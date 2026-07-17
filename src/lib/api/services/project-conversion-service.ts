/**
 * OPS Web — Project Conversion Service (Won-Conversion Unification)
 *
 * The single, canonical path that converts a won opportunity into an
 * operational project. Three entry points route through here so the link
 * contract, payload, dedup, disposition, and idempotency can never diverge:
 *
 *   1. The pipeline "Mark as Won" flow — winning a deal converts it in one
 *      atomic transaction (POST /api/opportunities/[id]/convert).
 *   2. The same flow's "link existing" branch — the operator picks a
 *      duplicate candidate instead of creating a new project.
 *   3. The AI approval-queue `create_project` action — the operator approving
 *      the queue item is the explicit confirmation. It creates the project
 *      WITHOUT winning the opportunity (stage is left untouched).
 *
 * The conversion is performed entirely by the unified SECURITY DEFINER RPC
 * `convert_opportunity_to_project`, which — in ONE transaction — wins the
 * opportunity (idempotently), creates OR links the project, carries lat/long,
 * writes the four-column link contract, re-links estimates (both ref + text
 * mirror), materializes LABOR line items into tasks, attaches site-visit
 * photos, and records a `converted_to_project` disposition. It rolls back on
 * any error — no half-conversion and no orphan project is reachable, so the
 * old bare-project pre-create + orphan-cleanup dance is gone.
 *
 * `get_conversion_preflight` is the read-only companion: it surfaces an
 * already-linked project, likely-duplicate candidates, the client's other
 * projects, and the auto-name preview — so the Won dialog can offer "link
 * instead of create" before anything is written.
 *
 * Service-role only: both RPCs run in a server context whose Supabase client
 * carries the service role (see /api/opportunities/[id]/convert + /preflight
 * and the approval queue).
 */

import { requireSupabase } from "@/lib/supabase/helpers";

// Literal names so the calls resolve to the typed `rpc` overload — args and
// return are checked against the generated database types (regenerated after the
// legacy guarded RPC was dropped).
const CONVERSION_RPC = "convert_opportunity_to_project";
const PREFLIGHT_RPC = "get_conversion_preflight";

interface ConversionCommonParams {
  opportunityId: string;
  companyId: string;
  /**
   * Final deal value from the Won dialog, if the operator entered one. The RPC
   * applies precedence p_actual_value ?? actual_value ?? estimated_value.
   */
  actualValue?: number | null;
  /**
   * Snapshot guard — the stage the caller saw when the dialog opened. If the
   * live stage no longer matches, the RPC short-circuits (snapshot_mismatch)
   * and converts nothing.
   */
  expectedStage?: string | null;
  /**
   * Approval-queue proposals may seed the project notes with the AI scope.
   * Carried only to `notes` (never invented elsewhere).
   */
  notesSeed?: string | null;
  /**
   * An operator-typed name (the Won dialog / create-form "rename" escape
   * hatch). Present ⇒ the project is hand-set (title_is_auto=false). Absent ⇒
   * the naming trigger auto-names from the address.
   */
  titleOverride?: string | null;
}

export type ConvertOpportunityParams =
  | (ConversionCommonParams & {
      sourcePath: "won_dialog";
      decidedBy: string;
      expectedAssignmentVersion: number;
      evidence: { surface: "web_won_dialog" };
    })
  | (ConversionCommonParams & {
      sourcePath: "approval_queue";
      decidedBy: string;
      expectedAssignmentVersion: number;
      evidence: {
        agent_action_id: string;
        approval_mode: "operator_approved";
      };
    })
  | (ConversionCommonParams & {
      sourcePath: "email_accept";
      decidedBy: null;
      expectedAssignmentVersion: number;
      evidence: {
        connection_id: string;
        email_thread_id: string;
        provider_thread_id: string;
        decision: "auto_advance_won";
      };
    })
  | (ConversionCommonParams & {
      sourcePath: "email_likely_won";
      decidedBy: null;
      expectedAssignmentVersion: number;
      evidence: {
        connection_id: string;
        provider_thread_id: string;
        provider_message_id: string;
        decision: "likely_won";
      };
    });

type HumanConversionParams = Extract<
  ConvertOpportunityParams,
  { decidedBy: string }
>;

