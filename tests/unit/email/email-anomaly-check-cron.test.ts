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

type RecentAnomaly = {
  id: string;
  kind: Eval["kind"];
  severity: Eval["severity"];
  detected_at: string;
  window_minutes: number;
  metric_value: number;
  threshold: number;
  context: Record<string, unknown>;
  action_taken: string | null;
  notification_id: string | null;
  pause_audit_id: string | null;
  resolved_at?: string | null;
};
const OPERATOR_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_USER_ID = "a6ab38dc-9844-4b72-922f-2d2f70f8e617";

const {
  CronDatabaseOperationError,
  evals,
  state,
  evaluateThresholdsMock,
  pauseMock,
  retryPauseNotificationFanoutMock,
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
      notificationRpcError: null as { code?: string; message: string } | null,
      notificationRpcResult: [
        {
          notification_id: "notification-created",
          created: true,
          incident_version: 1,
        },
      ] as unknown,
      notificationRpcCalls: [] as Array<Record<string, unknown>>,
      directNotificationInserts: 0,
      recentRows: [] as RecentAnomaly[],
      incompleteRows: [] as RecentAnomaly[],
      pauseAuditRows: new Map<string, string>(),
      pauseAuditLookupCalls: [] as string[],
      criticalKindFilters: [] as unknown[][],
      unresolvedFilterLanes: [] as string[],
      updateError: null as { code?: string; message: string } | null,
      logInsertCalls: [] as string[],
      updateCalls: [] as string[],
      updatePayloads: [] as Array<{
        id: string;
        payload: Record<string, unknown>;
      }>,
      activeInserts: 0,
      maxActiveInserts: 0,
      insertDelayMs: 0,
    },
    evaluateThresholdsMock: vi.fn(),
    pauseMock: vi.fn(),
    retryPauseNotificationFanoutMock: vi.fn(),
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
  retryPauseNotificationFanout: retryPauseNotificationFanoutMock,
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
    process.env.PMF_OPERATOR_USER_ID = OPERATOR_USER_ID;
    process.env.PMF_OPERATOR_EMAIL = "operator@example.com";
    process.env.PMF_NOTIFICATION_EMAIL = "operator@example.com";
    process.env.PMF_OPERATOR_COMPANY_ID = OPERATOR_COMPANY_ID;
    vi.clearAllMocks();
    evals.splice(0, evals.length, makeEval(0), makeEval(1), makeEval(2));
    state.metricsErrors.clear();
    state.recentError = null;
    state.logInsertErrorKind = null;
    state.notificationRpcError = null;
    state.notificationRpcResult = [
      {
        notification_id: "notification-created",
        created: true,
        incident_version: 1,
      },
    ];
    state.notificationRpcCalls.length = 0;
    state.directNotificationInserts = 0;
    state.recentRows.length = 0;
    state.incompleteRows.length = 0;
    state.pauseAuditRows.clear();
    state.pauseAuditLookupCalls.length = 0;
    state.criticalKindFilters.length = 0;
    state.unresolvedFilterLanes.length = 0;
    state.updateError = null;
    state.logInsertCalls.length = 0;
    state.updateCalls.length = 0;
    state.updatePayloads.length = 0;
    state.activeInserts = 0;
    state.maxActiveInserts = 0;
    state.insertDelayMs = 0;
    evaluateThresholdsMock.mockImplementation(() => [...evals]);
    pauseMock.mockResolvedValue({ pauseAuditId: "audit-1" });
    retryPauseNotificationFanoutMock.mockResolvedValue(undefined);
    runWithCronWorkloadControlMock.mockImplementation(
      async ({ work }: { work: () => Promise<unknown> }) => ({
        status: "completed",
        value: await work(),
      })
    );
    serviceClient.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "create_email_anomaly_notification_if_new") {
          state.notificationRpcCalls.push(args);
          return {
            data: state.notificationRpcResult,
            error: state.notificationRpcError,
          };
        }
        if (name !== "email_event_metrics") {
          throw new Error(`Unexpected RPC ${name}`);
        }
        const minutesBack = Number(args.p_minutes_back);
        return {
          data: {
            window_minutes: minutesBack,
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
          error: state.metricsErrors.get(minutesBack) ?? null,
        };
      }
    );
    serviceClient.from.mockImplementation((table: string) => {
      let mode: "read" | "insert" | "update" = "read";
      let reconciliationRead = false;
      let criticalReconciliationRead = false;
      let payload: Record<string, unknown> = {};
      const filters = new Map<string, unknown>();
      const query = {
        select: () => query,
        gte: async () => ({
          data: table === "email_anomaly_log" ? state.recentRows : [],
          error: state.recentError,
        }),
        or: () => {
          reconciliationRead = true;
          return query;
        },
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
            state.directNotificationInserts += 1;
            return {
              data: { id: `notification-${String(payload.title)}` },
              error: state.notificationRpcError,
            };
          }
          throw new Error(`Unexpected ${table} single in ${mode} mode`);
        },
        eq: (column: string, value: unknown) => {
          if (table === "email_anomaly_log" && mode === "update") {
            const id = String(value);
            state.updateCalls.push(id);
            state.updatePayloads.push({ id, payload });
            return Promise.resolve({ data: null, error: state.updateError });
          }
          if (
            table === "email_anomaly_log" &&
            column === "severity" &&
            value === "critical"
          ) {
            criticalReconciliationRead = true;
          }
          filters.set(column, value);
          return query;
        },
        is: (column: string, value: unknown) => {
          if (column === "resolved_at" && value === null) {
            state.unresolvedFilterLanes.push(
              reconciliationRead
                ? "incomplete"
                : criticalReconciliationRead
                  ? "critical"
                  : "other"
            );
          }
          return query;
        },
        in: (column: string, values: unknown[]) => {
          if (table === "email_anomaly_log" && column === "kind") {
            state.criticalKindFilters.push(values);
          }
          return query;
        },
        order: () => query,
        limit: (count: number) => {
          if (
            table === "email_anomaly_log" &&
            (reconciliationRead || criticalReconciliationRead)
          ) {
            return Promise.resolve({
              data: state.incompleteRows.slice(0, count),
              error: state.recentError,
            });
          }
          return query;
        },
        maybeSingle: async () => {
          if (table === "email_pause_audit_log" && mode === "read") {
            const anomalyId = String(filters.get("anomaly_log_id"));
            state.pauseAuditLookupCalls.push(anomalyId);
            const id = state.pauseAuditRows.get(anomalyId);
            return { data: id ? { id } : null, error: null };
          }
          throw new Error(`Unexpected ${table} maybeSingle in ${mode} mode`);
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
    delete process.env.PMF_NOTIFICATION_EMAIL;
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

  it("uses an anomaly-scoped identity key and finalizes an existing notification", async () => {
    evals.splice(0, evals.length, makeEval(3));
    state.notificationRpcResult = [
      {
        notification_id: "notification-existing",
        created: false,
        incident_version: 4,
      },
    ];

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(state.directNotificationInserts).toBe(0);
    expect(state.notificationRpcCalls).toEqual([
      expect.objectContaining({
        p_user_id: OPERATOR_USER_ID,
        p_company_id: OPERATOR_COMPANY_ID,
        p_anomaly_id: "anomaly-volume_drop",
      }),
    ]);
    expect(state.updatePayloads).toContainEqual({
      id: "anomaly-volume_drop",
      payload: expect.objectContaining({
        notification_id: "notification-existing",
      }),
    });
  });

  it("reconciles an incomplete recent anomaly before dedupe without inserting a duplicate", async () => {
    evals.splice(0, evals.length, makeEval(3));
    state.recentRows.push({
      id: "anomaly-existing-volume",
      kind: "volume_drop",
      severity: "warn",
      detected_at: new Date().toISOString(),
      window_minutes: 15,
      metric_value: 13,
      threshold: 5,
      context: { index: 3 },
      action_taken: null,
      notification_id: null,
      pause_audit_id: null,
    });
    state.notificationRpcResult = [
      {
        notification_id: "notification-recovered",
        created: false,
        incident_version: 2,
      },
    ];

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ written: 0 });
    expect(state.logInsertCalls).toEqual([]);
    expect(state.notificationRpcCalls).toEqual([
      expect.objectContaining({
        p_anomaly_id: "anomaly-existing-volume",
      }),
    ]);
    expect(state.updatePayloads).toContainEqual({
      id: "anomaly-existing-volume",
      payload: expect.objectContaining({
        notification_id: "notification-recovered",
      }),
    });
  });

  it("recovers an existing pause audit while finalizing instead of pausing twice", async () => {
    evals.splice(0, evals.length, makeEval(0, true));
    state.recentRows.push({
      id: "anomaly-existing-bounce",
      kind: "bounce_spike",
      severity: "critical",
      detected_at: new Date().toISOString(),
      window_minutes: 15,
      metric_value: 10,
      threshold: 5,
      context: { index: 0 },
      action_taken: null,
      notification_id: null,
      pause_audit_id: null,
    });
    state.pauseAuditRows.set("anomaly-existing-bounce", "pause-audit-existing");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(state.logInsertCalls).toEqual([]);
    expect(state.pauseAuditLookupCalls).toEqual(["anomaly-existing-bounce"]);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(state.updatePayloads).toContainEqual({
      id: "anomaly-existing-bounce",
      payload: expect.objectContaining({
        action_taken:
          "pause(global) by anomaly bounce_spike@10% [audit pause-audit-existing]",
        notification_id: "notification-created",
        pause_audit_id: "pause-audit-existing",
      }),
    });
  });

  it("reuses a pause audit already linked on an incomplete anomaly", async () => {
    evals.splice(0, evals.length, makeEval(0, true));
    state.recentRows.push({
      id: "anomaly-linked-bounce",
      kind: "bounce_spike",
      severity: "critical",
      detected_at: new Date().toISOString(),
      window_minutes: 15,
      metric_value: 10,
      threshold: 5,
      context: { index: 0 },
      action_taken: null,
      notification_id: null,
      pause_audit_id: "pause-audit-linked",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(state.pauseAuditLookupCalls).toEqual([]);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(state.updatePayloads).toContainEqual({
      id: "anomaly-linked-bounce",
      payload: expect.objectContaining({
        action_taken:
          "pause(global) by anomaly bounce_spike@10% [audit pause-audit-linked]",
        notification_id: "notification-created",
        pause_audit_id: "pause-audit-linked",
      }),
    });
  });

  it("reconciles an old incomplete anomaly outside the dedupe window", async () => {
    evals.splice(0, evals.length);
    state.incompleteRows.push({
      id: "anomaly-old-incomplete",
      kind: "volume_drop",
      severity: "warn",
      detected_at: "2026-08-01T00:00:00.000Z",
      window_minutes: 15,
      metric_value: 0,
      threshold: 5,
      context: {},
      action_taken: null,
      notification_id: null,
      pause_audit_id: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(state.notificationRpcCalls).toEqual([
      expect.objectContaining({ p_anomaly_id: "anomaly-old-incomplete" }),
    ]);
    expect(state.updateCalls).toContain("anomaly-old-incomplete");
  });

  it("retries a previously skipped critical pause when actor configuration recovers", async () => {
    evals.splice(0, evals.length);
    state.incompleteRows.push({
      id: "anomaly-pause-skipped",
      kind: "bounce_spike",
      severity: "critical",
      detected_at: "2026-08-01T00:00:00.000Z",
      window_minutes: 15,
      metric_value: 12,
      threshold: 5,
      context: {},
      action_taken:
        "pause skipped: PMF_OPERATOR_USER_ID or PMF_NOTIFICATION_EMAIL unset (cannot record actor)",
      notification_id: "notification-existing",
      pause_audit_id: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(pauseMock).toHaveBeenCalledOnce();
    expect(state.criticalKindFilters).toContainEqual([
      "bounce_spike",
      "spam_spike",
    ]);
    expect(state.updatePayloads).toContainEqual({
      id: "anomaly-pause-skipped",
      payload: expect.objectContaining({ pause_audit_id: "audit-1" }),
    });
  });

  it("excludes resolved rows from both reconciliation lanes", async () => {
    evals.splice(0, evals.length);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(state.unresolvedFilterLanes).toEqual(
      expect.arrayContaining(["incomplete", "critical"])
    );
  });

  it("keeps a resolved recent row for dedupe without re-running reconciliation", async () => {
    evals.splice(0, evals.length, makeEval(0, true));
    state.recentRows.push({
      id: "anomaly-resolved-recent",
      kind: "bounce_spike",
      severity: "critical",
      detected_at: new Date().toISOString(),
      window_minutes: 15,
      metric_value: 12,
      threshold: 5,
      context: {},
      action_taken: "pause skipped: prior config",
      notification_id: null,
      pause_audit_id: null,
      resolved_at: new Date().toISOString(),
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ written: 0 });
    expect(pauseMock).not.toHaveBeenCalled();
    expect(state.updateCalls).not.toContain("anomaly-resolved-recent");
  });

  it("isolates a malformed operator user id as recoverable configuration", async () => {
    process.env.PMF_OPERATOR_USER_ID = "not-a-uuid";
    evals.splice(0, evals.length);
    state.incompleteRows.push({
      id: "anomaly-invalid-operator",
      kind: "bounce_spike",
      severity: "critical",
      detected_at: "2026-08-01T00:00:00.000Z",
      window_minutes: 15,
      metric_value: 12,
      threshold: 5,
      context: {},
      action_taken: null,
      notification_id: null,
      pause_audit_id: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(state.notificationRpcCalls).toEqual([]);
    expect(state.updatePayloads).toContainEqual({
      id: "anomaly-invalid-operator",
      payload: expect.objectContaining({
        action_taken: expect.stringContaining("pause skipped:"),
      }),
    });
  });

  it("still applies the global pause when only notification company identity is missing", async () => {
    delete process.env.PMF_OPERATOR_COMPANY_ID;
    evals.splice(0, evals.length, makeEval(0, true));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(pauseMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: OPERATOR_USER_ID })
    );
    expect(state.notificationRpcCalls).toEqual([]);
  });

  it("retries pause notification fanout from the recovered audit without re-pausing", async () => {
    evals.splice(0, evals.length);
    state.incompleteRows.push({
      id: "anomaly-audit-fanout-gap",
      kind: "bounce_spike",
      severity: "critical",
      detected_at: "2026-08-01T00:00:00.000Z",
      window_minutes: 15,
      metric_value: 12,
      threshold: 5,
      context: {},
      action_taken: null,
      notification_id: null,
      pause_audit_id: "pause-audit-existing",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(pauseMock).not.toHaveBeenCalled();
    expect(retryPauseNotificationFanoutMock).toHaveBeenCalledWith({
      anomalyId: "anomaly-audit-fanout-gap",
      pauseAuditId: "pause-audit-existing",
    });
  });

  it("does not finalize an anomaly when notification identity is malformed", async () => {
    evals.splice(0, evals.length, makeEval(3));
    state.notificationRpcResult = [
      { notification_id: null, created: false, incident_version: 1 },
    ];

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(state.updateCalls).not.toContain("anomaly-volume_drop");
  });
});
