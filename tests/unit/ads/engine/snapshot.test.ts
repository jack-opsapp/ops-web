import { describe, expect, it } from "vitest";
import type { BlueprintKinds } from "@/lib/ads/engine/copy-kinds";
import { mapEntitySnapshot, type EntityRow } from "@/lib/ads/engine/snapshot";

const C = "customers/4454506598";

/** What the blueprint declares about the fixture account. */
const BLUEPRINT: BlueprintKinds = {
  campaigns: [
    { name: "CORE · CA", kind: "core", adGroups: [{ name: "Job management" }, { name: "Switching", copyKind: "competitor" }] },
    { name: "PRICING · US", kind: "competitor", adGroups: [{ name: "Jobber pricing" }] },
  ],
};

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
  it("reads the Maximize Clicks bid ceiling off target_spend, as Google sends it", () => {
    const live = rows().map((row) =>
      row.resource_name.endsWith("/campaigns/11")
        ? {
            ...row,
            payload: {
              ...(row.payload as Record<string, unknown>),
              biddingStrategyType: "TARGET_SPEND",
              maximizeClicks: undefined,
              targetSpend: { cpcBidCeilingMicros: "9000000" },
            },
          }
        : row
    );
    const campaign = mapEntitySnapshot(live, BLUEPRINT).campaigns.find((c) => c.id === "11")!;
    expect(campaign.biddingStrategy).toBe("MAXIMIZE_CLICKS");
    expect(campaign.cpcCeiling).toBe(9);
  });

  it("normalises campaigns with their budget, bidding and kind", () => {
    const snapshot = mapEntitySnapshot(rows(), BLUEPRINT);
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
      // Google names Maximize Clicks TARGET_SPEND. Reading that as OTHER is
      // how a capped campaign looked uncapped to the engine's guardrails.
      biddingStrategy: "MAXIMIZE_CLICKS",
    });
  });

  it("resolves ad roles from labels and lifts RSA assets, pins and paths", () => {
    const snapshot = mapEntitySnapshot(rows(), BLUEPRINT);
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
    const snapshot = mapEntitySnapshot(rows(), BLUEPRINT);
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
      rows().map((row) => ({ ...row, entity_type: "unknown" })),
      BLUEPRINT
    ).campaigns.map((c) => c.dailyBudget);
    expect(budget).toBe(32);
  });

  describe("campaign kinds and copy rules come from the blueprint, never from a name", () => {
    const at = "2026-10-20T08:10:00.000Z";
    // A competitor-intent campaign with no COMPETITOR prefix, and a core
    // campaign's group that bids on competitor terms and lands on a compare page.
    const account = (): EntityRow[] => [
      ...rows(),
      { resource_name: `${C}/campaigns/12`, entity_type: "campaign", parent_resource_name: null, name: "PRICING · US", status: "PAUSED", payload: { id: "12", name: "PRICING · US", status: "PAUSED", biddingStrategyType: "TARGET_SPEND" }, labels: ["engine"], snapshot_at: at },
      { resource_name: `${C}/adGroups/31`, entity_type: "ad_group", parent_resource_name: `${C}/campaigns/12`, name: "Jobber pricing", status: "ENABLED", payload: { id: "31", name: "Jobber pricing", status: "ENABLED", campaign: `${C}/campaigns/12` }, labels: [], snapshot_at: at },
      { resource_name: `${C}/adGroupAds/31~301`, entity_type: "ad_group_ad", parent_resource_name: `${C}/adGroups/31`, name: null, status: "ENABLED", payload: { adGroup: `${C}/adGroups/31`, status: "ENABLED", ad: { id: "301", finalUrls: ["https://try.opsapp.co/compare/jobber"] } }, labels: ["engine", "role-control"], snapshot_at: at },
      { resource_name: `${C}/adGroups/22`, entity_type: "ad_group", parent_resource_name: `${C}/campaigns/11`, name: "Switching", status: "ENABLED", payload: { id: "22", name: "Switching", status: "ENABLED", campaign: `${C}/campaigns/11` }, labels: [], snapshot_at: at },
      { resource_name: `${C}/adGroupAds/22~221`, entity_type: "ad_group_ad", parent_resource_name: `${C}/adGroups/22`, name: null, status: "ENABLED", payload: { adGroup: `${C}/adGroups/22`, status: "ENABLED", ad: { id: "221", finalUrls: ["https://try.opsapp.co/compare/jobber"] } }, labels: ["engine", "role-control"], snapshot_at: at },
      // Named like the old spec's competitor campaign, declared nowhere.
      { resource_name: `${C}/campaigns/13`, entity_type: "campaign", parent_resource_name: null, name: "COMPETITOR · CA", status: "PAUSED", payload: { id: "13", name: "COMPETITOR · CA", status: "PAUSED" }, labels: ["engine"], snapshot_at: at },
      { resource_name: `${C}/adGroups/33`, entity_type: "ad_group", parent_resource_name: `${C}/campaigns/13`, name: "Jobber alternative", status: "ENABLED", payload: { id: "33", name: "Jobber alternative", status: "ENABLED", campaign: `${C}/campaigns/13` }, labels: [], snapshot_at: at },
      { resource_name: `${C}/adGroupAds/33~331`, entity_type: "ad_group_ad", parent_resource_name: `${C}/adGroups/33`, name: null, status: "ENABLED", payload: { adGroup: `${C}/adGroups/33`, status: "ENABLED", ad: { id: "331", finalUrls: ["https://try.opsapp.co/compare/jobber"] } }, labels: ["engine", "role-control"], snapshot_at: at },
    ];
    const kinds = (blueprint: BlueprintKinds | null) => {
      const snapshot = mapEntitySnapshot(account(), blueprint);
      return {
        campaigns: Object.fromEntries(snapshot.campaigns.map((c) => [c.name, c.kind])),
        adGroups: Object.fromEntries(snapshot.adGroups.map((g) => [g.name, g.copyKind])),
      };
    };

    it("reads each campaign's kind and each ad group's copy rules from the blueprint", () => {
      expect(kinds(BLUEPRINT)).toEqual({
        campaigns: { "CORE · CA": "core", "Old Search 2025": "legacy", "PRICING · US": "competitor", "COMPETITOR · CA": "other" },
        adGroups: { "Job management": "core", "Jobber pricing": "competitor", Switching: "competitor", "Jobber alternative": "core" },
      });
    });

    it("grants nothing when the blueprint cannot be read: no kind, core copy everywhere, legacy still legacy", () => {
      expect(kinds(null)).toEqual({
        campaigns: { "CORE · CA": "other", "Old Search 2025": "legacy", "PRICING · US": "other", "COMPETITOR · CA": "other" },
        adGroups: { "Job management": "core", "Jobber pricing": "core", Switching: "core", "Jobber alternative": "core" },
      });
    });

    it("judges a group's copy on the page its ads actually land on", () => {
      const moved = account().map((row) =>
        row.resource_name === `${C}/adGroupAds/22~221`
          ? { ...row, payload: { ...(row.payload as Record<string, unknown>), ad: { id: "221", finalUrls: ["https://try.opsapp.co/job-management"] } } }
          : row
      );
      const switching = mapEntitySnapshot(moved, BLUEPRINT).adGroups.find((g) => g.name === "Switching")!;
      expect(switching).toMatchObject({ finalUrl: "https://try.opsapp.co/job-management", copyKind: "core" });
    });
  });
});
