// @vitest-environment node
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
    isConfigured: vi.fn(),
    bootstrapIfNeeded: vi.fn(),
    syncOnce: vi.fn(),
    updateAscSyncStatus: vi.fn(),
    runWithCronWorkloadControl: vi.fn(),
    observedWorkFailures: [] as unknown[],
    adminClient: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
    CronDatabaseOperationError,
  };
});

vi.mock("@/lib/analytics/app-store-client", () => ({
  isAppStoreConfigured: mocks.isConfigured,
}));
vi.mock("@/lib/admin/app-store-sync", () => ({
  bootstrapIfNeeded: mocks.bootstrapIfNeeded,
  syncOnce: mocks.syncOnce,
}));
vi.mock("@/lib/admin/app-store-queries", () => ({
  updateAscSyncStatus: mocks.updateAscSyncStatus,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => mocks.adminClient,
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: mocks.CronDatabaseOperationError,
  isDatabasePressureError: (error: unknown) =>
    error instanceof mocks.CronDatabaseOperationError,
  runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
}));

import { GET } from "@/app/api/cron/app-store-sync/route";

const workloadLease = {
  ownerToken: "app-store-test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/app-store-sync", {
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  mocks.isConfigured.mockReset();
  mocks.isConfigured.mockReturnValue(true);
  mocks.bootstrapIfNeeded.mockReset();
  mocks.bootstrapIfNeeded.mockResolvedValue(undefined);
  mocks.syncOnce.mockReset();
  mocks.syncOnce.mockResolvedValue({
    segmentsProcessed: 1,
    rowsIngested: 4,
    lastDate: "2026-07-23",
  });
  mocks.updateAscSyncStatus.mockReset();
  mocks.updateAscSyncStatus.mockResolvedValue(undefined);
  mocks.observedWorkFailures.length = 0;
  mocks.runWithCronWorkloadControl.mockReset();
  mocks.runWithCronWorkloadControl.mockImplementation(
    async ({
      work,
    }: {
      work: (lease: typeof workloadLease) => Promise<unknown>;
    }) => {
      try {
        return { status: "completed", value: await work(workloadLease) };
      } catch (error) {
        mocks.observedWorkFailures.push(error);
        throw error;
      }
    }
  );
});

describe("app-store-sync cron", () => {
  it("returns 401 when no authorization header is present", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.runWithCronWorkloadControl).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is wrong", async () => {
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    expect(mocks.runWithCronWorkloadControl).not.toHaveBeenCalled();
  });

  it("short-circuits when App Store Connect is not configured", async () => {
    mocks.isConfigured.mockReturnValue(false);

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      skipped: true,
      reason: "App Store Connect not configured",
    });
    expect(mocks.runWithCronWorkloadControl).not.toHaveBeenCalled();
  });

  it("runs one bounded sync under durable workload control", async () => {
    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "synced",
      segmentsProcessed: 1,
      rowsIngested: 4,
      lastDate: "2026-07-23",
    });
    expect(mocks.runWithCronWorkloadControl).toHaveBeenCalledWith({
      supabase: mocks.adminClient,
      workloadKey: "app-store-sync",
      leaseSeconds: 90,
      work: expect.any(Function),
    });
    expect(mocks.bootstrapIfNeeded).toHaveBeenCalledWith(mocks.adminClient);
    expect(mocks.syncOnce).toHaveBeenCalledWith(
      mocks.adminClient,
      workloadLease
    );
    expect(mocks.updateAscSyncStatus.mock.calls).toEqual([
      ["app-store-sync", { status: "running", error: null }, mocks.adminClient],
      [
        "app-store-sync",
        {
          status: "complete",
          last_synced_date: "2026-07-23",
          error: null,
        },
        mocks.adminClient,
      ],
    ]);
  });

  it("returns an idempotent no-op while another app-store sync owns the lease", async () => {
    mocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(mocks.bootstrapIfNeeded).not.toHaveBeenCalled();
    expect(mocks.syncOnce).not.toHaveBeenCalled();
  });

  it.each(["circuit_open", "control_unavailable"] as const)(
    "fails closed when workload control reports %s",
    async (reason) => {
      mocks.runWithCronWorkloadControl.mockResolvedValue({
        status: "skipped",
        reason,
        ...(reason === "control_unavailable"
          ? { error: new Error("control unavailable") }
          : {}),
      });

      const res = await GET(req("Bearer s3cret"));

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        ok: false,
        ran: false,
        reason,
      });
      expect(mocks.bootstrapIfNeeded).not.toHaveBeenCalled();
      expect(mocks.syncOnce).not.toHaveBeenCalled();
    }
  );

  it("does no later database work after sync reports database pressure", async () => {
    const raw = {
      code: "PGRST002",
      message: "Could not query the database for the schema cache",
    };
    const pressure = new mocks.CronDatabaseOperationError(
      "app store request lookup failed",
      { cause: raw }
    );
    mocks.syncOnce.mockRejectedValue(pressure);

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(500);
    expect(mocks.observedWorkFailures).toEqual([pressure]);
    expect(mocks.updateAscSyncStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateAscSyncStatus).toHaveBeenLastCalledWith(
      "app-store-sync",
      { status: "running", error: null },
      mocks.adminClient
    );
  });

  it("keeps an App Store provider failure outside the database circuit", async () => {
    const providerError = Object.assign(
      new Error("ASC GET reports -> 504"),
      { status: 504 }
    );
    mocks.syncOnce.mockRejectedValue(providerError);

    const res = await GET(req("Bearer s3cret"));

    expect(res.status).toBe(500);
    expect(mocks.observedWorkFailures).toEqual([providerError]);
    expect(providerError).not.toBeInstanceOf(
      mocks.CronDatabaseOperationError
    );
    expect(mocks.updateAscSyncStatus).toHaveBeenLastCalledWith(
      "app-store-sync",
      { status: "failed", error: providerError.message },
      mocks.adminClient
    );
  });
});
