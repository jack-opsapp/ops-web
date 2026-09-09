import { describe, expect, it } from "vitest";
import { mapEntitySnapshot, campaignKindOf, type EntityRow } from "@/lib/ads/engine/snapshot";

const C = "customers/4454506598";

// Rows as the phase 1 sync writes them: one per Google resource, payload = the
// camelCase resource JSON from searchStream, labels resolved to names.
function rows(): EntityRow[] {
  return [
    { resource_name: `${C}/labels/1`, entity_type: "label", parent_resource_name: null, name: "engine", status: null, payload: { id: "1", name: "engine" }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/labels/2`, entity_type: "label", parent_resource_name: null, name: "role-control", status: null, payload: { id: "2", name: "role-control" }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/labels/3`, entity_type: "label", parent_resource_name: null, name: "legacy", status: null, payload: { id: "3", name: "legacy" }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/campaignBudgets/1101`, entity_type: "campaign_budget", parent_resource_name: null, name: "CORE · CA budget", status: null, payload: { resourceName: `${C}/campaignBudgets/1101`, amountMicros: "32000000", deliveryMethod: "STANDARD" }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/campaigns/11`, entity_type: "campaign", parent_resource_name: null, name: "CORE · CA", status: "ENABLED", payload: { id: "11", name: "CORE · CA", status: "ENABLED", campaignBudget: `${C}/campaignBudgets/1101`, biddingStrategyType: "MAXIMIZE_CLICKS", maximizeClicks: { cpcBidCeilingMicros: "8000000" }, labels: [`${C}/labels/1`] }, labels: ["engine"], snapshot_at: "2026-10-20T08:10:00.000Z" },
    // A legacy campaign whose payload is the whole searchStream row, not the bare resource.
    { resource_name: `${C}/campaigns/99`, entity_type: "campaign", parent_resource_name: null, name: "Old Search 2025", status: "PAUSED", payload: { campaign: { id: "99", name: "Old Search 2025", status: "PAUSED", biddingStrategyType: "TARGET_SPEND" } }, labels: [`${C}/labels/3`], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/adGroups/21`, entity_type: "ad_group", parent_resource_name: `${C}/campaigns/11`, name: "Job management", status: "ENABLED", payload: { id: "21", name: "Job management", status: "ENABLED", campaign: `${C}/campaigns/11` }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/adGroupAds/21~201`, entity_type: "ad_group_ad", parent_resource_name: `${C}/adGroups/21`, name: null, status: "ENABLED", payload: { adGroup: `${C}/adGroups/21`, status: "ENABLED", labels: [`${C}/labels/1`, `${C}/labels/2`], policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED" }, ad: { id: "201", resourceName: `${C}/ads/201`, finalUrls: ["https://try.opsapp.co/job-management"], responsiveSearchAd: { headlines: [{ text: "Job management for trades", pinnedField: "HEADLINE_1" }, { text: "No training required" }], descriptions: [{ text: "One app your crew will actually use." }], path1: "trades", path2: "jobs" } } }, labels: ["engine", "role-control"], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/adGroupCriteria/21~101`, entity_type: "ad_group_criterion", parent_resource_name: `${C}/adGroups/21`, name: "job management app", status: "ENABLED", payload: { criterionId: "101", adGroup: `${C}/adGroups/21`, status: "ENABLED", negative: false, type: "KEYWORD", keyword: { text: "job management app", matchType: "PHRASE" } }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/campaignCriteria/11~7001`, entity_type: "campaign_criterion", parent_resource_name: `${C}/campaigns/11`, name: "servicetitan", status: null, payload: { campaign: `${C}/campaigns/11`, criterionId: "7001", negative: true, keyword: { text: "servicetitan", matchType: "BROAD" } }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/sharedSets/501`, entity_type: "shared_set", parent_resource_name: null, name: "NEG · Job seekers", status: "ENABLED", payload: { id: "501", name: "NEG · Job seekers", type: "NEGATIVE_KEYWORDS", status: "ENABLED" }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/sharedCriteria/501~1`, entity_type: "shared_criterion", parent_resource_name: `${C}/sharedSets/501`, name: "jobs", status: null, payload: { sharedSet: `${C}/sharedSets/501`, criterionId: "1", keyword: { text: "jobs", matchType: "BROAD" } }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
    { resource_name: `${C}/campaignSharedSets/11~501`, entity_type: "campaign_shared_set", parent_resource_name: `${C}/campaigns/11`, name: null, status: null, payload: { campaign: `${C}/campaigns/11`, sharedSet: `${C}/sharedSets/501` }, labels: [], snapshot_at: "2026-10-20T08:10:00.000Z" },
  ];
}

describe("mapEntitySnapshot", () => {
  it("normalises campaigns with their budget, bidding and kind", () => {
    const snapshot = mapEntitySnapshot(rows());
    expect(snapshot.snapshotAt).toBe("2026-10-20T08:10:00.000Z");
    const core = snapshot.campaigns.find((c) => c.id === "11")!;
    expect(core).toMatchObject({
      name: "CORE · CA",
      status: "ENABLED",
      kind: "core",
      labels: ["engine"],
      budgetResourceName: `${C}/campaignBudgets/1101`,
      dailyBudget: 32,
      biddingStrategy: "MAXIMIZE_CLICKS",
      cpcCeiling: 8,
      targetCpa: null,
    });
    const legacy = snapshot.campaigns.find((c) => c.id === "99")!;
    expect(legacy).toMatchObject({
      kind: "legacy",
      labels: ["legacy"],
      dailyBudget: null,
      biddingStrategy: "OTHER",
    });
  });

  it("resolves ad roles from labels and lifts RSA assets, pins and paths", () => {
    const snapshot = mapEntitySnapshot(rows());
    const ad = snapshot.ads[0];
    expect(ad).toMatchObject({
      resourceName: `${C}/adGroupAds/21~201`,
      id: "201",
      adGroupResourceName: `${C}/adGroups/21`,
      status: "ENABLED",
      role: "control",
      approvalStatus: "APPROVED",
      reviewStatus: "REVIEWED",
      finalUrls: ["https://try.opsapp.co/job-management"],
      path1: "trades",
      path2: "jobs",
    });
    expect(ad.headlines[0]).toEqual({ text: "Job management for trades", pinnedField: "HEADLINE_1" });
    expect(ad.headlines[1]).toEqual({ text: "No training required" });
    expect(snapshot.adGroups[0].finalUrl).toBe("https://try.opsapp.co/job-management");
  });

  it("separates keywords, campaign negatives and shared negative lists with their attachments", () => {
    const snapshot = mapEntitySnapshot(rows());
    expect(snapshot.keywords).toEqual([
      {
        resourceName: `${C}/adGroupCriteria/21~101`,
        criterionId: "101",
        adGroupResourceName: `${C}/adGroups/21`,
        text: "job management app",
        matchType: "PHRASE",
        status: "ENABLED",
        negative: false,
      },
    ]);
    expect(snapshot.campaignNegatives).toEqual([
      { resourceName: `${C}/campaignCriteria/11~7001`, campaignResourceName: `${C}/campaigns/11`, text: "servicetitan", matchType: "BROAD" },
    ]);
    expect(snapshot.sharedSets).toEqual([
      {
        resourceName: `${C}/sharedSets/501`,
        id: "501",
        name: "NEG · Job seekers",
        type: "NEGATIVE_KEYWORDS",
        members: [{ resourceName: `${C}/sharedCriteria/501~1`, text: "jobs", matchType: "BROAD" }],
        campaignResourceNames: [`${C}/campaigns/11`],
      },
    ]);
    expect(snapshot.labels.map((l) => l.name)).toEqual(["engine", "role-control", "legacy"]);
  });

  it("infers the entity type from the resource name when the stored type is unfamiliar", () => {
    const [budget] = mapEntitySnapshot(
      rows().map((row) => ({ ...row, entity_type: "unknown" }))
    ).campaigns.map((c) => c.dailyBudget);
    expect(budget).toBe(32);
  });

  it("classifies campaign kinds by label first, then by name", () => {
    expect(campaignKindOf("BRAND · CA", ["engine"])).toBe("brand");
    expect(campaignKindOf("Core · CA", ["engine"])).toBe("core");
    expect(campaignKindOf("COMPETITOR · CA", [])).toBe("competitor");
    expect(campaignKindOf("BRAND · CA", ["legacy"])).toBe("legacy");
    expect(campaignKindOf("Search - Bubble 2024", [])).toBe("other");
  });
});
