import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  runSyncMock,
  sweepStaleLeadsMock,
  retryDirtyClassificationsMock,
  retryPendingIngestionRecoveryMock,
  retryPendingLeadScansMock,
  runWithCronWorkloadControlMock,
  isDatabasePressureErrorMock,
  connectionLimitMock,
  runWithSupabaseMock,
  setSupabaseOverrideMock,
  readCronWorkloadCursorMock,
  advanceCronWorkloadCursorMock,
  runOutboundLearningWorkerMock,
  serviceRoleState,
  supabaseContext,
  serviceRoleClient,
} = vi.hoisted(() => {
  const supabaseContext: { current: unknown; seenBySync: unknown } = {
    current: null,
    seenBySync: null,
  };
  const serviceRoleState = {
    connections: [
      {
        id: "connection-1",
        company_id: "company-1",
        email: "owner@example.com",
        provider: "gmail",
        sync_interval_minutes: 15,
        last_synced_at: null as string | null,
        history_id: "terminal-history",
        history_recovery_page_token: null as string | null,
      },
    ],
  };
  const serviceRoleClient = {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: (table: string) => {
      const result =
        table === "email_connections"
          ? {
              data: serviceRoleState.connections,
              error: null,
            }
          : {
              data: [
                {
                  id: "company-1",
                  subscription_plan: "pro",
                  subscription_status: "active",
                },
              ],
              error: null,
            };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: (value: number) => {
          if (table === "email_connections") connectionLimitMock(value);
          return query;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return query;
    },
  };

  return {
    runSyncMock: vi.fn(),
    sweepStaleLeadsMock: vi.fn(),
    retryDirtyClassificationsMock: vi.fn(),
    retryPendingIngestionRecoveryMock: vi.fn(),
    retryPendingLeadScansMock: vi.fn(),
    runWithCronWorkloadControlMock: vi.fn(),
    isDatabasePressureErrorMock: vi.fn(),
    connectionLimitMock: vi.fn(),
    runWithSupabaseMock: vi.fn(),
    setSupabaseOverrideMock: vi.fn(),
    readCronWorkloadCursorMock: vi.fn(),
    advanceCronWorkloadCursorMock: vi.fn(),
    runOutboundLearningWorkerMock: vi.fn(),
    serviceRoleState,
    supabaseContext,
    serviceRoleClient,
  };
});

vi.mock("@/lib/api/services/sync-engine", () => ({
  SyncEngine: {
    runSync: runSyncMock,
    sweepStaleLeads: sweepStaleLeadsMock,
    retryPendingIngestionRecovery: retryPendingIngestionRecoveryMock,
    retryPendingLeadScans: retryPendingLeadScansMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    retryDirtyClassifications: retryDirtyClassificationsMock,
  },
}));

vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: readCronWorkloadCursorMock,
  advanceCronWorkloadCursor: advanceCronWorkloadCursorMock,
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class EmailOutboundLearningService {
    runWorker = runOutboundLearningWorkerMock;
  },
}));

vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  runWithCronWorkloadControl: runWithCronWorkloadControlMock,
  isDatabasePressureError: isDatabasePressureErrorMock,
  CronDatabaseOperationError: class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
    }
  },
}));

vi.mock("@/lib/subscription", () => ({
  getSubscriptionInfo: () => ({ isActive: true }),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: runWithSupabaseMock,
  setSupabaseOverride: setSupabaseOverrideMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => serviceRoleClient,
}));

import { dynamic, GET, runtime } from "@/app/api/cron/email-sync/route";

