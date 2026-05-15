/**
 * Pure thread-grouping function for the redesigned inbox left column.
 *
 * Groups (top → bottom) — state-based, faithful to canonical V4Column
 * (`design_handoff_inbox_redesign/reference/v4-states.jsx:132-138`).
 * The column sorts by ball-in-court state, not recency.
 *
 *   NEEDS_INPUT     → agent.needsInput true; Claude blocked, owes user a question
 *   NEEDS_REPLY     → AWAITING_REPLY; the operator owes a reply
 *   DRAFTS_READY    → Claude or operator has a draft sitting in the slot
 *   AWAITING_THEM   → operator already replied, ball with counterparty (recent)
 *   LATER           → quiet / older threads
 *
 * Suppressed entirely:
 *   - threads with `phaseC === "auto_sent"` (Claude already replied; quiet pile)
 *   - threads with `closed === true`        (resolved; archived from list)
 *
 * Group precedence is the order above — first match wins. Within each group,
 * threads sort newest-first by `ts`.
 */

// Re-exported from the domain layer so component code can import either path.
// The canonical definition lives with EmailThread so the wire shape, the
// service derivation, and the grouping/band consumers can never drift apart.
export type { PhaseC } from "@/lib/types/email-thread";
import type { PhaseC } from "@/lib/types/email-thread";

export type GroupKey =
  | "NEEDS_INPUT"
  | "NEEDS_REPLY"
  | "DRAFTS_READY"
  | "AWAITING_THEM"
  | "LATER";

export const GROUP_ORDER: readonly GroupKey[] = [
  "NEEDS_INPUT",
  "NEEDS_REPLY",
  "DRAFTS_READY",
  "AWAITING_THEM",
  "LATER",
] as const;

export interface ThreadForGrouping {
  id: string;
  /** Unix milliseconds — most recent activity. */
  ts: number;
  labels: string[];
  agent: { needsInput: boolean };
  phaseC: PhaseC;
  closed: boolean;
  /** True when there is at least one unread inbound message. Visual state only. */
  unread: boolean;
  /** Set when the thread has a saved draft. Drives DRAFTS_READY when phaseC is "none". */
  draftKind?: "ai" | "user" | null;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const RECENT_WINDOW_MS = 14 * DAY_MS;

function classify(thread: ThreadForGrouping, now: number): GroupKey | null {
  if (thread.closed) return null;
  if (thread.phaseC === "auto_sent") return null;
  if (thread.agent.needsInput) return "NEEDS_INPUT";
  if (thread.phaseC === "ai_drafted") return "DRAFTS_READY";
  if (thread.draftKind === "ai" || thread.draftKind === "user") return "DRAFTS_READY";
  if (thread.labels.includes("AWAITING_REPLY")) return "NEEDS_REPLY";
  if (now - thread.ts <= RECENT_WINDOW_MS) return "AWAITING_THEM";
  return "LATER";
}

export function groupThreads<T extends ThreadForGrouping>(
  threads: T[],
  now: number,
): Map<GroupKey, T[]> {
  const out = new Map<GroupKey, T[]>();
  for (const key of GROUP_ORDER) out.set(key, []);

  for (const thread of threads) {
    const key = classify(thread, now);
    if (key) out.get(key)!.push(thread);
  }

  for (const key of GROUP_ORDER) {
    out.get(key)!.sort((a, b) => b.ts - a.ts);
  }

  return out;
}
