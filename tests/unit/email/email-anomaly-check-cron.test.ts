import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Eval = {
  kind: "bounce_spike" | "spam_spike" | "delivery_drop" | "volume_drop";
  severity: "warn" | "critical";
  windowMinutes: number;
  metricValue: number;
  threshold: number;
  context: Record<string, unknown>;
};
const OPERATOR_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";

const {
  CronDatabaseOperationError,
  evals,
  state,
  evaluateThresholdsMock,
  pauseMock,
  runWithCronWorkloadControlMock,
  serviceClient,
} = vi.hoisted(() => {
  class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  }
  return {
    CronDatabaseOperationError,
    evals: [] as Eval[],
    state: {
      metricsErrors: new Map<number, { code?: string; message: string }>(),
      recentError: null as { code?: string; message: string } | null,
      logInsertErrorKind: null as string | null,
      notificationError: null as { code?: string; message: string } | null,
      updateError: null as { code?: string; message: string } | null,
      logInsertCalls: [] as string[],
      updateCalls: [] as string[],
      activeInserts: 0,
      maxActiveInserts: 0,
      insertDelayMs: 0,
    },
    evaluateThresholdsMock: vi.fn(),
    pauseMock: vi.fn(),
    runWithCronWorkloadControlMock: vi.fn(),
    serviceClient: { rpc: vi.fn(), from: vi.fn() },
  };
});

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError,
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
}));

vi.mock("@/lib/email/anomaly-thresholds", () => ({
  evaluateThresholds: evaluateThresholdsMock,
  severityRank: (severity: "warn" | "critical") =>
    severity === "critical" ? 2 : 1,
}));

vi.mock("@/lib/email/pause", () => ({
  pause: pauseMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceClient,
}));

import { GET } from "@/app/api/cron/email/anomaly-check/route";

function request() {
  return new NextRequest("https://ops.test/api/cron/email/anomaly-check", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

function makeEval(index: number, critical = false): Eval {
  const kinds: Eval["kind"][] = [
    "bounce_spike",
    "spam_spike",
    "delivery_drop",
    "volume_drop",
  ];
  return {
    kind: kinds[index % kinds.length],
    severity: critical ? "critical" : "warn",
    windowMinutes: 15,
    metricValue: 10 + index,
    threshold: 5,
    context: { index },
  };
}

describe("email anomaly check cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.PMF_OPERATOR_USER_ID = "operator-user";
    process.env.PMF_OPERATOR_EMAIL = "operator@example.com";
    process.env.PMF_OPERATOR_COMPANY_ID = OPERATOR_COMPANY_ID;
    vi.clearAllMocks();
    evals.splice(0, evals.length, makeEval(0), makeEval(1), makeEval(2));
    state.metricsErrors.clear();
    state.recentError = null;
    state.logInsertErrorKind = null;
    state.notificationError = null;
    state.updateError = null;
    state.logInsertCalls.length = 0;
    state.updateCalls.length = 0;
    state.activeInserts = 0;
    state.maxActiveInserts = 0;
    state.insertDelayMs = 0;
    evaluateThresholdsMock.mockImplementation(() => [...evals]);
    pauseMock.mockResolvedValue({ pauseAuditId: "audit-1" });
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    serviceClient.rpc.mockImplementation(
      async (_name: string, args: { p_minutes_back: number }) => ({
        data: {
          window_minutes: args.p_minutes_back,
          total_sent: 100,
          total_delivered: 95,
          total_bounced: 5,
          bounce_pct: 5,
          total_spam: 0,
          spam_pct: 0,
          total_open: 50,
          open_pct: 50,
          total_click: 10,
          click_pct: 10,
          error_events: 0,
        },
        error: state.metricsErrors.get(args.p_minutes_back) ?? null,
      })
    );
    serviceClient.from.mockImplementation((table: string) => {
      let mode: "read" | "insert" | "update" = "read";
      let payload: Record<string, unknown> = {};
      const query = {
        select: () => query,
        gte: async () => ({ data: [], error: state.recentError }),
        insert: (nextPayload: Record<string, unknown>) => {
          mode = "insert";
          payload = nextPayload;
          return query;
        },
        update: (nextPayload: Record<string, unknown>) => {
          mode = "update";
          payload = nextPayload;
          return query;
        },
        single: async () => {
          if (table === "email_anomaly_log" && mode === "insert") {
            const kind = String(payload.kind);
            state.logInsertCalls.push(kind);
            state.activeInserts += 1;
            state.maxActiveInserts = Math.max(
              state.maxActiveInserts,
              state.activeInserts
            );
            try {
              if (state.insertDelayMs > 0) {
                await new Promise((resolve) =>
                  setTimeout(resolve, state.insertDelayMs)
                );
              }
              return {
                data: { id: `anomaly-${kind}` },
                error:
                  state.logInsertErrorKind === kind
                    ? {
                        code: "53300",
                        message: "remaining connection slots",
                      }
                    : null,
              };
            } finally {
              state.activeInserts -= 1;
            }
          }
          if (table === "notifications" && mode === "insert") {
            return {
              data: { id: `notification-${String(payload.title)}` },
              error: state.notificationError,
            };
          }
          throw new Error(`Unexpected ${table} single in ${mode} mode`);
        },
        eq: async (_column: string, id: string) => {
          if (table === "email_anomaly_log" && mode === "update") {
            state.updateCalls.push(id);
            return { data: null, error: state.updateError };
          }
          throw new Error(`Unexpected ${table} eq in ${mode} mode`);
        },
      };
      return query;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.PMF_OPERATOR_USER_ID;
    delete process.env.PMF_OPERATOR_EMAIL;
    delete process.env.PMF_OPERATOR_COMPANY_ID;
    vi.restoreAllMocks();
  });

  it("runs evaluations with a maximum concurrency of two inside one workload lease", async () => {
    state.insertDelayMs = 10;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(state.maxActiveInserts).toBe(2);
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceClient,
        workloadKey: "email-anomaly-check",
        leaseSeconds: 120,
        work: expect.any(Function),
      })
    );
  });

  it("launches no metric or anomaly work while another run holds the lease", async () => {
    runWithCronWorkloadControlMock.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(serviceClient.rpc).not.toHaveBeenCalled();
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it("checks the baseline RPC error before querying later state", async () => {
    state.metricsErrors.set(60, {
      code: "53300",
      message: "remaining connection slots",
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it("stops queued evaluations after a database insert failure", async () => {
    state.logInsertErrorKind = "bounce_spike";
    state.insertDelayMs = 5;

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(state.logInsertCalls.length).toBeLessThanOrEqual(2);
    expect(state.updateCalls).not.toContain("anomaly-bounce_spike");
  });

  it("isolates an ordinary pause failure and completes the other evaluation", async () => {
    evals.splice(0, evals.length, makeEval(0, true), makeEval(2));
    pauseMock.mockRejectedValueOnce({
      status: 504,
      message: "notification provider timeout",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      evals: 2,
      written: 2,
    });
    expect(state.updateCalls).toHaveLength(2);
  });
});
