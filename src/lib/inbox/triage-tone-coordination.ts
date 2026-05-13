/**
 * Accent-slot coordination between the floating YOUR TURN badge and the
 * detail-header triage chip.
 *
 * The OPS design system allows one steel-blue accent (`#6F94B0`) per
 * screen, maximum. When the `<FloatingYourTurnBadge>` is mounted it claims
 * that slot — any other surface on the same screen that would otherwise
 * render with `tone="accent"` must demote.
 *
 * Today the only conflicting surface is P4-1's per-rail triage chip
 * rendered inside `<ThreadDetailHeader>`'s title row. That chip uses
 * `tone="accent"` exclusively for `computeStateTag(...).kind === "yours"`
 * (inbound + AWAITING_REPLY + ≤1 week elapsed). Every "yours" thread is
 * also YOUR_MOVE, so the badge is mounted whenever the chip would be
 * accent — the demotion fires deterministically.
 *
 * Other tones (rose for overdue/alarmed, tan for stale theirs, lavender
 * for drafts/auto-sent, neutral for everything else) carry meaning the
 * accent slot doesn't and pass through unchanged.
 */

import type { StateTagTone } from "@/components/ops/inbox/state-tag";

/**
 * Resolves the final tone for the detail-header triage chip given the
 * computed tone and whether the floating badge currently owns the accent
 * slot. Returns `undefined` when the chip should not render (matches the
 * input contract — callers pass `undefined` when no triage state exists).
 */
export function resolveTriageTone(
  computedTone: StateTagTone | undefined,
  floatingBadgeActive: boolean,
): StateTagTone | undefined {
  if (computedTone === undefined) return undefined;
  if (floatingBadgeActive && computedTone === "accent") return "neutral";
  return computedTone;
}
