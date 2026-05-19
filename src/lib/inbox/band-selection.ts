/**
 * Pure band-selection function for the redesigned inbox detail pane.
 *
 * Precedence (top wins):
 *   closed       → "closed"          (thread is resolved; soft success)
 *   needsInput   → "needs-input"     (Claude is blocked waiting on user)
 *   auto_sent    → "auto-sent"       (Claude already replied; banner)
 *   aiSummary    → "summary"         (lavender summary band)
 *   else         → null              (no band)
 *
 * "Your turn" is no longer a band — it surfaces through
 * <FloatingYourTurnBadge>, which is mounted by InboxRoute based on the
 * row-state predicate (`isYourMove(...)`) and floats above the message list
 * instead of displacing it.
 */

import type { PhaseC } from "@/lib/types/email-thread";

export type BandKind =
  | "summary"
  | "needs-input"
  | "auto-sent"
  | "closed";

export interface BandThreadInput {
  closed: boolean;
  agent: { needsInput: boolean };
  phaseC: PhaseC;
  aiSummary: string | null;
}

export function selectBand(thread: BandThreadInput): BandKind | null {
  if (thread.closed) return "closed";
  if (thread.agent.needsInput) return "needs-input";
  if (thread.phaseC === "auto_sent") return "auto-sent";
  if (thread.aiSummary) return "summary";
  return null;
}

export type ActionBandKind = Exclude<BandKind, "summary">;

/**
 * Returns the *action band* for a thread — the one that carries the obligation.
 * Distinct from `selectBand`: this never returns "summary" (the summary band
 * is selected independently and stacks above the action band per spec § 5.2).
 *
 * Precedence (top wins):
 *   closed       → "closed"
 *   needsInput   → "needs-input"
 *   auto_sent    → "auto-sent"
 *   else         → null
 */
export function selectActionBand(thread: BandThreadInput): ActionBandKind | null {
  if (thread.closed) return "closed";
  if (thread.agent.needsInput) return "needs-input";
  if (thread.phaseC === "auto_sent") return "auto-sent";
  return null;
}