export type LinkOpportunityToProjectParams = HumanConversionParams & {
  /** Existing project to adopt — no NEW project is created. */
  linkToProjectId: string;
};

export type ProjectConversionErrorKind =
  | "conflict"
  | "access_denied"
  | "not_found"
  | "unexpected";

export class ProjectConversionError extends Error {
  readonly name = "ProjectConversionError";

  constructor(
    public readonly kind: ProjectConversionErrorKind,
    message: string,
    public readonly options: {
      guardReason?: string;
      assignedTo?: string | null;
      assignmentVersion?: number;
      rpcCode?: string;
      rpcMessage?: string;
    } = {}
  ) {
    super(message);
  }

  get guardReason() {
    return this.options.guardReason;
  }

  get assignedTo() {
    return this.options.assignedTo;
  }

  get assignmentVersion() {
    return this.options.assignmentVersion;
  }

  get rpcCode() {
    return this.options.rpcCode;
  }

  get rpcMessage() {
    return this.options.rpcMessage;
  }
}

export interface ConvertOpportunityResult {
  /** True if THIS call performed the conversion (created or linked + won). */
  converted: boolean;
  /** Internal linked project id; browser routes mask it when inaccessible. */
  projectId: string;
  opportunityId: string;
  /** True when the opportunity was already converted (idempotent no-op). */
  alreadyConverted: boolean;
  /** Set when this call wrote the disposition row. */
  dispositionId?: string;
  /** Number of estimates re-pointed to the project. */
  relinkedEstimates?: number;
  /** Number of LABOR line items materialized into project_tasks. */
  materializedTasks?: number;
  /** Number of site-visit photos attached to the project. */
  attachedPhotos?: number;
  /** True when an existing project was linked rather than a new one created. */
  linkedExisting?: boolean;
  /** True when this call moved the opportunity to `won` (+ a stage transition). */
  won?: boolean;
  guardReason?: string | null;
  assignedTo: string | null;
  assignmentVersion: number;
  conversionEventId?: string;
  projectAccessible: boolean;
}

// ─── Preflight (read-only dedup + auto-name preview) ──────────────────────────

export interface ConversionPreflightCandidate {
  projectId: string;
  title: string;
  address: string | null;
  /** high = same client + address; medium = same address, other/unknown client. */
  confidence: "high" | "medium";
  signals: string[];
}

export interface ConversionPreflightOtherProject {
  projectId: string;
  title: string;
  address: string | null;
  status: string;
}

export interface ConversionPreflight {
  assignmentVersion: number;
  alreadyConverted: boolean;
  projectAccessible: boolean;
  /** Set when this opportunity has already been converted. */
  existingLinkedProject: { id: string; title: string } | null;
  /** Likely-the-same-job projects to offer "link instead of create". */
  duplicateCandidates: ConversionPreflightCandidate[];
  /** The client's other projects (informational — CLIENT-HAS-OTHERS). */
  otherClientProjects: ConversionPreflightOtherProject[];
  /** derive_project_name() preview (street line / client fallback / placeholder). */
  suggestedName: string;
}

// ─── Raw RPC payloads ─────────────────────────────────────────────────────────

interface UnifiedConversionResult {
  converted: boolean;
  already_converted: boolean;
  project_id?: string;
  opportunity_id?: string;
  disposition_id?: string;
  relinked_estimates?: number;
  materialized_tasks?: number;
  attached_photos?: number;
  linked_existing?: boolean;
  won?: boolean;
  guard_reason?: string;
  assigned_to?: string | null;
  assignment_version?: number;
  conversion_event_id?: string;
  project_accessible?: boolean;
}

interface RawPreflight {
  assignment_version?: number;
  already_converted?: boolean;
  project_accessible?: boolean;
  existing_linked_project?: { id: string; title: string } | null;
  duplicate_candidates?: Array<{
    project_id: string;
    title: string;
    address: string | null;
    confidence: "high" | "medium";
    signals: string[];
  }>;
  other_client_projects?: Array<{
    project_id: string;
    title: string;
    address: string | null;
    status: string;
  }>;
  suggested_name?: string;
}

interface RpcFailure {
  code?: string;
  message: string;
}

type UntypedRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: RpcFailure | null }>;
};

