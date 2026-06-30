// src/lib/api/services/conversation-state/accept-stage.ts
//
// Phase 2 — lead-state. Maps a deterministic AcceptSignal onto a stage action,
// per Jackson's split-by-confidence decision (2026-06-29):
//   high confidence  → auto-advance the lead to Won
//   low confidence   → surface a one-tap "Mark Won" (never auto)
// A thread the router held for human review is NEVER auto-advanced — a
// high-confidence accept there downgrades to a surfaced confirm.
//
// PURE: no DB, no network, no model. The caller (sync stage-evaluation) applies
// the action — writes the stage / raises the notification — and is responsible
// for respecting `stage_manually_set` before overwriting an operator's choice.

import type { AcceptSignal, LeadStage, RoutingDecision } from "./types";

export type AcceptStageAction =
  | { kind: "auto_advance_won"; reason: string }
  | { kind: "surface_mark_won"; reason: string }
  | { kind: "none" };

const TERMINAL_STAGES: ReadonlySet<LeadStage> = new Set<LeadStage>([
  "won",
  "lost",
  "discarded",
]);

/**
 * Decide what an accept signal should do to a lead's stage.
 *
 * - Terminal stage (won/lost/discarded) or no accept → none.
 * - High confidence + not held for review → auto-advance to Won.
 * - High confidence + held for review → surface a confirm (never auto).
 * - Low confidence → surface a confirm.
 */
export function decideAcceptStage(
  accept: AcceptSignal,
  currentStage: LeadStage,
  routing: RoutingDecision
): AcceptStageAction {
  if (TERMINAL_STAGES.has(currentStage)) return { kind: "none" };
  if (!accept.detected) return { kind: "none" };

  const basis = accept.basis.length > 0 ? accept.basis.join(", ") : "accept signal";

  if (accept.confidence === "high") {
    if (routing === "require_human_review") {
      return {
        kind: "surface_mark_won",
        reason: `High-confidence acceptance (${basis}) but the thread is held for review — confirm before marking Won.`,
      };
    }
    return {
      kind: "auto_advance_won",
      reason: `High-confidence acceptance (${basis}).`,
    };
  }

  return {
    kind: "surface_mark_won",
    reason: `Soft/verbal acceptance (${basis}) — confirm before marking Won.`,
  };
}
