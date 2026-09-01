/**
 * Integration tests for GET /api/cron/site-visit-prompts.
 *
 * Fires every 5 minutes, full-day. Selects booked, scheduled, non-deleted
 * site visits inside the prompt window, runs the pure prompt engine per
 * assignee, inserts rail notifications (idempotent via the scoped
 * `site_visit:%` dedupe unique index — a 23505 means "already prompted"),
 * and sends OneSignal pushes by external user id for freshly created rows
 * only. Visit prompts intentionally bypass quiet hours.
 *
 * Mocking strategy mirrors the other cron suites:
 *   - hand-rolled chainable Supabase mock with per-table scripted responses
 *   - workload control passes `work` straight through (skips scriptable)
 *   - canonical OneSignal helper mocked at the module boundary
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const VALID_SECRET = "test-cron-secret";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RecordedQuery {
  table: string;
  method: string;
  args: unknown[];
}

let recordedQueries: RecordedQuery[] = [];
let tableResponses: Record<
  string,
  { data: unknown; error: { message: string; code?: string } | null }
> = {};
let insertResults: Array<{
  error: { message: string; code?: string } | null;
}> = [];
let insertedRows: Array<Record<string, unknown>> = [];
let nextControlSkip: "lease_held" | "circuit_open" | null = null;

const pushMock = vi.hoisted(() => vi.fn());

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => makeMockClient(),
}));

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    return {
      ...actual,
      runWithCronWorkloadControl: async ({
        work,
      }: {
        work: () => Promise<unknown>;
      }) => {
        if (nextControlSkip) {
          return { status: "skipped", reason: nextControlSkip };
        }
        return { status: "completed", value: await work() };
      },
    };
  }
);

vi.mock("@/lib/notifications/onesignal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/notifications/onesignal")>();
  return {
    ...actual,
    sendOneSignalPush: pushMock,
  };
});

function makeQuery(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {};
  let isInsert = false;
  for (const method of [
    "select",
    "not",
    "is",
    "eq",
    "gte",
    "lte",
    "in",
    "order",
    "limit",
  ]) {
    q[method] = (...args: unknown[]) => {
      recordedQueries.push({ table, method, args });
      return q;
    };
  }
  q.insert = (row: Record<string, unknown>) => {
    isInsert = true;
    insertedRows.push(row);
    recordedQueries.push({ table, method: "insert", args: [row] });
    return q;
  };
  q.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown
  ) => {
    const response = isInsert
      ? { data: null, error: insertResults.shift()?.error ?? null }
      : (tableResponses[table] ?? { data: [], error: null });
    return Promise.resolve(response).then(resolve, reject);
  };
  return q;
}

function makeMockClient() {
  return { from: (table: string) => makeQuery(table) };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const COMPANY_ID = "c-1";
const LEAD = { id: "opp-1", title: "Faye Keys", address: "630 Agnes St" };

const MINUTE_MS = 60_000;

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "v-1",
    company_id: COMPANY_ID,
    opportunity_id: LEAD.id,
    scheduled_at: new Date(Date.now() + 20 * MINUTE_MS).toISOString(),
    duration_minutes: 60,
    status: "scheduled",
    booked_at: "2026-08-10T12:00:00.000Z",
    deleted_at: null,
    reminder_lead_minutes: null,
    assignee_ids: ["u-1"],
    ...overrides,
  };
}

function scriptTables(params: {
  visits: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
  preferences?: Array<Record<string, unknown>>;
  activeUserIds?: string[];
}) {
  tableResponses = {
    site_visits: { data: params.visits, error: null },
    opportunities: { data: params.opportunities ?? [LEAD], error: null },
    notification_preferences: { data: params.preferences ?? [], error: null },
    users: {
      data: (params.activeUserIds ?? ["u-1"]).map((id) => ({
        id,
        company_id: COMPANY_ID,
      })),
      error: null,
    },
  };
}

function epochOf(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) {
    headers.authorization = authHeader;
  }
  const req = new Request("http://localhost/api/cron/site-visit-prompts", {
    method: "GET",
    headers,
  });
  return req as unknown as NextRequest;
}

async function runRoute(authHeader = `Bearer ${VALID_SECRET}`) {
  const { GET } = await import("@/app/api/cron/site-visit-prompts/route");
  return GET(buildReq(authHeader));
}

beforeEach(() => {
  recordedQueries = [];
  insertedRows = [];
  insertResults = [];
  nextControlSkip = null;
  scriptTables({ visits: [] });
  pushMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  process.env.CRON_SECRET = VALID_SECRET;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("auth", () => {
  it("returns 401 without an auth header", async () => {
    const res = await runRoute("");
    expect(res.status).toBe(401);
    expect(recordedQueries).toHaveLength(0);
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const res = await runRoute("Bearer not-the-secret");
    expect(res.status).toBe(401);
    expect(recordedQueries).toHaveLength(0);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await runRoute();
    expect(res.status).toBe(500);
  });
});

describe("workload control", () => {
  it("reports already_running when the lease is held", async () => {
    nextControlSkip = "lease_held";
    const res = await runRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
  });
});

describe("heads-up prompts", () => {
  it("inserts the rail row and pushes by external id for a visit inside the default lead window", async () => {
    const visit = visitRow();
    scriptTables({ visits: [visit] });

    const res = await runRoute();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      scanned: 1,
      due: 1,
      inserted: 1,
      deduped: 0,
      gated: 0,
      pushed: 1,
      errors: 0,
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toEqual({
      user_id: "u-1",
      company_id: COMPANY_ID,
      type: "site_visit_reminder",
      title: "Site visit in 20 min — Faye Keys",
      body: "630 Agnes St",
      is_read: false,
      persistent: false,
      action_url: "/pipeline?opportunityId=opp-1",
      action_label: "OPEN LEAD",
      deep_link_type: "site_visit_heads_up",
      dedupe_key: `site_visit:v-1:heads_up:u-1:${epochOf(
        visit.scheduled_at as string
      )}`,
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserIds: ["u-1"],
        title: "Site visit in 20 min — Faye Keys",
        body: "630 Agnes St",
        data: {
          deep_link_type: "site_visit_heads_up",
          leadId: "opp-1",
          siteVisitId: "v-1",
        },
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
      })
    );
  });

  it("queries only booked, live, scheduled visits inside the prompt window", async () => {
    scriptTables({ visits: [] });
    await runRoute();

    const siteVisitFilters = recordedQueries
      .filter((query) => query.table === "site_visits")
      .map((query) => [query.method, ...query.args]);
    expect(siteVisitFilters).toEqual(
      expect.arrayContaining([
        ["not", "booked_at", "is", null],
        ["is", "deleted_at", null],
        ["eq", "status", "scheduled"],
      ])
    );
    expect(
      siteVisitFilters.some(([method]) => method === "gte")
    ).toBe(true);
    expect(
      siteVisitFilters.some(([method]) => method === "lte")
    ).toBe(true);
    expect(
      siteVisitFilters.some(([method]) => method === "limit")
    ).toBe(true);
  });

  it("honors a per-user lead default from notification_preferences", async () => {
    const visit = visitRow({
      scheduled_at: new Date(Date.now() + 50 * MINUTE_MS).toISOString(),
    });
    scriptTables({
      visits: [visit],
      preferences: [
        {
          user_id: "u-1",
          company_id: COMPANY_ID,
          push_enabled: true,
          channel_preferences: null,
          site_visit_reminder_lead_minutes: 60,
        },
      ],
    });

    const res = await runRoute();

    expect((await res.json()).inserted).toBe(1);
    expect(insertedRows[0].title).toBe("Site visit in 50 min — Faye Keys");
  });

  it("honors the per-booking override ahead of the user default", async () => {
    const visit = visitRow({
      scheduled_at: new Date(Date.now() + 50 * MINUTE_MS).toISOString(),
      reminder_lead_minutes: 60,
    });
    scriptTables({
      visits: [visit],
      preferences: [
        {
          user_id: "u-1",
          company_id: COMPANY_ID,
          push_enabled: true,
          channel_preferences: null,
          site_visit_reminder_lead_minutes: 30,
        },
      ],
    });

    const res = await runRoute();
    expect((await res.json()).inserted).toBe(1);
  });

  it("falls back to a terse no-address body when the lead has no address", async () => {
    scriptTables({
      visits: [visitRow()],
      opportunities: [{ ...LEAD, address: null }],
    });

    await runRoute();
    expect(insertedRows[0].body).toBe("No address on the lead.");
  });
});

describe("START prompts", () => {
  it("prompts START with the address as the anchor inside the grace window", async () => {
    const visit = visitRow({
      scheduled_at: new Date(Date.now() - 1 * MINUTE_MS).toISOString(),
    });
    scriptTables({ visits: [visit] });

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ due: 1, inserted: 1, pushed: 1 })
    );
    expect(insertedRows[0]).toEqual(
      expect.objectContaining({
        title: "Site visit — 630 Agnes St",
        body: "Start now?",
        action_label: "START VISIT",
        deep_link_type: "site_visit_start",
        dedupe_key: `site_visit:v-1:start:u-1:${epochOf(
          visit.scheduled_at as string
        )}`,
      })
    );
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deep_link_type: "site_visit_start" }),
      })
    );
  });

  it("anchors on the lead name when the lead has no address", async () => {
    scriptTables({
      visits: [
        visitRow({
          scheduled_at: new Date(Date.now() - 1 * MINUTE_MS).toISOString(),
        }),
      ],
      opportunities: [{ ...LEAD, address: "  " }],
    });

    await runRoute();
    expect(insertedRows[0].title).toBe("Site visit — Faye Keys");
  });
});

describe("gates and idempotency", () => {
  it("still writes the rail row but never pushes when push_enabled is off", async () => {
    scriptTables({
      visits: [visitRow()],
      preferences: [
        {
          user_id: "u-1",
          company_id: COMPANY_ID,
          push_enabled: false,
          channel_preferences: null,
          site_visit_reminder_lead_minutes: null,
        },
      ],
    });

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ inserted: 1, gated: 1, pushed: 0 })
    );
    expect(insertedRows).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("respects the site_visit_reminder channel preference", async () => {
    scriptTables({
      visits: [visitRow()],
      preferences: [
        {
          user_id: "u-1",
          company_id: COMPANY_ID,
          push_enabled: true,
          channel_preferences: { site_visit_reminder: { push: false } },
          site_visit_reminder_lead_minutes: null,
        },
      ],
    });

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ inserted: 1, gated: 1, pushed: 0 })
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("treats a dedupe conflict as already-prompted: no push, no error", async () => {
    scriptTables({ visits: [visitRow()] });
    insertResults = [
      {
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "notifications_site_visit_prompt_dedupe_uidx"',
        },
      },
    ];

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ due: 1, inserted: 0, deduped: 1, errors: 0 })
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("counts unexpected insert failures as errors and never pushes for them", async () => {
    scriptTables({ visits: [visitRow()] });
    insertResults = [{ error: { code: "XX000", message: "boom" } }];

    const res = await runRoute();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ inserted: 0, deduped: 0, errors: 1 })
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("candidacy guards", () => {
  it("never prompts a visit that already started, even if the query returns it", async () => {
    scriptTables({
      visits: [
        visitRow({
          status: "in_progress",
          scheduled_at: new Date(Date.now() - 1 * MINUTE_MS).toISOString(),
        }),
      ],
    });

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ scanned: 1, due: 0, inserted: 0, pushed: 0 })
    );
    expect(insertedRows).toHaveLength(0);
  });

  it("drops assignees who are no longer active in the company", async () => {
    scriptTables({
      visits: [visitRow({ assignee_ids: ["u-1", "u-gone"] })],
      activeUserIds: ["u-1"],
    });

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ due: 1, inserted: 1 })
    );
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].user_id).toBe("u-1");
  });

  it("skips visits with no linked lead", async () => {
    scriptTables({ visits: [visitRow({ opportunity_id: null })] });

    const res = await runRoute();

    expect(await res.json()).toEqual(
      expect.objectContaining({ scanned: 1, due: 0, inserted: 0 })
    );
  });

  it("no-ops cleanly when nothing is due", async () => {
    scriptTables({ visits: [] });
    const res = await runRoute();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      scanned: 0,
      due: 0,
      inserted: 0,
      deduped: 0,
      gated: 0,
      pushed: 0,
      errors: 0,
    });
  });
});