function classifyRpcError(
  error: RpcFailure,
  operation: string
): ProjectConversionError {
  const rpcMessage = error.message ?? "Unknown database error";
  if (rpcMessage.includes("access_denied")) {
    return new ProjectConversionError("access_denied", "Access denied", {
      rpcCode: error.code,
      rpcMessage,
    });
  }
  if (
    rpcMessage.includes("opportunity_not_found") ||
    rpcMessage.includes("project_link_unavailable")
  ) {
    return new ProjectConversionError("not_found", "Resource unavailable", {
      rpcCode: error.code,
      rpcMessage,
    });
  }
  return new ProjectConversionError(
    "unexpected",
    `${operation} failed: ${rpcMessage}`,
    { rpcCode: error.code, rpcMessage }
  );
}

/**
 * Run the unified convert RPC and normalize its result. `linkToProjectId` set
 * ⇒ link an existing project (no new one); null ⇒ create. Win is derived from
 * the source path: won_dialog and deterministic email acceptance win the
 * opportunity atomically; approval_queue creates the project without touching
 * the opportunity's stage.
 */
async function runConversion(
  params: ConvertOpportunityParams,
  linkToProjectId: string | null
): Promise<ConvertOpportunityResult> {
  if (
    !Number.isSafeInteger(params.expectedAssignmentVersion) ||
    params.expectedAssignmentVersion < 0
  ) {
    throw new ProjectConversionError(
      "unexpected",
      "A valid assignment snapshot is required",
      { rpcMessage: "invalid_assignment_snapshot" }
    );
  }

  const supabase = requireSupabase();
  const winOpportunity = params.sourcePath !== "approval_queue";

  if (
    params.sourcePath === "email_accept" ||
    params.sourcePath === "email_likely_won"
  ) {
    if (
      params.decidedBy !== null ||
      !Number.isSafeInteger(params.expectedAssignmentVersion) ||
      (params.expectedAssignmentVersion as number) < 0 ||
      !params.evidence
    ) {
      throw new Error(
        "Actorless email conversion requires exact evidence and an assignment snapshot"
      );
    }
    const keys = Object.keys(params.evidence).sort();
    const expectedKeys =
      params.sourcePath === "email_accept"
        ? ["connection_id", "decision", "email_thread_id", "provider_thread_id"]
        : [
            "connection_id",
            "decision",
            "provider_message_id",
            "provider_thread_id",
          ];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new Error("Actorless email conversion evidence is invalid");
    }
    const stringEvidence = params.evidence as Record<string, unknown>;
    if (
      Object.entries(stringEvidence).some(
        ([key, value]) =>
          key !== "decision" &&
          (typeof value !== "string" || value.trim().length === 0)
      ) ||
      (params.sourcePath === "email_accept" &&
        params.evidence.decision !== "auto_advance_won") ||
      (params.sourcePath === "email_likely_won" &&
        params.evidence.decision !== "likely_won")
    ) {
      throw new Error("Actorless email conversion evidence is invalid");
    }
  }

  const { data, error } = await (supabase as unknown as UntypedRpcClient).rpc(
    CONVERSION_RPC,
    {
      p_company_id: params.companyId,
      p_opportunity_id: params.opportunityId,
      p_actual_value: params.actualValue ?? null,
      p_expected_stage: params.expectedStage ?? null,
      p_decided_by: params.decidedBy,
      p_notes: params.notesSeed ?? null,
      p_title_override: params.titleOverride ?? null,
      p_link_to_project_id: linkToProjectId,
      p_source_path: params.sourcePath,
      p_win_opportunity: winOpportunity,
      p_evidence: params.evidence,
      p_expected_assignment_version: params.expectedAssignmentVersion,
    }
  );

  if (error) {
    throw classifyRpcError(error, "Project conversion RPC");
  }

  const result = (data ?? {}) as UnifiedConversionResult;

  // Snapshot guard — the opportunity changed underneath the operator.
  if (
    !result.converted &&
    (result.guard_reason === "snapshot_mismatch" ||
      result.guard_reason === "assignment_snapshot_mismatch" ||
      result.guard_reason === "manual_stage_override")
  ) {
    throw new ProjectConversionError(
      "conflict",
      "Opportunity changed before conversion completed",
      {
        guardReason: result.guard_reason,
        assignedTo: result.assigned_to ?? null,
        assignmentVersion: result.assignment_version,
        rpcMessage: result.guard_reason,
      }
    );
  }

  // Idempotent no-op — the opportunity is already linked to a project.
  if (!result.converted && result.already_converted) {
    if (!result.project_id) {
      throw new ProjectConversionError(
        "unexpected",
        "Project conversion RPC returned an already-converted result without a project id"
      );
    }
    return {
      converted: false,
      alreadyConverted: true,
      projectId: result.project_id,
      opportunityId: params.opportunityId,
      won: result.won,
      guardReason: result.guard_reason,
      assignedTo: result.assigned_to ?? null,
      assignmentVersion:
        result.assignment_version ?? params.expectedAssignmentVersion,
      conversionEventId: result.conversion_event_id,
      projectAccessible: result.project_accessible === true,
    };
  }

  if (!result.project_id) {
    throw new ProjectConversionError(
      "unexpected",
      "Project conversion RPC returned no project id"
    );
  }

  return {
    converted: result.converted,
    alreadyConverted: false,
    projectId: result.project_id,
    opportunityId: params.opportunityId,
    dispositionId: result.disposition_id,
    relinkedEstimates: result.relinked_estimates,
    materializedTasks: result.materialized_tasks,
    attachedPhotos: result.attached_photos,
    linkedExisting: result.linked_existing,
    won: result.won,
    guardReason: result.guard_reason,
    assignedTo: result.assigned_to ?? null,
    assignmentVersion:
      result.assignment_version ?? params.expectedAssignmentVersion,
    conversionEventId: result.conversion_event_id,
    projectAccessible: result.project_accessible === true,
  };
}

