/**
 * LeadDataReviewService — classification + guarded actions (Surface 2).
 *
 * Asserts:
 *   - the queue lists split threads (>1 opp/provider thread) + terminal/live
 *     NULL-canonical rows as actionable items;
 *   - the 2,198-style passive de-aggregated activities NEVER enter the
 *     actionable list — only the muted quarantinedCount;
 *   - already-quarantined `legacy:` threads are excluded from actionable items;
 *   - linkThread re-points only mislinked activities (idempotent) and REFUSES a
 *     non-owner target and a cross-client target (single-client guard);
 *   - quarantineThread re-points onto the synthetic `legacy:` marker;
 *   - the write allow-list rejects out-of-scope columns.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

import { LeadDataReviewService } from "@/lib/api/services/lead-data-review-service";

// ─── Chainable supabase fake (PostgREST-shaped) ─────────────────────────────

type Row = Record<string, unknown>;

interface TableSpec {
  rows: Row[];
}

function makeFake(tables: Record<string, TableSpec>) {
  const updates: Array<{ table: string; payload: Row; filters: Row }> = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];

  function from(table: string) {
    const all = tables[table]?.rows ?? [];
    let filtered = [...all];
    let pendingUpdate: Row | null = null;
    let countMode = false;
    const filters: Row = {};
    const builder: Record<string, unknown> = {};

    const resolve = () => {
      if (pendingUpdate) {
        updates.push({
          table,
          payload: pendingUpdate,
          filters: { ...filters },
        });
        // mutate the underlying rows so re-reads see the change (idempotency).
        for (const r of filtered) Object.assign(r, pendingUpdate);
        return { data: filtered, error: null, count: filtered.length };
      }
      if (countMode) return { data: null, error: null, count: filtered.length };
      return { data: filtered, error: null, count: filtered.length };
    };

    Object.assign(builder, {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) countMode = true;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        filtered = filtered.filter((r) => r[col] === val);
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] !== val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return builder;
      },
      is: (col: string, val: unknown) => {
        if (val === null) filtered = filtered.filter((r) => r[col] === null);
        return builder;
      },
      not: (col: string, _op: string, val: unknown) => {
        if (val === null) filtered = filtered.filter((r) => r[col] !== null);
        return builder;
      },
      like: (col: string, pattern: string) => {
        const prefix = pattern.replace(/%$/, "");
        filtered = filtered.filter(
          (r) =>
            typeof r[col] === "string" && (r[col] as string).startsWith(prefix)
        );
        return builder;
      },
      range: () => builder,
      order: () => builder,
      update: (payload: Row) => {
        pendingUpdate = payload;
        return builder;
      },
      single: async () => {
        const out = resolve();
        return { data: (out.data as Row[])?.[0] ?? null, error: out.error };
      },
      then: (
        cb: (v: { data: unknown; error: null; count: number }) => unknown
      ) => Promise.resolve(resolve()).then(cb),
    });
    return builder;
  }

  async function rpc(name: string, args: Row) {
    rpcCalls.push({ name, args });
    return {
      data: {
        provider_thread_id: args.p_provider_thread_id,
        target_opportunity_id: args.p_target_opportunity_id,
        activities_repointed: args.p_kind === "terminal_live" ? 0 : 1,
      },
      error: null,
    };
  }

  return { client: { from, rpc }, updates, rpcCalls };
}

const C_TAN = "client-tan";
const OPP_LIVE = "11111111-1111-4111-8111-111111111111";
const OPP_SHELL = "22222222-2222-4222-8222-222222222222";
const OPP_TERMINAL = "33333333-3333-4333-8333-333333333333";
const OPP_OTHER_CLIENT = "44444444-4444-4444-8444-444444444444";

beforeEach(() => requireSupabaseMock.mockReset());

describe("getQueue — classification", () => {
  it("lists a split thread, a terminal/live row, and the muted quarantined count; never lists passive activities", async () => {
    const fake = makeFake({
      activities: {
        rows: [
          // split thread T-split: two live same-client owners
          {
            id: "a1",
            type: "email",
            email_thread_id: "T-split",
            opportunity_id: OPP_LIVE,
            created_at: "2026-05-20T00:00:00Z",
            subject: "Deck quote",
          },
          {
            id: "a2",
            type: "email",
            email_thread_id: "T-split",
            opportunity_id: OPP_SHELL,
            created_at: "2026-05-21T00:00:00Z",
            subject: "Deck quote",
          },
          // single-owner thread → NOT a split (excluded)
          {
            id: "a3",
            type: "email",
            email_thread_id: "T-single",
            opportunity_id: OPP_LIVE,
            created_at: "2026-05-10T00:00:00Z",
            subject: "x",
          },
          // already-quarantined legacy thread → excluded from actionable, counted in quarantined
          {
            id: "a4",
            type: "email",
            email_thread_id: "legacy:dead",
            opportunity_id: OPP_LIVE,
            created_at: "2026-01-01T00:00:00Z",
            subject: "x",
          },
          {
            id: "a5",
            type: "email",
            email_thread_id: "legacy:dead2",
            opportunity_id: null,
            created_at: "2026-01-01T00:00:00Z",
            subject: "x",
          },
        ],
      },
      opportunities: {
        rows: [
          {
            id: OPP_LIVE,
            title: "Deck — Smith",
            stage: "quoting",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
          {
            id: OPP_SHELL,
            title: "Deck — Smith (dupe)",
            stage: "follow_up",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
          {
            id: OPP_TERMINAL,
            title: "Patio — Jones",
            stage: "won",
            archived_at: null,
            deleted_at: null,
            client_id: "client-jones",
            clients: { name: "Jones" },
          },
        ],
      },
      email_threads: {
        rows: [
          // NULL-canonical pointing at a terminal+live opp → terminal/live item
          {
            id: "et-1",
            provider_thread_id: "T-term",
            connection_id: "conn-1",
            opportunity_id: null,
            subject: "Patio thread",
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
      opportunity_email_threads: {
        rows: [
          {
            connection_id: "conn-1",
            thread_id: "T-term",
            opportunity_id: OPP_TERMINAL,
          },
        ],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const queue = await LeadDataReviewService.getQueue();

    expect(queue.split).toHaveLength(1);
    expect(queue.split[0].providerThreadId).toBe("T-split");
    expect(queue.split[0].kind).toBe("split");
    expect(queue.split[0].oppCount).toBe(2);
    expect(queue.split[0].linkCandidates).toHaveLength(2);

    expect(queue.terminalLive).toHaveLength(1);
    expect(queue.terminalLive[0].kind).toBe("terminal_live");
    expect(queue.terminalLive[0].terminalCount).toBe(1);

    // Passive legacy activities counted, NEVER actionable.
    expect(queue.quarantinedCount).toBe(2);
    const ids = [...queue.split, ...queue.terminalLive].map(
      (i) => i.providerThreadId
    );
    expect(ids).not.toContain("legacy:dead");
    expect(ids).not.toContain("T-single");
  });
});

describe("linkThread — guarded re-point", () => {
  function actsTwoOwners() {
    return [
      {
        id: "a1",
        company_id: "company-1",
        email_connection_id: "conn-1",
        type: "email",
        email_thread_id: "T-split",
        opportunity_id: OPP_LIVE,
        created_at: "2026-05-20T00:00:00Z",
        subject: "x",
      },
      {
        id: "a2",
        company_id: "company-1",
        email_connection_id: "conn-1",
        type: "email",
        email_thread_id: "T-split",
        opportunity_id: OPP_SHELL,
        created_at: "2026-05-21T00:00:00Z",
        subject: "x",
      },
    ];
  }

  it("re-points only the mislinked activities to the chosen owner (idempotent)", async () => {
    const fake = makeFake({
      activities: { rows: actsTwoOwners() },
      opportunities: {
        rows: [
          {
            id: OPP_LIVE,
            company_id: "company-1",
            title: "Live",
            stage: "quoting",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
          {
            id: OPP_SHELL,
            company_id: "company-1",
            title: "Shell",
            stage: "follow_up",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
        ],
      },
      email_threads: {
        rows: [
          {
            id: "et-1",
            company_id: "company-1",
            connection_id: "conn-1",
            provider_thread_id: "T-split",
            opportunity_id: OPP_SHELL,
          },
        ],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const res = await LeadDataReviewService.linkThread("T-split", OPP_LIVE);
    expect(res.activitiesRepointed).toBe(1); // only a2 (a1 already on target)
    expect(fake.updates).toHaveLength(0);
    expect(fake.rpcCalls).toEqual([
      {
        name: "reassign_opportunity_email_thread_guarded",
        args: {
          p_company_id: "company-1",
          p_connection_id: "conn-1",
          p_provider_thread_id: "T-split",
          p_target_opportunity_id: OPP_LIVE,
          p_kind: "split",
        },
      },
    ]);
  });

  it("REFUSES a target that is not an owner of the thread", async () => {
    const fake = makeFake({
      activities: { rows: actsTwoOwners() },
      opportunities: {
        rows: [
          {
            id: OPP_LIVE,
            title: "Live",
            stage: "quoting",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
          {
            id: OPP_SHELL,
            title: "Shell",
            stage: "follow_up",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
        ],
      },
      email_threads: { rows: [] },
    });
    requireSupabaseMock.mockReturnValue(fake.client);
    await expect(
      LeadDataReviewService.linkThread("T-split", "not-an-owner")
    ).rejects.toThrow(/not an owner/);
  });

  it("terminal_live: aligns the NULL-canonical cache row to the terminal owner (no activities, no throw)", async () => {
    // terminal_live items have NO owning activities — the prior implementation
    // threw "No activities found"; the resolving action must align the cache.
    const fake = makeFake({
      activities: { rows: [] },
      opportunities: {
        rows: [
          {
            id: OPP_TERMINAL,
            company_id: "company-1",
            title: "Patio — Jones",
            stage: "won",
            archived_at: null,
            deleted_at: null,
            client_id: "client-jones",
            clients: { name: "Jones" },
          },
        ],
      },
      email_threads: {
        rows: [
          {
            id: "et-1",
            company_id: "company-1",
            provider_thread_id: "T-term",
            connection_id: "conn-1",
            opportunity_id: null,
            subject: "Patio thread",
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const res = await LeadDataReviewService.linkThread(
      "T-term",
      OPP_TERMINAL,
      "terminal_live"
    );
    expect(res.activitiesRepointed).toBe(0);
    expect(res.targetTitle).toBe("Patio — Jones");
    expect(fake.updates).toHaveLength(0);
    expect(fake.rpcCalls[0]).toEqual({
      name: "reassign_opportunity_email_thread_guarded",
      args: {
        p_company_id: "company-1",
        p_connection_id: "conn-1",
        p_provider_thread_id: "T-term",
        p_target_opportunity_id: OPP_TERMINAL,
        p_kind: "terminal_live",
      },
    });
  });

  it("REFUSES a provider thread that is ambiguous across mailbox connections", async () => {
    const fake = makeFake({
      activities: { rows: actsTwoOwners() },
      opportunities: {
        rows: [
          {
            id: OPP_LIVE,
            company_id: "company-1",
            title: "Live",
            stage: "quoting",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
          {
            id: OPP_SHELL,
            company_id: "company-1",
            title: "Shell",
            stage: "follow_up",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
        ],
      },
      email_threads: {
        rows: [
          {
            id: "et-1",
            company_id: "company-1",
            connection_id: "conn-1",
            provider_thread_id: "T-split",
            opportunity_id: OPP_LIVE,
          },
          {
            id: "et-2",
            company_id: "company-1",
            connection_id: "conn-2",
            provider_thread_id: "T-split",
            opportunity_id: OPP_SHELL,
          },
        ],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      LeadDataReviewService.linkThread("T-split", OPP_LIVE)
    ).rejects.toThrow(/more than one mailbox/i);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("terminal_live: REFUSES aligning the cache to an archived/deleted target", async () => {
    const fake = makeFake({
      activities: { rows: [] },
      opportunities: {
        rows: [
          {
            id: OPP_TERMINAL,
            title: "Hidden",
            stage: "won",
            archived_at: "2026-01-01T00:00:00Z",
            deleted_at: null,
            client_id: "client-jones",
            clients: { name: "Jones" },
          },
        ],
      },
      email_threads: {
        rows: [
          {
            id: "et-1",
            provider_thread_id: "T-term",
            connection_id: "conn-1",
            opportunity_id: null,
            subject: "Patio",
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);
    await expect(
      LeadDataReviewService.linkThread("T-term", OPP_TERMINAL, "terminal_live")
    ).rejects.toThrow(/archived\/deleted/);
    expect(fake.updates).toHaveLength(0);
  });

  it("REFUSES a cross-client re-point (single-client guard)", async () => {
    const fake = makeFake({
      activities: {
        rows: [
          {
            id: "a1",
            type: "email",
            email_thread_id: "T-split",
            opportunity_id: OPP_LIVE,
            created_at: "2026-05-20T00:00:00Z",
            subject: "x",
          },
          {
            id: "a2",
            type: "email",
            email_thread_id: "T-split",
            opportunity_id: OPP_OTHER_CLIENT,
            created_at: "2026-05-21T00:00:00Z",
            subject: "x",
          },
        ],
      },
      opportunities: {
        rows: [
          {
            id: OPP_LIVE,
            title: "Live",
            stage: "quoting",
            archived_at: null,
            deleted_at: null,
            client_id: C_TAN,
            clients: { name: "Smith" },
          },
          {
            id: OPP_OTHER_CLIENT,
            title: "Other",
            stage: "quoting",
            archived_at: null,
            deleted_at: null,
            client_id: "client-other",
            clients: { name: "Other" },
          },
        ],
      },
      email_threads: { rows: [] },
    });
    requireSupabaseMock.mockReturnValue(fake.client);
    await expect(
      LeadDataReviewService.linkThread("T-split", OPP_LIVE)
    ).rejects.toThrow(/more than one client/);
  });
});

describe("quarantineThread", () => {
  it("re-points activities onto the synthetic legacy: marker", async () => {
    const fake = makeFake({
      activities: {
        rows: [
          {
            id: "a1",
            type: "email",
            email_thread_id: "T-split",
            opportunity_id: OPP_LIVE,
            created_at: "2026-05-20T00:00:00Z",
            subject: "Deck quote",
          },
          {
            id: "a2",
            type: "email",
            email_thread_id: "T-split",
            opportunity_id: OPP_SHELL,
            created_at: "2026-05-21T00:00:00Z",
            subject: "Deck quote",
          },
        ],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const res = await LeadDataReviewService.quarantineThread("T-split");
    expect(res.activitiesQuarantined).toBe(2);
    expect(res.subject).toBe("Deck quote");
    for (const u of fake.updates) {
      expect(u.table).toBe("activities");
      expect(u.payload.email_thread_id).toBe("legacy:T-split");
    }
  });

  it("REFUSES re-quarantining an already-legacy thread", async () => {
    requireSupabaseMock.mockReturnValue(
      makeFake({ activities: { rows: [] } }).client
    );
    await expect(
      LeadDataReviewService.quarantineThread("legacy:already")
    ).rejects.toThrow(/already quarantined/);
  });

  it("split: throws when there are no owning activities", async () => {
    requireSupabaseMock.mockReturnValue(
      makeFake({ activities: { rows: [] } }).client
    );
    await expect(
      LeadDataReviewService.quarantineThread("T-empty", "split")
    ).rejects.toThrow(/No activities found/);
  });

  it("terminal_live: no-ops gracefully when there are no owning activities", async () => {
    const fake = makeFake({ activities: { rows: [] } });
    requireSupabaseMock.mockReturnValue(fake.client);
    const res = await LeadDataReviewService.quarantineThread(
      "T-term",
      "terminal_live"
    );
    expect(res.activitiesQuarantined).toBe(0);
    expect(fake.updates).toHaveLength(0);
  });
});

describe("write allow-list", () => {
  it("permits only the two allow-listed columns", () => {
    expect(() =>
      LeadDataReviewService._assertWriteAllowed("activities", "opportunity_id")
    ).not.toThrow();
    expect(() =>
      LeadDataReviewService._assertWriteAllowed("activities", "email_thread_id")
    ).not.toThrow();
    expect(() =>
      LeadDataReviewService._assertWriteAllowed(
        "email_threads",
        "opportunity_id"
      )
    ).not.toThrow();
    expect(() =>
      LeadDataReviewService._assertWriteAllowed("opportunities", "stage")
    ).toThrow(/allow-list/);
    expect(() =>
      LeadDataReviewService._assertWriteAllowed("activities", "company_id")
    ).toThrow(/allow-list/);
  });

  it("builds the legacy marker correctly", () => {
    expect(LeadDataReviewService._quarantineThreadId("abc")).toBe("legacy:abc");
  });
});
