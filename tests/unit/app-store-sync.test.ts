// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedRow } from "@/lib/analytics/app-store-parse";

// ── Mocks ────────────────────────────────────────────────────────────────────
const ascPost = vi.fn();
const ascGet = vi.fn();
const downloadSegment = vi.fn();
vi.mock("@/lib/analytics/app-store-client", () => ({
  ascPost: (...a: unknown[]) => ascPost(...a),
  ascGet: (...a: unknown[]) => ascGet(...a),
  downloadSegment: (...a: unknown[]) => downloadSegment(...a),
  getAscAppId: () => "999888777",
}));

let existingRequests: { access_type: string; created_at: string }[] = [];
const inserts: { table: string; row: unknown }[] = [];
vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        order: () => query,
        limit: () =>
          Promise.resolve({ data: existingRequests, error: null }),
        insert: (row: unknown) => {
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
  }),
}));

import {
  buildReportRequestBody,
  toEngagementFact,
  toDownloadFact,
  bootstrapIfNeeded,
  aggregateFactsByConflictIdentity,
  ENGAGEMENT_CONFLICT,
  syncOnce,
  runSync,
} from "@/lib/admin/app-store-sync";
import type { CronWorkloadLease } from "@/lib/api/services/cron-workload-control-service";

const row = (fields: Record<string, string | number>): ParsedRow => ({ raw: {}, ...fields });

beforeEach(() => {
  ascPost.mockReset();
  ascPost.mockImplementation(() => Promise.resolve({ data: { id: "req_" + (ascPost.mock.calls.length) } }));
  existingRequests = [];
  inserts.length = 0;
  ascGet.mockReset();
  downloadSegment.mockReset();
});

describe("buildReportRequestBody", () => {
  it("scopes the request to the app via the apps relationship + numeric id", () => {
    expect(buildReportRequestBody("ONGOING", "999888777")).toEqual({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: "999888777" } } },
      },
    });
  });
});

describe("toEngagementFact / toDownloadFact", () => {
  it("maps engagement fields, normalizes channel, and carries segment id", () => {
    const f = toEngagementFact(
      row({ reporting_date: "2026-06-10", engagement_type: "Impression", source_type: "App Store Search", territory: "US", counts: 100, unique_counts: 80 }),
      "seg-1",
    );
    expect(f).toMatchObject({
      reporting_date: "2026-06-10",
      engagement_type: "Impression",
      source_type: "App Store Search",
      channel: "app_store_search",
      territory: "US",
      counts: 100,
      unique_counts: 80,
      segment_id: "seg-1",
      granularity: "DAILY",
    });
    expect(f.page_type).toBeNull(); // absent dimension → null
  });

  it("maps download rows and normalizes an unknown source to 'other'", () => {
    const f = toDownloadFact(
      row({ reporting_date: "2026-06-10", download_type: "Total Downloads", source_type: "Mystery", counts: 5, unique_counts: 5 }),
      "seg-2",
    );
    expect(f).toMatchObject({ download_type: "Total Downloads", channel: "other", counts: 5, segment_id: "seg-2" });
  });
});

