/**
 * OPS Admin — Google Ads API Client (Service Account Auth)
 *
 * SERVER ONLY. Never import from client components.
 * Data latency: near real-time (2-3 hour reporting delay for some metrics).
 *
 * Auth: Firebase service account with Google Ads account access.
 * Pattern: matches src/lib/analytics/ga4-client.ts (singleton, reuses Firebase credentials).
 */
import { GoogleAuth } from "google-auth-library";
import { unstable_cache } from "next/cache";
import { parsePrivateKey } from "@/lib/firebase/parse-private-key";
import type {
  AdsDayRange,
  GoogleAdsAccountSummary,
  CampaignPerformance,
  KeywordPerformance,
  SearchTermData,
  ConversionBreakdown,
  DailySpend,
} from "./google-ads-types";

// ─── Singleton auth client ────────────────────────────────────────────────────

const ADS_API_VERSION = "v18";
const ADS_BASE_URL = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

let _auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (_auth) return _auth;

  // Support full JSON (same as GA4 client)
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson);
    _auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/adwords"],
    });
    return _auth;
  }

  // Construct from individual env vars (same as GA4 client)
  const privateKey = parsePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
    ?? `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`;

  if (!privateKey || !projectId) {
    throw new Error("Missing FIREBASE_ADMIN_PRIVATE_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID env var");
  }

  _auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ["https://www.googleapis.com/auth/adwords"],
  });

  return _auth;
}

function getCustomerId(): string {
  const id = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!id) throw new Error("Missing GOOGLE_ADS_CUSTOMER_ID env var");
  return id;
}

function getDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) throw new Error("Missing GOOGLE_ADS_DEVELOPER_TOKEN env var");
  return token;
}

// ─── REST API query helper ────────────────────────────────────────────────────

interface GoogleAdsRow {
  customer?: { id?: string };
  campaign?: { name?: string; status?: string };
  adGroupCriterion?: { keyword?: { text?: string; matchType?: string } };
  searchTermView?: { searchTerm?: string };
  segments?: { date?: string; conversionActionName?: string };
  metrics?: {
    costMicros?: string;
    clicks?: string;
    impressions?: string;
    conversions?: number;
    costPerConversion?: number;
    ctr?: number;
    historicalQualityScore?: number;
  };
}

async function queryGoogleAds(gaql: string): Promise<GoogleAdsRow[]> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;

  if (!accessToken) throw new Error("Failed to obtain access token for Google Ads API");

  const customerId = getCustomerId();
  const developerToken = getDeveloperToken();

  const response = await fetch(
    `${ADS_BASE_URL}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: gaql }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Ads API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  // searchStream returns an array of batches, each with a results array
  const rows: GoogleAdsRow[] = [];
  if (Array.isArray(data)) {
    for (const batch of data) {
      if (batch.results) {
        rows.push(...batch.results);
      }
    }
  }

  return rows;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DURING_MAP: Record<AdsDayRange, string> = {
  7: "LAST_7_DAYS",
  14: "LAST_14_DAYS",
  30: "LAST_30_DAYS",
};

function microsToDollars(micros: string | number | null | undefined): number {
  if (micros == null) return 0;
  const val = typeof micros === "string" ? parseInt(micros, 10) : micros;
  return val / 1_000_000;
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT || process.env.FIREBASE_ADMIN_PRIVATE_KEY)
  );
}

// ─── Query Functions ──────────────────────────────────────────────────────────

async function getAccountSummary(days: AdsDayRange): Promise<GoogleAdsAccountSummary> {
  const rows = await queryGoogleAds(`
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
    totalSpend: microsToDollars(row.metrics?.costMicros),
    totalClicks: Number(row.metrics?.clicks ?? 0),
    totalImpressions: Number(row.metrics?.impressions ?? 0),
    totalConversions: Number(row.metrics?.conversions ?? 0),
    avgCpa: microsToDollars(row.metrics?.costPerConversion),
    avgCtr: Number(row.metrics?.ctr ?? 0),
  };
}

async function getCampaignPerformance(days: AdsDayRange): Promise<CampaignPerformance[]> {
  const rows = await queryGoogleAds(`
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
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
    cpa: microsToDollars(row.metrics?.costPerConversion),
  }));
}

async function getKeywordPerformance(days: AdsDayRange, limit: number = 50): Promise<KeywordPerformance[]> {
  const rows = await queryGoogleAds(`
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
    keyword: String(row.adGroupCriterion?.keyword?.text ?? ""),
    matchType: (row.adGroupCriterion?.keyword?.matchType ?? "BROAD") as KeywordPerformance["matchType"],
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
    qualityScore: row.metrics?.historicalQualityScore != null
      ? Number(row.metrics.historicalQualityScore)
      : null,
  }));
}

async function getSearchTerms(days: AdsDayRange, limit: number = 50): Promise<SearchTermData[]> {
  const rows = await queryGoogleAds(`
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
    searchTerm: String(row.searchTermView?.searchTerm ?? ""),
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

async function getCostPerConversion(days: AdsDayRange): Promise<ConversionBreakdown[]> {
  const rows = await queryGoogleAds(`
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
    const name = String(row.segments?.conversionActionName ?? "Unknown");
    const existing = byAction.get(name);
    if (existing) {
      existing.conversions += Number(row.metrics?.conversions ?? 0);
      existing.cost += microsToDollars(row.metrics?.costMicros);
      existing.cpa = existing.conversions > 0 ? existing.cost / existing.conversions : 0;
    } else {
      const conversions = Number(row.metrics?.conversions ?? 0);
      const cost = microsToDollars(row.metrics?.costMicros);
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
  const rows = await queryGoogleAds(`
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
    spend: microsToDollars(row.metrics?.costMicros),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

// ─── Date-Range Query Functions (for briefing prior-period comparison) ────────

/** Format a Date to YYYY-MM-DD for GAQL queries */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Get account summary for an explicit date range (not DURING literal).
 * Used for prior-period comparison in briefings.
 */
export async function getAccountSummaryForRange(
  startDate: Date,
  endDate: Date
): Promise<GoogleAdsAccountSummary> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.ctr
    FROM customer
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
  `);

  if (!rows.length) {
    return { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0, avgCpa: 0, avgCtr: 0 };
  }

  const row = rows[0];
  return {
    totalSpend: microsToDollars(row.metrics?.costMicros),
    totalClicks: Number(row.metrics?.clicks ?? 0),
    totalImpressions: Number(row.metrics?.impressions ?? 0),
    totalConversions: Number(row.metrics?.conversions ?? 0),
    avgCpa: microsToDollars(row.metrics?.costPerConversion),
    avgCtr: Number(row.metrics?.ctr ?? 0),
  };
}

/**
 * Get campaign performance for an explicit date range.
 */
export async function getCampaignPerformanceForRange(
  startDate: Date,
  endDate: Date
): Promise<CampaignPerformance[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
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
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `);

  return rows.map((row) => ({
    name: String(row.campaign?.name ?? "Unknown"),
    status: (row.campaign?.status ?? "ENABLED") as CampaignPerformance["status"],
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    ctr: Number(row.metrics?.ctr ?? 0),
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
    cpa: microsToDollars(row.metrics?.costPerConversion),
  }));
}

/**
 * Get daily spend for an explicit date range.
 */
export async function getDailySpendForRange(
  startDate: Date,
  endDate: Date
): Promise<DailySpend[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.conversions
    FROM customer
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY segments.date ASC
  `);

  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    spend: microsToDollars(row.metrics?.costMicros),
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
