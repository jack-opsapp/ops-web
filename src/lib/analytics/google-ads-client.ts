/**
 * OPS Admin — Google Ads API Client
 *
 * SERVER ONLY. Never import from client components.
 * Data latency: near real-time (2-3 hour reporting delay for some metrics).
 *
 * Pattern: matches src/lib/analytics/ga4-client.ts (singleton, GAQL queries).
 */
import { GoogleAdsApi } from "google-ads-api";
import { unstable_cache } from "next/cache";
import type {
  AdsDayRange,
  GoogleAdsAccountSummary,
  CampaignPerformance,
  KeywordPerformance,
  SearchTermData,
  ConversionBreakdown,
  DailySpend,
} from "./google-ads-types";

// ─── Singleton client ─────────────────────────────────────────────────────────

let _client: GoogleAdsApi | null = null;

function getGoogleAdsClient(): GoogleAdsApi {
  if (_client) return _client;

  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!clientId || !clientSecret || !developerToken) {
    throw new Error(
      "Missing Google Ads env vars: GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN"
    );
  }

  _client = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken });
  return _client;
}

function getCustomer() {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!customerId || !refreshToken) {
    throw new Error("Missing Google Ads env vars: GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_REFRESH_TOKEN");
  }

  return getGoogleAdsClient().Customer({ customer_id: customerId, refresh_token: refreshToken });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DURING_MAP: Record<AdsDayRange, string> = {
  7: "LAST_7_DAYS",
  14: "LAST_14_DAYS",
  30: "LAST_30_DAYS",
};

function microsToDollars(micros: number | string | undefined): number {
  const val = typeof micros === "string" ? parseInt(micros, 10) : (micros ?? 0);
  return val / 1_000_000;
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN
  );
}

// ─── Query Functions ──────────────────────────────────────────────────────────

async function getAccountSummary(days: AdsDayRange): Promise<GoogleAdsAccountSummary> {
  const customer = getCustomer();
  const rows = await customer.query(`
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.ctr
    FROM customer
    WHERE segments.date DURING ${DURING_MAP[days]}
  `);

  if (!rows.length) {
    return { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, avgCpa: 0, avgCtr: 0 };
  }

  const row = rows[0];
  return {
    totalSpend: microsToDollars(row.metrics?.cost_micros),
    totalClicks: Number(row.metrics?.clicks ?? 0),
    totalImpressions: Number(row.metrics?.impressions ?? 0),
    totalConversions: Number(row.metrics?.conversions ?? 0),
    avgCpa: microsToDollars(row.metrics?.cost_per_conversion),
    avgCtr: Number(row.metrics?.ctr ?? 0),
  };
}

async function getCampaignPerformance(days: AdsDayRange): Promise<CampaignPerformance[]> {
  const customer = getCustomer();
  const rows = await customer.query(`
    SELECT
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date DURING ${DURING_MAP[days]}
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => ({
    name: String(row.campaign?.name ?? "Unknown"),
    status: (row.campaign?.status ?? "ENABLED") as CampaignPerformance["status"],
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    ctr: Number(row.metrics?.ctr ?? 0),
    cost: microsToDollars(row.metrics?.cost_micros),
    conversions: Number(row.metrics?.conversions ?? 0),
    cpa: microsToDollars(row.metrics?.cost_per_conversion),
  }));
}

async function getKeywordPerformance(days: AdsDayRange, limit: number = 50): Promise<KeywordPerformance[]> {
  const customer = getCustomer();
  const rows = await customer.query(`
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.historical_quality_score
    FROM keyword_view
    WHERE segments.date DURING ${DURING_MAP[days]}
    ORDER BY metrics.cost_micros DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    keyword: String(row.ad_group_criterion?.keyword?.text ?? ""),
    matchType: (row.ad_group_criterion?.keyword?.match_type ?? "BROAD") as KeywordPerformance["matchType"],
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    cost: microsToDollars(row.metrics?.cost_micros),
    conversions: Number(row.metrics?.conversions ?? 0),
    qualityScore: row.metrics?.historical_quality_score != null
      ? Number(row.metrics.historical_quality_score)
      : null,
  }));
}

async function getSearchTerms(days: AdsDayRange, limit: number = 50): Promise<SearchTermData[]> {
  const customer = getCustomer();
  const rows = await customer.query(`
    SELECT
      search_term_view.search_term,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING ${DURING_MAP[days]}
    ORDER BY metrics.impressions DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    searchTerm: String(row.search_term_view?.search_term ?? ""),
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    cost: microsToDollars(row.metrics?.cost_micros),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

async function getCostPerConversion(days: AdsDayRange): Promise<ConversionBreakdown[]> {
  const customer = getCustomer();
  const rows = await customer.query(`
    SELECT
      segments.conversion_action_name,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date DURING ${DURING_MAP[days]}
      AND segments.conversion_action_name != ''
  `);

  // Aggregate by conversion action name (multiple campaigns may contribute)
  const byAction = new Map<string, ConversionBreakdown>();
  for (const row of rows) {
    const name = String(row.segments?.conversion_action_name ?? "Unknown");
    const existing = byAction.get(name);
    if (existing) {
      existing.conversions += Number(row.metrics?.conversions ?? 0);
      existing.cost += microsToDollars(row.metrics?.cost_micros);
      existing.cpa = existing.conversions > 0 ? existing.cost / existing.conversions : 0;
    } else {
      const conversions = Number(row.metrics?.conversions ?? 0);
      const cost = microsToDollars(row.metrics?.cost_micros);
      byAction.set(name, {
        actionName: name,
        conversions,
        cost,
        cpa: conversions > 0 ? cost / conversions : 0,
      });
    }
  }

  return Array.from(byAction.values()).sort((a, b) => b.conversions - a.conversions);
}

async function getDailySpend(days: AdsDayRange): Promise<DailySpend[]> {
  const customer = getCustomer();
  const rows = await customer.query(`
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.conversions
    FROM customer
    WHERE segments.date DURING ${DURING_MAP[days]}
    ORDER BY segments.date ASC
  `);

  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    spend: microsToDollars(row.metrics?.cost_micros),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

// ─── Cached Exports (5-min TTL, matching existing admin query pattern) ────────

export const getCachedAccountSummary = unstable_cache(
  (days: AdsDayRange) => getAccountSummary(days),
  ["google-ads-account-summary"],
  { revalidate: 300 }
);

export const getCachedCampaignPerformance = unstable_cache(
  (days: AdsDayRange) => getCampaignPerformance(days),
  ["google-ads-campaigns"],
  { revalidate: 300 }
);

export const getCachedKeywordPerformance = unstable_cache(
  (days: AdsDayRange, limit?: number) => getKeywordPerformance(days, limit),
  ["google-ads-keywords"],
  { revalidate: 300 }
);

export const getCachedSearchTerms = unstable_cache(
  (days: AdsDayRange, limit?: number) => getSearchTerms(days, limit),
  ["google-ads-search-terms"],
  { revalidate: 300 }
);

export const getCachedCostPerConversion = unstable_cache(
  (days: AdsDayRange) => getCostPerConversion(days),
  ["google-ads-conversions"],
  { revalidate: 300 }
);

export const getCachedDailySpend = unstable_cache(
  (days: AdsDayRange) => getDailySpend(days),
  ["google-ads-daily-spend"],
  { revalidate: 300 }
);
