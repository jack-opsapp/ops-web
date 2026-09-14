// @vitest-environment node
/**
 * Bug 964cf782 — the daily ads sync must degrade truthfully when the Google
 * Ads account/token cannot access the API, instead of hard-500ing on every
 * scheduled run. Unexpected failures must still 500.
 *
 * The run is: syncDay → runWarehouseExtension (entity snapshot + trailing
 * grains) → mark complete → report healthy → refresh engine readiness.
 * Every step the route imports is mocked here; an unmocked export throws
 * inside the run and turns the success path into a 500 (bug P2-1-1-2).
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
    runWarehouseExtension: vi.fn(),
    refreshReadinessProbe: vi.fn(),
    getSyncStatus: vi.fn(),
    updateSyncStatus: vi.fn(),
    dispatchBackfillChunk: vi.fn(),
    runWithCronWorkloadControl: vi.fn(),
    reportAdsProviderHealth: vi.fn(),
    adminClient: { from: vi.fn(), rpc: vi.fn() },
    CronDatabaseOperationError,
  };
});

vi.mock("@/lib/admin/ads-history-sync", () => ({
  syncDay: mocks.syncDay,
  runWarehouseExtension: mocks.runWarehouseExtension,
}));
vi.mock("@/lib/ads/readiness-probe", () => ({
  refreshReadinessProbe: mocks.refreshReadinessProbe,
}));
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

const EXTENSION = {
  window: { start: "2026-09-11", end: "2026-09-13", days: 3 },
  grains: { adGroups: 12, ads: 24, assets: 96, keywords: 54, clicks: 7, apiCalls: 7 },
  entityRows: 1928,
};

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  vi.clearAllMocks();
  mocks.syncDay.mockResolvedValue(undefined);
  mocks.runWarehouseExtension.mockResolvedValue(EXTENSION);
  mocks.refreshReadinessProbe.mockResolvedValue({});
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

  it("runs the warehouse extension after the day and marks the sync complete only once both land", async () => {
    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "synced", warehouse: EXTENSION });
    expect(mocks.runWarehouseExtension).toHaveBeenCalledTimes(1);
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith("daily-sync", {
      status: "complete",
      last_synced_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      error: null,
    });

    const completeCall = mocks.updateSyncStatus.mock.calls.findIndex(
      ([, patch]) => patch.status === "complete"
    );
    const [syncDayOrder] = mocks.syncDay.mock.invocationCallOrder;
    const [extensionOrder] = mocks.runWarehouseExtension.mock.invocationCallOrder;
    expect(syncDayOrder).toBeLessThan(extensionOrder);
    expect(extensionOrder).toBeLessThan(
      mocks.updateSyncStatus.mock.invocationCallOrder[completeCall]
    );
  });

  it("refreshes engine readiness after reporting the provider healthy", async () => {
    await GET(req("Bearer s3cret"));

    expect(mocks.refreshReadinessProbe).toHaveBeenCalledWith(mocks.adminClient);
    const [healthOrder] = mocks.reportAdsProviderHealth.mock.invocationCallOrder;
    const [probeOrder] = mocks.refreshReadinessProbe.mock.invocationCallOrder;
    expect(healthOrder).toBeLessThan(probeOrder);
  });

  it("keeps the sync synced when the readiness refresh fails", async () => {
    const probeError = new Error("probe unavailable");
    mocks.refreshReadinessProbe.mockRejectedValue(probeError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "synced", ran: true });
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith(
      "daily-sync",
      expect.objectContaining({ status: "complete" })
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[ads-sync] readiness probe refresh failed:",
      probeError
    );
    consoleError.mockRestore();
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
    expect(mocks.runWarehouseExtension).not.toHaveBeenCalled();
    expect(mocks.refreshReadinessProbe).not.toHaveBeenCalled();
  });

  it("degrades, never marking the day complete, when access is blocked during the warehouse extension", async () => {
    mocks.runWarehouseExtension.mockRejectedValue(ACCESS_ERROR);

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "degraded", ran: true });
    expect(mocks.updateSyncStatus).not.toHaveBeenCalledWith(
      "daily-sync",
      expect.objectContaining({ status: "complete" })
    );
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith("daily-sync", {
      status: "failed",
      error: expect.stringContaining("DEVELOPER_TOKEN_NOT_APPROVED"),
    });
    expect(mocks.reportAdsProviderHealth).toHaveBeenCalledWith(
      mocks.adminClient,
      { blocked: true, reason: expect.stringContaining("DEVELOPER_TOKEN_NOT_APPROVED") }
    );
    expect(mocks.refreshReadinessProbe).not.toHaveBeenCalled();
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
    expect(mocks.refreshReadinessProbe).not.toHaveBeenCalled();
  });

  it("500s, never marking the day complete, on an unexpected warehouse extension failure", async () => {
    mocks.runWarehouseExtension.mockRejectedValue(new Error("searchStream exploded"));

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "searchStream exploded" });
    expect(mocks.updateSyncStatus).not.toHaveBeenCalledWith(
      "daily-sync",
      expect.objectContaining({ status: "complete" })
    );
    expect(mocks.updateSyncStatus).toHaveBeenLastCalledWith("daily-sync", {
      status: "failed",
      error: "searchStream exploded",
    });
    expect(mocks.reportAdsProviderHealth).not.toHaveBeenCalled();
    expect(mocks.refreshReadinessProbe).not.toHaveBeenCalled();
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
