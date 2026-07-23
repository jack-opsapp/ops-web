import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  runSyncMock,
  sweepStaleLeadsMock,
  retryDirtyClassificationsMock,
  retryPendingLeadScansMock,
  runWithSupabaseMock,
  setSupabaseOverrideMock,
  supabaseContext,
  serviceRoleClient,
} = vi.hoisted(() => {
  const supabaseContext: { current: unknown; seenBySync: unknown } = {
    current: null,
    seenBySync: null,
  };
  const serviceRoleClient = {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: (table: string) => {
      const result =
        table === "email_connections"
          ? {
              data: [
                {
                  id: "connection-1",
                  company_id: "company-1",
                  email: "owner@example.com",
                  provider: "gmail",
                  sync_interval_minutes: 15,
                  last_synced_at: null,
                },
              ],
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
    retryPendingLeadScansMock: vi.fn(),
    runWithSupabaseMock: vi.fn(),
    setSupabaseOverrideMock: vi.fn(),
    supabaseContext,
    serviceRoleClient,
  };
});

vi.mock("@/lib/api/services/sync-engine", () => ({
  SyncEngine: {
    runSync: runSyncMock,
    sweepStaleLeads: sweepStaleLeadsMock,
    retryPendingLeadScans: retryPendingLeadScansMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    retryDirtyClassifications: retryDirtyClassificationsMock,
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

describe("email sync cron HTTP outcome", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    runSyncMock.mockReset();
    sweepStaleLeadsMock.mockReset();
    retryDirtyClassificationsMock.mockReset();
    retryPendingLeadScansMock.mockReset();
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
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 0,
      classified: 0,
      errors: 0,
    });
    retryPendingLeadScansMock.mockResolvedValue({
      scanned: 0,
      promoted: 0,
      cleared: 0,
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
    sweepStaleLeadsMock.mockResolvedValue(0);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runWithSupabaseMock).toHaveBeenCalledWith(
      serviceRoleClient,
      expect.any(Function)
    );
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
    sweepStaleLeadsMock.mockResolvedValue(0);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, failed: 1, failedConnections: 1 });
    expect(body.results[0].errors).toEqual(["cursor intentionally unchanged"]);
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
    sweepStaleLeadsMock.mockResolvedValue(0);
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 2,
      classified: 2,
      errors: 0,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(retryDirtyClassificationsMock).toHaveBeenCalledWith({
      companyIds: ["company-1"],
      limit: 10,
      concurrency: 2,
    });
    expect(body.threadClassificationRetry).toEqual({
      scanned: 2,
      classified: 2,
      errors: 0,
    });
  });

  it("returns a retryable failure while any dirty thread remains unclassified", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(0);
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 1,
      classified: 0,
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
    sweepStaleLeadsMock.mockResolvedValue(0);
    retryPendingLeadScansMock.mockResolvedValue({
      scanned: 3,
      promoted: 2,
      cleared: 3,
      errors: [],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(retryPendingLeadScansMock).toHaveBeenCalledWith({ limit: 50 });
    expect(body.pendingLeadScanSweep).toEqual({
      scanned: 3,
      promoted: 2,
      cleared: 3,
      errors: [],
    });
    expect(body.pendingLeadScanSweepError).toBeNull();
  });

  it("counts a pending lead-scan sweep error in the failed tally", async () => {
    runSyncMock.mockResolvedValue({
      activitiesCreated: 0,
      newLeads: 0,
      errors: [],
    });
    sweepStaleLeadsMock.mockResolvedValue(0);
    retryPendingLeadScansMock.mockResolvedValue({
      scanned: 2,
      promoted: 0,
      cleared: 1,
      errors: ["connection conn-1: AI provider unavailable — insufficient_quota"],
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
});