export const ProjectConversionService = {
  /**
   * Convert a won opportunity into a NEW linked project. Idempotent: an
   * already-linked opportunity returns the existing project (never a second
   * one). The immutable conversion event owns notification delivery.
   */
  async convertOpportunityToProject(
    params: ConvertOpportunityParams
  ): Promise<ConvertOpportunityResult> {
    return runConversion(params, null);
  },

  /**
   * Win a deal by LINKING it to an existing project instead of creating a new
   * one (the Won dialog's "link" branch / dedup candidate selection). The
   * target's status/title are untouched; only the link contract, estimate
   * relink, task/photo dedup, disposition, and immutable conversion event are
   * written.
   */
  async linkOpportunityToExistingProject(
    params: LinkOpportunityToProjectParams
  ): Promise<ConvertOpportunityResult> {
    return runConversion(params, params.linkToProjectId);
  },

  /**
   * Read-only conversion preflight: existing link, duplicate candidates, the
   * client's other projects, and the auto-name preview. Drives the enriched
   * Won dialog's dedup states before any write.
   */
  async getConversionPreflight(
    opportunityId: string,
    companyId: string,
    actorUserId: string
  ): Promise<ConversionPreflight> {
    const supabase = requireSupabase();
    const { data, error } = await (supabase as unknown as UntypedRpcClient).rpc(
      PREFLIGHT_RPC,
      {
        p_opportunity_id: opportunityId,
        p_company_id: companyId,
        p_actor_user_id: actorUserId,
      }
    );

    if (error) {
      throw classifyRpcError(error, "Conversion preflight");
    }

    const raw = (data ?? {}) as RawPreflight;

    return {
      assignmentVersion: raw.assignment_version ?? -1,
      alreadyConverted: raw.already_converted === true,
      projectAccessible: raw.project_accessible === true,
      existingLinkedProject: raw.existing_linked_project
        ? {
            id: raw.existing_linked_project.id,
            title: raw.existing_linked_project.title,
          }
        : null,
      duplicateCandidates: (raw.duplicate_candidates ?? []).map((c) => ({
        projectId: c.project_id,
        title: c.title,
        address: c.address ?? null,
        confidence: c.confidence,
        signals: c.signals ?? [],
      })),
      otherClientProjects: (raw.other_client_projects ?? []).map((p) => ({
        projectId: p.project_id,
        title: p.title,
        address: p.address ?? null,
        status: p.status,
      })),
      suggestedName: raw.suggested_name ?? "",
    };
  },
};

export default ProjectConversionService;
