/**
 * A small, coherent live account: the three engine campaigns from the P2
 * blueprint plus one paused legacy campaign, with enough metrics and ledger
 * history to exercise every validator rule in both directions.
 */
import type {
  ChangeRecord,
  EngineSettings,
  EntitySnapshot,
  MetricsWindow,
  TestRecord,
  ValidationContext,
} from "@/lib/ads/engine/types";

export const NOW = new Date("2026-10-20T15:05:00.000Z");
const C = "customers/4454506598";

export const R = {
  core: `${C}/campaigns/11`,
  brand: `${C}/campaigns/12`,
  competitor: `${C}/campaigns/13`,
  legacy: `${C}/campaigns/99`,
  coreBudget: `${C}/campaignBudgets/1101`,
  brandBudget: `${C}/campaignBudgets/1201`,
  competitorBudget: `${C}/campaignBudgets/1301`,
  jobManagement: `${C}/adGroups/21`,
  crewScheduling: `${C}/adGroups/22`,
  quotesInvoices: `${C}/adGroups/23`,
  jobberAlternative: `${C}/adGroups/31`,
  brandGroup: `${C}/adGroups/41`,
  legacyGroup: `${C}/adGroups/91`,
  jmControl: `${C}/adGroupAds/21~201`,
  jmChallenger: `${C}/adGroupAds/21~202`,
  csControl: `${C}/adGroupAds/22~203`,
  jaControl: `${C}/adGroupAds/31~204`,
  jaChallenger: `${C}/adGroupAds/31~205`,
  brandControl: `${C}/adGroupAds/41~206`,
  brandChallenger: `${C}/adGroupAds/41~207`,
  pausedAd: `${C}/adGroupAds/21~208`,
  kwJobManagementApp: `${C}/adGroupCriteria/21~101`,
  kwCrewSchedulingApp: `${C}/adGroupCriteria/22~102`,
  kwLegacy: `${C}/adGroupCriteria/91~901`,
  negJobSeekers: `${C}/sharedSets/501`,
  negHomeowner: `${C}/sharedSets/502`,
} as const;

function rsa(finalUrl: string, pins = true) {
  return {
    finalUrls: [finalUrl],
    headlines: [
      { text: "Job management for trades", pinnedField: pins ? ("HEADLINE_1" as const) : undefined },
      { text: "Your crew opens it and goes", pinnedField: pins ? ("HEADLINE_1" as const) : undefined },
      { text: "No training required" },
      { text: "Built by trades, for trades" },
      { text: "Every feature, every tier" },
      { text: "Free to start" },
      { text: "Works offline in the field" },
      { text: "Schedule the whole crew" },
      { text: "Quotes and invoices in one" },
    ],
    descriptions: [
      { text: "One app your crew will actually use. No manual, no training." },
      { text: "Free to start. No credit card. Every feature on every tier." },
      { text: "Schedule jobs, track the crew and send invoices from the truck." },
    ],
    path1: "trades",
    path2: "jobs",
  };
}

