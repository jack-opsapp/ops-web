import { describe, it, expect } from "vitest";

import { buildHeldReviewView } from "@/components/ops/inbox/held-review";

// ─────────────────────────────────────────────────────────────────────────────
// held-review — PURE presentation core. Turns the persisted router decision
// (routing / routing_reasons / router_confidence) into the view the inbox needs:
// is the thread held, the reasons to show, and a formatted confidence label.
// Keeps the row + banner components dumb and the formatting testable.
// ─────────────────────────────────────────────────────────────────────────────

describe("buildHeldReviewView", () => {
  it("flags a held thread, keeps its reasons, and formats confidence as a whole percent", () => {
    const v = buildHeldReviewView({
      routing: "require_human_review",
      routingReasons: [
        "Contact identity is too weak to act on (no verified name, email, or phone).",
        "1 attachment requires inspection but is uninspected or failed.",
      ],
      routerConfidence: 0.48,
    });
    expect(v.held).toBe(true);
    expect(v.reasons).toHaveLength(2);
    expect(v.reasons[0]).toContain("Contact identity");
    expect(v.confidenceLabel).toBe("48%");
  });

  it("is not held for a draftable thread", () => {
    const v = buildHeldReviewView({ routing: "draft", routingReasons: ["x"], routerConfidence: 0.9 });
    expect(v.held).toBe(false);
    expect(v.reasons).toEqual([]);
    expect(v.confidenceLabel).toBeNull();
  });

  it("is not held when routing is unknown (null/undefined)", () => {
    expect(buildHeldReviewView({ routing: null, routingReasons: null, routerConfidence: null }).held).toBe(false);
    expect(buildHeldReviewView({ routing: undefined, routingReasons: undefined, routerConfidence: undefined }).held).toBe(false);
  });

  it("held with no confidence yields a null label (omit the chip)", () => {
    const v = buildHeldReviewView({ routing: "require_human_review", routingReasons: ["weak identity"], routerConfidence: null });
    expect(v.held).toBe(true);
    expect(v.confidenceLabel).toBeNull();
  });

  it("drops blank reasons and tolerates a missing reasons array", () => {
    const v = buildHeldReviewView({ routing: "require_human_review", routingReasons: ["  ", "", "weak identity"], routerConfidence: 0.5 });
    expect(v.reasons).toEqual(["weak identity"]);
    const v2 = buildHeldReviewView({ routing: "require_human_review", routingReasons: null, routerConfidence: 0.5 });
    expect(v2.reasons).toEqual([]);
  });

  it("rounds and clamps confidence to 0..100", () => {
    expect(buildHeldReviewView({ routing: "require_human_review", routingReasons: [], routerConfidence: 0.476 }).confidenceLabel).toBe("48%");
    expect(buildHeldReviewView({ routing: "require_human_review", routingReasons: [], routerConfidence: 1.4 }).confidenceLabel).toBe("100%");
    expect(buildHeldReviewView({ routing: "require_human_review", routingReasons: [], routerConfidence: -0.2 }).confidenceLabel).toBe("0%");
  });
});
