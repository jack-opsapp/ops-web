/**
 * Integration tests for GET /api/cron/pmf/weekly-digest.
 *
 * Fires Monday 07:00 PT. Superset of the daily digest — pulls retention
 * cohorts from the `pmf_retention_cohorts` RPC (D30/D60/D90 by first-paid
 * month cohort) and renders `WeeklyDigestEmail` with the current PMF
 * state, days-to-GATE-B, ISO week number, and the cohort rows.
 *
 * Mocking strategy (mirrors pmf-daily-digest-cron.test.ts + adds the
 * rpc() mock from pmf-mrr-trend-route.test.ts):
 *   - `computePmfState()` returns a configurable `PmfState` or throws.
 *   - `sendPmfNotification()` is captured and inspected.
 *   - The mock Supabase client exposes `.rpc(name, args)` whose response
 *     is configurable per-test (rows, null, or error).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { ReactElement } from "react";
import type { PmfState } from "@/lib/pmf/types";
import type { WeeklyDigestProps } from "@/emails/pmf/weekly-digest";

// ─── Mock state ──────────────────────────────────────────────────────────────

interface RpcCall {
  name: string;
  args?: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];

let nextRpcResponse: {
  data: unknown;
  error: { message: string } | null;
} = { data: [], error: null };

const sendPmfNotificationMock =
  vi.fn<
    (opts: {
      kind: string;
      trigger: string;
      emailSubject?: string;
      emailReact?: unknown;
    }) => Promise<void>
  >();

let nextComputePmfStateResult: PmfState | Error = makeState();

// Captures the exact props the route handed to `WeeklyDigestEmail`, since
// the component returns JSX (not a self-wrapping element) and we can't
// introspect props from its output tree.
const weeklyDigestProps: WeeklyDigestProps[] = [];

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
  getAdminSupabase: () => ({
    from: () => ({}),
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return nextRpcResponse;
    },
  }),
}));

// Mock the email template so we can capture the exact props passed to it.
// Return a minimal React-element-shaped placeholder so `emailReact` is
// truthy and recognizable as a ReactElement by downstream checks.
vi.mock("@/emails/pmf/weekly-digest", () => ({
  WeeklyDigestEmail: (props: WeeklyDigestProps) => {
    weeklyDigestProps.push(props);
    // Minimal element-shaped sentinel (not rendered — sendPmfNotification
    // is mocked, so `render()` never runs).
    return {
      type: "WeeklyDigestEmailMock",
      props,
      key: null,
      ref: null,
      $$typeof: Symbol.for("react.element"),
    };
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_SECRET = "test-cron-secret-pmf-weekly-digest";

function buildReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  const req = new Request("http://localhost/api/cron/pmf/weekly-digest", {
    method: "GET",
    headers,
  });
  return req as unknown as NextRequest;
}

/** Build a PmfState with sensible defaults. */
function makeState(): PmfState {
  return {
    capturedAt: "2026-04-22T12:00:00.000Z",
    markers: {
      marker_1: {
        status: "amber",
        value: 1,
        target: 2,
        label: "TIER A ENGAGEMENTS",
      },
      marker_2: {
        status: "red",
        value: 0,
        target: 5,
        label: "RETAINED BASE SAAS",
      },
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
        status: "red",
        value: 0,
        delta_wow: 0,
        sparkline: new Array(12).fill(0),
        label: "REFERRALS",
      },
    },
  };
}