function request(): NextRequest {
  return new NextRequest("https://ops.test/api/cron/email-sync", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

const workloadLease = {
  ownerToken: "email-sync-test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

const emptyStaleSweep = {
  stageChanges: 0,
  scanned: 0,
  nextCursor: null,
};

describe("email sync cron HTTP outcome", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    runSyncMock.mockReset();
    sweepStaleLeadsMock.mockReset();
    retryDirtyClassificationsMock.mockReset();
    retryPendingIngestionRecoveryMock.mockReset();
    retryPendingLeadScansMock.mockReset();
    readCronWorkloadCursorMock.mockReset();
    advanceCronWorkloadCursorMock.mockReset();
    runOutboundLearningWorkerMock.mockReset();
    runWithCronWorkloadControlMock.mockReset();
    runWithCronWorkloadControlMock.mockImplementation(
      async ({
        work,
      }: {
        work: (lease: typeof workloadLease) => Promise<unknown>;
      }) => ({
        status: "completed",
        value: await work(workloadLease),
      })
    );
    readCronWorkloadCursorMock.mockResolvedValue(null);
    advanceCronWorkloadCursorMock.mockResolvedValue(undefined);
    runOutboundLearningWorkerMock.mockResolvedValue({
      claimed: 0,
      prepared: 0,
      completed: 0,
      deferred: 0,
      retrying: 0,
      bookkeepingFailed: 0,
      terminalFailed: 0,
      failed: 0,
      errors: [],
    });
    isDatabasePressureErrorMock.mockReset();
    isDatabasePressureErrorMock.mockImplementation((error: unknown) =>
      /PGRST002|57014|connection timeout|SSL handshake failed|web server is down|\b52[125]\b/i.test(
        String(error)
      )
    );
    connectionLimitMock.mockReset();
    runWithSupabaseMock.mockReset();
    runWithSupabaseMock.mockImplementation(
      async (client: unknown, work: () => Promise<unknown>) => {
        supabaseContext.current = client;
        try {
          return await work();
        } finally {
          supabaseContext.current = null;
        }
      }
    );
    setSupabaseOverrideMock.mockReset();
    supabaseContext.current = null;
    supabaseContext.seenBySync = null;
    serviceRoleState.connections[0].last_synced_at = null;
    serviceRoleState.connections[0].history_id = "terminal-history";
    serviceRoleState.connections[0].history_recovery_page_token = null;
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 0,
      classified: 0,
      deferred: 0,
      errors: 0,
    });
    retryPendingLeadScansMock.mockResolvedValue({
      scanned: 0,
      promoted: 0,
      cleared: 0,
      errors: [],
    });
    retryPendingIngestionRecoveryMock.mockResolvedValue({
      claimed: 0,
      classificationsRecovered: 0,
      promoted: 0,
      labelsApplied: 0,
      retrying: 0,
      failed: 0,
      stale: 0,
      staleCompletions: 0,
      errors: [],
    });
  });

  it("keeps the complete cron cycle inside an isolated service-role context", async () => {
    runSyncMock.mockImplementation(async () => {
      supabaseContext.seenBySync = supabaseContext.current;
      return {
        activitiesCreated: 0,
        newLeads: 0,
        errors: [],
      };
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runWithSupabaseMock).toHaveBeenCalledWith(
      serviceRoleClient,
      expect.any(Function)
    );
    expect(runWithCronWorkloadControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceRoleClient,
        workloadKey: "email-sync",
        leaseSeconds: 360,
        work: expect.any(Function),
      })
    );
    expect(connectionLimitMock).toHaveBeenCalledWith(5);
    expect(supabaseContext.seenBySync).toBe(serviceRoleClient);
    expect(setSupabaseOverrideMock).not.toHaveBeenCalled();
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns a retryable non-2xx status when a sync cycle returns errors", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: ["cursor intentionally unchanged"],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, failed: 1, failedConnections: 1 });
    expect(body.results[0].errors).toEqual(["cursor intentionally unchanged"]);
  });

  it("continues a nonterminal cursor even inside the ordinary sync interval", async () => {
    serviceRoleState.connections[0].last_synced_at = new Date().toISOString();
    serviceRoleState.connections[0].history_id =
      'gmail:v1:{"startHistoryId":"100","pageToken":null,"finalHistoryId":"200","pendingMessageIds":["message-2"]}';
    runSyncMock.mockResolvedValue({
      activitiesCreated: 25,
      newLeads: 0,
      continuationPending: true,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runSyncMock).toHaveBeenCalledWith("connection-1");
    expect(body.results[0]).toMatchObject({ continuationPending: true });
  });

  it("continues an unfinished recovery page even inside the ordinary sync interval", async () => {
    serviceRoleState.connections[0].last_synced_at = new Date().toISOString();
    serviceRoleState.connections[0].history_id = "terminal-history";
    serviceRoleState.connections[0].history_recovery_page_token = "page-2";
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      continuationPending: true,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runSyncMock).toHaveBeenCalledWith("connection-1");
  });

  it("includes a stale-sweep failure and returns non-2xx", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 1,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockRejectedValue(new Error("stale sweep unavailable"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      failed: 1,
      failedConnections: 0,
      staleSweepError: "stale sweep unavailable",
    });
  });

  it("retries dirty thread summaries for active companies in a bounded sweep", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 1,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 2,
      classified: 2,
      deferred: 0,
      errors: 0,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(retryDirtyClassificationsMock).toHaveBeenCalledWith({
      companyIds: ["company-1"],
      limit: 5,
      concurrency: 1,
    });
    expect(body.threadClassificationRetry).toEqual({
      scanned: 2,
      classified: 2,
      deferred: 0,
      errors: 0,
    });
  });

  it("returns a retryable failure while any dirty thread remains unclassified", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 1,
      classified: 0,
      deferred: 0,
      errors: 1,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      failed: 1,
      threadClassificationRetry: {
        scanned: 1,
        classified: 0,
        deferred: 0,
        errors: 1,
      },
    });
  });

  it("drains deferred lead-classification scans and surfaces the summary", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);
    retryPendingLeadScansMock.mockResolvedValue({
      scanned: 3,
      promoted: 2,
      cleared: 3,
      errors: [],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(retryPendingLeadScansMock).toHaveBeenCalledWith({ limit: 10 });
    expect(body.pendingLeadScanSweep).toEqual({
      scanned: 3,
      promoted: 2,
      cleared: 3,
      errors: [],
    });
    expect(body.pendingLeadScanSweepError).toBeNull();
  });

  it("drains exact-message classification and label recovery for active companies", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);
    retryPendingIngestionRecoveryMock.mockResolvedValue({
      claimed: 3,
      classificationsRecovered: 1,
      promoted: 1,
      labelsApplied: 2,
      retrying: 0,
      failed: 0,
      stale: 0,
      staleCompletions: 0,
      errors: [],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(retryPendingIngestionRecoveryMock).toHaveBeenCalledWith({
      companyIds: ["company-1"],
      limit: 10,
    });
    expect(body.ingestionRecovery).toMatchObject({
      claimed: 3,
      classificationsRecovered: 1,
      promoted: 1,
      labelsApplied: 2,
    });
    expect(body.ingestionRecoveryError).toBeNull();
  });

  it("returns 503 while a durable ingestion recovery remains retrying", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);
    retryPendingIngestionRecoveryMock.mockResolvedValue({
      claimed: 1,
      classificationsRecovered: 0,
      promoted: 0,
      labelsApplied: 0,
      retrying: 1,
      failed: 0,
      stale: 0,
      staleCompletions: 0,
      errors: [{ queueId: "recovery-1", error: "gmail unavailable" }],
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      ingestionRecovery: { retrying: 1 },
    });
  });

  it("counts a pending lead-scan sweep error in the failed tally", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);
    retryPendingLeadScansMock.mockResolvedValue({
      scanned: 2,
      promoted: 0,
      cleared: 1,
      errors: [
        "connection conn-1: AI provider unavailable — insufficient_quota",
      ],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      failed: 1,
      failedConnections: 0,
    });
    expect(body.pendingLeadScanSweep.errors).toHaveLength(1);
  });

  it("stops the cycle immediately when mailbox work reports database pressure", async () => {
    runSyncMock.mockRejectedValue(
      new Error("PGRST002: could not query the database for the schema cache")
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(sweepStaleLeadsMock).not.toHaveBeenCalled();
    expect(retryDirtyClassificationsMock).not.toHaveBeenCalled();
    expect(retryPendingIngestionRecoveryMock).not.toHaveBeenCalled();
    expect(retryPendingLeadScansMock).not.toHaveBeenCalled();
  });

  it("does not infer database pressure from an external-provider error string", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: ["Gmail 525 SSL handshake failed"],
    });
    sweepStaleLeadsMock.mockResolvedValue(emptyStaleSweep);

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(sweepStaleLeadsMock).toHaveBeenCalledOnce();
    expect(retryDirtyClassificationsMock).toHaveBeenCalledOnce();
    expect(retryPendingIngestionRecoveryMock).toHaveBeenCalledOnce();
    expect(retryPendingLeadScansMock).toHaveBeenCalledOnce();
  });

  it("launches no work while another heavy workload holds the durable lease", async () => {
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
    expect(runSyncMock).not.toHaveBeenCalled();
    expect(sweepStaleLeadsMock).not.toHaveBeenCalled();
    expect(retryDirtyClassificationsMock).not.toHaveBeenCalled();
    expect(retryPendingIngestionRecoveryMock).not.toHaveBeenCalled();
    expect(retryPendingLeadScansMock).not.toHaveBeenCalled();
  });

  it("fails closed when workload control cannot reach the database", async () => {
    runWithCronWorkloadControlMock.mockResolvedValue({
      status: "skipped",
      reason: "control_unavailable",
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      ran: false,
      reason: "control_unavailable",
    });
    expect(runSyncMock).not.toHaveBeenCalled();
  });
});
