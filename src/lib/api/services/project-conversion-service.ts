/**
 * OPS Web — Project Conversion Service (Lead Lifecycle P6)
 *
 * The single, canonical path that converts a won opportunity into an
 * operational project. Both entry points route through here so the link
 * contract, payload, disposition, and idempotency can never diverge:
 *
 *   1. The pipeline "Mark as Won" flow — winning a deal AUTOMATICALLY converts
 *      it (POST /api/opportunities/[id]/convert, fired after the won stage move).
 *   2. The AI approval-queue `create_project` action — the operator approving
 *      the queue item is the explicit confirmation.
 *
 * The conversion is performed by the guarded SECURITY DEFINER RPC
 * `execute_opportunity_project_conversion_guarded`, which writes the full
 * four-column link contract + estimates re-link + disposition row in ONE
 * transaction (rolls back on any error — no half-conversion is reachable).
 *
 * The opportunity STAYS at stage='won' and is NOT archived — it is the
 * preserved sales / attribution record, linked to the project via project_ref.
 * The project is the operational record.
 *
 * Service-role only: the RPC is granted to service_role exclusively, so this
 * service must run in a server context whose Supabase client carries the
 * service role (see /api/opportunities/[id]/convert and the approval queue).
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { ProjectService } from "./project-service";
import { NotificationService } from "./notification-service";
import { ProjectStatus } from "@/lib/types/models";

// The guarded conversion RPC is granted to service_role only. Held in a
// `string`-typed const so the call resolves to the loosely-typed rpc overload
// (the function is not yet in the generated database types — the migration is
// applied by the operator alongside the P5 migrations). Mirrors the merge
// service's `supabase.rpc(rpc, args)` pattern.
const CONVERSION_RPC: string =
  "execute_opportunity_project_conversion_guarded";

export type ConversionSourcePath = "won_dialog" | "approval_queue";

export interface ConvertOpportunityParams {
  opportunityId: string;
  companyId: string;
  /** The operator confirming the conversion (decided_by + created_by). */
  decidedBy?: string | null;
  /** Which surface triggered the conversion (recorded in the disposition). */
  sourcePath: ConversionSourcePath;
  /**
   * Final deal value from the Won dialog, if the operator entered one. Takes
   * precedence over the opportunity's stored values for the project's
   * estimated_value. When omitted, value precedence is actual_value ??
   * estimated_value.
   */
  actualValue?: number | null;
  /**
   * Snapshot guard — the stage the caller saw. If the live stage no longer
   * matches, the RPC short-circuits (snapshot_mismatch) and converts nothing.
   * The won-dialog path passes 'won'.
   */
  expectedStage?: string | null;
  /**
   * Approval-queue proposals may seed the project notes with the AI scope.
   * Carried only to `notes` (never invented elsewhere).
   */
  notesSeed?: string | null;
}

export interface ConvertOpportunityResult {
  /** True if THIS call created + linked the project. */
  converted: boolean;
  /** Always the linked project id (existing one when already converted). */
  projectId: string;
  opportunityId: string;
  /** Set when this call wrote the disposition row. */
  dispositionId?: string;
  /** Number of estimates re-pointed to the new project. */
  relinkedEstimates?: number;
  /** True when the opportunity was already converted (idempotent no-op). */
  alreadyConverted: boolean;
}

interface GuardedConversionResult {
  converted: boolean;
  project_id: string;
  opportunity_id?: string;
  disposition_id?: string;
  relinked_estimates?: number;
  guard_reason?: string;
  requested_project_id?: string;
}

