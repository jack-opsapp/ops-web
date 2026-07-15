import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runSyncMock, sweepStaleLeadsMock, retryDirtyClassificationsMock } =
  vi.hoisted(() => ({
    runSyncMock: vi.fn(),
    sweepStaleLeadsMock: vi.fn(),
    retryDirtyClassificationsMock: vi.fn(),
  }));

vi.mock("@/lib/api/services/sync-engine", () => ({
  SyncEngine: {
    runSync: runSyncMock,
    sweepStaleLeads: sweepStaleLeadsMock,
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
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
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
  }),
}));

import { GET } from "@/app/api/cron/email-sync/route";

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
    retryDirtyClassificationsMock.mockResolvedValue({
      scanned: 0,
      classified: 0,
      errors: 0,
    });
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
});
