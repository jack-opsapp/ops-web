import { describe, expect, it } from "vitest";
import {
  countUnresolvedDecisions,
  findUnresolvedDecisions,
  isUnresolvedDecision,
  unresolvedDecisionsMessage,
  unresolvedReason,
} from "@/lib/api/services/qbo-apply-decisions";

describe("qbo-apply-decisions", () => {
  it("treats create and skip as finished", () => {
    expect(unresolvedReason({ action: "create" })).toBeNull();
    expect(unresolvedReason({ action: "skip" })).toBeNull();
  });

  it("treats a Link with a client as finished", () => {
    expect(unresolvedReason({ action: "link", client_id: "c-1" })).toBeNull();
    expect(isUnresolvedDecision({ action: "link", client_id: "c-1" })).toBe(false);
  });

  it("flags a Link with no client — missing, null, empty, or whitespace", () => {
    for (const client_id of [undefined, null, "", "   "]) {
      expect(unresolvedReason({ action: "link", client_id })).toBe("link_without_client");
    }
  });

  it("flags needs_review even when a client id rides along", () => {
    expect(unresolvedReason({ action: "needs_review", client_id: "c-1" })).toBe("needs_review");
  });

  it("lists unfinished decisions in payload order and counts them by reason", () => {
    const decisions = [
      { customer_qb_id: "A", action: "link" as const },
      { customer_qb_id: "B", action: "create" as const },
      { customer_qb_id: "C", action: "needs_review" as const },
      { customer_qb_id: "D", action: "link" as const, client_id: "c-4" },
      { customer_qb_id: "E", action: "link" as const, client_id: "" },
    ];
    expect(findUnresolvedDecisions(decisions)).toEqual([
      { customer_qb_id: "A", reason: "link_without_client" },
      { customer_qb_id: "C", reason: "needs_review" },
      { customer_qb_id: "E", reason: "link_without_client" },
    ]);
    expect(countUnresolvedDecisions(decisions)).toEqual({ needsReview: 1, linkWithoutClient: 2 });
    expect(findUnresolvedDecisions([{ customer_qb_id: "B", action: "create" }])).toEqual([]);
  });

  it("names every unfinished customer in the engine's error", () => {
    const message = unresolvedDecisionsMessage([
      { customer_qb_id: "A", reason: "link_without_client" },
      { customer_qb_id: "C", reason: "needs_review" },
      { customer_qb_id: "E", reason: "link_without_client" },
    ]);
    expect(message).toContain("3 customer decision(s) unfinished");
    expect(message).toContain("link with no OPS client: A, E");
    expect(message).toContain("needs review: C");
    expect(message).toContain("Nothing was written");
  });
});
