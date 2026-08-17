// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type DbError = { code?: string; message: string };
type DbResult = { data: unknown; error: DbError | null };

const mocks = vi.hoisted(() => ({
  ascGet: vi.fn(),
  ascPost: vi.fn(),
  downloadSegment: vi.fn(),
  parseTsv: vi.fn(),
  actualParseTsv: null as
    null | ((text: string, aliases: Record<string, string[]>) => unknown[]),
  readCronWorkloadCursor: vi.fn(),
  advanceCronWorkloadCursor: vi.fn(),
  CronDatabaseOperationError: class CronDatabaseOperationError extends Error {
    constructor(message: string, options: { cause: unknown }) {
      super(message, options);
      this.name = "CronDatabaseOperationError";
    }
  },
}));

const workloadLease = {
  ownerToken: "00000000-0000-4000-8000-000000000026",
  fenceToken: 7,
  globalFenceToken: 9,
  expiresAt: "2026-07-24T23:59:59.000Z",
  signal: new AbortController().signal,
};

vi.mock("@/lib/analytics/app-store-client", () => ({
  ascGet: mocks.ascGet,
  ascPost: mocks.ascPost,
  downloadSegment: mocks.downloadSegment,
  getAscAppId: () => "999888777",
}));
vi.mock("@/lib/analytics/app-store-parse", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/analytics/app-store-parse")>();
  mocks.actualParseTsv = actual.parseTsv;
  return {
    ...actual,
    parseTsv: mocks.parseTsv,
  };
});
vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: mocks.readCronWorkloadCursor,
  advanceCronWorkloadCursor: mocks.advanceCronWorkloadCursor,
}));
vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    return {
      ...actual,
      CronDatabaseOperationError: mocks.CronDatabaseOperationError,
    };
  }
);

const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
let results: Record<string, DbResult[]> = {};

function nextResult(table: string): DbResult {
  return results[table]?.shift() ?? { data: null, error: null };
}

function builder(table: string) {
  const query = {
    select(...args: unknown[]) {
      calls.push({ table, method: "select", args });
      return query;
    },
    insert(...args: unknown[]) {
      calls.push({ table, method: "insert", args });
      return query;
    },
    upsert(...args: unknown[]) {
      calls.push({ table, method: "upsert", args });
      return query;
    },
    update(...args: unknown[]) {
      calls.push({ table, method: "update", args });
      return query;
    },
    eq(...args: unknown[]) {
      calls.push({ table, method: "eq", args });
      return query;
    },
    gt(...args: unknown[]) {
      calls.push({ table, method: "gt", args });
      return query;
    },
    is(...args: unknown[]) {
      calls.push({ table, method: "is", args });
      return query;
    },
    order(...args: unknown[]) {
      calls.push({ table, method: "order", args });
      return query;
    },
    limit(...args: unknown[]) {
      calls.push({ table, method: "limit", args });
      return query;
    },
    maybeSingle() {
      calls.push({ table, method: "maybeSingle", args: [] });
      return query;
    },
    single() {
      calls.push({ table, method: "single", args: [] });
      return query;
    },
    then<TResult1 = DbResult, TResult2 = never>(
      onFulfilled?:
        ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?:
        ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(nextResult(table)).then(onFulfilled, onRejected);
    },
  };
  return query;
}

const supabase = {
  from(table: string) {
    calls.push({ table, method: "from", args: [] });
    return builder(table);
  },
  rpc: vi.fn(),
};

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => supabase,
}));

beforeEach(() => {
  calls.length = 0;
  results = {};
  vi.clearAllMocks();
  mocks.readCronWorkloadCursor.mockResolvedValue(null);
  mocks.advanceCronWorkloadCursor.mockResolvedValue(undefined);
  mocks.parseTsv.mockReturnValue([]);
  mocks.downloadSegment.mockResolvedValue("tsv");
  mocks.ascPost.mockResolvedValue({ data: { id: "request-provider-1" } });
});

