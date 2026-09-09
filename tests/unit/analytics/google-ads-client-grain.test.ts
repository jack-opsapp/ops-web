/**
 * The grain report queries: GAQL shape (one segments.date per click_view
 * query, no pageSize) and the mapping from Google's camelCase rows to the
 * warehouse row shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { getAccessToken: async () => ({ token: "t" }) };
    }
  },
}));

const MANAGER_ID = "5448339076";
const CLIENT_ID = "4454506598";
interface Recorded { url: string; body: { query?: string } }
let requests: Recorded[];

function install(answers: (query: string) => unknown[]) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push({ url: String(url), body });
      const query = String(body.query ?? "");
      const isDiscovery = query.includes("FROM customer_client");
      const payload = isDiscovery
        ? {
            results: [
              { customerClient: { id: MANAGER_ID, level: "0", manager: true, status: "ENABLED" } },
              { customerClient: { id: CLIENT_ID, level: "1", manager: false, status: "ENABLED" } },
            ],
          }
        : [{ results: answers(query) }];
      return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
    })
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "dev");
  vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID", MANAGER_ID);
  vi.stubEnv("FIREBASE_ADMIN_SERVICE_ACCOUNT", JSON.stringify({ client_email: "t@t", private_key: "k" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const importClient = () => import("@/lib/analytics/google-ads-client");
const lastQuery = () => String(requests[requests.length - 1].body.query);

describe("grain queries", () => {
  it("queryClickMap filters to exactly one segments.date and maps ids out of resource names", async () => {
    install(() => [
      {
        clickView: {
          gclid: "Cj0K",
          adGroupAd: `customers/${CLIENT_ID}/adGroupAds/111~222`,
          keyword: `customers/${CLIENT_ID}/adGroupCriteria/111~333`,
          keywordInfo: { text: "jobber alternative", matchType: "PHRASE" },
        },
        campaign: { id: "999" },
        adGroup: { id: "111" },
        segments: { date: "2026-09-01" },
      },
    ]);
    const c = await importClient();
    const rows = await c.queryClickMap(new Date("2026-09-01T00:00:00Z"));
    expect(lastQuery()).toMatch(/FROM click_view/);
    expect(lastQuery().match(/segments\.date = '2026-09-01'/g)).toHaveLength(1);
    expect(lastQuery()).not.toMatch(/BETWEEN|>=|<=/);
    expect(rows).toEqual([
      { gclid: "Cj0K", click_date: "2026-09-01", campaign_id: "999", ad_group_id: "111", ad_id: "222", criterion_id: "333", keyword: "jobber alternative" },
    ]);
  });

  it("queryDailyKeywordData maps the ad-group + criterion grain with quality score and average cpc", async () => {
    install(() => [
      {
        segments: { date: "2026-09-02" },
        campaign: { id: "9", name: "Jobber alt" },
        adGroup: { id: "1", name: "jobber" },
        adGroupCriterion: { criterionId: "7", keyword: { text: "jobber alternative", matchType: "PHRASE" }, status: "ENABLED", qualityInfo: { qualityScore: 7 } },
        metrics: { costMicros: "1500000", clicks: "2", impressions: "40", conversions: 0, averageCpc: "750000" },
      },
    ]);
    const c = await importClient();
    const rows = await c.queryDailyKeywordData(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-02T00:00:00Z"));
    expect(lastQuery()).toMatch(/FROM keyword_view/);
    expect(lastQuery()).toMatch(/ad_group_criterion\.criterion_id/);
    expect(rows).toEqual([
      { date: "2026-09-02", campaign_id: "9", campaign_name: "Jobber alt", ad_group_id: "1", ad_group_name: "jobber", criterion_id: "7", keyword: "jobber alternative", match_type: "PHRASE", status: "ENABLED", quality_score: 7, spend: 1.5, clicks: 2, impressions: 40, conversions: 0, average_cpc: 0.75 },
    ]);
  });

  it("queryDailyAdData carries ad strength, policy verdicts, and the first final url", async () => {
    install(() => [
      {
        segments: { date: "2026-09-02" },
        adGroup: { id: "1" },
        adGroupAd: { status: "ENABLED", adStrength: "GOOD", policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED" }, ad: { id: "22", type: "RESPONSIVE_SEARCH_AD", finalUrls: ["https://try.opsapp.co/job-management", "https://x"] } },
        metrics: { costMicros: "2000000", clicks: "3", impressions: "100", conversions: 1, ctr: 0.03 },
      },
    ]);
    const c = await importClient();
    const rows = await c.queryDailyAdData(new Date("2026-09-02T00:00:00Z"), new Date("2026-09-02T00:00:00Z"));
    expect(lastQuery()).toMatch(/FROM ad_group_ad/);
    expect(rows).toEqual([
      { date: "2026-09-02", ad_group_id: "1", ad_id: "22", ad_type: "RESPONSIVE_SEARCH_AD", status: "ENABLED", ad_strength: "GOOD", approval_status: "APPROVED", review_status: "REVIEWED", final_url: "https://try.opsapp.co/job-management", spend: 2, clicks: 3, impressions: 100, conversions: 1, ctr: 0.03 },
    ]);
  });

  it("queryDailyAssetData maps the RSA asset grain from ad_group_ad_asset_view", async () => {
    install(() => [
      {
        segments: { date: "2026-09-02" },
        adGroupAdAssetView: { adGroupAd: `customers/${CLIENT_ID}/adGroupAds/1~22`, asset: `customers/${CLIENT_ID}/assets/55`, fieldType: "HEADLINE", performanceLabel: "BEST", pinnedField: "HEADLINE_1" },
        asset: { id: "55", textAsset: { text: "Job management your crew will use" } },
        metrics: { impressions: "80", clicks: "4", conversions: 0 },
      },
    ]);
    const c = await importClient();
    const rows = await c.queryDailyAssetData(new Date("2026-09-02T00:00:00Z"), new Date("2026-09-02T00:00:00Z"));
    expect(lastQuery()).toMatch(/FROM ad_group_ad_asset_view/);
    expect(rows).toEqual([
      { date: "2026-09-02", ad_id: "22", asset_id: "55", field_type: "HEADLINE", performance_label: "BEST", pinned_field: "HEADLINE_1", text: "Job management your crew will use", impressions: 80, clicks: 4, conversions: 0 },
    ]);
  });

  it("queryDailyAdGroupData maps the ad-group grain", async () => {
    install(() => [
      {
        segments: { date: "2026-09-02" },
        campaign: { id: "9", name: "Jobber alt" },
        adGroup: { id: "1", name: "jobber", status: "ENABLED" },
        metrics: { costMicros: "3000000", clicks: "6", impressions: "200", conversions: 0, ctr: 0.03 },
      },
    ]);
    const c = await importClient();
    const rows = await c.queryDailyAdGroupData(new Date("2026-09-02T00:00:00Z"), new Date("2026-09-02T00:00:00Z"));
    expect(lastQuery()).toMatch(/FROM ad_group\b/);
    expect(rows).toEqual([
      { date: "2026-09-02", campaign_id: "9", campaign_name: "Jobber alt", ad_group_id: "1", ad_group_name: "jobber", status: "ENABLED", spend: 3, clicks: 6, impressions: 200, conversions: 0, ctr: 0.03 },
    ]);
  });

  it("queryEntitySnapshot walks every structural resource and keys rows by resource name", async () => {
    install((query) => {
      if (/FROM campaign_budget/.test(query)) return [{ campaignBudget: { resourceName: "customers/1/campaignBudgets/5", name: "B", amountMicros: "1000000", status: "ENABLED" } }];
      if (/FROM campaign_shared_set/.test(query)) return [{ campaignSharedSet: { resourceName: "customers/1/campaignSharedSets/9~4", campaign: "customers/1/campaigns/9", sharedSet: "customers/1/sharedSets/4", status: "ENABLED" } }];
      if (/FROM campaign\b/.test(query)) return [{ campaign: { resourceName: "customers/1/campaigns/9", id: "9", name: "Jobber alt", status: "PAUSED", campaignBudget: "customers/1/campaignBudgets/5" } }];
      if (/FROM ad_group_ad\b/.test(query)) return [{ adGroupAd: { resourceName: "customers/1/adGroupAds/1~22", status: "ENABLED", adGroup: "customers/1/adGroups/1", ad: { id: "22", responsiveSearchAd: { headlines: [{ text: "H", pinnedField: "HEADLINE_1" }] } }, labels: ["customers/1/labels/3"] } }];
      if (/FROM ad_group_criterion/.test(query)) return [{ adGroupCriterion: { resourceName: "customers/1/adGroupCriteria/1~7", adGroup: "customers/1/adGroups/1", status: "ENABLED", negative: false, keyword: { text: "jobber alternative", matchType: "PHRASE" } } }];
      if (/FROM ad_group\b/.test(query)) return [{ adGroup: { resourceName: "customers/1/adGroups/1", id: "1", name: "jobber", status: "ENABLED", campaign: "customers/1/campaigns/9" } }];
      if (/FROM campaign_criterion/.test(query)) return [{ campaignCriterion: { resourceName: "customers/1/campaignCriteria/9~8", campaign: "customers/1/campaigns/9", negative: true, keyword: { text: "free", matchType: "BROAD" } } }];
      if (/FROM shared_set/.test(query)) return [{ sharedSet: { resourceName: "customers/1/sharedSets/4", name: "Competitors", type: "NEGATIVE_KEYWORDS", status: "ENABLED" } }];
      if (/FROM shared_criterion/.test(query)) return [{ sharedCriterion: { resourceName: "customers/1/sharedCriteria/4~2", sharedSet: "customers/1/sharedSets/4", keyword: { text: "jobber", matchType: "BROAD" } } }];
      if (/FROM label/.test(query)) return [{ label: { resourceName: "customers/1/labels/3", name: "engine", status: "ENABLED" } }];
      return [];
    });
    const c = await importClient();
    const rows = await c.queryEntitySnapshot();
    const byName = Object.fromEntries(rows.map((r) => [r.resource_name, r]));
    expect(Object.keys(byName).sort()).toEqual([
      "customers/1/adGroupAds/1~22",
      "customers/1/adGroupCriteria/1~7",
      "customers/1/adGroups/1",
      "customers/1/campaignBudgets/5",
      "customers/1/campaignCriteria/9~8",
      "customers/1/campaignSharedSets/9~4",
      "customers/1/campaigns/9",
      "customers/1/labels/3",
      "customers/1/sharedCriteria/4~2",
      "customers/1/sharedSets/4",
    ]);
    expect(byName["customers/1/campaigns/9"]).toMatchObject({ entity_type: "campaign", parent_resource_name: null, name: "Jobber alt", status: "PAUSED" });
    expect(byName["customers/1/adGroups/1"]).toMatchObject({ entity_type: "ad_group", parent_resource_name: "customers/1/campaigns/9" });
    expect(byName["customers/1/adGroupAds/1~22"]).toMatchObject({ entity_type: "ad", parent_resource_name: "customers/1/adGroups/1", labels: ["customers/1/labels/3"] });
    expect(byName["customers/1/adGroupCriteria/1~7"]).toMatchObject({ entity_type: "keyword", name: "jobber alternative" });
    expect(byName["customers/1/campaignCriteria/9~8"]).toMatchObject({ entity_type: "negative_keyword", parent_resource_name: "customers/1/campaigns/9", name: "free" });
    expect(byName["customers/1/sharedCriteria/4~2"]).toMatchObject({ entity_type: "shared_criterion", parent_resource_name: "customers/1/sharedSets/4" });
    expect(byName["customers/1/campaignSharedSets/9~4"]).toMatchObject({ entity_type: "campaign_shared_set", parent_resource_name: "customers/1/campaigns/9", name: "customers/1/sharedSets/4", status: "ENABLED" });
    expect(byName["customers/1/campaignSharedSets/9~4"].payload).toMatchObject({ campaignSharedSet: { sharedSet: "customers/1/sharedSets/4", campaign: "customers/1/campaigns/9" } });
    expect(byName["customers/1/labels/3"]).toMatchObject({ entity_type: "label", name: "engine" });
    expect(byName["customers/1/campaigns/9"].payload).toMatchObject({ campaign: { id: "9" } });
    for (const r of requests) expect(r.body).not.toHaveProperty("pageSize");
  });
});
