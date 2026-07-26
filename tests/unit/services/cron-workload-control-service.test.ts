import { describe, expect, it, vi } from "vitest";

import {
  CronDatabaseOperationError,
  CronWorkloadControlCompletionError,
  isDatabasePressureError,
  runWithCronWorkloadControl,
  type CronWorkloadControlClient,
} from "@/lib/api/services/cron-workload-control-service";

type RpcResponse = {
  data: unknown;
  error: {
    code?: string;
    details?: string;
    hint?: string;
    message: string;
  } | null;
};

const acquiredLease = {
  acquired: true,
  reason: "acquired",
  owner_token: "00000000-0000-4000-8000-000000000001",
  fence_token: 7,
  global_fence_token: 13,
  expires_at: "2026-07-24T18:00:00.000Z",
};

function createClient(responses: RpcResponse[]): CronWorkloadControlClient & {
  rpc: ReturnType<typeof vi.fn>;
} {
  const queue = [...responses];
  return {
    rpc: vi.fn(async () => {
      const response = queue.shift();
      if (!response) throw new Error("unexpected RPC call");
      return response;
    }),
  };
}

describe("isDatabasePressureError", () => {
  it.each([
    [
      {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    ],
    [{ code: "PGRST002", message: "schema cache unavailable" }],
    [{ code: "PGRST000", message: "database connection unavailable" }],
    [{ code: "PGRST001", message: "database connection failed" }],
    [{ code: "PGRST003", message: "database pool timeout" }],
    [{ code: "08006", message: "connection failure" }],
    [{ code: "53200", message: "out of memory" }],
    [{ code: "53300", message: "remaining connection slots are reserved" }],
    [{ code: "55P03", message: "lock timeout" }],
    [{ code: "58030", message: "I/O error" }],
    [new Error("PostgREST schema cache failed to load")],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { code: "ETIMEDOUT", message: "connect ETIMEDOUT" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { status: 502, message: "Bad Gateway" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { status: 503, message: "Service Unavailable" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { status: 504, message: "Gateway Timeout" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { status: 521, message: "Web server is down" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { statusCode: 522, message: "Connection timed out" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { status: 524, message: "A timeout occurred" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { code: "525", message: "SSL handshake failed" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { code: "ECONNREFUSED", message: "connection refused" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { code: "ENOTFOUND", message: "DNS lookup failed" },
      }),
    ],
    [
      new CronDatabaseOperationError("Supabase request failed", {
        cause: { code: "EAI_AGAIN", message: "DNS lookup timed out" },
      }),
    ],
  ])("classifies database availability pressure from %o", (error) => {
    expect(isDatabasePressureError(error)).toBe(true);
  });

  it("walks wrapped causes without treating ordinary work failures as pressure", () => {
    const pressure = Object.assign(new Error("worker failed"), {
      cause: {
        code: "PGRST002",
        message: "Could not query the database for the schema cache",
      },
    });

    expect(isDatabasePressureError(pressure)).toBe(true);
    expect(
      isDatabasePressureError(new Error("OneSignal rejected payload"))
    ).toBe(false);
    expect(
      isDatabasePressureError({ code: "23505", message: "duplicate key" })
    ).toBe(false);
  });

  it.each([
    { status: 504, message: "Gmail gateway timeout" },
    { statusCode: 522, message: "OneSignal connection timed out" },
    { code: "525", message: "OpenAI SSL handshake failed" },
    { code: "ETIMEDOUT", message: "connect ETIMEDOUT" },
    new Error("provider statement timeout"),
    new Error("provider returned out of memory"),
    new Error("local filesystem is disk full"),
  ])(
    "does not open the database circuit for an untagged external provider failure %o",
    (error) => {
      expect(isDatabasePressureError(error)).toBe(false);
    }
  );
});

describe("runWithCronWorkloadControl", () => {
  it("enforces a crash-safe lease beyond the 300-second serverless ceiling", async () => {
    const client = createClient([
      { data: acquiredLease, error: null },
      { data: true, error: null },
    ]);

    await runWithCronWorkloadControl({
      supabase: client,
      workloadKey: "short-route",
      leaseSeconds: 90,
      ownerToken: acquiredLease.owner_token,
      work: async () => "done",
    });

    expect(client.rpc).toHaveBeenNthCalledWith(
      1,
      "acquire_cron_workload_lease_as_system",
      expect.objectContaining({ p_lease_seconds: 360 })
    );
  });

  it("renews the exact live fence while bounded work is still running", async () => {
    vi.useFakeTimers();
    try {
      let releaseWork!: () => void;
      const workRelease = new Promise<void>((resolve) => {
        releaseWork = resolve;
      });
      const client: CronWorkloadControlClient & {
        rpc: ReturnType<typeof vi.fn>;
      } = {
        rpc: vi.fn(
          async (
            functionName: string,
            args: Record<string, unknown>
          ): Promise<RpcResponse> => {
            if (functionName === "acquire_cron_workload_lease_as_system") {
              return {
                data: {
                  ...acquiredLease,
                  owner_token: args.p_owner_token,
                  expires_at: new Date(Date.now() + 360_000).toISOString(),
                },
                error: null,
              };
            }
            if (functionName === "renew_cron_workload_lease_as_system") {
              return {
                data: {
                  renewed: true,
                  expires_at: new Date(Date.now() + 360_000).toISOString(),
                },
                error: null,
              };
            }
            expect(functionName).toBe(
              "complete_cron_workload_lease_as_system"
            );
            return { data: true, error: null };
          }
        ),
      };

      const running = runWithCronWorkloadControl({
        supabase: client,
        workloadKey: "long-route",
        leaseSeconds: 360,
        ownerToken: acquiredLease.owner_token,
        work: async () => {
          await workRelease;
          return "done";
        },
      });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.rpc).toHaveBeenCalledWith(
        "renew_cron_workload_lease_as_system",
        expect.objectContaining({
          p_fence_token: 7,
          p_global_fence_token: 13,
          p_lease_seconds: 360,
        })
      );

      releaseWork();
      await expect(running).resolves.toEqual({
        status: "completed",
        value: "done",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("admits exactly one overlapping workload across both same and different lanes", async () => {
    let activeOwner: string | null = null;
    let fence = 0;
    let activeWork = 0;
    let maxActiveWork = 0;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const sharedBackend: CronWorkloadControlClient = {
      rpc: vi.fn(
        async (
          functionName: string,
          args: Record<string, unknown>
        ): Promise<RpcResponse> => {
          if (functionName === "acquire_cron_workload_lease_as_system") {
            if (activeOwner) {
              return {
                data: { acquired: false, reason: "lease_held" },
                error: null,
              };
            }
            activeOwner = String(args.p_owner_token);
            fence += 1;
            return {
              data: {
                acquired: true,
                owner_token: activeOwner,
                fence_token: fence,
                global_fence_token: fence,
                expires_at: new Date(Date.now() + 60_000).toISOString(),
              },
              error: null,
            };
          }

          expect(functionName).toBe(
            "complete_cron_workload_lease_as_system"
          );
          expect(args.p_owner_token).toBe(activeOwner);
          activeOwner = null;
          return { data: true, error: null };
        }
      ),
    };

    const first = runWithCronWorkloadControl({
      supabase: sharedBackend,
      workloadKey: "lead-outbox",
      leaseSeconds: 60,
      ownerToken: "00000000-0000-4000-8000-000000000011",
      work: async () => {
        activeWork += 1;
        maxActiveWork = Math.max(maxActiveWork, activeWork);
        markFirstStarted();
        await firstRelease;
        activeWork -= 1;
        return "first";
      },
    });

    await firstStarted;

    const sameLaneWork = vi.fn(async () => "same-lane");
    const otherLaneWork = vi.fn(async () => "other-lane");
    const [sameLane, otherLane] = await Promise.all([
      runWithCronWorkloadControl({
        supabase: sharedBackend,
        workloadKey: "lead-outbox",
        leaseSeconds: 60,
        ownerToken: "00000000-0000-4000-8000-000000000012",
        work: sameLaneWork,
      }),
      runWithCronWorkloadControl({
        supabase: sharedBackend,
        workloadKey: "email-sync",
        leaseSeconds: 60,
        ownerToken: "00000000-0000-4000-8000-000000000013",
        work: otherLaneWork,
      }),
    ]);

    expect(sameLane).toEqual({ status: "skipped", reason: "lease_held" });
    expect(otherLane).toEqual({ status: "skipped", reason: "lease_held" });
    expect(sameLaneWork).not.toHaveBeenCalled();
    expect(otherLaneWork).not.toHaveBeenCalled();
    expect(maxActiveWork).toBe(1);

    releaseFirst();
    await expect(first).resolves.toEqual({
      status: "completed",
      value: "first",
    });
  });

  it("runs once under the acquired fenced lease and completes success", async () => {
    const client = createClient([
      { data: acquiredLease, error: null },
      { data: true, error: null },
    ]);
    const work = vi.fn(async (lease) => `${lease.fenceToken}:done`);

    await expect(
      runWithCronWorkloadControl({
        supabase: client,
        workloadKey: "lead-outbox",
        leaseSeconds: 360,
        ownerToken: acquiredLease.owner_token,
        work,
      })
    ).resolves.toEqual({ status: "completed", value: "7:done" });

    expect(work).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenNthCalledWith(
      1,
      "acquire_cron_workload_lease_as_system",
      {
        p_workload_key: "lead-outbox",
        p_owner_token: acquiredLease.owner_token,
        p_lease_seconds: 360,
      }
    );
    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      "complete_cron_workload_lease_as_system",
      {
        p_workload_key: "lead-outbox",
        p_owner_token: acquiredLease.owner_token,
        p_fence_token: 7,
        p_global_fence_token: 13,
        p_succeeded: true,
        p_database_pressure: false,
        p_circuit_open_seconds: 300,
      }
    );
  });

  it.each(["lease_held", "circuit_open"] as const)(
    "skips all work when acquisition reports %s",
    async (reason) => {
      const client = createClient([
        { data: { acquired: false, reason }, error: null },
      ]);
      const work = vi.fn(async () => "must-not-run");

      await expect(
        runWithCronWorkloadControl({
          supabase: client,
          workloadKey: "email-sync",
          leaseSeconds: 900,
          ownerToken: acquiredLease.owner_token,
          work,
        })
      ).resolves.toEqual({ status: "skipped", reason });

      expect(work).not.toHaveBeenCalled();
      expect(client.rpc).toHaveBeenCalledOnce();
    }
  );

  it("makes one bounded jittered retry when control acquisition fails", async () => {
    const client = createClient([
      {
        data: null,
        error: { code: "PGRST002", message: "schema cache unavailable" },
      },
      { data: acquiredLease, error: null },
      { data: true, error: null },
    ]);
    const delays: number[] = [];
    const work = vi.fn(async () => "recovered");

    await expect(
      runWithCronWorkloadControl({
        supabase: client,
        workloadKey: "attachment-maintenance",
        leaseSeconds: 360,
        ownerToken: acquiredLease.owner_token,
        random: () => 1,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
        work,
      })
    ).resolves.toEqual({ status: "completed", value: "recovered" });

    expect(delays).toEqual([250]);
    expect(work).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  it("fails closed after the single acquisition retry", async () => {
    const client = createClient([
      {
        data: null,
        error: { code: "PGRST002", message: "schema cache unavailable" },
      },
      {
        data: null,
        error: { code: "57014", message: "statement timeout" },
      },
    ]);
    const delays: number[] = [];
    const work = vi.fn(async () => "must-not-run");

    const result = await runWithCronWorkloadControl({
      supabase: client,
      workloadKey: "projection-repair",
      leaseSeconds: 360,
      ownerToken: acquiredLease.owner_token,
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      work,
    });

    expect(result.status).toBe("skipped");
    expect(result).toMatchObject({
      reason: "control_unavailable",
      error: { code: "57014", message: "statement timeout" },
    });
    expect(delays).toEqual([125]);
    expect(work).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed acquisition data", async () => {
    const client = createClient([
      { data: { acquired: true, fence_token: "7" }, error: null },
      { data: null, error: null },
    ]);
    const work = vi.fn(async () => "must-not-run");

    const result = await runWithCronWorkloadControl({
      supabase: client,
      workloadKey: "send-reconciliation",
      leaseSeconds: 360,
      ownerToken: acquiredLease.owner_token,
      sleep: async () => {},
      work,
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "control_unavailable",
      error: expect.any(Error),
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("persists database pressure before rethrowing the original work error", async () => {
    const client = createClient([
      { data: acquiredLease, error: null },
      { data: true, error: null },
    ]);
    const pressure = Object.assign(new Error("statement timeout"), {
      code: "57014",
    });

    await expect(
      runWithCronWorkloadControl({
        supabase: client,
        workloadKey: "lead-outbox",
        leaseSeconds: 360,
        circuitOpenSeconds: 600,
        ownerToken: acquiredLease.owner_token,
        work: async () => {
          throw pressure;
        },
      })
    ).rejects.toBe(pressure);

    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      "complete_cron_workload_lease_as_system",
      {
        p_workload_key: "lead-outbox",
        p_owner_token: acquiredLease.owner_token,
        p_fence_token: 7,
        p_global_fence_token: 13,
        p_succeeded: false,
        p_database_pressure: true,
        p_circuit_open_seconds: 600,
      }
    );
  });

  it("records ordinary failures without opening the database circuit", async () => {
    const client = createClient([
      { data: acquiredLease, error: null },
      { data: true, error: null },
    ]);
    const ordinary = new Error("OneSignal rejected payload");

    await expect(
      runWithCronWorkloadControl({
        supabase: client,
        workloadKey: "lead-outbox",
        leaseSeconds: 360,
        ownerToken: acquiredLease.owner_token,
        work: async () => {
          throw ordinary;
        },
      })
    ).rejects.toBe(ordinary);

    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      "complete_cron_workload_lease_as_system",
      expect.objectContaining({
        p_succeeded: false,
        p_database_pressure: false,
      })
    );
  });

  it("rejects a stale or unreachable completion after successful work", async () => {
    const staleClient = createClient([
      { data: acquiredLease, error: null },
      { data: false, error: null },
    ]);

    await expect(
      runWithCronWorkloadControl({
        supabase: staleClient,
        workloadKey: "lead-outbox",
        leaseSeconds: 360,
        ownerToken: acquiredLease.owner_token,
        work: async () => "sent",
      })
    ).rejects.toBeInstanceOf(CronWorkloadControlCompletionError);

    const unavailableClient = createClient([
      { data: acquiredLease, error: null },
      {
        data: null,
        error: { code: "57014", message: "statement timeout" },
      },
    ]);

    await expect(
      runWithCronWorkloadControl({
        supabase: unavailableClient,
        workloadKey: "lead-outbox",
        leaseSeconds: 360,
        ownerToken: acquiredLease.owner_token,
        work: async () => "sent",
      })
    ).rejects.toBeInstanceOf(CronWorkloadControlCompletionError);
  });
});
