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
interface CapturedRpc {
  name: string;
  args: unknown;
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
  id?: string;
  kind: string;
  severity: "warn" | "critical";
  detected_at: string;
  window_minutes?: number;
  metric_value?: number;
  threshold?: number;
  context?: Record<string, unknown>;
  action_taken?: string | null;
  notification_id?: string | null;
  pause_audit_id?: string | null;
}

const captures = {
  inserts: [] as CapturedInsert[],
  updates: [] as CapturedUpdate[],
  rpcs: [] as CapturedRpc[],
  metrics: { value: null as MetricsResp | null },
  recent: [] as AnomalyRow[],
  incomplete: [] as AnomalyRow[],
  notificationIdentity: [
    {
      notification_id: "notif-1",
      created: false,
      incident_version: 2,
    },
  ] as unknown,
};
const OPERATOR_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_USER_ID = "a6ab38dc-9844-4b72-922f-2d2f70f8e617";

const pauseMock = vi.fn(async (_input: unknown) => ({
  state: {
    scope: "global",
    isPaused: true,
    pauseReason: "test",
    pausedUntil: null,
    pausedAt: new Date().toISOString(),
    pausedBy: OPERATOR_USER_ID,
  },
  pauseAuditId: "audit-1",
}));

vi.mock("@/lib/email/pause", () => ({
  pause: (input: unknown) => pauseMock(input),
  retryPauseNotificationFanout: vi.fn(async () => undefined),
}));

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    const workloadLease = {
      ownerToken: "email-anomaly-test-owner",
      fenceToken: 1,
      globalFenceToken: 1,
      expiresAt: "2099-01-01T00:00:00.000Z",
      signal: new AbortController().signal,
    };
    return {
      ...actual,
      runWithCronWorkloadControl: async ({
        work,
      }: {
        work: (lease: typeof workloadLease) => Promise<unknown>;
      }) => ({
        status: "completed",
        value: await work(workloadLease),
      }),
    };
  }
);

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
      let reconciliationRead = false;
      let criticalReconciliationRead = false;
      const chain = {
        gte: async () => ({ data: captures.recent, error: null }),
        or: () => {
          reconciliationRead = true;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          if (column === "severity" && value === "critical") {
            criticalReconciliationRead = true;
          }
          return chain;
        },
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: (count: number) =>
          reconciliationRead || criticalReconciliationRead
            ? Promise.resolve({
                data: captures.incomplete.slice(0, count),
                error: null,
                count: captures.incomplete.length,
              })
            : chain,
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
      rpc: async (name: string, args: unknown) => {
        captures.rpcs.push({ name, args });
        if (name === "email_event_metrics") {
          return { data: captures.metrics.value, error: null };
        }
        if (name === "create_email_anomaly_notification_if_new") {
          return { data: captures.notificationIdentity, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      from: fromBuilder,
    }),
  };
});

beforeEach(() => {
  captures.inserts = [];
  captures.updates = [];
  captures.rpcs = [];
  captures.recent = [];
  captures.incomplete = [];
  captures.metrics.value = null;
  captures.notificationIdentity = [
    {
      notification_id: "notif-1",
      created: false,
      incident_version: 2,
    },
  ];
  pauseMock.mockClear();
  process.env.CRON_SECRET = "test-secret";
  process.env.PMF_OPERATOR_USER_ID = OPERATOR_USER_ID;
  process.env.PMF_NOTIFICATION_EMAIL = "ops@opsapp.co";
  process.env.PMF_OPERATOR_COMPANY_ID = OPERATOR_COMPANY_ID;
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
  }, 15_000);

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

  it("critical bounce writes anomaly, pauses, and finalizes collision-safe notification identity", async () => {
    captures.metrics.value = CRITICAL_BOUNCE;
    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(
      captures.inserts.find((i) => i.table === "email_anomaly_log")
    ).toBeTruthy();
    expect(
      captures.inserts.find((i) => i.table === "notifications")
    ).toBeFalsy();
    expect(
      captures.rpcs.find(
        ({ name }) => name === "create_email_anomaly_notification_if_new"
      )
    ).toEqual({
      name: "create_email_anomaly_notification_if_new",
      args: expect.objectContaining({
        p_user_id: OPERATOR_USER_ID,
        p_company_id: OPERATOR_COMPANY_ID,
        p_anomaly_id: "anom-1",
      }),
    });
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
            "audit-1" &&
          (u.payload as { notification_id?: string }).notification_id ===
            "notif-1"
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
    expect(
      captures.inserts.find((i) => i.table === "email_anomaly_log")
    ).toBeFalsy();
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it("recovers a recent incomplete anomaly after the live metrics are healthy", async () => {
    captures.metrics.value = HEALTHY;
    captures.recent = [
      {
        id: "anom-incomplete",
        kind: "volume_drop",
        severity: "warn",
        detected_at: new Date().toISOString(),
        window_minutes: 15,
        metric_value: 0,
        threshold: 1,
        context: { baselineSent: 25 },
        action_taken: null,
        notification_id: null,
        pause_audit_id: null,
      },
    ];

    const { GET } = await import("@/app/api/cron/email/anomaly-check/route");
    const res = await GET(buildReq("Bearer test-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ evals: 0, written: 0 });
    expect(
      captures.inserts.find((i) => i.table === "email_anomaly_log")
    ).toBeFalsy();
    expect(
      captures.rpcs.find(
        ({ name, args }) =>
          name === "create_email_anomaly_notification_if_new" &&
          (args as { p_anomaly_id?: string }).p_anomaly_id === "anom-incomplete"
      )
    ).toBeTruthy();
    expect(captures.updates).toContainEqual({
      table: "email_anomaly_log",
      payload: expect.objectContaining({ notification_id: "notif-1" }),
    });
  });
});
