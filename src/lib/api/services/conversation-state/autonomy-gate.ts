// src/lib/api/services/conversation-state/autonomy-gate.ts
//
// Phase 3 — routing + human review. The deterministic safety rule that keeps the
// inbox from silently acting on a thread it can't confidently act on:
//
//   An AUTONOMOUS draft or send proceeds ONLY when the deterministic router
//   affirmatively returned 'draft'. Anything else holds — held-for-review,
//   update-lead-only (no reply warranted / no real customer message, e.g. an
//   automated notification), or unknown state. Act only when sure.
//   A MANUAL action (the operator explicitly asks for a draft) ALWAYS proceeds —
//   the operator IS the human review.
//
// This mirrors the canonical gate already in accept-stage.ts (decideAcceptStage
// refuses to auto-advance a held thread). PURE: no DB, no network, no model. The
// caller (ai-draft-service.generateDraft) reads routing from the already-built
// ConversationState and applies this decision before producing an autonomous draft.

import type { RoutingDecision } from "./types";

export interface AutonomyGateInput {
  /** true for auto-draft / auto-send paths; false (or omitted) for operator-initiated drafts. */
  autonomous: boolean;
  /** The deterministic router decision for the thread; null/undefined when unknown. */
  routing: RoutingDecision | null | undefined;
  /** The router's human-readable reasons, surfaced in the hold reason for logs/UI. */
  routingReasons?: string[];
}

export interface AutonomyGateDecision {
  /** true → suppress the autonomous draft/send and leave the thread for a human. */
  hold: boolean;
  /** Explanation when held (empty string when not held). */
  reason: string;
}

/**
 * Decide whether an autonomous draft/send must be held.
 *
 * An autonomous action proceeds ONLY when the router affirmatively returned
 * 'draft'. Every other routing holds:
 *   - 'require_human_review' — the router flagged it for a person.
 *   - 'update_lead_only'     — a real customer thread, but the ball is NOT in the
 *                              operator's court (nothing to reply to). This is also
 *                              where a thread with no real customer message lands
 *                              (e.g. an automated Google Business review
 *                              notification), so suppressing the draft here is what
 *                              stops the inbox from auto-replying to a robot.
 *   - null / undefined       — the clean state couldn't be built, so we are NOT
 *                              sure this is a customer awaiting a reply. Acting only
 *                              when sure is the whole point of the gate.
 *
 * Manual (operator-initiated) actions are NEVER gated — the operator is the review.
 */
export function evaluateAutonomyGate(input: AutonomyGateInput): AutonomyGateDecision {
  if (!input.autonomous) return { hold: false, reason: "" };
  if (input.routing === "draft") return { hold: false, reason: "" };

  const reasons = (input.routingReasons ?? []).filter((r) => r && r.trim().length > 0);
  const base =
    input.routing === "require_human_review"
      ? "thread held for human review"
      : input.routing === "update_lead_only"
        ? "no reply warranted — ball is not in the operator's court"
        : "thread state could not be determined";
  const detail = reasons.length > 0 ? reasons.join("; ") : base;
  return { hold: true, reason: `Autonomous draft/send suppressed — ${detail}` };
}
