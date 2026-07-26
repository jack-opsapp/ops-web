import { beforeEach, describe, expect, it, vi } from "vitest";

type DbError = { code?: string; message: string };
type DbResult = {
  data: unknown;
  error: DbError | null;
};

const cursorMocks = vi.hoisted(() => ({
  readCronWorkloadCursor: vi.fn(),
  advanceCronWorkloadCursor: vi.fn(),
}));

const lease = {
  ownerToken: "00000000-0000-4000-8000-000000000025",
  fenceToken: 3,
  globalFenceToken: 5,
  expiresAt: "2026-07-24T23:59:59.000Z",
  signal: new AbortController().signal,
};

vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: cursorMocks.readCronWorkloadCursor,
  advanceCronWorkloadCursor: cursorMocks.advanceCronWorkloadCursor,
}));

const calls: Array<{
  table: string;
  method: string;
  args: unknown[];
}> = [];
let resultQueue: DbResult[] = [];

function makeBuilder(table: string) {
  const builder = {
    select(...args: unknown[]) {
      calls.push({ table, method: "select", args });
      return builder;
    },
    update(...args: unknown[]) {
      calls.push({ table, method: "update", args });
      return builder;
    },
    delete(...args: unknown[]) {
      calls.push({ table, method: "delete", args });
      return builder;
    },
    gt(...args: unknown[]) {
      calls.push({ table, method: "gt", args });
      return builder;
    },
    lt(...args: unknown[]) {
      calls.push({ table, method: "lt", args });
      return builder;
    },
    eq(...args: unknown[]) {
      calls.push({ table, method: "eq", args });
      return builder;
    },
    in(...args: unknown[]) {
      calls.push({ table, method: "in", args });
      return builder;
    },
    is(...args: unknown[]) {
      calls.push({ table, method: "is", args });
      return builder;
    },
    not(...args: unknown[]) {
      calls.push({ table, method: "not", args });
      return builder;
    },
    or(...args: unknown[]) {
      calls.push({ table, method: "or", args });
      return builder;
    },
    order(...args: unknown[]) {
      calls.push({ table, method: "order", args });
      return builder;
    },
    limit(...args: unknown[]) {
      calls.push({ table, method: "limit", args });
      return builder;
    },
    then<TResult1 = DbResult, TResult2 = never>(
      onFulfilled?:
        | ((value: DbResult) => TResult1 | PromiseLike<TResult1>)
        | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      const result = resultQueue.shift() ?? {
        data: null,
        error: null,
      };
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

const supabase = {
  from(table: string) {
    calls.push({ table, method: "from", args: [] });
    return makeBuilder(table);
  },
  rpc: vi.fn(),
};

beforeEach(() => {
  calls.length = 0;
  resultQueue = [];
  cursorMocks.readCronWorkloadCursor.mockReset();
  cursorMocks.readCronWorkloadCursor.mockResolvedValue(null);
  cursorMocks.advanceCronWorkloadCursor.mockReset();
  cursorMocks.advanceCronWorkloadCursor.mockResolvedValue(undefined);
});

describe("runMemoryDecayMaintenance outage bounds", () => {
  it("caps decay and prune at 100 and company discovery at one", async () => {
    resultQueue = [
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];

    const {
      MEMORY_DECAY_BATCH_SIZE,
      MEMORY_PRUNE_BATCH_SIZE,
      runMemoryDecayMaintenance,
    } = await import("@/lib/api/services/memory-decay-service");

    const stats = await runMemoryDecayMaintenance(supabase as never, lease);

    expect(stats).toEqual({
      decayed: 0,
      pruned: 0,
      consolidated: 0,
      errors: [],
    });
    const limits = calls
      .filter(({ method }) => method === "limit")
      .map(({ args }) => args[0]);
    expect(limits).toEqual([
      MEMORY_DECAY_BATCH_SIZE,
      MEMORY_PRUNE_BATCH_SIZE,
      1,
    ]);
    expect(MEMORY_DECAY_BATCH_SIZE).toBe(100);
    expect(MEMORY_PRUNE_BATCH_SIZE).toBe(100);
    expect(cursorMocks.advanceCronWorkloadCursor).toHaveBeenCalledTimes(1);
  });

  it("consolidates at most one company and slices its memory page to 20", async () => {
    const memories = Array.from({ length: 21 }, (_, index) => ({
      id: `memory-${String(index).padStart(2, "0")}`,
      category: "preference",
      content: `memory ${index}`,
      confidence: 0.9,
      access_count: 1,
      embedding: Array.from(
        { length: 21 },
        (_, dimension) => (dimension === index ? 1 : 0)
      ),
      decay_score: 1,
    }));
    resultQueue = [
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ company_id: "company-1" }], error: null },
      { data: memories, error: null },
    ];

    const {
      MEMORY_CONSOLIDATION_PAGE_SIZE,
      runMemoryDecayMaintenance,
    } = await import("@/lib/api/services/memory-decay-service");

    await runMemoryDecayMaintenance(supabase as never, lease);

    expect(MEMORY_CONSOLIDATION_PAGE_SIZE).toBe(20);
    expect(calls).toContainEqual({
      table: "agent_memories",
      method: "limit",
      args: [20],
    });
    expect(
      calls.filter(
        ({ table, method }) =>
          table === "agent_memories" &&
          method === "eq"
      )
    ).toContainEqual({
      table: "agent_memories",
      method: "eq",
      args: ["company_id", "company-1"],
    });

    const nextCursor = cursorMocks.advanceCronWorkloadCursor.mock.calls[0][4];
    expect(JSON.parse(nextCursor as string)).toMatchObject({
      consolidationCompanyId: "company-1",
      consolidationMemoryAfterId: "memory-19",
    });
  });

  it("aborts before prune and consolidation when decay fetch hits pressure", async () => {
    const raw = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    resultQueue = [{ data: null, error: raw }];

    const { runMemoryDecayMaintenance } = await import(
      "@/lib/api/services/memory-decay-service"
    );
    const { CronDatabaseOperationError } = await import(
      "@/lib/api/services/cron-workload-control-service"
    );

    const failure = await runMemoryDecayMaintenance(
      supabase as never,
      lease
    ).catch(
      (error) => error
    );

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(calls.filter(({ method }) => method === "select")).toHaveLength(1);
    expect(cursorMocks.advanceCronWorkloadCursor).not.toHaveBeenCalled();
  });

  it("checks consolidation writes and stops before delete on pressure", async () => {
    const raw = {
      code: "PGRST002",
      message: "Could not query the database for the schema cache",
    };
    resultQueue = [
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ company_id: "company-1" }], error: null },
      {
        data: [
          {
            id: "memory-a",
            confidence: 0.9,
            access_count: 1,
            embedding: [1, 0],
            decay_score: 1,
          },
          {
            id: "memory-b",
            confidence: 0.8,
            access_count: 2,
            embedding: [1, 0],
            decay_score: 1,
          },
        ],
        error: null,
      },
      { data: null, error: raw },
    ];

    const { runMemoryDecayMaintenance } = await import(
      "@/lib/api/services/memory-decay-service"
    );
    const { CronDatabaseOperationError } = await import(
      "@/lib/api/services/cron-workload-control-service"
    );

    const failure = await runMemoryDecayMaintenance(
      supabase as never,
      lease
    ).catch(
      (error) => error
    );

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(calls.some(({ method }) => method === "update")).toBe(true);
    expect(calls.some(({ method }) => method === "delete")).toBe(false);
    expect(cursorMocks.advanceCronWorkloadCursor).not.toHaveBeenCalled();
  });
});
