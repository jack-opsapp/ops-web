import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  operations: [] as Array<{ name: string; args: unknown[] }>,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ from: state.from }),
}));

import { listEmailThreadSiblings } from "@/lib/api/services/email-thread-sibling-service";
import type { AllowedEmailInboxListAccess } from "@/lib/email/email-opportunity-access";

const access: AllowedEmailInboxListAccess = {
  allowed: true,
  actor: { userId: "user-1", companyId: "company-1" },
  inboxScope: "assigned",
  pipelineScope: "assigned",
  ownPersonalConnectionIds: ["connection-own"],
  assignedOpportunityIds: ["opportunity-assigned"],
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

function makeQuery() {
  const query: Record<string, unknown> = {};
  for (const name of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "or",
    "order",
    "limit",
  ]) {
    query[name] = (...args: unknown[]) => {
      state.operations.push({ name, args });
      return query;
    };
  }
  query.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown
  ) => Promise.resolve({ data: [], error: null }).then(resolve);
  return query;
}

describe("email thread sibling authorization", () => {
  beforeEach(() => {
    state.operations = [];
    state.from.mockReset();
    state.from.mockReturnValue(makeQuery());
  });

  it("applies the assigned opportunity union before the sibling limit", async () => {
    await listEmailThreadSiblings(
      "company-1",
      "client-1",
      "thread-current",
      access,
      5
    );

    const authorizationIndex = state.operations.findIndex(
      (operation) =>
        operation.name === "or" &&
        operation.args[0] ===
          "opportunity_id.in.(opportunity-assigned),and(connection_id.in.(connection-own),opportunity_id.is.null)"
    );
    const limitIndex = state.operations.findIndex(
      (operation) => operation.name === "limit"
    );
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(limitIndex).toBeGreaterThan(authorizationIndex);
    expect(state.operations[limitIndex]?.args).toEqual([5]);
  });
});
