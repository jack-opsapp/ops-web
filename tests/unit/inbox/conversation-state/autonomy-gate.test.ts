import { describe, it, expect } from "vitest";

import { evaluateAutonomyGate } from "@/lib/api/services/conversation-state/autonomy-gate";

// ─────────────────────────────────────────────────────────────────────────────
// autonomy-gate — PURE. The Phase 3 safety rule: an AUTONOMOUS draft/send proceeds
// ONLY when the router affirmatively returned 'draft'. Every other routing holds —
// held-for-review, update-lead-only (no reply warranted / no real customer message,
// e.g. an automated notification), and unknown state. A MANUAL draft (the operator
// explicitly asks) always proceeds — the operator IS the human review.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateAutonomyGate", () => {
  it("holds an autonomous action on a thread held for review", () => {
    const d = evaluateAutonomyGate({
      autonomous: true,
      routing: "require_human_review",
      routingReasons: ["Contact identity is too weak to act on.", "1 attachment is uninspected."],
    });
    expect(d.hold).toBe(true);
    expect(d.reason).toContain("Contact identity is too weak");
    expect(d.reason).toContain("uninspected");
  });

  it("still holds (with a fallback reason) when no routing reasons are supplied", () => {
    const d = evaluateAutonomyGate({ autonomous: true, routing: "require_human_review" });
    expect(d.hold).toBe(true);
    expect(d.reason.trim().length).toBeGreaterThan(0);
  });

  it("does NOT hold an autonomous action when the router affirmatively says draft", () => {
    expect(evaluateAutonomyGate({ autonomous: true, routing: "draft" }).hold).toBe(false);
  });

  it("HOLDS on update_lead_only — no reply warranted (this is what suppresses a reply to an automated notification)", () => {
    const d = evaluateAutonomyGate({ autonomous: true, routing: "update_lead_only" });
    expect(d.hold).toBe(true);
    expect(d.reason.trim().length).toBeGreaterThan(0);
  });

  it("HOLDS when routing is unknown (null/undefined) — act only when sure", () => {
    expect(evaluateAutonomyGate({ autonomous: true, routing: null }).hold).toBe(true);
    expect(evaluateAutonomyGate({ autonomous: true, routing: undefined }).hold).toBe(true);
  });

  it("NEVER holds a manual action, even on a held thread (operator is the human review)", () => {
    const d = evaluateAutonomyGate({
      autonomous: false,
      routing: "require_human_review",
      routingReasons: ["Contact identity is too weak to act on."],
    });
    expect(d.hold).toBe(false);
    expect(d.reason).toBe("");
  });
});
