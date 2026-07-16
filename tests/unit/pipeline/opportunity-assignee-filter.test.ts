import { describe, expect, it } from "vitest";

import {
  matchesOpportunityAssigneeFilter,
  type OpportunityAssigneeFilter,
} from "@/lib/types/pipeline";

function matches(
  assignedTo: string | null,
  filter: OpportunityAssigneeFilter,
  currentUserId: string | null = "actor-1"
): boolean {
  return matchesOpportunityAssigneeFilter(
    { assignedTo },
    filter,
    currentUserId
  );
}

describe("opportunity assignee filters", () => {
  it("supports all, mine, unassigned, and explicit team-member scopes", () => {
    expect(matches("actor-2", "all")).toBe(true);
    expect(matches("actor-1", "mine")).toBe(true);
    expect(matches("actor-2", "mine")).toBe(false);
    expect(matches(null, "unassigned")).toBe(true);
    expect(matches("actor-2", "user:actor-2")).toBe(true);
    expect(matches("actor-1", "user:actor-2")).toBe(false);
  });

  it("fails closed for mine without an actor and for malformed member filters", () => {
    expect(matches("actor-1", "mine", null)).toBe(false);
    expect(matches("actor-1", "user:")).toBe(false);
  });
});
