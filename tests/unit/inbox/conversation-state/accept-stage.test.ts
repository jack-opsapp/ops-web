import { describe, it, expect } from "vitest";

import { decideAcceptStage } from "@/lib/api/services/conversation-state/accept-stage";
import type { AcceptSignal, LeadStage, RoutingDecision } from "@/lib/api/services/conversation-state/types";

// ─────────────────────────────────────────────────────────────────────────────
// accept-stage — PURE. Maps a deterministic AcceptSignal + current stage +
// routing decision to a stage action (split-by-confidence, Jackson 2026-06-29):
//   high  → auto-advance to Won
//   low   → surface a one-tap "Mark Won" (never auto)
//   held for human review → never auto-advance (downgrade to surface)
// ─────────────────────────────────────────────────────────────────────────────

function accept(over: Partial<AcceptSignal> = {}): AcceptSignal {
  return { detected: true, confidence: "high", basis: ["explicit_accept_language"], evidenceMessageIds: ["m1"], ...over };
}

const DRAFT: RoutingDecision = "draft";
const REVIEW: RoutingDecision = "require_human_review";

describe("decideAcceptStage", () => {
  it("auto-advances to Won on a high-confidence accept in an active stage", () => {
    const action = decideAcceptStage(accept({ confidence: "high" }), "quoting", DRAFT);
    expect(action.kind).toBe("auto_advance_won");
  });

  it("surfaces a one-tap Mark Won (never auto) on a low-confidence accept", () => {
    const action = decideAcceptStage(accept({ confidence: "low", basis: ["verbal_soft"] }), "quoting", DRAFT);
    expect(action.kind).toBe("surface_mark_won");
  });

  it("never auto-advances when the thread is held for human review — downgrades to surface", () => {
    const action = decideAcceptStage(accept({ confidence: "high" }), "quoting", REVIEW);
    expect(action.kind).toBe("surface_mark_won");
  });

  it("does nothing when no accept was detected", () => {
    const action = decideAcceptStage(accept({ detected: false, confidence: "low", basis: [] }), "quoting", DRAFT);
    expect(action.kind).toBe("none");
  });

  it("does nothing when the lead is already in a terminal stage", () => {
    for (const stage of ["won", "lost", "discarded"] as LeadStage[]) {
      const action = decideAcceptStage(accept({ confidence: "high" }), stage, DRAFT);
      expect(action.kind).toBe("none");
    }
  });

  it("carries a human-readable reason for the action", () => {
    const auto = decideAcceptStage(accept({ confidence: "high", basis: ["signed_estimate_attachment"] }), "quoted", DRAFT);
    expect(auto.kind).toBe("auto_advance_won");
    if (auto.kind !== "none") expect(auto.reason.length).toBeGreaterThan(0);
  });
});
