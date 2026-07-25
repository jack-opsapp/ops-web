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

    await expect(
      listBoundedPhaseCCompanyIds(supabase, 2)
    ).resolves.toEqual(["company-2", "company-1"]);

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
      data: [
        { company_id: "company-2" },
        { company_id: "company-3" },
      ],
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
      data: [
        { company_id: "company-1" },
        { company_id: "company-2" },
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