describe("app-store sync outage bounds", () => {
  it("checks bootstrap reads and preserves the raw database error", async () => {
    const raw = {
      code: "PGRST002",
      message: "Could not query the database for the schema cache",
    };
    results.asc_report_requests = [{ data: null, error: raw }];

    const { bootstrapIfNeeded } = await import("@/lib/admin/app-store-sync");
    const failure = await bootstrapIfNeeded(supabase as never).catch(
      (error) => error
    );

    expect(failure).toBeInstanceOf(mocks.CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(mocks.ascPost).not.toHaveBeenCalled();
  });

  it("inspects at most one request, two instances, and ingests one segment", async () => {
    results.asc_report_requests = [
      {
        data: [
          {
            id: "request-db-1",
            asc_request_id: "request-provider-1",
          },
          {
            id: "request-db-2",
            asc_request_id: "request-provider-2",
          },
        ],
        error: null,
      },
    ];
    results.asc_reports = [{ data: { id: "report-db-1" }, error: null }];
    results.asc_report_instances = [
      { data: { id: "instance-db-1" }, error: null },
    ];
    results.asc_report_segments = [
      { data: null, error: null },
      { data: { id: "segment-db-1" }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];

    mocks.ascGet
      .mockResolvedValueOnce({
        data: [
          {
            id: "report-provider-1",
            attributes: {
              category: "APP_STORE_ENGAGEMENT",
              name: "Engagement",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "instance-provider-1",
            attributes: {
              granularity: "DAILY",
              processingDate: "2026-07-23",
            },
          },
          {
            id: "instance-provider-2",
            attributes: {
              granularity: "DAILY",
              processingDate: "2026-07-22",
            },
          },
          {
            id: "instance-provider-3",
            attributes: {
              granularity: "DAILY",
              processingDate: "2026-07-21",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "segment-provider-1",
            attributes: {
              checksum: "checksum-1",
              url: "https://example.test/segment.gz",
            },
          },
          {
            id: "segment-provider-2",
            attributes: {
              checksum: "checksum-2",
              url: "https://example.test/segment-2.gz",
            },
          },
        ],
      });

    const { syncOnce } = await import("@/lib/admin/app-store-sync");
    const result = await syncOnce(supabase as never, workloadLease);

    expect(result.segmentsProcessed).toBe(1);
    expect(mocks.downloadSegment).toHaveBeenCalledTimes(1);
    expect(
      calls.filter(
        ({ table, method }) =>
          table === "asc_report_instances" && method === "upsert"
      )
    ).toHaveLength(1);
    expect(
      calls.find(
        ({ table, method }) =>
          table === "asc_report_requests" && method === "limit"
      )
    ).toEqual({
      table: "asc_report_requests",
      method: "limit",
      args: [1],
    });
    expect(
      mocks.ascGet.mock.calls.some(([path]) =>
        String(path).includes("instances?filter[granularity]=DAILY&limit=2")
      )
    ).toBe(true);
    expect(
      mocks.ascGet.mock.calls.some(([path]) =>
        String(path).includes("segments?limit=1")
      )
    ).toBe(true);
    expect(mocks.advanceCronWorkloadCursor).toHaveBeenCalledTimes(1);
  });

  it("does not advance the cursor when a checked segment write hits pressure", async () => {
    const raw = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    results.asc_report_requests = [
      {
        data: [
          {
            id: "request-db-1",
            asc_request_id: "request-provider-1",
          },
        ],
        error: null,
      },
    ];
    results.asc_reports = [{ data: { id: "report-db-1" }, error: null }];
    results.asc_report_instances = [
      { data: { id: "instance-db-1" }, error: null },
    ];
    results.asc_report_segments = [
      { data: null, error: null },
      { data: null, error: raw },
    ];
    mocks.ascGet
      .mockResolvedValueOnce({
        data: [
          {
            id: "report-provider-1",
            attributes: { name: "Engagement" },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "instance-provider-1",
            attributes: {
              granularity: "DAILY",
              processingDate: "2026-07-23",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "segment-provider-1",
            attributes: {
              checksum: "checksum-1",
              url: "https://example.test/segment.gz",
            },
          },
        ],
      });

    const { syncOnce } = await import("@/lib/admin/app-store-sync");
    const failure = await syncOnce(supabase as never, workloadLease).catch(
      (error) => error
    );

    expect(failure).toBeInstanceOf(mocks.CronDatabaseOperationError);
    expect(failure.cause).toBe(raw);
    expect(mocks.downloadSegment).not.toHaveBeenCalled();
    expect(mocks.advanceCronWorkloadCursor).not.toHaveBeenCalled();
  });

  it("preserves canonical engagement identities through segment completion", async () => {
    results.asc_report_requests = [
      {
        data: [
          {
            id: "request-db-1",
            asc_request_id: "request-provider-1",
          },
        ],
        error: null,
      },
    ];
    results.asc_reports = [{ data: { id: "report-db-1" }, error: null }];
    results.asc_report_instances = [
      { data: { id: "instance-db-1" }, error: null },
    ];
    results.asc_report_segments = [
      { data: null, error: null },
      { data: { id: "segment-db-1" }, error: null },
    ];
    mocks.ascGet
      .mockResolvedValueOnce({
        data: [
          {
            id: "report-provider-1",
            attributes: {
              category: "APP_STORE_ENGAGEMENT",
              name: "Engagement",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "instance-provider-1",
            attributes: {
              granularity: "DAILY",
              processingDate: "2026-07-23",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "segment-provider-1",
            attributes: {
              checksum: "checksum-1",
              url: "https://example.test/segment.gz",
            },
          },
        ],
      });
    mocks.parseTsv.mockImplementation(mocks.actualParseTsv!);
    mocks.downloadSegment.mockResolvedValue(
      [
        "Date\tEvent\tEngagement Type\tPage Type\tSource Type\tSource Info\tDevice\tPlatform Version\tTerritory\tCounts\tUnique Counts",
        "2026-07-23\tTap\tGet\tProduct Page\tApp Store Search\t\tiPhone\tiOS 18\tUS\t8\t8",
        "2026-07-23\tTap\tOpen\tProduct Page\tApp Store Search\t\tiPhone\tiOS 18\tUS\t4\t4",
      ].join("\n")
    );

    const { syncOnce } = await import("@/lib/admin/app-store-sync");
    const result = await syncOnce(supabase as never, workloadLease);

    const factUpsert = calls.find(
      ({ table, method }) =>
        table === "asc_discovery_engagement" && method === "upsert"
    );
    const facts = (factUpsert?.args[0] ?? []) as Array<{
      engagement_type: string | null;
    }>;
    expect(facts.map((fact) => fact.engagement_type)).toEqual(["Get", "Open"]);
    expect(result).toMatchObject({ segmentsProcessed: 1, rowsIngested: 2 });
    expect(
      calls.some(
        ({ table, method, args }) =>
          table === "asc_report_segments" &&
          method === "update" &&
          (args[0] as { state?: string }).state === "processed"
      )
    ).toBe(true);
  });
});