describe("bootstrapIfNeeded (idempotent)", () => {
  it("creates at most one report request when no requests exist", async () => {
    existingRequests = [];
    await bootstrapIfNeeded();
    expect(ascPost).toHaveBeenCalledTimes(1);
    expect((inserts[0].row as { access_type: string }).access_type).toBe(
      "ONGOING"
    );
  });

  it("does nothing when ONGOING + a fresh snapshot already exist", async () => {
    const now = new Date().toISOString();
    existingRequests = [
      { access_type: "ONGOING", created_at: now },
      { access_type: "ONE_TIME_SNAPSHOT", created_at: now },
    ];
    await bootstrapIfNeeded();
    expect(ascPost).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("creates only the missing ONGOING when a snapshot already exists", async () => {
    existingRequests = [{ access_type: "ONE_TIME_SNAPSHOT", created_at: new Date().toISOString() }];
    await bootstrapIfNeeded();
    expect(ascPost).toHaveBeenCalledTimes(1);
    expect((inserts[0].row as { access_type: string }).access_type).toBe("ONGOING");
  });

  it("creates the snapshot on the run after ONGOING exists", async () => {
    existingRequests = [
      { access_type: "ONGOING", created_at: new Date().toISOString() },
    ];

    await bootstrapIfNeeded();

    expect(ascPost).toHaveBeenCalledTimes(1);
    expect((inserts[0].row as { access_type: string }).access_type).toBe(
      "ONE_TIME_SNAPSHOT"
    );
  });
});

describe("aggregateFactsByConflictIdentity", () => {
  const identity = ENGAGEMENT_CONFLICT.split(",");
  const base = {
    granularity: "DAILY",
    reporting_date: "2026-07-29",
    engagement_type: "Tap",
    page_type: "Product page",
    source_type: "App Store browse",
    source_info: null,
    device: "iPhone",
    platform_version: "iOS 26.5",
    territory: "US",
    channel: "app_store_browse",
    segment_id: "seg-1",
    updated_at: "t",
  };

  it("sums counts and unique_counts for rows sharing the identity (null-safe)", () => {
    const out = aggregateFactsByConflictIdentity(
      [
        { ...base, counts: 1, unique_counts: 1 },
        { ...base, counts: 2, unique_counts: 1 },
      ],
      identity
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ counts: 3, unique_counts: 2 });
  });

  it("keeps distinct identities apart and preserves order-independent totals", () => {
    const out = aggregateFactsByConflictIdentity(
      [
        { ...base, counts: 1, unique_counts: 1 },
        { ...base, engagement_type: "Impression", counts: 5, unique_counts: 4 },
      ],
      identity
    );
    expect(out).toHaveLength(2);
  });

  it("treats null and the string 'null' as different identity values", () => {
    const out = aggregateFactsByConflictIdentity(
      [
        { ...base, source_info: null, counts: 1, unique_counts: 1 },
        { ...base, source_info: "null", counts: 1, unique_counts: 1 },
      ],
      identity
    );
    expect(out).toHaveLength(2);
  });

  it("does not mutate the input rows", () => {
    const input = [
      { ...base, counts: 1, unique_counts: 1 },
      { ...base, counts: 2, unique_counts: 3 },
    ];
    aggregateFactsByConflictIdentity(input, identity);
    expect(input[0]).toMatchObject({ counts: 1, unique_counts: 1 });
  });
});

// ── syncOnce / runSync harness ───────────────────────────────────────────────
// A chainable, awaitable stand-in for the supabase query builder. Every call is
// recorded so tests can assert the exact table/op sequence syncOnce performed.

interface RecordedOp {
  op: string;
  args: unknown[];
}
interface RecordedQuery {
  table: string;
  ops: RecordedOp[];
}
interface QueryResult {
  data: unknown;
  error: unknown;
}

const BUILDER_METHODS = [
  "select",
  "order",
  "limit",
  "is",
  "eq",
  "gt",
  "upsert",
  "insert",
  "update",
  "delete",
  "maybeSingle",
  "single",
] as const;

function terminalShape(ops: RecordedOp[]): "single" | "many" {
  return ops.some((o) => o.op === "single" || o.op === "maybeSingle")
    ? "single"
    : "many";
}

interface HarnessOptions {
  /** rows returned by the active report-request read */
  requests?: { id: string; asc_request_id: string }[];
  /** existing asc_report_segments row for the checksum lookup */
  existingSegment?: { id: string; state: string } | null;
}

function makeHarness(options: HarnessOptions = {}) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  let storedCursor: string | null = null;

  const requests = options.requests ?? [
    { id: "req-1", asc_request_id: "asc-req-1" },
  ];

  function resolveQuery(table: string, ops: RecordedOp[]): QueryResult {
    const shape = terminalShape(ops);
    if (table === "asc_report_requests") {
      // Honour the cursor filters so a full walk actually terminates.
      const after = ops.find((o) => o.op === "gt" && o.args[0] === "id");
      const only = ops.find((o) => o.op === "eq" && o.args[0] === "id");
      let rows = requests;
      if (after) rows = rows.filter((r) => r.id > (after.args[1] as string));
      if (only) rows = rows.filter((r) => r.id === (only.args[1] as string));
      return { data: rows, error: null };
    }
    if (table === "asc_reports") {
      return { data: shape === "single" ? { id: "report-row-1" } : null, error: null };
    }
    if (table === "asc_report_instances") {
      const isUpsert = ops.some((o) => o.op === "upsert");
      return {
        data: isUpsert && shape === "single" ? { id: "inst-row-1" } : null,
        error: null,
      };
    }
    if (table === "asc_report_segments") {
      const isUpsert = ops.some((o) => o.op === "upsert");
      if (isUpsert) return { data: { id: "seg-row-1" }, error: null };
      if (shape === "single") {
        return { data: options.existingSegment ?? null, error: null };
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "read_cron_workload_cursor_as_system") {
        return Promise.resolve({ data: storedCursor, error: null });
      }
      if (fn === "advance_cron_workload_cursor_as_system") {
        storedCursor = (args.p_next_cursor as string | null) ?? null;
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      const ops: RecordedOp[] = [];
      queries.push({ table, ops });
      const query: Record<string, unknown> = {};
      for (const method of BUILDER_METHODS) {
        query[method] = (...args: unknown[]) => {
          ops.push({ op: method, args });
          return query;
        };
      }
      query.then = (
        onFulfilled?: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(resolveQuery(table, ops)).then(onFulfilled, onRejected);
      return query;
    },
  };

  return {
    client: client as never,
    queries,
    rpcCalls,
    get cursor() {
      return storedCursor;
    },
    setCursor(next: string | null) {
      storedCursor = next;
    },
    advanceCalls() {
      return rpcCalls.filter(
        (c) => c.fn === "advance_cron_workload_cursor_as_system"
      );
    },
    queriesFor(table: string) {
      return queries.filter((q) => q.table === table);
    },
  };
}

function makeLease(signal?: AbortSignal): CronWorkloadLease {
  return {
    ownerToken: "owner-1",
    fenceToken: 1,
    globalFenceToken: 1,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    signal: signal ?? new AbortController().signal,
  };
}

/** Apple's engagement report shape, with BOTH Event and Engagement Type. */
const POISON_TSV = [
  "Date\tEvent\tEngagement Type\tPage Type\tSource Type\tSource Info\tDevice\tPlatform Version\tTerritory\tCounts\tUnique Counts",
  "2026-07-29\tTap\tGet\tProduct page\tApp Store browse\t\tiPhone\tiOS 26.5\tUS\t8\t8",
  "2026-07-29\tTap\tOpen\tProduct page\tApp Store browse\t\tiPhone\tiOS 26.5\tUS\t4\t4",
].join("\n");

/**
 * Wire ascGet to walk one engagement report → one instance → one segment.
 * `reportName` drives the allowlist branch; `reportNext` simulates another
 * report page after the current one.
 */
function wireAscWalk(options: {
  reportName: string;
  reportNext?: string;
  segmentUrl?: string;
}) {
  ascGet.mockImplementation((path: string) => {
    if (path.includes("/reports?")) {
      return Promise.resolve({
        data: [
          {
            id: "asc-report-1",
            attributes: {
              category: "APP_STORE_ENGAGEMENT",
              name: options.reportName,
            },
          },
        ],
        links: options.reportNext ? { next: options.reportNext } : {},
      });
    }
    if (path.includes("/instances?")) {
      return Promise.resolve({
        data: [
          {
            id: "asc-inst-1",
            attributes: { granularity: "DAILY", processingDate: "2026-08-20" },
          },
        ],
        links: {},
      });
    }
    if (path.includes("/segments?")) {
      return Promise.resolve({
        data: [
          {
            id: "asc-seg-1",
            attributes: {
              checksum: "chk-1",
              sizeInBytes: 100,
              url: options.segmentUrl ?? "https://apple.example/seg-1",
            },
          },
        ],
        links: {},
      });
    }
    // /v1/analyticsReports/<id> detail lookup (resumed-cursor branch)
    return Promise.resolve({
      data: { id: "asc-report-1", attributes: { name: options.reportName } },
    });
  });
}

describe("syncOnce report allowlist", () => {
  it("skips a non-allowlisted report without touching asc_reports", async () => {
    const harness = makeHarness();
    wireAscWalk({
      reportName: "App Store Discovery and Engagement Detailed",
      reportNext: "https://api.apple.example/reports?cursor=page2",
    });

    const result = await syncOnce(harness.client, makeLease());

    expect(harness.queriesFor("asc_reports")).toHaveLength(0);
    expect(result.segmentsProcessed).toBe(0);
    const advance = harness.advanceCalls();
    expect(advance).toHaveLength(1);
    expect(
      JSON.parse(advance[0].args.p_next_cursor as string)
    ).toMatchObject({ reportPage: "https://api.apple.example/reports?cursor=page2" });
  });

  it("ingests the allowlisted engagement report", async () => {
    const harness = makeHarness();
    wireAscWalk({ reportName: "App Store Discovery and Engagement Standard" });
    downloadSegment.mockResolvedValue(POISON_TSV);

    const result = await syncOnce(harness.client, makeLease());

    expect(harness.queriesFor("asc_reports")).toHaveLength(1);
    expect(result.segmentsProcessed).toBe(1);
  });

  it("unpins a resumed cursor parked inside a non-allowlisted report", async () => {
    const harness = makeHarness();
    harness.setCursor(
      JSON.stringify({
        requestId: "req-1",
        categoryIndex: 0,
        reportId: "asc-report-1",
      })
    );
    wireAscWalk({ reportName: "Web Preview Engagement Standard" });

    await syncOnce(harness.client, makeLease());

    expect(harness.queriesFor("asc_reports")).toHaveLength(0);
    expect(ascGet).toHaveBeenCalledWith("/v1/analyticsReports/asc-report-1");
    expect(harness.advanceCalls()).toHaveLength(1);
  });
});

describe("syncOnce raw-row idempotency", () => {
  it("replaces the segment's raw rows before inserting", async () => {
    const harness = makeHarness();
    wireAscWalk({ reportName: "App Store Discovery and Engagement Standard" });
    downloadSegment.mockResolvedValue(POISON_TSV);

    await syncOnce(harness.client, makeLease());

    const rawQueries = harness.queriesFor("asc_raw_rows");
    expect(rawQueries).toHaveLength(2);
    expect(rawQueries[0].ops.map((o) => o.op)).toEqual(["delete", "eq"]);
    expect(rawQueries[0].ops[1].args).toEqual(["segment_id", "seg-row-1"]);
    expect(rawQueries[1].ops[0].op).toBe("insert");
  });
});

describe("syncOnce duplicate conflict identity (bug 2c85587e regression)", () => {
  it("collapses two Tap subtype rows into one summed fact", async () => {
    const harness = makeHarness();
    wireAscWalk({ reportName: "App Store Discovery and Engagement Standard" });
    downloadSegment.mockResolvedValue(POISON_TSV);

    const result = await syncOnce(harness.client, makeLease());

    const factQuery = harness.queriesFor("asc_discovery_engagement")[0];
    expect(factQuery).toBeDefined();
    const upsertOp = factQuery.ops.find((o) => o.op === "upsert");
    const payload = upsertOp?.args[0] as Record<string, unknown>[];
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      engagement_type: "Tap",
      counts: 12,
      unique_counts: 12,
      territory: "US",
    });
    expect(upsertOp?.args[1]).toEqual({ onConflict: ENGAGEMENT_CONFLICT });
    expect(result.rowsIngested).toBe(1);
  });
});

