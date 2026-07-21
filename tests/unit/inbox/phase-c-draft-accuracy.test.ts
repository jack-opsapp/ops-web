import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

import {
  getHumanDraftAccuracy,
  summarizeHumanDraftOutcomes,
} from "@/lib/api/services/phase-c-draft-accuracy-service";

type Row = {
  draft_outcome: Record<string, unknown> | null;
  profile_type: string;
};

function makeClient(rows: Row[]) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  return {
    client: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ method: "rpc", args: [name, args] });
        return Promise.resolve({ data: rows, error: null });
      },
    },
    calls,
  };
}

beforeEach(() => {
  requireSupabaseMock.mockReset();
});

describe("Phase C human draft accuracy", () => {
  it("treats every human edit as an error and ignores malformed outcomes", () => {
    expect(
      summarizeHumanDraftOutcomes([
        { draft_outcome: { sentWithoutChanges: true } },
        { draft_outcome: { sentWithoutChanges: false } },
        { draft_outcome: { sentWithoutChanges: false, editDistance: 1 } },
        { draft_outcome: null },
        { draft_outcome: { sentWithoutChanges: "true" } },
      ])
    ).toEqual({
      sampleSize: 3,
      approvedWithoutChanges: 1,
      errors: 2,
      approvalRate: 1 / 3,
      errorRate: 2 / 3,
    });
  });

  it("returns zero rates when there are no valid finalized outcomes", () => {
    expect(summarizeHumanDraftOutcomes([])).toEqual({
      sampleSize: 0,
      approvedWithoutChanges: 0,
      errors: 0,
      approvalRate: 0,
      errorRate: 0,
    });
  });

  it("reads only completed operator-approved outcomes for the exact OPS actor", async () => {
    const fake = makeClient([
      {
        draft_outcome: { sentWithoutChanges: true },
        profile_type: "client_new_inquiry",
      },
    ]);
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      getHumanDraftAccuracy({
        companyId: "company-1",
        userId: "actor-1",
        profileTypes: ["client_new_inquiry", "client_quoting"],
        limit: 50,
      })
    ).resolves.toMatchObject({ sampleSize: 1, approvalRate: 1, errorRate: 0 });

    expect(fake.calls).toContainEqual({
      method: "rpc",
      args: [
        "get_human_draft_accuracy_as_system",
        {
          p_company_id: "company-1",
          p_actor_user_id: "actor-1",
          p_profile_types: ["client_new_inquiry", "client_quoting"],
          p_limit: 50,
        },
      ],
    });
  });

  it("scopes graduation accuracy to the exact actor and mailbox", async () => {
    const fake = makeClient([
      {
        draft_outcome: { sentWithoutChanges: true },
        profile_type: "client_new_inquiry",
      },
    ]);
    requireSupabaseMock.mockReturnValue(fake.client);

    await getHumanDraftAccuracy({
      companyId: "company-1",
      connectionId: "connection-1",
      userId: "actor-1",
      primaryCategory: "PLATFORM_BID",
      limit: 20,
    });

    expect(fake.calls).toContainEqual({
      method: "rpc",
      args: [
        "get_human_draft_accuracy_for_category_as_system",
        {
          p_company_id: "company-1",
          p_actor_user_id: "actor-1",
          p_connection_id: "connection-1",
          p_primary_category: "PLATFORM_BID",
          p_limit: 20,
        },
      ],
    });
  });

  it("never degrades an explicitly supplied blank mailbox into actor-wide accuracy", async () => {
    const fake = makeClient([]);
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      getHumanDraftAccuracy({
        companyId: "company-1",
        connectionId: "   ",
        userId: "actor-1",
      })
    ).rejects.toThrow("Mailbox connection is required");
    expect(fake.calls).toEqual([]);
  });

  it("fails closed when the durable outcome ledger cannot be read", async () => {
    requireSupabaseMock.mockReturnValue({
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: "ledger unavailable" },
        }),
    });

    await expect(
      getHumanDraftAccuracy({ companyId: "company-1", userId: "actor-1" })
    ).rejects.toThrow("ledger unavailable");
  });
});
