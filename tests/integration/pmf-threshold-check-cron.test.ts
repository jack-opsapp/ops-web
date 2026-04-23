/**
 * Integration tests for GET /api/cron/pmf/threshold-check.
 *
 * Runs every 15 minutes on Vercel cron. Two-part job:
 *   1. STATE DIFF — snapshot → compare to prior snapshot → alert on each
 *      transition that `diffState` surfaces (improving-to-green or
 *      worsening-from-anything).
 *   2. EVENT-DRIVEN — scan the last 15 min for new inbound prospects,
 *      refund events, and a "first ever referral" edge case.
 *
 * Mocking strategy mirrors tests/unit/notifications/pmf-send.test.ts:
 *   - A chainable, thenable Supabase builder mock with a FIFO result
 *     queue keyed by call order (so each `.from(...)` terminal await
 *     pulls the next pre-seeded response).
 *   - `computePmfState` and `sendPmfNotification` are mocked at module
 *     boundaries; we let the real React email template flow through
 *     so `emailReact` is a real ReactElement when asserted.
 *   - We never hit real Supabase, Twilio, SendGrid, or the Postgres RPCs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { PmfState } from "@/lib/pmf/types";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

const recordedCalls: RecordedCall[] = [];

type DbResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

// Result queue consumed in FIFO order by terminal .then() awaits on the
// chainable builder. Each test pushes responses in the order the route
// issues queries:
//   1. select pmf_threshold_snapshots  (prior snapshot)
//   2. insert pmf_threshold_snapshots  (current snapshot)
//   3. select pmf_prospects            (inbound)
//   4. select billing_events           (refunds)
//   5. select pmf_prospects            (referrals)
let resultQueue: DbResult[] = [];

function enqueue(result: DbResult): void {
  resultQueue.push(result);
}

const sendPmfNotificationMock = vi.fn<
  (opts: {
    kind: string;
    trigger: string;
    smsBody?: string;
    emailSubject?: string;
    emailReact?: unknown;
    inAppTitle?: string;
    inAppBody?: string;
  }) => Promise<void>
>();

let nextComputePmfStateResult: PmfState | Error = makeState();

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/admin/pmf-queries", () => ({
  computePmfState: async () => {
    if (nextComputePmfStateResult instanceof Error) {
      throw nextComputePmfStateResult;
    }
    return nextComputePmfStateResult;
  },
}));

vi.mock("@/lib/notifications/pmf-send", () => ({
  sendPmfNotification: (opts: Parameters<typeof sendPmfNotificationMock>[0]) =>
    sendPmfNotificationMock(opts),
}));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => makeMockClient(),
}));

interface MockBuilder {
  select: (cols?: string) => MockBuilder;
  insert: (rows: unknown) => Promise<DbResult>;
  eq: (col: string, val: unknown) => MockBuilder;
  gte: (col: string, val: unknown) => MockBuilder;
  or: (filter: string) => MockBuilder;
  limit: (n: number) => MockBuilder;
  order: (col: string, opts?: unknown) => MockBuilder;
  then: (onFulfilled: (v: DbResult) => unknown) => Promise<unknown>;
}

function makeMockClient(): { from: (table: string) => MockBuilder } {
  return {
    from(table: string): MockBuilder {
      const record = (method: string, ...args: unknown[]) =>
        recordedCalls.push({ table, method, args });

      const consumeResult = (): DbResult => {
        if (resultQueue.length > 0) return resultQueue.shift()!;
        return { data: null, error: null };
      };

      const builder: MockBuilder = {
        select: (cols) => {
          record("select", cols);
          return builder;
        },
        // `.insert({...})` is awaited directly, so it resolves to the
        // next queued DbResult. We intentionally do NOT return the
        // builder here — the route code awaits the result.
        insert: async (rows) => {
          record("insert", rows);
          return consumeResult();
        },
        eq: (col, val) => {
          record("eq", col, val);
          return builder;
        },
        gte: (col, val) => {
          record("gte", col, val);
          return builder;
        },
        or: (filter) => {
          record("or", filter);
          return builder;
        },
        limit: (n) => {
          record("limit", n);
          return builder;
        },
        order: (col, opts) => {
          record("order", col, opts);
          return builder;
        },
        // Terminal await on the builder — consume the next queued result.
        then: (onFulfilled) => {
          record("await");
          return Promise.resolve(consumeResult()).then(onFulfilled);
        },
      };
      return builder;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_SECRET = "test-cron-secret-pmf-threshold-check";

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  const req = new Request("http://localhost/api/cron/pmf/threshold-check", {
    method: "GET",
    headers,
  });
  return req as unknown as NextRequest;
}

/** Build a PmfState with sensible defaults, overridable per test. */
function makeState(overrides?: {
  marker1?: "red" | "amber" | "green";
  indicatorE?: number;
}): PmfState {
  const marker1Status = overrides?.marker1 ?? "amber";
  const indicatorEValue = overrides?.indicatorE ?? 0;
  return {
    capturedAt: "2026-04-22T12:00:00.000Z",
    markers: {
      marker_1: {
        status: marker1Status,
        value: 1,
        target: 2,
        label: "TIER A ENGAGEMENTS",
      },
      marker_2: { status: "red", value: 0, target: 5, label: "RETAINED BASE SAAS" },
      marker_3: { status: "red", value: 0, target: 1, label: "INBOUND LEAD" },
      marker_4: {
        status: "red",
        value: 0,
        target: 15000,
        label: "CAC FROM $15K SPEND",
        detail: "0 paid attributed",
      },
    },
    indicators: {
      indicator_a: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "ACTIVE TIER A",
      },
      indicator_b: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "WEEKLY TRIALS",
      },
      indicator_c: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "TRIAL→PAID",
        unit: "percent",
      },
      indicator_d: {
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "COHORT CHURN",
        unit: "percent",
      },
      indicator_e: {
        status: indicatorEValue > 0 ? "green" : "red",
        value: indicatorEValue,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "REFERRALS",
      },
    },
  };
}

