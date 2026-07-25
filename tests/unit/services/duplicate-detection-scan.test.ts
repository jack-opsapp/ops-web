import { beforeEach, describe, expect, it, vi } from "vitest";

type DbError = { code?: string; message: string };
type DbResult = {
  data: unknown;
  error: DbError | null;
};

const mocks = vi.hoisted(() => ({
  requireSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: mocks.requireSupabase,
}));

const tableResults = new Map<string, DbResult>();
const calls: Array<{
  table: string;
  method: string;
  args: unknown[];
}> = [];
let reviewWriteError: DbError | null = null;

function makeBuilder(table: string) {
  let operation: "select" | "upsert" = "select";
  let payload: unknown;

  const builder = {
    select(...args: unknown[]) {
      calls.push({ table, method: "select", args });
      return builder;
    },
    upsert(rows: unknown, ...args: unknown[]) {
      operation = "upsert";
      payload = rows;
      calls.push({ table, method: "upsert", args: [rows, ...args] });
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
      const result =
        operation === "upsert"
          ? {
              data: reviewWriteError
                ? null
                : (payload as unknown[]).map((_, index) => ({
                    id: `review-${index}`,
                  })),
              error: reviewWriteError,
            }
          : tableResults.get(table) ?? { data: [], error: null };
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
};

beforeEach(() => {
  tableResults.clear();
  calls.length = 0;
  reviewWriteError = null;
  mocks.requireSupabase.mockReset();
  mocks.requireSupabase.mockReturnValue(supabase);
});

describe("DuplicateDetectionService.scanCompany outage bounds", () => {
  it("uses an ordered, bounded page for every entity type", async () => {
    const {
      DUPLICATE_ENTITY_PAGE_SIZE,
      DuplicateDetectionService,
    } = await import("@/lib/api/services/duplicate-detection-service");

    await DuplicateDetectionService.scanCompany("company-1");

    for (const table of [
      "clients",
      "opportunities",
      "projects",
      "project_tasks",
    ]) {
      const tableCalls = calls.filter((call) => call.table === table);
      expect(tableCalls).toContainEqual({
        table,
        method: "order",
        args: ["id", { ascending: true }],
      });
      expect(tableCalls).toContainEqual({
        table,
        method: "limit",
        args: [DUPLICATE_ENTITY_PAGE_SIZE],
      });
    }
  });

  it("tags a raw entity-page read error and stops before later entity work", async () => {
    const raw = {
      code: "PGRST002",
      message: "Could not query the database for the schema cache",
    };
    tableResults.set("clients", { data: null, error: raw });

    const { DuplicateDetectionService } = await import(
      "@/lib/api/services/duplicate-detection-service"
    );
    const { CronDatabaseOperationError } = await import(
      "@/lib/api/services/cron-workload-control-service"
    );

    const failure = await DuplicateDetectionService.scanCompany(
      "company-1"
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(calls.some(({ table }) => table === "opportunities")).toBe(false);
  });

  it("checks duplicate-review writes and retains their raw database cause", async () => {
    tableResults.set("clients", {
      data: [
        {
          id: "client-a",
          name: "Acme",
          email: "same@example.com",
          phone_number: null,
          address: null,
        },
        {
          id: "client-b",
          name: "Acme 2",
          email: "same@example.com",
          phone_number: null,
          address: null,
        },
      ],
      error: null,
    });
    const raw = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    reviewWriteError = raw;

    const { DuplicateDetectionService } = await import(
      "@/lib/api/services/duplicate-detection-service"
    );
    const { CronDatabaseOperationError } = await import(
      "@/lib/api/services/cron-workload-control-service"
    );

    const failure = await DuplicateDetectionService.scanCompany(
      "company-1"
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(
      calls.some(
        ({ table, method }) =>
          table === "duplicate_reviews" && method === "upsert"
      )
    ).toBe(true);
    expect(calls.some(({ table }) => table === "opportunities")).toBe(false);
  });
});
