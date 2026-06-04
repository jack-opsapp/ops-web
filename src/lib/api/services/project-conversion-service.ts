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
import { NotificationService } from "./notification-service";

// The unified RPCs are not yet in the generated database types (the post-drop
// regen lands in the cleanup phase). Hold the names in `string`-typed consts so
// the calls resolve to the loosely-typed `rpc` overload — mirrors the merge
// service's `supabase.rpc(rpc, args)` pattern.
const CONVERSION_RPC: string = "convert_opportunity_to_project";
const PREFLIGHT_RPC: string = "get_conversion_preflight";

export type ConversionSourcePath = "won_dialog" | "approval_queue";

export interface ConvertOpportunityParams {
  opportunityId: string;
  companyId: string;
  /** The operator confirming the conversion (decided_by + created_by). */
  decidedBy?: string | null;
  /** Which surface triggered the conversion (recorded in the disposition). */
  sourcePath: ConversionSourcePath;
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

export interface LinkOpportunityToProjectParams
  extends ConvertOpportunityParams {
  /** Existing project to adopt — no NEW project is created. */
  linkToProjectId: string;
}

export interface ConvertOpportunityResult {
  /** True if THIS call performed the conversion (created or linked + won). */
  converted: boolean;
  /** Always the linked project id (existing one when already converted). */
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
}

interface RawPreflight {
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

/**
 * Run the unified convert RPC and normalize its result. `linkToProjectId` set
 * ⇒ link an existing project (no new one); null ⇒ create. Win is derived from
 * the source path: won_dialog wins the opportunity atomically; approval_queue
 * creates the project WITHOUT touching the opportunity's stage.
 */
async function runConversion(
  params: ConvertOpportunityParams,
  linkToProjectId: string | null
): Promise<ConvertOpportunityResult> {
  const supabase = requireSupabase();
  const winOpportunity = params.sourcePath === "won_dialog";

  const { data, error } = await supabase.rpc(CONVERSION_RPC, {
    p_company_id: params.companyId,
    p_opportunity_id: params.opportunityId,
    p_actual_value: params.actualValue ?? null,
    p_expected_stage: params.expectedStage ?? null,
    p_decided_by: params.decidedBy ?? null,
    p_notes: params.notesSeed ?? null,
    p_title_override: params.titleOverride ?? null,
    p_link_to_project_id: linkToProjectId,
    p_source_path: params.sourcePath,
    p_win_opportunity: winOpportunity,
  });

  if (error) {
    throw new Error(`Project conversion RPC failed: ${error.message}`);
  }

  const result = (data ?? {}) as UnifiedConversionResult;

  // Snapshot guard — the opportunity changed underneath the operator.
  if (!result.converted && result.guard_reason === "snapshot_mismatch") {
    throw new Error(
      "Opportunity changed before conversion completed — please retry"
    );
  }

  // Idempotent no-op — the opportunity is already linked to a project.
  if (!result.converted && result.already_converted) {
    return {
      converted: false,
      alreadyConverted: true,
      projectId: (result.project_id as string) ?? "",
      opportunityId: params.opportunityId,
    };
  }

  return {
    converted: result.converted,
    alreadyConverted: false,
    projectId: (result.project_id as string) ?? "",
    opportunityId: params.opportunityId,
    dispositionId: result.disposition_id,
    relinkedEstimates: result.relinked_estimates,
    materializedTasks: result.materialized_tasks,
    attachedPhotos: result.attached_photos,
    linkedExisting: result.linked_existing,
    won: result.won,
  };
}

export const ProjectConversionService = {
  /**
   * Convert a won opportunity into a NEW linked project. Idempotent: an
   * already-linked opportunity returns the existing project (never a second
   * one). On a real creation, fires the "Project created" rail notification.
   */
  async convertOpportunityToProject(
    params: ConvertOpportunityParams
  ): Promise<ConvertOpportunityResult> {
    const result = await runConversion(params, null);

    // Rail notification on a genuine NEW-project creation only — never on the
    // idempotent no-op, and never on link-existing (handled separately, which
    // does not notify because the project already existed).
    if (result.converted && !result.linkedExisting && params.decidedBy) {
      const supabase = requireSupabase();
      const { data: oppRow } = await supabase
        .from("opportunities")
        .select("title")
        .eq("id", params.opportunityId)
        .eq("company_id", params.companyId)
        .maybeSingle();
      const oppTitle = (oppRow?.title as string) ?? "an opportunity";

      await NotificationService.create({
        userId: params.decidedBy,
        companyId: params.companyId,
        type: "mention",
        title: "Project created",
        body: `Created from ${oppTitle}`,
        persistent: false,
        actionUrl: `/dashboard?openProject=${result.projectId}&mode=view`,
        actionLabel: "View Project",
        projectId: result.projectId,
      });
    }

    return result;
  },

  /**
   * Win a deal by LINKING it to an existing project instead of creating a new
   * one (the Won dialog's "link" branch / dedup candidate selection). No new
   * project, no "project created" notification — the target's status/title are
   * untouched; only the link contract, estimate relink, task/photo dedup, and
   * disposition are written.
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
    companyId?: string | null
  ): Promise<ConversionPreflight> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(PREFLIGHT_RPC, {
      p_opportunity_id: opportunityId,
      p_company_id: companyId ?? null,
    });

    if (error) {
      throw new Error(`Conversion preflight failed: ${error.message}`);
    }

    const raw = (data ?? {}) as RawPreflight;

    return {
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
