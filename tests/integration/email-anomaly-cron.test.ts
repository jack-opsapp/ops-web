/**
 * Integration tests for /api/cron/email/anomaly-check.
 *
 * Covers: auth gating, healthy snapshot → no writes, critical bounce snapshot
 * triggers anomaly write + pause + notification, dedup suppression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface CapturedInsert {
  table: string;
  payload: unknown;
}
interface CapturedUpdate {
  table: string;
  payload: unknown;
}
interface MetricsResp {
  window_minutes: number;
  total_sent: number;
  total_delivered: number;
  total_bounced: number;
  bounce_pct: number;
  total_spam: number;
  spam_pct: number;
  total_open: number;
  open_pct: number;
  total_click: number;
  click_pct: number;
  error_events: number;
}

interface AnomalyRow {
  kind: string;
  severity: "warn" | "critical";
  detected_at: string;
}

const captures = {
  inserts: [] as CapturedInsert[],
  updates: [] as CapturedUpdate[],
  metrics: { value: null as MetricsResp | null },
  recent: [] as AnomalyRow[],
};

const pauseMock = vi.fn(async (_input: unknown) => ({
  state: {
    scope: "global",
    isPaused: true,
    pauseReason: "test",
    pausedUntil: null,
    pausedAt: new Date().toISOString(),
    pausedBy: "u-op",
  },
  pauseAuditId: "audit-1",
}));

vi.mock("@/lib/email/pause", () => ({
  pause: (input: unknown) => pauseMock(input),
}));

vi.mock("@/lib/supabase/server-client", () => {
  const fromBuilder = (table: string) => {
    const insertBuilder = (payload: unknown) => {
      captures.inserts.push({ table, payload });
      const insertedId =
        table === "email_anomaly_log"
          ? "anom-1"
          : table === "notifications"
            ? "notif-1"
            : "row-1";
      return {
        select: () => ({
          single: async () => ({ data: { id: insertedId }, error: null }),
        }),
      };
    };
    const updateBuilder = (payload: unknown) => {
      captures.updates.push({ table, payload });
      return {
        eq: async () => ({ data: null, error: null }),
      };
    };
    const selectChain = () => {
      const chain = {
        gte: async () => ({ data: captures.recent, error: null }),
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null, count: 0 }),
        range: async () => ({ data: [], error: null, count: 0 }),
      };
      return chain;
    };
    return {
      select: selectChain,
      insert: insertBuilder,
      update: updateBuilder,
    };
  };
  return {
    getServiceRoleClient: () => ({
      rpc: async (_name: string, _args: unknown) => ({
        data: captures.metrics.value,
        error: null,
      }),
      from: fromBuilder,
    }),
  };
});

beforeEach(() => {
  captures.inserts = [];
  captures.updates = [];
  captures.recent = [];
  captures.metrics.value = null;
  pauseMock.mockClear();
  process.env.CRON_SECRET = "test-secret";
  process.env.PMF_OPERATOR_USER_ID = "u-op";
  process.env.PMF_NOTIFICATION_EMAIL = "ops@opsapp.co";
  process.env.PMF_OPERATOR_COMPANY_ID = "co-op";
});

function buildReq(auth?: string): NextRequest {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  return new NextRequest(
    new URL("https://example.com/api/cron/email/anomaly-check"),
    { headers }
  );
}

const HEALTHY: MetricsResp = {
  window_minutes: 15,
  total_sent: 100,
  total_delivered: 99,
  total_bounced: 0,
  bounce_pct: 0,
  total_spam: 0,
  spam_pct: 0,
  total_open: 40,
  open_pct: 40.4,
  total_click: 5,
  click_pct: 5.05,
  error_events: 0,
};

const CRITICAL_BOUNCE: MetricsResp = {
  window_minutes: 15,
  total_sent: 100,
  total_delivered: 80,
  total_bounced: 12,
  bounce_pct: 12,
  total_spam: 0,
  spam_pct: 0,
  total_open: 30,
  open_pct: 37.5,
  total_click: 5,
  click_pct: 6.2,
  error_events: 0,
};

describe("anomaly-check cron", () => {
  it("returns 500 when CRON_SECRET unset", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
  });

  it("returns 401 without auth header", async () => {
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer", async () => {
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("healthy snapshot writes nothing", async () => {
    captures.metrics.value = HEALTHY;
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evals).toBe(0);
    expect(body.written).toBe(0);
    expect(captures.inserts.length).toBe(0);
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it("critical bounce writes anomaly + pauses + notifies", async () => {
    captures.metrics.value = CRITICAL_BOUNCE;
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(captures.inserts.find((i) => i.table === "email_anomaly_log")).toBeTruthy();
    expect(captures.inserts.find((i) => i.table === "notifications")).toBeTruthy();
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock.mock.calls[0][0]).toMatchObject({
      scope: "global",
      severity: "critical",
      anomalyLogId: "anom-1",
    });
    // The anomaly row gets a follow-up update with pauseAuditId + notification id
    expect(
      captures.updates.find(
        (u) =>
          u.table === "email_anomaly_log" &&
          (u.payload as { pause_audit_id?: string }).pause_audit_id ===
            "audit-1"
      )
    ).toBeTruthy();
  });

  it("dedup suppresses repeat critical within 60min", async () => {
    captures.metrics.value = CRITICAL_BOUNCE;
    captures.recent = [
      {
        kind: "bounce_spike",
        severity: "critical",
        detected_at: new Date().toISOString(),
      },
    ];
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.written).toBe(0);
    expect(captures.inserts.find((i) => i.table === "email_anomaly_log")).toBeFalsy();
    expect(pauseMock).not.toHaveBeenCalled();
  });
});
