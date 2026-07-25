import { beforeEach, describe, expect, it, vi } from "vitest";

type DatabaseError = {
  code?: string;
  message: string;
};

type DatabaseResult = {
  data: unknown;
  error: DatabaseError | null;
  count?: number | null;
};

type RpcResponder = (
  name: string,
  args?: Record<string, unknown>
) => DatabaseResult;

const mocks = vi.hoisted(() => ({
  getAdminSupabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: mocks.getAdminSupabase,
}));

interface RecordedSelect {
  table: string;
  columns?: string;
}

let rpcResponder: RpcResponder;
let fallbackRows: unknown[];
let fallbackError: DatabaseError | null;
let recordedRpcCalls: Array<{
  name: string;
  args?: Record<string, unknown>;
}>;
let recordedFromCalls: string[];
let recordedSelects: RecordedSelect[];
let delayOperations: boolean;
let activeOperations: number;
let maxActiveOperations: number;
let completedOperations: number;

function defaultRpcResponder(
  name: string,
  _args?: Record<string, unknown>
): DatabaseResult {
  switch (name) {
    case "pmf_count_tier_a_paid_delivered":
      return { data: 1, error: null };
    case "pmf_count_retained_saas":
      return { data: 2, error: null };
    case "pmf_marker_4_totals_as_system":
      return {
        data: { spend_cents: 12_345, attributed_paid: 4 },
        error: null,
      };
    case "pmf_latest_mature_conversion":
      return { data: 25, error: null };
    case "pmf_latest_cohort_churn":
      return { data: 5, error: null };
    case "pmf_sparkline":
      return { data: new Array(12).fill(0), error: null };
    default:
      throw new Error(`Unexpected RPC: ${name}`);
  }
}

async function finishOperation(
  result: DatabaseResult
): Promise<DatabaseResult> {
  activeOperations += 1;
  maxActiveOperations = Math.max(maxActiveOperations, activeOperations);

  if (delayOperations) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  activeOperations -= 1;
  completedOperations += 1;
  return result;
}

function tableResult(table: string, columns?: string): DatabaseResult {
  if (table === "pmf_deals" && columns?.includes("deposit_amount_cents")) {
    return {
      data: fallbackRows,
      error: fallbackError,
    };
  }

  return {
    data: [],
    error: null,
    count: 0,
  };
}

function makeBuilder(table: string) {
  let selectedColumns: string | undefined;

  const builder = {
    select(columns?: string) {
      selectedColumns = columns;
      recordedSelects.push({ table, columns });
      return builder;
    },
    eq() {
      return builder;
    },
    in() {
      return builder;
    },
    not() {
      return builder;
    },
    or() {
      return builder;
    },
    gte() {
      return builder;
    },
    then<TResult1 = DatabaseResult, TResult2 = never>(
      onFulfilled?:
        | ((value: DatabaseResult) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return finishOperation(tableResult(table, selectedColumns)).then(
        onFulfilled,
        onRejected
      );
    },
  };

  return builder;
}

function makeClient() {
  return {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      recordedRpcCalls.push({ name, args });
      return finishOperation(rpcResponder(name, args));
    },
    from: (table: string) => {
      recordedFromCalls.push(table);
      return makeBuilder(table);
    },
  };
}

beforeEach(() => {
  rpcResponder = defaultRpcResponder;
  fallbackRows = [];
  fallbackError = null;
  recordedRpcCalls = [];
  recordedFromCalls = [];
  recordedSelects = [];
  delayOperations = false;
  activeOperations = 0;
  maxActiveOperations = 0;
  completedOperations = 0;
  mocks.getAdminSupabase.mockReset();
  mocks.getAdminSupabase.mockImplementation(() => makeClient());
});

