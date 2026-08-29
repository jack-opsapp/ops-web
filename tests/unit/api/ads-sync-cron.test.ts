// @vitest-environment node
/**
 * Bug 964cf782 — the daily ads sync must degrade truthfully when the Google
 * Ads account/token cannot access the API, instead of hard-500ing on every
 * scheduled run. Unexpected failures must still 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  }
  return {
    syncDay: vi.fn(),
    getSyncStatus: vi.fn(),
    updateSyncStatus: vi.fn(),
    dispatchBackfillChunk: vi.fn(),
    runWithCronWorkloadControl: vi.fn(),
    reportAdsProviderHealth: vi.fn(),
    adminClient: { from: vi.fn(), rpc: vi.fn() },
    CronDatabaseOperationError,
  };
});

vi.mock("@/lib/admin/ads-history-sync", () => ({ syncDay: mocks.syncDay }));
vi.mock("@/lib/admin/ads-history-queries", () => ({
  getSyncStatus: mocks.getSyncStatus,
  updateSyncStatus: mocks.updateSyncStatus,
}));
vi.mock("@/lib/admin/ads-backfill-dispatch", () => ({
  dispatchBackfillChunk: mocks.dispatchBackfillChunk,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => mocks.adminClient,
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: mocks.CronDatabaseOperationError,
  runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
}));
vi.mock("@/lib/admin/ads-provider-health", () => ({
  classifyGoogleAdsAccessFailure: (error: unknown) =>
    error instanceof Error && error.message.includes("(403)")
      ? "Google Ads API access blocked (DEVELOPER_TOKEN_NOT_APPROVED). Scheduled ads syncs are paused until access is restored."
      : null,
  reportAdsProviderHealth: mocks.reportAdsProviderHealth,
}));

import { GET } from "@/app/api/cron/ads-sync/route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/ads-sync", {
    headers: auth ? { authorization: auth } : {},
  });

const ACCESS_ERROR = new Error("Google Ads API error (403): DEVELOPER_TOKEN_NOT_APPROVED");

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  vi.clearAllMocks();
  mocks.syncDay.mockResolvedValue(undefined);
  mocks.getSyncStatus.mockResolvedValue(null);
  mocks.updateSyncStatus.mockResolvedValue(undefined);
  mocks.reportAdsProviderHealth.mockResolvedValue(undefined);
  mocks.runWithCronWorkloadControl.mockImplementation(
    async ({ work }: { work: (lease: unknown) => Promise<unknown> }) => ({
      status: "completed",
      value: await work({}),
    })
  );
});

describe("ads-sync cron", () => {
  it("returns 401 without the cron bearer token", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.runWithCronWorkloadControl).not.toHaveBeenCalled();
  });

  it("records provider health as healthy on a successful sync", async () => {
    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "synced", ran: true });
    expect(mocks.reportAdsProviderHealth).toHaveBeenCalledWith(
      mocks.adminClient,
      { blocked: false }
    );
  });

  it("degrades with 200 when Google Ads access is blocked", async () => {
    mocks.syncDay.mockRejectedValue(ACCESS_ERROR);

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "degraded", ran: true });
    expect(body.reason).toContain("DEVELOPER_TOKEN_NOT_APPROVED");
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith("daily-sync", {
      status: "failed",
      error: expect.stringContaining("DEVELOPER_TOKEN_NOT_APPROVED"),
    });
    expect(mocks.reportAdsProviderHealth).toHaveBeenCalledWith(
      mocks.adminClient,
      {
        blocked: true,
        reason: expect.stringContaining("DEVELOPER_TOKEN_NOT_APPROVED"),
      }
    );
  });

  it("still 500s on an unexpected failure", async () => {
    mocks.syncDay.mockRejectedValue(new Error("boom"));

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(500);
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith("daily-sync", {
      status: "failed",
      error: "boom",
    });
    expect(mocks.reportAdsProviderHealth).not.toHaveBeenCalled();
  });

  it("keeps database-pressure errors outside the degrade path", async () => {
    const pressure = new mocks.CronDatabaseOperationError("unreachable", {
      cause: { code: "PGRST002" },
    });
    mocks.syncDay.mockRejectedValue(pressure);

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(500);
    expect(mocks.reportAdsProviderHealth).not.toHaveBeenCalled();
    // Only the initial "running" write happened.
    expect(mocks.updateSyncStatus).toHaveBeenCalledTimes(1);
  });

  it("returns an idempotent no-op while another sync owns the lease", async () => {
    mocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "already_running", ran: false });
  });
});
