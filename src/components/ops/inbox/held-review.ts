// src/components/ops/inbox/held-review.ts
//
// Phase 3 — held-for-review presentation core (PURE). Turns the persisted
// deterministic router decision into the small view the inbox row + detail
// banner render: whether the thread is held, the reasons to show, and a
// formatted confidence label. Keeps the components dumb and the formatting
// (rounding/clamping) unit-tested.

import type { RoutingDecision } from "@/lib/api/services/conversation-state/types";

export interface HeldReviewInput {
  routing: RoutingDecision | null | undefined;
  routingReasons: string[] | null | undefined;
  routerConfidence: number | null | undefined;
}

export interface HeldReviewView {
  /** true when the deterministic router held this thread for human review. */
  held: boolean;
  /** Non-empty, trimmed reasons to surface (empty when not held / none recorded). */
  reasons: string[];
  /** Whole-percent confidence label ("48%"), or null when no confidence is known. */
  confidenceLabel: string | null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Build the held-for-review view from a thread's persisted routing fields. */
export function buildHeldReviewView(input: HeldReviewInput): HeldReviewView {
  if (input.routing !== "require_human_review") {
    return { held: false, reasons: [], confidenceLabel: null };
  }

  const reasons = (input.routingReasons ?? [])
    .map((r) => (r ?? "").trim())
    .filter((r) => r.length > 0);

  const c = input.routerConfidence;
  const confidenceLabel =
    typeof c === "number" && Number.isFinite(c)
      ? `${Math.round(clamp01(c) * 100)}%`
      : null;

  return { held: true, reasons, confidenceLabel };
}