function isReactElement(x: unknown): x is ReactElement {
  return typeof x === "object" && x !== null && "type" in x && "props" in x;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/cron/pmf/weekly-digest", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    weeklyDigestProps.length = 0;
    nextRpcResponse = { data: [], error: null };
    sendPmfNotificationMock.mockReset();
    sendPmfNotificationMock.mockResolvedValue(undefined);
    nextComputePmfStateResult = makeState();
    process.env.CRON_SECRET = VALID_SECRET;
  });

  it("returns 401 when no auth header is supplied", async () => {
    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 401 with the wrong bearer secret", async () => {
    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq("Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("cron_secret");
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
  });

  it("happy path: calls pmf_retention_cohorts RPC and fires one notification", async () => {
    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json).toEqual({ ok: true });

    // RPC was called with the correct function name.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("pmf_retention_cohorts");

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("hands off kind, date-scoped trigger, subject with week + days, and a React element", async () => {
    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    await GET(buildReq(`Bearer ${VALID_SECRET}`));

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    const call = sendPmfNotificationMock.mock.calls[0][0];

    // Kind is exactly 'weekly_digest' so pmf-send routes to email-only.
    expect(call.kind).toBe("weekly_digest");

    // Trigger is date-scoped YYYY-MM-DD.
    expect(call.trigger).toMatch(/^weekly_\d{4}-\d{2}-\d{2}$/);
    const today = new Date().toISOString().slice(0, 10);
    expect(call.trigger).toBe(`weekly_${today}`);

    // Subject follows "OPS :: PMF WEEKLY · W<N> · <DAYS> DAYS".
    expect(call.emailSubject).toMatch(/^OPS :: PMF WEEKLY · W\d+ · \d+ DAYS$/);

    // emailReact is a real React element.
    expect(call.emailReact).toBeTruthy();
    expect(isReactElement(call.emailReact)).toBe(true);
  });

  it("subject includes the current ISO week number", async () => {
    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    await GET(buildReq(`Bearer ${VALID_SECRET}`));

    const call = sendPmfNotificationMock.mock.calls[0][0];
    const subject = call.emailSubject ?? "";

    // Compute the week number the same way the route does and assert it
    // appears in the subject. This guards against subject-format drift.
    const now = new Date();
    const tmp = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    );
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const expectedWeek = Math.ceil(
      ((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
    );

    expect(subject).toContain(`W${expectedWeek}`);
  });

  it("passes retentionCohorts through to the email props (real rows)", async () => {
    nextRpcResponse = {
      data: [
        { cohort_month: "2026-03", size: 10, d30: 0.9, d60: 0.8, d90: 0.7 },
        { cohort_month: "2026-02", size: 8, d30: 0.75, d60: 0.625, d90: 0.5 },
      ],
      error: null,
    };

    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    // Inspect the props the route passed to WeeklyDigestEmail (captured by
    // the vi.mock above — can't introspect props from rendered JSX).
    expect(weeklyDigestProps).toHaveLength(1);
    const props = weeklyDigestProps[0];
    expect(props.retentionCohorts).toHaveLength(2);
    expect(props.retentionCohorts[0]).toEqual({
      cohort_month: "2026-03",
      size: 10,
      d30: 0.9,
      d60: 0.8,
      d90: 0.7,
    });
    // And emailReact is the React-element sentinel from our mock.
    expect(sendPmfNotificationMock.mock.calls[0][0].emailReact).toBeTruthy();
  });

  it("coerces null RPC data to an empty retentionCohorts array", async () => {
    // Mirrors the deploy-gate case: migration not applied yet, RPC returns
    // null rather than []. Route must not crash; email template renders
    // '[NO COHORT DATA YET]'.
    nextRpcResponse = { data: null, error: null };

    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);

    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    expect(weeklyDigestProps).toHaveLength(1);
    expect(weeklyDigestProps[0].retentionCohorts).toEqual([]);
  });

  it("RPC error is non-fatal: logs and still sends with empty cohorts", async () => {
    nextRpcResponse = {
      data: null,
      error: {
        message: "function public.pmf_retention_cohorts() does not exist",
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(200);

    // Send still happened with an empty cohort array.
    expect(sendPmfNotificationMock).toHaveBeenCalledTimes(1);
    expect(weeklyDigestProps).toHaveLength(1);
    expect(weeklyDigestProps[0].retentionCohorts).toEqual([]);

    // And the RPC error was logged.
    expect(errorSpy).toHaveBeenCalled();
    const loggedRpcErr = errorSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          a.includes("pmf_retention_cohorts RPC failed")
      )
    );
    expect(loggedRpcErr).toBe(true);
    errorSpy.mockRestore();
  });

  it("returns 500 when computePmfState throws (and logs the error)", async () => {
    nextComputePmfStateResult = new Error(
      "RPC pmf_count_retained_saas missing"
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("weekly digest failed");
    expect(errorSpy).toHaveBeenCalled();
    expect(sendPmfNotificationMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns 500 when sendPmfNotification throws", async () => {
    sendPmfNotificationMock.mockRejectedValueOnce(
      new Error("sendgrid transient 502")
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("@/app/api/cron/pmf/weekly-digest/route");
    const res = await GET(buildReq(`Bearer ${VALID_SECRET}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("weekly digest failed");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
