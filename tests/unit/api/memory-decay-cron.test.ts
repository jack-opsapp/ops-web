import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  }

  return {
    CronDatabaseOperationError,
    runWithCronWorkloadControl: vi.fn(),
    observedWorkFailures: [] as unknown[],
    runMemoryDecayMaintenance: vi.fn(),
    supabase: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
  };
});

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => mocks.supabase,
}));
vi.mock("@/lib/api/services/memory-decay-service", () => ({
  runMemoryDecayMaintenance: mocks.runMemoryDecayMaintenance,
}));
vi.mock("@/lib/api/services/cron-workload-control-service", () => ({
  CronDatabaseOperationError: mocks.CronDatabaseOperationError,
  runWithCronWorkloadControl: mocks.runWithCronWorkloadControl,
}));

function request(auth = "Bearer memory-secret"): NextRequest {
  return new Request("http://localhost/api/cron/memory-decay", {
    headers: { authorization: auth },
  }) as unknown as NextRequest;
}

const workloadLease = {
  ownerToken: "memory-decay-test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

beforeEach(() => {
  process.env.CRON_SECRET = "memory-secret";
  mocks.runMemoryDecayMaintenance.mockReset();
  mocks.runMemoryDecayMaintenance.mockResolvedValue({
    decayed: 1,
    pruned: 2,
    consolidated: 3,
    errors: [],
  });
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

describe("memory-decay cron outage controls", () => {
  it("runs bounded maintenance under durable workload control", async () => {
    const { GET } = await import("@/app/api/cron/memory-decay/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      decayed: 1,
      pruned: 2,
      consolidated: 3,
      errors: [],
    });
    expect(mocks.runWithCronWorkloadControl).toHaveBeenCalledWith({
      supabase: mocks.supabase,
      workloadKey: "memory-decay",
      leaseSeconds: 360,
      work: expect.any(Function),
    });
    expect(mocks.runMemoryDecayMaintenance).toHaveBeenCalledWith(
      mocks.supabase,
      workloadLease
    );
  });

  it("returns an idempotent no-op while another maintenance run owns the lease", async () => {
    mocks.runWithCronWorkloadControl.mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    });

    const { GET } = await import("@/app/api/cron/memory-decay/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(mocks.runMemoryDecayMaintenance).not.toHaveBeenCalled();
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

      const { GET } = await import("@/app/api/cron/memory-decay/route");
      const response = await GET(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        ran: false,
        reason,
      });
      expect(mocks.runMemoryDecayMaintenance).not.toHaveBeenCalled();
    }
  );

  it("surfaces a tagged database-pressure failure from maintenance", async () => {
    const pressure = new mocks.CronDatabaseOperationError(
      "memory decay fetch failed",
      {
        cause: {
          code: "57014",
          message: "canceling statement due to statement timeout",
        },
      }
    );
    mocks.runMemoryDecayMaintenance.mockRejectedValue(pressure);

    const { GET } = await import("@/app/api/cron/memory-decay/route");
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(mocks.observedWorkFailures).toEqual([pressure]);
  });
});