export const ProjectConversionService = {
  /**
   * Convert a won opportunity into a linked project. Idempotent: if the
   * opportunity is already linked (project_ref set), this is a no-op that
   * returns the existing project — never a second project.
   */
  async convertOpportunityToProject(
    params: ConvertOpportunityParams
  ): Promise<ConvertOpportunityResult> {
    const supabase = requireSupabase();

    // ── Step 1: read the canonical opportunity row (raw columns) ──
    const { data: oppRow, error: oppErr } = await supabase
      .from("opportunities")
      .select(
        "id, company_id, title, client_id, address, description, " +
          "estimated_value, actual_value, source, source_email_id, " +
          "stage, project_ref, deleted_at"
      )
      .eq("id", params.opportunityId)
      .eq("company_id", params.companyId)
      .single();

    if (oppErr || !oppRow) {
      throw new Error(
        `Opportunity ${params.opportunityId} not found for conversion`
      );
    }
    const opp = oppRow as unknown as Record<string, unknown>;

    // ── Step 2: pre-check idempotency BEFORE creating any project ──
    // Avoids minting an orphan when the opportunity is already converted.
    if (opp.project_ref) {
      return {
        converted: false,
        alreadyConverted: true,
        projectId: opp.project_ref as string,
        opportunityId: params.opportunityId,
      };
    }

    // ── Step 3: build the project payload (canonical fill-forward) ──
    // Value precedence: operator-entered actualValue (Won dialog) ??
    // opportunity.actual_value ?? opportunity.estimated_value. Never invent.
    const carriedValue =
      params.actualValue ??
      (opp.actual_value != null ? Number(opp.actual_value) : null) ??
      (opp.estimated_value != null ? Number(opp.estimated_value) : null);

    // platform_metadata seeds from { source, source_email_id } until P2 lands
    // opportunities.source_metadata. Only set when at least one value exists —
    // never write an all-null object.
    const platformMetadata =
      opp.source || opp.source_email_id
        ? {
            source: (opp.source as string) ?? null,
            source_email_id: (opp.source_email_id as string) ?? null,
          }
        : null;

    // Won-dialog conversion lands the project at `accepted` (bible §10:
    // won → Project Accepted). Approval-queue proposals land at `rfq`.
    const status =
      params.sourcePath === "won_dialog"
        ? ProjectStatus.Accepted
        : ProjectStatus.RFQ;

    const projectId = await ProjectService.createProject({
      title: (opp.title as string) ?? "Untitled project",
      companyId: params.companyId,
      clientId: (opp.client_id as string) ?? null,
      address: (opp.address as string) ?? null,
      projectDescription: (opp.description as string) ?? null,
      notes: params.notesSeed ?? null,
      status,
      estimatedValue: carriedValue,
      source: (opp.source as string) ?? null,
      platformMetadata,
      // Mirrors are written authoritatively by the RPC inside the transaction;
      // we leave the link columns unset on the bare insert so the RPC is the
      // single source of truth for the four-column contract.
    });

    // ── Step 4: guarded conversion RPC (atomic link + relink + disposition) ──
    const { data, error } = await supabase.rpc(CONVERSION_RPC, {
      p_company_id: params.companyId,
      p_opportunity_id: params.opportunityId,
      p_project_id: projectId,
      p_expected_stage: params.expectedStage ?? null,
      p_decided_by: params.decidedBy ?? null,
      p_evidence: {
        source_path: params.sourcePath,
        actual_value: carriedValue,
      },
    });

    if (error) {
      // The link transaction failed and rolled back — the bare project we just
      // created is an orphan. Soft-delete it so a failed conversion leaves no
      // unlinked project behind, then surface the error.
      await ProjectService.deleteProject(projectId).catch(() => {});
      throw new Error(`Project conversion RPC failed: ${error.message}`);
    }

    const result = (data ?? {}) as GuardedConversionResult;

    // ── Step 5: handle the idempotency race ──
    // Another converter won between our pre-check and the RPC's lock. Our
    // freshly-created project is the loser's orphan — soft-delete it and return
    // the existing linked project.
    if (!result.converted && result.guard_reason === "already_converted") {
      await ProjectService.deleteProject(projectId).catch(() => {});
      return {
        converted: false,
        alreadyConverted: true,
        projectId: result.project_id,
        opportunityId: params.opportunityId,
      };
    }

    // Snapshot mismatch — the opportunity changed underneath the operator.
    // Roll our orphan back and surface a clear error to the caller.
    if (!result.converted && result.guard_reason === "snapshot_mismatch") {
      await ProjectService.deleteProject(projectId).catch(() => {});
      throw new Error(
        "Opportunity changed before conversion completed — please retry"
      );
    }

    // ── Step 6: rail notification (standard, click-through to the project) ──
    if (result.converted && params.decidedBy) {
      await NotificationService.create({
        userId: params.decidedBy,
        companyId: params.companyId,
        type: "mention",
        title: "Project created",
        body: `Created from ${(opp.title as string) ?? "an opportunity"}`,
        persistent: false,
        actionUrl: `/dashboard?openProject=${projectId}&mode=view`,
        actionLabel: "View Project",
        projectId,
      });
    }

    return {
      converted: result.converted,
      alreadyConverted: false,
      projectId: result.project_id ?? projectId,
      opportunityId: params.opportunityId,
      dispositionId: result.disposition_id,
      relinkedEstimates: result.relinked_estimates,
    };
  },
};

export default ProjectConversionService;