describe("computePmfState outage hardening", () => {
  it("uses one bounded aggregate RPC for Marker 4 and validates its totals", async () => {
    const { computePmfState } = await import("@/lib/admin/pmf-queries");

    const state = await computePmfState();

    expect(
      recordedRpcCalls.filter(
        ({ name }) => name === "pmf_marker_4_totals_as_system"
      )
    ).toHaveLength(1);
    expect(recordedFromCalls).not.toContain("ad_spend_log");
    expect(state.markers.marker_4.value).toBe(123);
    expect(state.markers.marker_4.detail).toBe("4 paid attributed");
  });

  it("rejects an invalid Marker 4 aggregate result as a database-origin failure", async () => {
    const invalidResult = {
      spend_cents: "12345",
      attributed_paid: 4,
    };
    rpcResponder = (name, args) =>
      name === "pmf_marker_4_totals_as_system"
        ? { data: invalidResult, error: null }
        : defaultRpcResponder(name, args);

    const { computePmfState } = await import("@/lib/admin/pmf-queries");
    const { CronDatabaseOperationError } =
      await import("@/lib/api/services/cron-workload-control-service");

    const failure = await computePmfState().catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.message).toContain(
      "pmf_marker_4_totals_as_system returned an invalid result"
    );
  });

  it("never runs more than three PMF queries concurrently", async () => {
    vi.useFakeTimers();
    delayOperations = true;

    try {
      const { computePmfState } = await import("@/lib/admin/pmf-queries");

      const computation = computePmfState();
      await vi.runAllTimersAsync();
      await computation;

      expect(completedOperations).toBe(14);
      expect(maxActiveOperations).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not launch Marker 1 fallback work when the RPC reports database pressure", async () => {
    const pressureError = {
      code: "PGRST002",
      message: "Could not query the database for the schema cache",
    };
    rpcResponder = (name, args) =>
      name === "pmf_count_tier_a_paid_delivered"
        ? { data: null, error: pressureError }
        : defaultRpcResponder(name, args);

    const { computePmfState } = await import("@/lib/admin/pmf-queries");
    const { CronDatabaseOperationError } =
      await import("@/lib/api/services/cron-workload-control-service");

    const failure = await computePmfState().catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(pressureError);
    expect(
      recordedSelects.filter(({ columns }) =>
        columns?.includes("deposit_amount_cents")
      )
    ).toHaveLength(0);
  });

  it("uses the Marker 1 inline fallback only for a confirmed missing-function error", async () => {
    const missingFunctionError = {
      code: "PGRST202",
      message:
        "Could not find the function public.pmf_count_tier_a_paid_delivered in the schema cache",
    };
    rpcResponder = (name, args) =>
      name === "pmf_count_tier_a_paid_delivered"
        ? { data: null, error: missingFunctionError }
        : defaultRpcResponder(name, args);
    fallbackRows = [
      {
        deposit_amount_cents: 5_000,
        implementation_fee_cents: 10_000,
      },
      {
        deposit_amount_cents: 4_999,
        implementation_fee_cents: 10_000,
      },
      {
        deposit_amount_cents: 6_000,
        implementation_fee_cents: 10_000,
      },
    ];

    const { computePmfState } = await import("@/lib/admin/pmf-queries");

    const state = await computePmfState();

    expect(state.markers.marker_1.value).toBe(2);
    expect(
      recordedSelects.filter(({ columns }) =>
        columns?.includes("deposit_amount_cents")
      )
    ).toHaveLength(1);
  });

  it("retains the raw PostgREST cause for a direct PMF RPC error", async () => {
    const rpcError = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    rpcResponder = (name, args) =>
      name === "pmf_latest_mature_conversion"
        ? { data: null, error: rpcError }
        : defaultRpcResponder(name, args);

    const { computePmfState } = await import("@/lib/admin/pmf-queries");
    const { CronDatabaseOperationError, isDatabasePressureError } =
      await import("@/lib/api/services/cron-workload-control-service");

    const failure = await computePmfState().catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(rpcError);
    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it("tags a thrown database transport failure without changing its raw cause", async () => {
    const transportFailure = Object.assign(new Error("connect ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    rpcResponder = (name, args) => {
      if (name === "pmf_marker_4_totals_as_system") {
        throw transportFailure;
      }
      return defaultRpcResponder(name, args);
    };

    const { computePmfState } = await import("@/lib/admin/pmf-queries");
    const { CronDatabaseOperationError, isDatabasePressureError } =
      await import("@/lib/api/services/cron-workload-control-service");

    const failure = await computePmfState().catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(transportFailure);
    expect(isDatabasePressureError(failure)).toBe(true);
  });
});