/**
 * Seed the standard 5-query response queue in the exact order the
 * route issues them: prior snapshot → insert snapshot → inbound →
 * refunds → referrals. Pass nulls/empties for "no data".
 */
function seedQueue(seed: {
  prior?: PmfState | null;
  inbound?: unknown[];
  refunds?: unknown[];
  referrals?: unknown[];
}): void {
  resultQueue = [
    // 1. prior snapshot
    {
      data: seed.prior ? [{ state: seed.prior }] : [],
      error: null,
    },
    // 2. insert snapshot
    { data: null, error: null },
    // 3. newInbound
    { data: seed.inbound ?? [], error: null },
    // 4. newRefunds
    { data: seed.refunds ?? [], error: null },
    // 5. newReferrals
    { data: seed.referrals ?? [], error: null },
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/cron/pmf/threshold-check", () => {
  beforeEach(() => {
    recordedCalls.length = 0;
    resultQueue = [];
    sendPmfNotificationMock.mockReset();
    sendPmfNotificationMock.mockResolvedValue(undefined);
    nextComputePmfStateResult = makeState();
    process.env.CRON_SECRET = VALID_SECRET;
  });

  it("returns 401 when no auth header is supplied", async () => {
    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    expect(recordedCalls).toHaveLength(0);
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    expect(recordedCalls).toHaveLength(0);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("cron_secret");
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it("first run: no prior snapshot → no transitions; inserts current snapshot; returns { ok, transitions: 0 }", async () => {
    seedQueue({ prior: null });
    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      transitions: number;
      inbound: number;
      refunds: number;
      sent: number;
    };
    expect(json.ok).toBe(true);
    expect(json.transitions).toBe(0);
    expect(json.inbound).toBe(0);
    expect(json.refunds).toBe(0);
    expect(json.sent).toBe(0);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();

    // Snapshot was inserted.
    const inserts = recordedCalls.filter(
      (c) => c.table === "pmf_threshold_snapshots" && c.method === "insert"
    );
    expect(inserts).toHaveLength(1);
    const insertedRow = inserts[0].args[0] as { state: PmfState };
    expect(insertedRow.state).toBeDefined();
    expect(insertedRow.state.markers).toBeDefined();
  });

  it("transition: marker_1 amber → green fires one sendPmfNotification", async () => {
    const prior = makeState({ marker1: "amber" });
    const now = makeState({ marker1: "green" });
    nextComputePmfStateResult = now;
    seedQueue({ prior });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { transitions: number; sent: number };
    expect(json.transitions).toBe(1);
    expect(json.sent).toBe(1);

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    const call = sendPmfNotificationMock.mock.calls[0][0];
    expect(call.kind).toBe("threshold_alert");
    expect(call.trigger).toBe("marker_1_amber_to_green");
    expect(call.emailSubject).toBe("OPS :: MARKER_1 GREEN");
    expect(call.inAppTitle).toBe("MARKER_1 GREEN");
    expect(call.smsBody).toContain("MARKER_1 GREEN");
    expect(call.emailReact).toBeDefined();
  });

  it("new inbound prospect fires one alert with company name uppercased", async () => {
    seedQueue({
      prior: makeState(),
      inbound: [
        {
          id: "prospect-1",
          company: "acme corp",
          name: "john doe",
          source: "organic_search",
          first_contact_direction: "inbound",
          first_contact_at: "2026-04-22T11:55:00.000Z",
        },
      ],
    });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { inbound: number; sent: number };
    expect(json.inbound).toBe(1);
    expect(json.sent).toBe(1);

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    const call = sendPmfNotificationMock.mock.calls[0][0];
    expect(call.trigger).toBe("new_inbound_prospect-1");
    expect(call.inAppTitle).toBe("NEW INBOUND LEAD · ACME CORP");
    expect(call.inAppBody).toBe("source: organic_search");
    expect(call.emailSubject).toBe("OPS :: NEW INBOUND LEAD · ACME CORP");
  });

  it("new inbound prospect falls back to name when company is null", async () => {
    seedQueue({
      prior: makeState(),
      inbound: [
        {
          id: "prospect-2",
          company: null,
          name: "jane smith",
          source: "referral",
          first_contact_direction: "inbound",
          first_contact_at: "2026-04-22T11:55:00.000Z",
        },
      ],
    });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const call = sendPmfNotificationMock.mock.calls[0][0];
    expect(call.inAppTitle).toBe("NEW INBOUND LEAD · JANE SMITH");
  });

  it("new refund fires an alert with the refund amount in the stem", async () => {
    seedQueue({
      prior: makeState(),
      refunds: [
        {
          id: "refund-1",
          amount_cents: 12345,
          company_id: "company-uuid",
          occurred_at: "2026-04-22T11:58:00.000Z",
        },
      ],
    });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { refunds: number; sent: number };
    expect(json.refunds).toBe(1);
    expect(json.sent).toBe(1);

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    const call = sendPmfNotificationMock.mock.calls[0][0];
    expect(call.trigger).toBe("refund_refund-1");
    // $12345 / 100 = 123.45 → .toFixed(0) → "123"
    expect(call.inAppTitle).toBe("REFUND · $123");
    expect(call.emailSubject).toBe("OPS :: REFUND · $123");
  });

  it("queries billing_events by received_at (not the nonexistent created_at)", async () => {
    seedQueue({ prior: makeState() });
    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    await GET(buildReq(`Bearer ${VALID_SECRET}`));

    // Schema has no `billing_events.created_at`, so the route MUST filter
    // on `received_at` — guard against a regression that would make
    // refund alerts silently fail in prod.
    const billingCalls = recordedCalls.filter((c) => c.table === "billing_events");
    const gteCalls = billingCalls.filter((c) => c.method === "gte");
    expect(gteCalls).toHaveLength(1);
    expect(gteCalls[0].args[0]).toBe("received_at");
  });

  it("first referral: fires once when prior indicator_e.value === 0", async () => {
    seedQueue({
      prior: makeState({ indicatorE: 0 }),
      referrals: [
        {
          id: "referral-1",
          company: "bob's trades",
          name: "bob",
        },
      ],
    });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    const call = sendPmfNotificationMock.mock.calls[0][0];
    expect(call.trigger).toBe("first_referral");
    expect(call.inAppTitle).toBe("FIRST REFERRAL · BOB'S TRADES");
  });

  it("first referral: does NOT fire when prior indicator_e.value > 0", async () => {
    // Prior AND current both have indicator_e === 1, so there's no
    // state-diff transition to fire either. The only question this test
    // answers: does the first_referral EVENT fire when prior.E was
    // non-zero? Answer: it must not.
    const priorState = makeState({ indicatorE: 1 });
    nextComputePmfStateResult = makeState({ indicatorE: 1 });
    seedQueue({
      prior: priorState,
      referrals: [
        {
          id: "referral-1",
          company: "bob's trades",
          name: "bob",
        },
      ],
    });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);

    // Specifically assert no first_referral trigger fired.
    const firstReferralCalls = sendPmfNotificationMock.mock.calls.filter(
      (c) => c[0].trigger === "first_referral"
    );
    expect(firstReferralCalls).toHaveLength(0);
    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(0);
  });

  it("no transitions, no events: returns 200 with zero sends", async () => {
    seedQueue({ prior: makeState() });
    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      transitions: number;
      inbound: number;
      refunds: number;
      sent: number;
    };
    expect(json).toEqual({
      ok: true,
      transitions: 0,
      inbound: 0,
      refunds: 0,
      sent: 0,
    });
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 500 when computePmfState throws (and logs the error)", async () => {
    nextComputePmfStateResult = new Error("RPC pmf_count_retained_saas missing");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    // Generic error shape — no Supabase internals leaked to clients.
    expect(json.error).toBe("pmf state computation failed");
    expect(errorSpy).toHaveBeenCalled();
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("combined: transition + inbound + refund all fire alongside each other", async () => {
    const prior = makeState({ marker1: "amber" });
    const now = makeState({ marker1: "green" });
    nextComputePmfStateResult = now;
    seedQueue({
      prior,
      inbound: [
        {
          id: "prospect-99",
          company: "xyz inc",
          name: "alice",
          source: "paid_ad",
          first_contact_direction: "inbound",
          first_contact_at: "2026-04-22T11:50:00.000Z",
        },
      ],
      refunds: [
        {
          id: "refund-99",
          amount_cents: 5000,
          company_id: null,
          occurred_at: "2026-04-22T11:55:00.000Z",
        },
      ],
    });

    const { GET } = await import(
      "@/app/api/cron/pmf/threshold-check/route"
    );
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      transitions: number;
      inbound: number;
      refunds: number;
      sent: number;
    };
    expect(json.transitions).toBe(1);
    expect(json.inbound).toBe(1);
    expect(json.refunds).toBe(1);
    expect(json.sent).toBe(3);

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(3);
    const triggers = sendPmfNotificationMock.mock.calls
      .map((c) => c[0].trigger)
      .sort();
    expect(triggers).toEqual([
      "marker_1_amber_to_green",
      "new_inbound_prospect-99",
      "refund_refund-99",
    ]);
  });
});
