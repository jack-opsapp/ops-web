/**
 * Pure band-selection function for the redesigned inbox detail pane.
 *
 * Precedence (top wins):
 *   closed       → "closed"          (thread is resolved; soft success)
 *   needsInput   → "needs-input"     (Claude is blocked waiting on user)
 *   auto_sent    → "auto-sent"       (Claude already replied; banner)
 *   aiSummary    → "summary"         (lavender summary band)
 *   ballInCourt  → "ball-yours"      (your turn — accent CTA band)
 *   else         → null              (no band)
 */

import type { PhaseC } from "@/lib/inbox/grouping";

export type BandKind =
  | "summary"
  | "needs-input"
  | "ball-yours"
  | "auto-sent"
  | "closed";

export interface BandThreadInput {
  closed: boolean;
  agent: { needsInput: boolean };
  phaseC: PhaseC;
  aiSummary: string | null;
  /** Who owes the next move. "user" surfaces the "Your turn" CTA band. */
  ballInCourt: "user" | "them" | null;
}

export function selectBand(thread: BandThreadInput): BandKind | null {
  if (thread.closed) return "closed";
  if (thread.agent.needsInput) return "needs-input";
  if (thread.phaseC === "auto_sent") return "auto-sent";
  if (thread.aiSummary) return "summary";
  if (thread.ballInCourt === "user") return "ball-yours";
  return null;
}
