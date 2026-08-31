import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSyncStore } from "@/lib/admin/analytics-sync-store";
import {
  aggregateGA4AcquisitionFacts,
  classifyGA4Channel,
  planGA4Sync,
  runGA4AcquisitionSync,
  toGA4AcquisitionFact,
  type ChannelMapRule,
} from "@/lib/admin/ga4-acquisition-sync";
import {
  GA4_ACQUISITION_DIMENSIONS,
  GA4_ACQUISITION_METRICS,
  buildGA4AcquisitionRequest,
  fetchGA4AcquisitionDate,
} from "@/lib/analytics/ga4-acquisition-client";

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests/fixtures/analytics/ga4/acquisition.json"),
    "utf8"
  )
);

const rules: ChannelMapRule[] = [
  {
    raw_channel: "Organic Search",
    raw_source: null,
    raw_medium: null,
    canonical_channel: "organic_search",
    priority: 10,
  },
  {
    raw_channel: null,
    raw_source: null,
    raw_medium: null,
    canonical_channel: "other",
    priority: 1000,
  },
];

function storeMock() {
  return {
    latest: vi.fn().mockResolvedValue({
      cursor: null,
      metadata: { backfill_complete: true },
    }),
    begin: vi.fn().mockResolvedValue("run-id"),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    replaceGA4Date: vi.fn().mockImplementation(async ({ rows }) => rows.length),
  } as unknown as AnalyticsSyncStore;
}

describe("GA4 acquisition warehouse", () => {
  beforeEach(() => {
    vi.stubEnv("GA4_MARKETING_PROPERTY_ID", "475051117");
    vi.stubEnv("GA4_WEB_APP_PROPERTY_ID", "539494652");
    vi.stubEnv("GA4_IOS_APP_PROPERTY_ID", "514229717");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests the exact session acquisition dimensions and metrics", () => {
    const request = buildGA4AcquisitionRequest(
      "marketing",
      "2026-08-28",
      100_000
    );
    expect(request.dimensions?.map((value) => value.name)).toEqual([
      ...GA4_ACQUISITION_DIMENSIONS,
    ]);
    expect(request.metrics?.map((value) => value.name)).toEqual([
      ...GA4_ACQUISITION_METRICS,
    ]);
    expect(request.offset).toBe(100_000);
  });

  it("paginates without treating a permission failure as zero traffic", async () => {
    const client = {
      runReport: vi
        .fn()
        .mockResolvedValueOnce([{ rows: fixture.rows, rowCount: 2 }])
        .mockResolvedValueOnce([{ rows: fixture.rows, rowCount: 2 }]),
    };
    const rows = await fetchGA4AcquisitionDate("marketing", "2026-08-28", {
      client,
      limit: 1,
    });
    expect(rows).toHaveLength(2);

    const denied = { runReport: vi.fn().mockRejectedValue(new Error("PERMISSION_DENIED")) };
    await expect(
      fetchGA4AcquisitionDate("marketing", "2026-08-28", { client: denied })
    ).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("sanitizes landing paths and maps the source through the shared channel rules", () => {
    const fact = toGA4AcquisitionFact(
      fixture.rows[0],
      "marketing",
      "475051117",
      "2026-08-28",
      "2026-08-30T20:00:00.000Z"
    );
    expect(fact.landing_path).toBe("/projects/:id");
    expect(fact.sessions).toBe(12);
    expect(classifyGA4Channel(rules, fact)).toBe("organic_search");
  });

  it("re-aggregates rows that collapse after route templating", () => {
    const fact = toGA4AcquisitionFact(
      fixture.rows[0],
      "marketing",
      "475051117",
      "2026-08-28",
      "2026-08-30T20:00:00.000Z"
    );
    const rows = aggregateGA4AcquisitionFacts([
      fact,
      {
        ...fact,
        sessions: 2,
        engaged_sessions: 1,
        new_users: 1,
        total_users: 2,
        key_events: 1,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        landing_path: "/projects/:id",
        sessions: 14,
        engaged_sessions: 9,
        new_users: 7,
        total_users: 12,
        key_events: 3,
      })
    );
  });

  it("restates D-8 through D-2 and records each property independently", async () => {
    expect(
      planGA4Sync({
        today: "2026-08-30",
        latestState: { cursor: null, metadata: { backfill_complete: true } },
      }).dates
    ).toEqual([
      "2026-08-22",
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);

    const store = storeMock();
    const fetchDate = vi.fn().mockImplementation(async (_propertyKey, date) => [
      {
        ...fixture.rows[0],
        dimensionValues: [
          { value: date.replaceAll("-", "") },
          ...fixture.rows[0].dimensionValues.slice(1),
        ],
      },
    ]);
    const result = await runGA4AcquisitionSync({
      store,
      now: new Date("2026-08-30T20:00:00.000Z"),
      propertyIds: {
        marketing: "475051117",
        web_app: "539494652",
        ios_app: "514229717",
      },
      channelRules: rules,
      fetchDate,
      fetchConversionQA: vi.fn().mockResolvedValue([]),
    });

    expect(result.properties).toEqual([
      expect.objectContaining({ propertyKey: "marketing", rowCount: 7 }),
      expect.objectContaining({ propertyKey: "web_app", rowCount: 7 }),
    ]);
    expect(store.replaceGA4Date).toHaveBeenCalledTimes(14);
    expect(store.complete).toHaveBeenCalledTimes(3);
  });
});
