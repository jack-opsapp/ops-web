/**
 * Pure derivation of `PhaseC` for a thread, given the latest matching row
 * from `ai_draft_history`. Sits beside `grouping.ts` and `band-selection.ts`
 * so all inbox derivation logic is in one place — none of it touches
 * Supabase or React; consumers compose them with whatever orchestration
 * layer fits.
 *
 * Mapping:
 *   status='drafted'                                              → ai_drafted
 *   status='sent' AND sent_without_changes AND
 *                       thread.latestDirection === 'outbound'     → auto_sent
 *   anything else (or no row)                                     → none
 *
 * The `latestDirection === 'outbound'` guard is intentional: it prevents
 * `auto_sent` from sticking after a new inbound reply lands on a thread
 * Claude already auto-replied to. Without it, the thread would be silently
 * suppressed from the column (`grouping.ts` returns null for `auto_sent`)
 * even though the operator now needs to see the new message.
 */

import type { PhaseC } from "@/lib/types/email-thread";

/** Subset of `email_threads` columns the derivation cares about. */
export interface PhaseCThreadInput {
  latestDirection: "inbound" | "outbound" | null;
}

/** Subset of `ai_draft_history` columns the derivation cares about. */
export interface PhaseCDraftRow {
  status: string;
  sent_without_changes: boolean | null;
}

export function derivePhaseC(
  thread: PhaseCThreadInput,
  latestDraftRow: PhaseCDraftRow | null,
): PhaseC {
  if (!latestDraftRow) return "none";
  if (latestDraftRow.status === "drafted") return "ai_drafted";
  if (
    latestDraftRow.status === "sent" &&
    Boolean(latestDraftRow.sent_without_changes) &&
    thread.latestDirection === "outbound"
  ) {
    return "auto_sent";
  }
  return "none";
}
