import { describe, expect, it } from "vitest";
import {
  aggregateMetrics,
  metricWindows,
  type DailyRows,
} from "@/lib/ads/engine/metrics";

const NOW = new Date("2026-10-20T15:05:00.000Z");

function rowsFixture(): DailyRows {
  return {
    campaigns: [
      { date: "2026-10-16", campaign_name: "CORE · CA", campaign_status: "ENABLED", spend: 30, clicks: 10, impressions: 400, conversions: 1 },
      { date: "2026-10-17", campaign_name: "CORE · CA", campaign_status: "ENABLED", spend: 32, clicks: 12, impressions: 420, conversions: 0 },
      // Inside the trailing three days: excluded from every window.
      { date: "2026-10-19", campaign_name: "CORE · CA", campaign_status: "ENABLED", spend: 99, clicks: 99, impressions: 9999, conversions: 9 },
    ],
    adGroups: [
      { date: "2026-10-17", campaign_id: "11", ad_group_id: "21", spend: 20, clicks: 8, impressions: 300, conversions: 0 },
    ],
    ads: [
      { date: "2026-09-01", ad_group_id: "21", ad_id: "201", status: "ENABLED", approval_status: "APPROVED", ad_strength: "GOOD", spend: 1, clicks: 1, impressions: 10, conversions: 0 },
      { date: "2026-10-16", ad_group_id: "21", ad_id: "201", status: "ENABLED", approval_status: "APPROVED", ad_strength: "GOOD", spend: 10, clicks: 4, impressions: 200, conversions: 1 },
      { date: "2026-10-17", ad_group_id: "21", ad_id: "201", status: "ENABLED", approval_status: "APPROVED", ad_strength: "EXCELLENT", spend: 12, clicks: 6, impressions: 200, conversions: 0 },
    ],
    keywords: [
      { date: "2026-09-05", ad_group_id: "21", criterion_id: "101", keyword: "job management app", match_type: "PHRASE", quality_score: 6, spend: 2, clicks: 1, impressions: 20, conversions: 0 },
      { date: "2026-10-17", ad_group_id: "21", criterion_id: "101", keyword: "job management app", match_type: "PHRASE", quality_score: 7, spend: 9, clicks: 3, impressions: 90, conversions: 0 },
    ],
    searchTerms: [
      { date: "2026-10-17", search_term: "Job Management Jobs", campaign_name: "CORE · CA", ad_group_name: "Job management", spend: 4.5, clicks: 1, impressions: 15, conversions: 0 },
      { date: "2026-10-16", search_term: "job management jobs", campaign_name: "CORE · CA", ad_group_name: "Job management", spend: 4.5, clicks: 1, impressions: 15, conversions: 0 },
    ],
    assets: [
      { date: "2026-10-17", ad_id: "201", asset_id: "9001", field_type: "HEADLINE", performance_label: "BEST", pinned_field: "HEADLINE_1", text: "Job management for trades", impressions: 150, clicks: 5, conversions: 0 },
    ],
  };
}

describe("metricWindows", () => {
  it("excludes the trailing three days from both windows", () => {
    expect(metricWindows(NOW)).toEqual({
      metrics7d: { from: "2026-10-11", to: "2026-10-17" },
      metrics28d: { from: "2026-09-20", to: "2026-10-17" },
    });
  });
});

describe("aggregateMetrics", () => {
  it("sums each grain inside the window and drops rows outside it", () => {
    const window = aggregateMetrics(rowsFixture(), { from: "2026-09-20", to: "2026-10-17" });
    expect(window.campaigns).toEqual([
      { campaignId: null, campaignName: "CORE · CA", clicks: 22, impressions: 820, spend: 62, conversions: 1, days: 2 },
    ]);
    expect(window.adGroups).toEqual([
      { adGroupId: "21", campaignId: "11", clicks: 8, impressions: 300, spend: 20, conversions: 0 },
    ]);
    expect(window.ads).toEqual([
      {
        adId: "201",
        adGroupId: "21",
        clicks: 10,
        impressions: 400,
        spend: 22,
        conversions: 1,
        ctr: 0.025,
        approvalStatus: "APPROVED",
        adStrength: "EXCELLENT",
        firstSeen: "2026-09-01",
        days: 2,
      },
    ]);
    expect(window.keywords).toEqual([
      {
        criterionId: "101",
        adGroupId: "21",
        text: "job management app",
        matchType: "PHRASE",
        clicks: 3,
        impressions: 90,
        spend: 9,
        conversions: 0,
        qualityScore: 7,
        firstSeen: "2026-09-05",
        days: 1,
      },
    ]);
  });

  it("folds search terms case-insensitively and keeps assets with their labels", () => {
    const window = aggregateMetrics(rowsFixture(), { from: "2026-09-20", to: "2026-10-17" });
    expect(window.searchTerms).toEqual([
      { term: "job management jobs", campaignName: "CORE · CA", adGroupName: "Job management", clicks: 2, impressions: 30, spend: 9, conversions: 0 },
    ]);
    expect(window.assets).toEqual([
      { adId: "201", assetId: "9001", fieldType: "HEADLINE", text: "Job management for trades", performanceLabel: "BEST", pinnedField: "HEADLINE_1", impressions: 150, clicks: 5 },
    ]);
  });

  it("resolves campaign ids through the snapshot names when given", () => {
    const window = aggregateMetrics(
      rowsFixture(),
      { from: "2026-09-20", to: "2026-10-17" },
      { campaignIdsByName: new Map([["CORE · CA", "11"]]) }
    );
    expect(window.campaigns[0].campaignId).toBe("11");
  });
});
