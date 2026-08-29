import { getLeadAccess } from "@/lib/permissions/lead-access-policy";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import { ProjectStatus } from "@/lib/types/models";
import type { OpportunityStage } from "@/lib/types/pipeline";
import {
  useLeadWonPromptStore,
  type LeadWonProposal,
} from "@/stores/lead-won-prompt-store";

/**
 * Lead-won prompt evaluation + commits — bug 9a89b951, web half of D3
 * (2026-08-18 lead-project-identity design).
 *
 * The DB link trigger no longer wins a linked lead when its project enters an
 * active status. Every successful HUMAN status write calls `propose()`
 * instead; when the linked lead is open, un-declined, and editable by the
 * actor, a proposal lands in the LeadWonPrompt store and the root-mounted
 * host asks. Confirming commits through `public.win_linked_opportunity`
 * (SECURITY INVOKER — RLS re-checks authority; the RPC re-verifies the link
 * under a row lock, is idempotent on already-won, refuses terminal stages,
 * and stamps the human actor into stage_transitions). Declining writes
 * `won_prompt_declined_at/_by` once — the lead is never asked about again,
 * on any client.
 *
 * Evaluation verifies against the SERVER rows — TanStack caches can be stale
 * or partial — and is best-effort by design: offline, RLS-invisible, or
 * pre-migration environments all evaluate to "no ask now", and the next
 * qualifying transition re-evaluates. iOS behaves identically
 * (ops-ios OPS/Views/Components/Project/LeadWonPrompt.swift).
 */

/** Project statuses that propose winning the linked lead (D3: any active status). */
export const LEAD_WON_PROPOSING_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
]);

/** The columns evaluation reads — raw snake_case, no model mapping needed. */
export interface LeadWonOpportunityRow {
  id: string;
  stage: string;
  assigned_to: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  title: string | null;
  contact_name: string | null;
  won_prompt_declined_at: string | null;
}

const ANSWERED_OR_TERMINAL_STAGES = new Set(["won", "lost", "discarded"]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimmedOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure decision core — unit-tested with no I/O. Mirrors the iOS
 * LeadWonPromptEvaluator case-for-case:
 *   - only proposing statuses ask;
 *   - no server row (offline / RLS-invisible / unlinked) → no ask;
 *   - a recorded decline is permanent → no ask;
 *   - won is moot, lost/discarded are terminal → no ask;
 *   - never surface an action the viewer cannot take → no ask without edit.
 */
export function evaluateLeadWonProposal(args: {
  newStatus: ProjectStatus;
  projectId: string;
  userId: string | null;
  row: LeadWonOpportunityRow | null;
  canEditLead: (row: LeadWonOpportunityRow) => boolean;
}): LeadWonProposal | null {
  const { newStatus, projectId, userId, row, canEditLead } = args;
  if (!LEAD_WON_PROPOSING_STATUSES.has(newStatus)) return null;
  if (!userId) return null;
  if (!row) return null;
  if (row.won_prompt_declined_at !== null) return null;
  if (ANSWERED_OR_TERMINAL_STAGES.has(row.stage)) return null;
  if (!canEditLead(row)) return null;
  return {
    opportunityId: row.id,
    projectId,
    leadLabel: trimmedOrNull(row.title) ?? trimmedOrNull(row.contact_name),
    userId,
  };
}

/** Live permission check for a raw row — getLeadAccess over the real stores. */
function canEditLeadRow(userId: string, row: LeadWonOpportunityRow): boolean {
  return getLeadAccess(usePermissionStore.getState(), userId, {
    assignedTo: row.assigned_to,
    stage: row.stage as OpportunityStage,
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  }).canEdit;
}

async function evaluateAgainstServer(
  projectId: string,
  newStatus: ProjectStatus
): Promise<LeadWonProposal | null> {
  const userId = useAuthStore.getState().currentUser?.id ?? null;
  if (!userId) return null;

  const supabase = requireSupabase();

  // The project row is the link's source of truth (opportunity_ref is the
  // normalized FK; opportunity_id is the legacy text mirror). RLS: the actor
  // just changed this project's status, so they can read it.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("opportunity_ref, opportunity_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project) return null;

  const rawLink =
    (project.opportunity_ref as string | null) ??
    (project.opportunity_id as string | null);
  const link = rawLink?.trim().toLowerCase() ?? "";
  // Legacy opportunity_id rows can hold non-uuid text; the DB link trigger
  // ignores those and so does the prompt.
  if (!UUID_PATTERN.test(link)) return null;

  const { data: row, error: rowError } = await supabase
    .from("opportunities")
    .select(
      "id, stage, assigned_to, archived_at, deleted_at, title, contact_name, won_prompt_declined_at"
    )
    .eq("id", link)
    .is("deleted_at", null)
    .maybeSingle();
  // Fetch errors (offline; or won_prompt_declined_at not yet migrated) and
  // RLS-invisible rows both land here: no ask now, and the next qualifying
  // status change re-evaluates. Honest for an online-only decision.
  if (rowError || !row) return null;

  return evaluateLeadWonProposal({
    newStatus,
    projectId,
    userId,
    row: row as unknown as LeadWonOpportunityRow,
    canEditLead: (candidate) => canEditLeadRow(userId, candidate),
  });
}

export const LeadWonPromptService = {
  /**
   * Best-effort proposal from a successful HUMAN project-status write.
   * NEVER rejects and never blocks the mutation that called it — call sites
   * invoke it as `void LeadWonPromptService.propose(...)`. Returns the
   * settled promise so tests can await the full evaluation.
   */
  async propose(projectId: string, newStatus: ProjectStatus): Promise<void> {
    if (!LEAD_WON_PROPOSING_STATUSES.has(newStatus)) return;
    try {
      const proposal = await evaluateAgainstServer(projectId, newStatus);
      if (proposal) {
        useLeadWonPromptStore.getState().enqueue(proposal);
      }
    } catch {
      // Deliberately swallowed: evaluation is best-effort (see module doc).
    }
  },

  /**
   * Commit the win through the guarded RPC (see module doc for its
   * contract). Throws on failure — the host reports by toast.
   */
  async winLinkedOpportunity(proposal: LeadWonProposal): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase.rpc("win_linked_opportunity", {
      p_opportunity_id: proposal.opportunityId,
      p_project_id: proposal.projectId,
      p_user_id: proposal.userId,
    });
    if (error) {
      throw new Error(`Failed to mark lead won: ${error.message}`, {
        cause: error,
      });
    }
  },

  /**
   * Record the decline. Non-null won_prompt_declined_at suppresses every
   * future ask for this lead on every client. First answer wins — the
   * `.is()` filter never overwrites an existing record. Zero updated rows
   * (already declined, or RLS filtered) is success by that definition.
   */
  async declineWonPrompt(proposal: LeadWonProposal): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("opportunities")
      .update({
        won_prompt_declined_at: new Date().toISOString(),
        won_prompt_declined_by: proposal.userId,
      })
      .eq("id", proposal.opportunityId)
      .is("won_prompt_declined_at", null);
    if (error) {
      throw new Error(`Failed to record lead-won decline: ${error.message}`, {
        cause: error,
      });
    }
  },
};
