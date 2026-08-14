import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listBoundedPhaseCCompanyIds,
  runBoundedPhaseCCompanyFanout,
  throwCronDatabaseOperationError,
} from "@/lib/api/services/cron-company-fanout-service";
import {
  CronDatabaseOperationError,
  isDatabasePressureError,
  type CronWorkloadLease,
} from "@/lib/api/services/cron-workload-control-service";

const queryState = vi.hoisted(() => ({
  result: {
    data: [] as Array<{ company_id: string }>,
    error: null as Record<string, unknown> | null,
  },
}));

function phaseCQuery() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "gt", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(async () => queryState.result);
  return chain;
}

const lease: CronWorkloadLease = {
  ownerToken: "owner-1",
  fenceToken: 7,
  globalFenceToken: 11,
  expiresAt: "2026-07-24T22:00:00.000Z",
  signal: new AbortController().signal,
};

describe("cron company fan-out controls", () => {
  beforeEach(() => {
    queryState.result = { data: [], error: null };
  });

  it("uses one bounded set-based Phase C query and returns unique company ids", async () => {
    queryState.result = {
      data: [
        { company_id: "company-2" },
        { company_id: "company-1" },
        { company_id: "company-2" },
      ],
      error: null,
    };
    const query = phaseCQuery();
    const supabase = {
      from: vi.fn(() => query),
    };

    await expect(listBoundedPhaseCCompanyIds(supabase, 2)).resolves.toEqual([
      "company-2",
      "company-1",
    ]);

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("admin_feature_overrides");
    expect(query.select).toHaveBeenCalledWith("company_id");
    expect(query.eq).toHaveBeenNthCalledWith(1, "feature_key", "phase_c");
    expect(query.eq).toHaveBeenNthCalledWith(2, "enabled", true);
    expect(query.order).toHaveBeenCalledWith("company_id", {
      ascending: true,
    });
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it("preserves a PostgREST gateway timeout as database pressure", async () => {
    const rawError = {
      status: 504,
      message: "upstream request timeout",
    };
    queryState.result = { data: [], error: rawError };

    let caught: unknown;
    try {
      await listBoundedPhaseCCompanyIds(
        { from: vi.fn(() => phaseCQuery()) },
        5
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CronDatabaseOperationError);
    expect((caught as Error & { cause?: unknown }).cause).toBe(rawError);
    expect(isDatabasePressureError(caught)).toBe(true);
  });

  it("does not classify an external provider timeout without database context", () => {
    expect(
      isDatabasePressureError({
        status: 504,
        message: "upstream request timeout",
      })
    ).toBe(false);
  });

  it("does not double-wrap an existing database operation error", () => {
    const original = new CronDatabaseOperationError("database failed", {
      cause: { code: "PGRST002" },
    });

    expect(() =>
      throwCronDatabaseOperationError("outer operation", original)
    ).toThrow(original);
  });

  it("resumes after the fenced cursor, processes the tail serially, and wraps to null", async () => {
    queryState.result = {
      data: [{ company_id: "company-2" }, { company_id: "company-3" }],
      error: null,
    };
    const query = phaseCQuery();
    const rpc = vi.fn(
      async (functionName: string): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: "company-1", error: null };
        }
        return { data: true, error: null };
      }
    );
    const events: string[] = [];

    const result = await runBoundedPhaseCCompanyFanout({
      supabase: {
        from: vi.fn(() => query),
        rpc,
      },
      workloadKey: "project-health",
      lease,
      companyLimit: 5,
      processCompany: async (companyId) => {
        events.push(`start:${companyId}`);
        await Promise.resolve();
        events.push(`end:${companyId}`);
        return { companyId, ok: true };
      },
      onCompanyError: (companyId) => ({ companyId, ok: false }),
    });

    expect(query.gt).toHaveBeenCalledWith("company_id", "company-1");
    expect(events).toEqual([
      "start:company-2",
      "end:company-2",
      "start:company-3",
      "end:company-3",
    ]);
    expect(result).toEqual({
      companyIds: ["company-2", "company-3"],
      results: [
        { companyId: "company-2", ok: true },
        { companyId: "company-3", ok: true },
      ],
      cursor: { previous: "company-1", next: null },
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "advance_cron_workload_cursor_as_system",
      expect.objectContaining({
        p_workload_key: "project-health",
        p_owner_token: "owner-1",
        p_fence_token: 7,
        p_global_fence_token: 11,
        p_expected_cursor: "company-1",
        p_next_cursor: null,
      })
    );
  });

  it("fails fast on database pressure and leaves the cursor unchanged", async () => {
    queryState.result = {
      data: [
        { company_id: "company-1" },
        { company_id: "company-2" },
        { company_id: "company-3" },
      ],
      error: null,
    };
    const query = phaseCQuery();
    const rpc = vi.fn(
      async (functionName: string): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: null, error: null };
        }
        return { data: true, error: null };
      }
    );
    const processed: string[] = [];

    await expect(
      runBoundedPhaseCCompanyFanout({
        supabase: {
          from: vi.fn(() => query),
          rpc,
        },
        workloadKey: "payment-reminders",
        lease,
        companyLimit: 5,
        processCompany: async (companyId) => {
          processed.push(companyId);
          if (companyId === "company-2") {
            throw new CronDatabaseOperationError("database unavailable", {
              cause: { code: "PGRST002" },
            });
          }
          return { companyId, ok: true };
        },
        onCompanyError: (companyId) => ({ companyId, ok: false }),
      })
    ).rejects.toThrow("database unavailable");

    expect(processed).toEqual(["company-1", "company-2"]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("isolates a non-database company failure and continues the serial page", async () => {
    queryState.result = {
      data: [{ company_id: "company-1" }, { company_id: "company-2" }],
      error: null,
    };
    const query = phaseCQuery();
    const rpc = vi.fn(
      async (functionName: string): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: null, error: null };
        }
        return { data: true, error: null };
      }
    );

    const result = await runBoundedPhaseCCompanyFanout({
      supabase: {
        from: vi.fn(() => query),
        rpc,
      },
      workloadKey: "financial-digest",
      lease,
      companyLimit: 3,
      processCompany: async (companyId) => {
        if (companyId === "company-1") {
          throw new Error("provider refused request");
        }
        return { companyId, ok: true };
      },
      onCompanyError: (companyId, error) => ({
        companyId,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    });

    expect(result.results).toEqual([
      {
        companyId: "company-1",
        ok: false,
        error: "provider refused request",
      },
      { companyId: "company-2", ok: true },
    ]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("durably bounds a poison-company retry without replaying successful page siblings or starving the next page", async () => {
    queryState.result = {
      data: [
        { company_id: "company-1" },
        { company_id: "company-2" },
        { company_id: "company-3" },
      ],
      error: null,
    };
    let storedCursor: string | null = null;
    const rpc = vi.fn(
      async (
        functionName: string,
        args: Record<string, unknown>
      ): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: storedCursor, error: null };
        }
        expect(args.p_expected_cursor).toBe(storedCursor);
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return { data: true, error: null };
      }
    );
    const from = vi.fn(() => phaseCQuery());
    const processed: string[] = [];
    const run = () =>
      runBoundedPhaseCCompanyFanout({
        supabase: { from, rpc },
        workloadKey: "financial-digest",
        lease,
        companyLimit: 3,
        processCompany: async (companyId) => {
          processed.push(companyId);
          if (companyId === "company-2") {
            throw new Error("provider unavailable");
          }
          return { companyId, disposition: "success" as const };
        },
        onCompanyError: (companyId, error) => ({
          companyId,
          disposition: "retryable" as const,
          error: error instanceof Error ? error.message : "unknown error",
        }),
        retryPolicy: {
          maxAttempts: 3,
          classifyResult: (result) => result.disposition,
        },
      });

    const first = await run();
    expect(first.retry).toMatchObject({
      status: "scheduled",
      scheduled: [{ companyId: "company-2", attempt: 1 }],
      exhausted: [],
    });
    expect(first.cursor.next).toBe("company-3");

    queryState.result = {
      data: [{ company_id: "company-4" }, { company_id: "company-5" }],
      error: null,
    };

    const second = await run();
    expect(second.retry).toMatchObject({
      status: "scheduled",
      scheduled: [{ companyId: "company-2", attempt: 2 }],
      exhausted: [],
    });

    queryState.result = {
      data: [{ company_id: "company-6" }, { company_id: "company-7" }],
      error: null,
    };

    const third = await run();
    expect(third.retry).toMatchObject({
      status: "exhausted",
      scheduled: [],
      exhausted: [{ companyId: "company-2", attempts: 3 }],
    });
    expect(storedCursor).toBe("company-7");
    expect(processed).toEqual([
      "company-1",
      "company-2",
      "company-3",
      "company-2",
      "company-4",
      "company-5",
      "company-2",
      "company-6",
      "company-7",
    ]);
    expect(from).toHaveBeenCalledTimes(3);

    queryState.result = {
      data: [{ company_id: "company-8" }],
      error: null,
    };
    const fourth = await run();
    expect(fourth.companyIds).toEqual(["company-8"]);
    expect(processed.at(-1)).toBe("company-8");
  });

  it("advances the main page immediately while durable retries follow the page cursor", async () => {
    queryState.result = {
      data: [
        { company_id: "company-1" },
        { company_id: "company-2" },
        { company_id: "company-3" },
      ],
      error: null,
    };
    let storedCursor: string | null = null;
    const rpc = vi.fn(
      async (
        functionName: string,
        args: Record<string, unknown>
      ): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: storedCursor, error: null };
        }
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return { data: true, error: null };
      }
    );
    const from = vi.fn(() => phaseCQuery());
    const processCompany = vi.fn(async (companyId: string) => {
      if (companyId === "company-2") throw new Error("transient provider error");
      return { companyId, disposition: "success" as const };
    });

    const result = await runBoundedPhaseCCompanyFanout({
      supabase: { from, rpc },
      workloadKey: "schedule-optimization",
      lease,
      companyLimit: 3,
      processCompany,
      onCompanyError: (companyId, error) => ({
        companyId,
        disposition: "retryable" as const,
        error: error instanceof Error ? error.message : "unknown error",
      }),
      retryPolicy: {
        maxAttempts: 3,
        classifyResult: (row) => row.disposition,
      },
    });

    expect(result.cursor.next).toBe("company-3");
    expect(result.retry).toMatchObject({
      status: "scheduled",
      scheduled: [{ companyId: "company-2", attempt: 1 }],
    });
    expect(storedCursor).toMatch(/^phase-c-fanout:v2:/);
  });

  it("preserves a null main-page cursor while retrying after wrap-around", async () => {
    queryState.result = {
      data: [{ company_id: "company-1" }],
      error: null,
    };
    let storedCursor: string | null = null;
    const queries: Array<ReturnType<typeof phaseCQuery>> = [];
    const from = vi.fn(() => {
      const query = phaseCQuery();
      queries.push(query);
      return query;
    });
    const rpc = vi.fn(
      async (
        functionName: string,
        args: Record<string, unknown>
      ): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: storedCursor, error: null };
        }
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return { data: true, error: null };
      }
    );
    const run = () =>
      runBoundedPhaseCCompanyFanout({
        supabase: { from, rpc },
        workloadKey: "financial-digest",
        lease,
        companyLimit: 3,
        processCompany: async (companyId) => {
          throw new Error(`temporary failure for ${companyId}`);
        },
        onCompanyError: (companyId) => ({
          companyId,
          disposition: "retryable" as const,
        }),
        retryPolicy: {
          maxAttempts: 3,
          classifyResult: (row) => row.disposition,
        },
      });

    const first = await run();
    expect(first.cursor.next).toBeNull();
    expect(storedCursor).toMatch(/^phase-c-fanout:v2:/);
    await run();

    expect(queries[1].gt).not.toHaveBeenCalled();
  });

  it("does not exhaust a company or hide the circuit signal on database pressure", async () => {
    queryState.result = {
      data: [{ company_id: "company-1" }],
      error: null,
    };
    let storedCursor: string | null = null;
    const rpc = vi.fn(
      async (
        functionName: string,
        args: Record<string, unknown>
      ): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: storedCursor, error: null };
        }
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return { data: true, error: null };
      }
    );
    let invocation = 0;
    const run = () =>
      runBoundedPhaseCCompanyFanout({
        supabase: { from: vi.fn(() => phaseCQuery()), rpc },
        workloadKey: "schedule-optimization",
        lease,
        companyLimit: 3,
        processCompany: async (companyId) => {
          invocation += 1;
          if (invocation === 3) {
            throw new CronDatabaseOperationError("database unavailable", {
              cause: { code: "PGRST002" },
            });
          }
          throw new Error(`temporary provider failure for ${companyId}`);
        },
        onCompanyError: (companyId) => ({
          companyId,
          disposition: "retryable" as const,
        }),
        retryPolicy: {
          maxAttempts: 3,
          classifyResult: (row) => row.disposition,
        },
      });

    await run();
    await run();
    const pressureRun = await run();

    expect(pressureRun.retry).toMatchObject({
      status: "scheduled",
      scheduled: [{ companyId: "company-1", attempt: 2 }],
      exhausted: [],
    });
    expect(isDatabasePressureError(pressureRun.failureCause)).toBe(true);
    expect(storedCursor).toMatch(/^phase-c-fanout:v2:/);
  });

  it("stops before a fresh failure whose retry could not fit the durable cursor", async () => {
    const longCompanyId = (suffix: string) => `${suffix}${"x".repeat(126)}`;
    queryState.result = {
      data: [
        { company_id: longCompanyId("a") },
        { company_id: longCompanyId("b") },
        { company_id: longCompanyId("c") },
      ],
      error: null,
    };
    let storedCursor: string | null = null;
    const rpc = vi.fn(
      async (
        functionName: string,
        args: Record<string, unknown>
      ): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: storedCursor, error: null };
        }
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return { data: true, error: null };
      }
    );
    const processCompany = vi.fn(async (companyId: string) => {
      throw new Error(`temporary failure for ${companyId}`);
    });

    const result = await runBoundedPhaseCCompanyFanout({
      supabase: { from: vi.fn(() => phaseCQuery()), rpc },
      workloadKey: "financial-digest",
      lease,
      companyLimit: 3,
      processCompany,
      onCompanyError: (companyId) => ({
        companyId,
        disposition: "retryable" as const,
      }),
      retryPolicy: {
        maxAttempts: 3,
        classifyResult: (row) => row.disposition,
      },
    });

    expect(processCompany).toHaveBeenCalledTimes(2);
    expect(result.companyIds).toEqual([
      longCompanyId("a"),
      longCompanyId("b"),
    ]);
    expect(result.cursor.next).toBe(longCompanyId("b"));
    expect(storedCursor?.length).toBeLessThanOrEqual(512);
  });

  it("distinguishes an exhausted cursor page from an absent cursor and resets it without replay", async () => {
    queryState.result = { data: [], error: null };
    const query = phaseCQuery();
    const from = vi.fn(() => query);
    const rpc = vi.fn(
      async (functionName: string): Promise<{ data: unknown; error: null }> => {
        if (functionName === "read_cron_workload_cursor_as_system") {
          return { data: "company-last", error: null };
        }
        return { data: true, error: null };
      }
    );
    const processCompany = vi.fn();

    const result = await runBoundedPhaseCCompanyFanout({
      supabase: { from, rpc },
      workloadKey: "auto-confirm-schedules",
      lease,
      companyLimit: 5,
      processCompany,
      onCompanyError: (companyId) => companyId,
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(processCompany).not.toHaveBeenCalled();
    expect(result).toEqual({
      companyIds: [],
      results: [],
      cursor: { previous: "company-last", next: null },
    });
  });
});