export function snapshot(): EntitySnapshot {
  return {
    snapshotAt: "2026-10-20T08:10:00.000Z",
    campaigns: [
      {
        resourceName: R.core,
        id: "11",
        name: "CORE · CA",
        status: "ENABLED",
        labels: ["engine"],
        kind: "core",
        budgetResourceName: R.coreBudget,
        dailyBudget: 32,
        biddingStrategy: "MAXIMIZE_CLICKS",
        cpcCeiling: 8,
        targetCpa: null,
      },
      {
        resourceName: R.brand,
        id: "12",
        name: "BRAND · CA",
        status: "ENABLED",
        labels: ["engine"],
        kind: "brand",
        budgetResourceName: R.brandBudget,
        dailyBudget: 3,
        biddingStrategy: "MANUAL_CPC",
        cpcCeiling: 2,
        targetCpa: null,
      },
      {
        resourceName: R.competitor,
        id: "13",
        name: "COMPETITOR · CA",
        status: "ENABLED",
        labels: ["engine"],
        kind: "competitor",
        budgetResourceName: R.competitorBudget,
        dailyBudget: 15,
        biddingStrategy: "MAXIMIZE_CLICKS",
        cpcCeiling: 10,
        targetCpa: null,
      },
      {
        resourceName: R.legacy,
        id: "99",
        name: "Old Search 2025",
        status: "PAUSED",
        labels: ["legacy"],
        kind: "legacy",
        budgetResourceName: `${C}/campaignBudgets/9901`,
        dailyBudget: 20,
        biddingStrategy: "OTHER",
        cpcCeiling: null,
        targetCpa: null,
      },
    ],
    adGroups: [
      { resourceName: R.jobManagement, id: "21", name: "Job management", campaignResourceName: R.core, status: "ENABLED", labels: [], finalUrl: "https://try.opsapp.co/job-management" },
      { resourceName: R.crewScheduling, id: "22", name: "Crew scheduling", campaignResourceName: R.core, status: "ENABLED", labels: [], finalUrl: "https://try.opsapp.co/scheduling" },
      { resourceName: R.quotesInvoices, id: "23", name: "Quotes & invoices", campaignResourceName: R.core, status: "ENABLED", labels: [], finalUrl: "https://try.opsapp.co/quotes-invoices" },
      { resourceName: R.jobberAlternative, id: "31", name: "Jobber alternative", campaignResourceName: R.competitor, status: "ENABLED", labels: [], finalUrl: "https://try.opsapp.co/compare/jobber" },
      { resourceName: R.brandGroup, id: "41", name: "Brand", campaignResourceName: R.brand, status: "ENABLED", labels: [], finalUrl: "https://try.opsapp.co/" },
      { resourceName: R.legacyGroup, id: "91", name: "Legacy group", campaignResourceName: R.legacy, status: "PAUSED", labels: [], finalUrl: "https://opsapp.co/plans" },
    ],
    ads: [
      { resourceName: R.jmControl, id: "201", adGroupResourceName: R.jobManagement, status: "ENABLED", labels: ["engine", "gen-p2", "role-control"], role: "control", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/job-management") },
      { resourceName: R.jmChallenger, id: "202", adGroupResourceName: R.jobManagement, status: "ENABLED", labels: ["engine", "gen-p2", "role-challenger"], role: "challenger", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/job-management") },
      { resourceName: R.csControl, id: "203", adGroupResourceName: R.crewScheduling, status: "ENABLED", labels: ["engine", "gen-p2", "role-control"], role: "control", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/scheduling") },
      { resourceName: R.jaControl, id: "204", adGroupResourceName: R.jobberAlternative, status: "ENABLED", labels: ["engine", "gen-p2", "role-control"], role: "control", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/compare/jobber") },
      { resourceName: R.jaChallenger, id: "205", adGroupResourceName: R.jobberAlternative, status: "ENABLED", labels: ["engine", "gen-r7", "role-challenger"], role: "challenger", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/compare/jobber") },
      { resourceName: R.brandControl, id: "206", adGroupResourceName: R.brandGroup, status: "ENABLED", labels: ["engine", "gen-p2", "role-control"], role: "control", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/") },
      { resourceName: R.brandChallenger, id: "207", adGroupResourceName: R.brandGroup, status: "ENABLED", labels: ["engine", "gen-r3", "role-challenger"], role: "challenger", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/") },
      { resourceName: R.pausedAd, id: "208", adGroupResourceName: R.jobManagement, status: "PAUSED", labels: ["engine", "gen-p1", "role-challenger"], role: "challenger", approvalStatus: "APPROVED", reviewStatus: "REVIEWED", ...rsa("https://try.opsapp.co/job-management") },
    ],
    keywords: [
      { resourceName: R.kwJobManagementApp, criterionId: "101", adGroupResourceName: R.jobManagement, text: "job management app", matchType: "PHRASE", status: "ENABLED", negative: false },
      { resourceName: R.kwCrewSchedulingApp, criterionId: "102", adGroupResourceName: R.crewScheduling, text: "crew scheduling app", matchType: "PHRASE", status: "ENABLED", negative: false },
      { resourceName: R.kwLegacy, criterionId: "901", adGroupResourceName: R.legacyGroup, text: "field service software", matchType: "BROAD", status: "PAUSED", negative: false },
    ],
    sharedSets: [
      {
        resourceName: R.negJobSeekers,
        id: "501",
        name: "NEG · Job seekers",
        type: "NEGATIVE_KEYWORDS",
        members: [
          { resourceName: `${C}/sharedCriteria/501~1`, text: "jobs", matchType: "BROAD" },
          { resourceName: `${C}/sharedCriteria/501~2`, text: "hiring", matchType: "BROAD" },
        ],
        campaignResourceNames: [R.core, R.brand, R.competitor],
      },
      {
        resourceName: R.negHomeowner,
        id: "502",
        name: "NEG · Homeowner intent",
        type: "NEGATIVE_KEYWORDS",
        members: [{ resourceName: `${C}/sharedCriteria/502~1`, text: "near me", matchType: "PHRASE" }],
        campaignResourceNames: [R.core, R.brand, R.competitor],
      },
    ],
    campaignNegatives: [],
    labels: [
      { resourceName: `${C}/labels/1`, name: "engine" },
      { resourceName: `${C}/labels/2`, name: "legacy" },
      { resourceName: `${C}/labels/3`, name: "role-control" },
      { resourceName: `${C}/labels/4`, name: "role-challenger" },
    ],
  };
}

export function metrics28d(): MetricsWindow {
  return {
    from: "2026-09-20",
    to: "2026-10-17",
    campaigns: [
      { campaignId: "11", campaignName: "CORE · CA", clicks: 280, impressions: 9000, spend: 620, conversions: 2, budgetLostDays: 0, days: 28 },
      { campaignId: "12", campaignName: "BRAND · CA", clicks: 40, impressions: 500, spend: 40, conversions: 1, budgetLostDays: 0, days: 28 },
      { campaignId: "13", campaignName: "COMPETITOR · CA", clicks: 90, impressions: 2100, spend: 300, conversions: 0, budgetLostDays: 4, days: 28 },
    ],
    adGroups: [],
    ads: [
      { adId: "201", adGroupId: "21", clicks: 120, impressions: 4200, spend: 300, conversions: 1, ctr: 120 / 4200, approvalStatus: "APPROVED", adStrength: "GOOD", days: 28 },
      { adId: "202", adGroupId: "21", clicks: 160, impressions: 4300, spend: 320, conversions: 1, ctr: 160 / 4300, approvalStatus: "APPROVED", adStrength: "GOOD", days: 28 },
    ],
    keywords: [
      { criterionId: "101", adGroupId: "21", text: "job management app", matchType: "PHRASE", clicks: 40, impressions: 1500, spend: 180, conversions: 0, qualityScore: 6, firstSeen: "2026-09-05", days: 28 },
      { criterionId: "102", adGroupId: "22", text: "crew scheduling app", matchType: "PHRASE", clicks: 10, impressions: 400, spend: 30, conversions: 0, qualityScore: 7, firstSeen: "2026-10-10", days: 8 },
    ],
    searchTerms: [
      { term: "job management jobs", campaignName: "CORE · CA", adGroupName: "Job management", clicks: 4, impressions: 60, spend: 18, conversions: 0 },
      { term: "job management software", campaignName: "CORE · CA", adGroupName: "Job management", clicks: 12, impressions: 200, spend: 60, conversions: 1 },
      { term: "job management course", campaignName: "CORE · CA", adGroupName: "Job management", clicks: 3, impressions: 40, spend: 12, conversions: 0 },
    ],
    assets: [],
  };
}

export function tests(): TestRecord[] {
  return [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", campaign_id: "11", ad_group_id: "21", ad_group_name: "Job management", control_ad_id: "201", challenger_ad_id: "202", started_at: "2026-09-15T15:00:00.000Z", min_days: 14, min_impressions: 2000, max_days: 56, state: "challenger_won", stats: { p: 0.01 }, verdict_at: "2026-10-18T15:00:00.000Z" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", campaign_id: "13", ad_group_id: "31", ad_group_name: "Jobber alternative", control_ad_id: "204", challenger_ad_id: "205", started_at: "2026-10-12T15:00:00.000Z", min_days: 14, min_impressions: 2000, max_days: 56, state: "running", stats: null, verdict_at: null },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", campaign_id: "12", ad_group_id: "41", ad_group_name: "Brand", control_ad_id: "206", challenger_ad_id: "207", started_at: "2026-08-01T15:00:00.000Z", min_days: 14, min_impressions: 2000, max_days: 56, state: "control_won", stats: { p: 0.02 }, verdict_at: "2026-09-01T15:00:00.000Z" },
  ];
}

export function ledger(): ChangeRecord[] {
  return [
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", proposal_id: "pppppppp-pppp-4ppp-8ppp-ppppppppppp1", kind: "adjust_budget", campaign_id: "13", ad_group_id: null, resource_names: [R.competitorBudget], before: { dailyBudget: 13 }, after: { dailyBudget: 15 }, applied_at: "2026-10-15T16:00:00.000Z", measure_from: "2026-10-16", measure_to: "2026-10-30", pre_metrics: null, post_metrics: null, verdict: "pending", verdict_at: null },
    { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", proposal_id: "pppppppp-pppp-4ppp-8ppp-ppppppppppp2", kind: "adjust_cpc_cap", campaign_id: "11", ad_group_id: null, resource_names: [R.core], before: { cpcCeiling: 7 }, after: { cpcCeiling: 8 }, applied_at: "2026-09-20T16:00:00.000Z", measure_from: "2026-09-21", measure_to: "2026-10-05", pre_metrics: { ctr: 0.03 }, post_metrics: { ctr: 0.034 }, verdict: "better", verdict_at: "2026-10-09T15:00:00.000Z" },
  ];
}

export function settings(overrides: Partial<EngineSettings> = {}): EngineSettings {
  return {
    modes: {
      add_negatives: "propose",
      pause_keyword: "propose",
      add_keywords: "propose",
      create_rsa_challenger: "propose",
      promote_challenger: "propose",
      pause_ad: "propose",
      adjust_budget: "propose",
      adjust_cpc_cap: "propose",
      set_bidding_strategy: "propose",
      add_ad_group: "propose",
      observation: "propose",
    },
    monthly_cap: 1500,
    daily_cap: 60,
    max_budget_change_pct: 15,
    budget_cooldown_days: 14,
    max_structural_per_run: 3,
    lease_minutes: 40,
    stall_hours: 50,
    target_cost_per_trial: 150,
    heartbeat_at: "2026-10-19T15:00:00.000Z",
    ...overrides,
  };
}

export const ALLOWED_URLS = [
  "https://try.opsapp.co/",
  "https://try.opsapp.co/job-management",
  "https://try.opsapp.co/scheduling",
  "https://try.opsapp.co/quotes-invoices",
  "https://try.opsapp.co/compare/jobber",
  "https://try.opsapp.co/compare/housecall-pro",
];

export function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    settings: settings(),
    snapshot: snapshot(),
    metrics28d: metrics28d(),
    tests: tests(),
    ledger: ledger(),
    openProposals: [],
    funnel: {
      trialStartsLast30: 2,
      trialStartsPrev30: 1,
      monthToDateSpend: 400,
      daysLeftInMonth: 10,
    },
    allowedFinalUrls: ALLOWED_URLS,
    structuralAcceptedThisRun: 0,
    now: NOW,
    ...overrides,
  };
}

export function goodRsa(finalUrl = "https://try.opsapp.co/scheduling") {
  return {
    headlines: [
      { text: "Crew scheduling for trades", pinnedField: "HEADLINE_1" },
      { text: "Every crew knows where to be", pinnedField: "HEADLINE_1" },
      { text: "No training required" },
      { text: "Built by trades, for trades" },
      { text: "Every feature, every tier" },
      { text: "Free to start" },
      { text: "Works offline in the field" },
      { text: "Dispatch from the truck" },
      { text: "Quotes and invoices in one" },
    ],
    descriptions: [
      { text: "One app your crew will actually use. No manual, no training." },
      { text: "Free to start. No credit card. Every feature on every tier." },
      { text: "Schedule jobs, track the crew and send invoices from the truck." },
    ],
    path1: "crews",
    path2: "schedule",
    final_url: finalUrl,
  };
}