describe("runSync loop", () => {
  it("stops as soon as a step completes the cycle (cursorAfter null)", async () => {
    const harness = makeHarness({ requests: [] });

    const total = await runSync(harness.client, makeLease());

    expect(harness.advanceCalls()).toHaveLength(1);
    expect(total.cursorAfter).toBeNull();
    expect(total.segmentsProcessed).toBe(0);
  });

  it("accumulates totals across steps and keeps the newest lastDate", async () => {
    const harness = makeHarness();
    wireAscWalk({ reportName: "App Store Discovery and Engagement Standard" });
    downloadSegment.mockResolvedValue(POISON_TSV);

    const total = await runSync(harness.client, makeLease());

    expect(total.segmentsProcessed).toBeGreaterThanOrEqual(1);
    expect(total.rowsIngested).toBeGreaterThanOrEqual(1);
    expect(total.lastDate).toBe("2026-08-20");
    expect(total.cursorAfter).toBeNull();
  });

  it("stops at the step cap when the cursor never completes", async () => {
    const harness = makeHarness();
    // Every report page points at another page → the cursor never reaches null.
    wireAscWalk({
      reportName: "App Store Discovery and Engagement Detailed",
      reportNext: "https://api.apple.example/reports?cursor=next",
    });

    const total = await runSync(harness.client, makeLease());

    expect(harness.advanceCalls()).toHaveLength(60);
    expect(total.cursorAfter).not.toBeNull();
  });

  it("stops when the time budget is spent", async () => {
    const harness = makeHarness();
    wireAscWalk({
      reportName: "App Store Discovery and Engagement Detailed",
      reportNext: "https://api.apple.example/reports?cursor=next",
    });

    await runSync(harness.client, makeLease(), 0);

    expect(harness.advanceCalls()).toHaveLength(1);
  });

  it("stops when the lease aborts", async () => {
    const harness = makeHarness();
    wireAscWalk({
      reportName: "App Store Discovery and Engagement Detailed",
      reportNext: "https://api.apple.example/reports?cursor=next",
    });
    const controller = new AbortController();
    controller.abort();

    await runSync(harness.client, makeLease(controller.signal));

    expect(harness.advanceCalls()).toHaveLength(0);
  });
});
