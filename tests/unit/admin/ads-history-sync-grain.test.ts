/**
 * Warehouse sync orchestration for the new grains. The Ads client and the
 * Supabase queries are mocked; this proves what the sync asks for and what it
 * writes, and the trailing-window rule (3 days daily, 30 on Mondays).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { client, queries } = vi.hoisted(() => ({
  client: {
    queryDailyAdGroupData: vi.fn(),
    queryDailyAdData: vi.fn(),
    queryDailyAssetData: vi.fn(),
    queryDailyKeywordData: vi.fn(),
    queryClickMap: vi.fn(),
    queryEntitySnapshot: vi.fn(),
    getAccountSummaryForRange: vi.fn(),
    getCampaignPerformanceForRange: vi.fn(),
    queryDailySearchTermData: vi.fn(),
    queryDailyAccountData: vi.fn(),
    queryDailyCampaignData: vi.fn(),
  },
  queries: {
    upsertDailyAccount: vi.fn(),
    upsertDailyAccountBatch: vi.fn(),
    upsertDailyCampaigns: vi.fn(),
    upsertDailySearchTerms: vi.fn(),
    upsertDailyAdGroups: vi.fn(),
    upsertDailyAds: vi.fn(),
    upsertDailyAssets: vi.fn(),
    upsertDailyKeywords: vi.fn(),
    upsertClickMap: vi.fn(),
    upsertEntitySnapshot: vi.fn(),
    updateSyncStatus: vi.fn(),
  },
}));
vi.mock("@/lib/analytics/google-ads-client", () => client);
vi.mock("@/lib/admin/ads-history-queries", () => queries);

import { syncGrains, syncEntitySnapshot, trailingGrainWindow } from "@/lib/admin/ads-history-sync";

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  for (const fn of Object.values(queries)) fn.mockReset();
  client.queryDailyAdGroupData.mockResolvedValue([{ date: "2026-09-01", ad_group_id: "g1" }]);
  client.queryDailyAdData.mockResolvedValue([{ date: "2026-09-01", ad_id: "a1" }]);
  client.queryDailyAssetData.mockResolvedValue([{ date: "2026-09-01", ad_id: "a1", asset_id: "s1", field_type: "HEADLINE" }]);
  client.queryDailyKeywordData.mockResolvedValue([{ date: "2026-09-01", ad_group_id: "g1", criterion_id: "k1" }]);
  client.queryClickMap.mockImplementation(async (date: Date) => [{ gclid: `g-${date.toISOString().slice(0, 10)}` }]);
  client.queryEntitySnapshot.mockResolvedValue([
    { resource_name: "customers/1/campaigns/1", entity_type: "campaign", parent_resource_name: null, name: "C", status: "PAUSED", payload: {}, labels: [] },
    { resource_name: "customers/1/adGroups/2", entity_type: "ad_group", parent_resource_name: "customers/1/campaigns/1", name: "G", status: "ENABLED", payload: {}, labels: [] },
  ]);
  for (const fn of Object.values(queries)) fn.mockResolvedValue(undefined);
});

describe("syncGrains", () => {
  it("queries each grain once for the range and the click map once per day, then upserts every grain", async () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-09-03T00:00:00Z");
    const out = await syncGrains(start, end);

    expect(client.queryDailyAdGroupData).toHaveBeenCalledTimes(1);
    expect(client.queryDailyAdGroupData).toHaveBeenCalledWith(start, end);
    expect(client.queryDailyAdData).toHaveBeenCalledWith(start, end);
    expect(client.queryDailyAssetData).toHaveBeenCalledWith(start, end);
    expect(client.queryDailyKeywordData).toHaveBeenCalledWith(start, end);
    expect(client.queryClickMap.mock.calls.map(([d]) => (d as Date).toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);

    expect(queries.upsertDailyAdGroups).toHaveBeenCalledWith([{ date: "2026-09-01", ad_group_id: "g1" }]);
    expect(queries.upsertDailyAds).toHaveBeenCalledWith([{ date: "2026-09-01", ad_id: "a1" }]);
    expect(queries.upsertDailyAssets).toHaveBeenCalledWith([{ date: "2026-09-01", ad_id: "a1", asset_id: "s1", field_type: "HEADLINE" }]);
    expect(queries.upsertDailyKeywords).toHaveBeenCalledWith([{ date: "2026-09-01", ad_group_id: "g1", criterion_id: "k1" }]);
    expect(queries.upsertClickMap).toHaveBeenCalledWith([
      { gclid: "g-2026-09-01" },
      { gclid: "g-2026-09-02" },
      { gclid: "g-2026-09-03" },
    ]);
    expect(out).toEqual({ adGroups: 1, ads: 1, assets: 1, keywords: 1, clicks: 3, apiCalls: 7 });
  });

  it("does not touch the account, campaign, or search-term grains", async () => {
    await syncGrains(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"));
    expect(client.queryDailyAccountData).not.toHaveBeenCalled();
    expect(client.queryDailySearchTermData).not.toHaveBeenCalled();
    expect(queries.upsertDailyAccountBatch).not.toHaveBeenCalled();
    expect(queries.upsertDailySearchTerms).not.toHaveBeenCalled();
  });
});

describe("syncEntitySnapshot", () => {
  it("writes the whole snapshot in one upsert and reports the row count", async () => {
    const count = await syncEntitySnapshot();
    expect(client.queryEntitySnapshot).toHaveBeenCalledTimes(1);
    expect(queries.upsertEntitySnapshot).toHaveBeenCalledTimes(1);
    const rows = queries.upsertEntitySnapshot.mock.calls[0][0] as Array<{ resource_name: string }>;
    expect(rows.map((r) => r.resource_name)).toEqual(["customers/1/campaigns/1", "customers/1/adGroups/2"]);
    expect(count).toBe(2);
  });
});

describe("trailingGrainWindow", () => {
  it("re-syncs the trailing three days ending yesterday", () => {
    const { start, end, days } = trailingGrainWindow(new Date("2026-09-09T08:04:00Z")); // Wednesday
    expect(end.toISOString().slice(0, 10)).toBe("2026-09-08");
    expect(start.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(days).toBe(3);
  });
  it("widens to thirty days on Mondays because Google restates inside the lookback window", () => {
    const { start, end, days } = trailingGrainWindow(new Date("2026-09-07T08:04:00Z")); // Monday
    expect(end.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(start.toISOString().slice(0, 10)).toBe("2026-08-08");
    expect(days).toBe(30);
  });
});
