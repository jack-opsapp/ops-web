/**
 * LeadDataReviewService — tenant/mailbox/assignment scope contract.
 *
 * Provider thread ids are mailbox-scoped. Every read and mutation therefore
 * carries the server-derived OPS actor + company and an exact connection id.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

import { LeadDataReviewService } from "@/lib/api/services/lead-data-review-service";

type Row = Record<string, unknown>;
type RpcHandler = (
  name: string,
  args: Row
) => { data: unknown; error: unknown };

function makeFake(
  tables: Record<string, Row[]>,
  rpcHandler: RpcHandler = (name, args) => {
    if (name === "authorize_email_thread_data_review_as_system") {
      return { data: true, error: null };
    }
    if (name === "reassign_opportunity_email_thread_guarded") {
      return {
        data: {
          provider_thread_id: args.p_provider_thread_id,
          target_opportunity_id: args.p_target_opportunity_id,
          target_title: "Deck — Smith",
          activities_repointed: 1,
          resolution_version: 1,
        },
        error: null,
      };
    }
    if (name === "quarantine_opportunity_email_thread_guarded") {
      return {
        data: {
          provider_thread_id: args.p_provider_thread_id,
          subject: "Deck quote",
          activities_quarantined: 2,
          resolution_version: 1,
        },
        error: null,
      };
    }
    return { data: null, error: { message: `unexpected RPC ${name}` } };
  }
) {
  const queryLog: Array<{ table: string; filters: Row }> = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const updates: Array<{ table: string; payload: Row }> = [];

  function from(table: string) {
    let filtered = [...(tables[table] ?? [])];
    const filters: Row = {};
    const builder: Record<string, unknown> = {};

    const resolve = () => {
      queryLog.push({ table, filters: { ...filters } });
      return { data: filtered, error: null, count: filtered.length };
    };

    Object.assign(builder, {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        filtered = filtered.filter((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        filtered = filtered.filter((row) => row[column] !== value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filtered = filtered.filter((row) => values.includes(row[column]));
        return builder;
      },
      is: (column: string, value: unknown) => {
        filtered = filtered.filter((row) => row[column] === value);
        return builder;
      },
      not: (column: string, operator: string, value: unknown) => {
        if (operator === "is" && value === null) {
          filtered = filtered.filter((row) => row[column] !== null);
        }
        return builder;
      },
      like: (column: string, pattern: string) => {
        const prefix = pattern.replace(/%$/, "");
        filtered = filtered.filter(
          (row) =>
            typeof row[column] === "string" && row[column].startsWith(prefix)
        );
        return builder;
      },
      range: () => builder,
      order: () => builder,
      update: (payload: Row) => {
        updates.push({ table, payload });
        return builder;
      },
      then: (callback: (value: ReturnType<typeof resolve>) => unknown) =>
        Promise.resolve(resolve()).then(callback),
    });

    return builder;
  }

  async function rpc(name: string, args: Row) {
    rpcCalls.push({ name, args });
    return rpcHandler(name, args);
  }

  return { client: { from, rpc }, queryLog, rpcCalls, updates };
}

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONN_1 = "11111111-1111-4111-8111-111111111111";
const CONN_2 = "22222222-2222-4222-8222-222222222222";
const CONN_OTHER = "33333333-3333-4333-8333-333333333333";
const OPP_1 = "44444444-4444-4444-8444-444444444444";
const OPP_2 = "55555555-5555-4555-8555-555555555555";
const OPP_3 = "66666666-6666-4666-8666-666666666666";
const OPP_4 = "88888888-8888-4888-8888-888888888888";
const OPP_5 = "99999999-9999-4999-8999-999999999999";
const OPP_6 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OPP_7 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const context = { actorUserId: ACTOR, companyId: COMPANY };

beforeEach(() => requireSupabaseMock.mockReset());

function opportunity(id: string, companyId = COMPANY, stage = "quoting") {
  return {
    id,
    company_id: companyId,
    title: `Opportunity ${id.slice(0, 4)}`,
    stage,
    archived_at: null,
    deleted_at: null,
    client_id: "77777777-7777-4777-8777-777777777777",
    clients: { name: "Smith" },
  };
}

describe("getQueue", () => {
  it("treats only the exact legacy: marker as quarantine, not a provider id that starts with legacy", async () => {
    const fake = makeFake({
      activities: [
        {
          id: "legacy-prefix-1",
          company_id: COMPANY,
          email_connection_id: CONN_1,
          type: "email",
          email_thread_id: "legacy-provider-thread",
          opportunity_id: OPP_1,
          created_at: "2026-07-20T10:00:00Z",
        },
        {
          id: "legacy-prefix-2",
          company_id: COMPANY,
          email_connection_id: CONN_1,
          type: "email",
          email_thread_id: "legacy-provider-thread",
          opportunity_id: OPP_2,
          created_at: "2026-07-20T11:00:00Z",
        },
      ],
      opportunities: [opportunity(OPP_1), opportunity(OPP_2)],
      email_threads: [
        {
          id: "legacy-prefix-thread-row",
          company_id: COMPANY,
          connection_id: CONN_1,
          provider_thread_id: "legacy-provider-thread",
          opportunity_id: OPP_1,
          subject: "Legitimate provider id",
          created_at: "2026-07-20T11:00:00Z",
        },
      ],
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const queue = await LeadDataReviewService.getQueue(context);

    expect(queue.split).toHaveLength(1);
    expect(queue.split[0].providerThreadId).toBe("legacy-provider-thread");
    expect(queue.quarantinedCount).toBe(0);
  });

  it("scopes by company, treats provider ids as mailbox-scoped, and hides denied assigned-scope items", async () => {
    const fake = makeFake(
      {
        activities: [
          // Same provider id in conn-1 is a real split.
          {
            id: "a1",
            company_id: COMPANY,
            email_connection_id: CONN_1,
            type: "email",
            email_thread_id: "same-provider-id",
            opportunity_id: OPP_1,
            created_at: "2026-07-20T10:00:00Z",
          },
          {
            id: "a2",
            company_id: COMPANY,
            email_connection_id: CONN_1,
            type: "email",
            email_thread_id: "same-provider-id",
            opportunity_id: OPP_2,
            created_at: "2026-07-20T11:00:00Z",
          },
          // The identical provider id in conn-2 is a separate, single-owner thread.
          {
            id: "a3",
            company_id: COMPANY,
            email_connection_id: CONN_2,
            type: "email",
            email_thread_id: "same-provider-id",
            opportunity_id: OPP_3,
            created_at: "2026-07-20T12:00:00Z",
          },
          // Another tenant must never enter classification.
          {
            id: "a4",
            company_id: OTHER_COMPANY,
            email_connection_id: CONN_OTHER,
            type: "email",
            email_thread_id: "same-provider-id",
            opportunity_id: OPP_3,
            created_at: "2026-07-20T13:00:00Z",
          },
          // Only exact, actor-authorized legacy identities contribute to count.
          {
            id: "a5",
            company_id: COMPANY,
            email_connection_id: CONN_1,
            type: "email",
            email_thread_id: "legacy:old-thread",
            opportunity_id: OPP_1,
            created_at: "2026-07-19T10:00:00Z",
          },
          {
            id: "a6",
            company_id: COMPANY,
            email_connection_id: null,
            type: "email",
            email_thread_id: "legacy:unclaimed",
            opportunity_id: OPP_1,
            created_at: "2026-07-19T10:00:00Z",
          },
        ],
        opportunities: [
          opportunity(OPP_1, COMPANY, "won"),
          opportunity(OPP_2),
          opportunity(OPP_3, COMPANY, "won"),
        ],
        email_threads: [
          {
            id: "thread-1",
            company_id: COMPANY,
            connection_id: CONN_1,
            provider_thread_id: "old-thread",
            opportunity_id: OPP_1,
            subject: "Old",
            created_at: "2026-07-19T10:00:00Z",
          },
          {
            id: "thread-terminal-visible",
            company_id: COMPANY,
            connection_id: CONN_1,
            provider_thread_id: "terminal-visible",
            opportunity_id: null,
            subject: "Won job",
            created_at: "2026-07-18T10:00:00Z",
          },
          {
            id: "thread-terminal-denied",
            company_id: COMPANY,
            connection_id: CONN_2,
            provider_thread_id: "terminal-denied",
            opportunity_id: null,
            subject: "Another assignee",
            created_at: "2026-07-18T11:00:00Z",
          },
          {
            id: "thread-other-company",
            company_id: OTHER_COMPANY,
            connection_id: CONN_OTHER,
            provider_thread_id: "other-company",
            opportunity_id: null,
            subject: "Secret",
            created_at: "2026-07-18T12:00:00Z",
          },
        ],
        opportunity_email_threads: [
          {
            connection_id: CONN_1,
            thread_id: "terminal-visible",
            opportunity_id: OPP_1,
          },
          {
            connection_id: CONN_2,
            thread_id: "terminal-denied",
            opportunity_id: OPP_3,
          },
          {
            connection_id: CONN_OTHER,
            thread_id: "other-company",
            opportunity_id: OPP_3,
          },
        ],
      },
      (name, args) => {
        if (name === "authorize_email_thread_data_review_as_system") {
          return { data: args.p_connection_id !== CONN_2, error: null };
        }
        return { data: null, error: { message: `unexpected RPC ${name}` } };
      }
    );
    requireSupabaseMock.mockReturnValue(fake.client);

    const queue = await LeadDataReviewService.getQueue(context);

    expect(queue.split).toHaveLength(1);
    expect(queue.split[0]).toMatchObject({
      connectionId: CONN_1,
      providerThreadId: "same-provider-id",
      oppCount: 2,
    });
    expect(queue.terminalLive).toHaveLength(1);
    expect(queue.terminalLive[0]).toMatchObject({
      connectionId: CONN_1,
      providerThreadId: "terminal-visible",
    });
    expect(queue.quarantinedCount).toBe(1);

    const companyScopedQueries = fake.queryLog.filter(({ table }) =>
      ["activities", "email_threads", "opportunities"].includes(table)
    );
    expect(companyScopedQueries.length).toBeGreaterThan(0);
    for (const query of companyScopedQueries) {
      expect(query.filters.company_id, query.table).toBe(COMPANY);
    }

    const authorizationCalls = fake.rpcCalls.filter(
      ({ name }) => name === "authorize_email_thread_data_review_as_system"
    );
    expect(authorizationCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of authorizationCalls) {
      expect(call.args).toMatchObject({
        p_actor_user_id: ACTOR,
        p_company_id: COMPANY,
        p_action: "view",
      });
    }
  });

  it("exposes only non-hidden split targets that satisfy every exact projection owner client", async () => {
    const CLIENT_A = "77777777-7777-4777-8777-777777777777";
    const CLIENT_B = "12121212-1212-4212-8212-121212121212";
    const activity = (
      id: string,
      threadId: string,
      opportunityId: string,
      createdAt: string
    ) => ({
      id,
      company_id: COMPANY,
      email_connection_id: CONN_1,
      type: "email",
      email_thread_id: threadId,
      opportunity_id: opportunityId,
      created_at: createdAt,
    });
    const thread = (id: string, providerThreadId: string) => ({
      id,
      company_id: COMPANY,
      connection_id: CONN_1,
      provider_thread_id: providerThreadId,
      opportunity_id: null,
      subject: providerThreadId,
      created_at: "2026-07-20T12:00:00Z",
    });

    const fake = makeFake({
      activities: [
        activity("cross-a", "cross-client", OPP_1, "2026-07-20T10:00:00Z"),
        activity("cross-b", "cross-client", OPP_2, "2026-07-20T11:00:00Z"),
        activity("hidden-a", "hidden-owner", OPP_3, "2026-07-20T10:00:00Z"),
        activity("hidden-b", "hidden-owner", OPP_4, "2026-07-20T11:00:00Z"),
        activity(
          "projection-a",
          "projection-client",
          OPP_5,
          "2026-07-20T10:00:00Z"
        ),
        activity(
          "projection-b",
          "projection-client",
          OPP_6,
          "2026-07-20T11:00:00Z"
        ),
      ],
      opportunities: [
        { ...opportunity(OPP_1), client_id: CLIENT_A },
        { ...opportunity(OPP_2), client_id: CLIENT_B },
        { ...opportunity(OPP_3), client_id: CLIENT_A },
        {
          ...opportunity(OPP_4),
          client_id: CLIENT_A,
          archived_at: "2026-07-20T12:30:00Z",
        },
        { ...opportunity(OPP_5), client_id: CLIENT_A },
        { ...opportunity(OPP_6), client_id: CLIENT_A },
        { ...opportunity(OPP_7), client_id: CLIENT_B },
      ],
      email_threads: [
        thread("thread-cross", "cross-client"),
        thread("thread-hidden", "hidden-owner"),
        thread("thread-projection", "projection-client"),
      ],
      opportunity_email_threads: [
        {
          connection_id: CONN_1,
          thread_id: "projection-client",
          opportunity_id: OPP_7,
        },
      ],
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const queue = await LeadDataReviewService.getQueue(context);

    expect(
      queue.split.find((item) => item.providerThreadId === "cross-client")
        ?.linkCandidates
    ).toEqual([]);
    expect(
      queue.split.find((item) => item.providerThreadId === "hidden-owner")
        ?.linkCandidates
    ).toEqual([expect.objectContaining({ opportunityId: OPP_3 })]);
    expect(
      queue.split.find((item) => item.providerThreadId === "projection-client")
        ?.linkCandidates
    ).toEqual([]);
    expect(
      queue.split.find((item) => item.providerThreadId === "projection-client")
        ?.reason
    ).toContain("2 distinct client(s)");
  });
});

describe("mutations", () => {
  it("links through one actor-aware atomic RPC with exact mailbox identity", async () => {
    const fake = makeFake({});
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await LeadDataReviewService.linkThread({
      ...context,
      connectionId: CONN_1,
      providerThreadId: "same-provider-id",
      targetOpportunityId: OPP_1,
      kind: "split",
    });

    expect(result).toMatchObject({
      providerThreadId: "same-provider-id",
      targetOpportunityId: OPP_1,
      targetTitle: "Deck — Smith",
      activitiesRepointed: 1,
      resolutionVersion: 1,
    });
    expect(fake.rpcCalls).toEqual([
      {
        name: "reassign_opportunity_email_thread_guarded",
        args: {
          p_actor_user_id: ACTOR,
          p_company_id: COMPANY,
          p_connection_id: CONN_1,
          p_provider_thread_id: "same-provider-id",
          p_target_opportunity_id: OPP_1,
          p_kind: "split",
        },
      },
    ]);
    expect(fake.updates).toHaveLength(0);
  });

  it("quarantines through one actor-aware atomic RPC and performs no partial application writes", async () => {
    const fake = makeFake({});
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await LeadDataReviewService.quarantineThread({
      ...context,
      connectionId: CONN_2,
      providerThreadId: "terminal-denied",
      kind: "terminal_live",
    });

    expect(result.activitiesQuarantined).toBe(2);
    expect(result.resolutionVersion).toBe(1);
    expect(fake.rpcCalls).toEqual([
      {
        name: "quarantine_opportunity_email_thread_guarded",
        args: {
          p_actor_user_id: ACTOR,
          p_company_id: COMPANY,
          p_connection_id: CONN_2,
          p_provider_thread_id: "terminal-denied",
          p_kind: "terminal_live",
        },
      },
    ]);
    expect(fake.updates).toHaveLength(0);
  });

  it("fails closed when the guarded database operation rejects authorization", async () => {
    const fake = makeFake({}, () => ({
      data: null,
      error: { message: "data_review_access_denied" },
    }));
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      LeadDataReviewService.linkThread({
        ...context,
        connectionId: CONN_1,
        providerThreadId: "same-provider-id",
        targetOpportunityId: OPP_1,
        kind: "split",
      })
    ).rejects.toThrow("data_review_access_denied");
    expect(fake.updates).toHaveLength(0);
  });
});

describe("test-only deterministic marker", () => {
  it("preserves the established legacy marker", () => {
    expect(LeadDataReviewService._quarantineThreadId("abc")).toBe("legacy:abc");
  });
});
