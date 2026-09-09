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
import { getServiceAccountCredentials } from "@/lib/google/service-account-credentials";
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

const ADS_API_VERSION = "v25";
const ADS_BASE_URL = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

let _auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (_auth) return _auth;

  // Full JSON or key + email pair — one loader shared with the Data Manager
  // and GA4 clients (src/lib/google/service-account-credentials.ts).
  _auth = new GoogleAuth({
    credentials: getServiceAccountCredentials(),
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
  customer?: {
    id?: string;
    conversionTrackingSetting?: {
      acceptedCustomerDataTerms?: boolean;
      enhancedConversionsForLeadsEnabled?: boolean;
      conversionTrackingStatus?: string;
    };
  };
  customerUserAccess?: { userId?: string | number; emailAddress?: string; accessRole?: string };
  campaign?: {
    resourceName?: string;
    id?: string | number;
    name?: string;
    status?: string;
    labels?: string[];
    [key: string]: unknown;
  };
  campaignBudget?: { resourceName?: string; name?: string; status?: string; [key: string]: unknown };
  adGroup?: {
    resourceName?: string;
    id?: string | number;
    name?: string;
    status?: string;
    campaign?: string;
    labels?: string[];
    [key: string]: unknown;
  };
  adGroupAd?: {
    resourceName?: string;
    status?: string;
    adGroup?: string;
    adStrength?: string;
    labels?: string[];
    policySummary?: { approvalStatus?: string; reviewStatus?: string };
    ad?: { id?: string | number; type?: string; finalUrls?: string[]; [key: string]: unknown };
    [key: string]: unknown;
  };
  adGroupAdAssetView?: {
    adGroupAd?: string;
    asset?: string;
    fieldType?: string;
    performanceLabel?: string;
    pinnedField?: string;
  };
  asset?: { id?: string | number; textAsset?: { text?: string } };
  adGroupCriterion?: {
    resourceName?: string;
    criterionId?: string | number;
    adGroup?: string;
    status?: string;
    negative?: boolean;
    labels?: string[];
    keyword?: { text?: string; matchType?: string };
    qualityInfo?: { qualityScore?: number };
    [key: string]: unknown;
  };
  campaignCriterion?: {
    resourceName?: string;
    campaign?: string;
    negative?: boolean;
    keyword?: { text?: string; matchType?: string };
    [key: string]: unknown;
  };
  sharedSet?: { resourceName?: string; name?: string; status?: string; [key: string]: unknown };
  sharedCriterion?: { resourceName?: string; sharedSet?: string; keyword?: { text?: string; matchType?: string }; [key: string]: unknown };
  label?: { resourceName?: string; name?: string; status?: string; [key: string]: unknown };
  clickView?: {
    gclid?: string;
    adGroupAd?: string;
    keyword?: string;
    keywordInfo?: { text?: string; matchType?: string };
  };
  searchTermView?: { searchTerm?: string };
  conversionAction?: {
    resourceName?: string;
    id?: string | number;
    name?: string;
    type?: string;
    category?: string;
    status?: string;
    primaryForGoal?: boolean;
    includeInConversionsMetric?: boolean;
    countingType?: string;
    clickThroughLookbackWindowDays?: string | number;
  };
  segments?: { date?: string; conversionActionName?: string };
  metrics?: {
    costMicros?: string;
    clicks?: string;
    impressions?: string;
    conversions?: number;
    costPerConversion?: number;
    ctr?: number;
    historicalQualityScore?: number;
    averageCpc?: string | number;
  };
}

async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!accessToken) throw new Error("Failed to obtain access token for Google Ads API");
  return accessToken;
}

/**
 * A non-OK response from the Google Ads API. Typed so callers can classify
 * standing access conditions (401/403 authorization failures) apart from
 * transient or code failures without string-matching. The message template is
 * byte-identical to the untyped throw it replaces.
 */
export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Google Ads API error (${status}): ${body}`);
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Low-level GAQL search against an explicit customer id. Used by both the
 * public query path and manager→client resolution (which must not recurse).
 *
 * Do NOT send pageSize: the API rejects it with PAGE_SIZE_NOT_SUPPORTED —
 * responses are fixed at 10,000 rows per page, paged via nextPageToken.
 * Kept for the tiny discovery query only; report reads use rawSearchStream.
 */
async function rawSearch(
  accessToken: string,
  customerId: string,
  gaql: string,
  loginCustomerId?: string
): Promise<GoogleAdsRow[]> {
  const developerToken = getDeveloperToken();

  const allRows: GoogleAdsRow[] = [];
  let pageToken: string | undefined;

  do {
    const response = await fetch(
      `${ADS_BASE_URL}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "Content-Type": "application/json",
          ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
        },
        body: JSON.stringify({
          query: gaql,
          ...(pageToken ? { pageToken } : {}),
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GoogleAdsApiError(response.status, errorBody);
    }

    const data = await response.json();
    if (data.results) {
      allRows.push(...data.results);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allRows;
}

/**
 * Streaming GAQL read. `googleAds:searchStream` answers with a JSON ARRAY of
 * chunks, each `{ results, fieldMask, requestId }`; the chunks are concatenated
 * in order. One request per report — no paging, and never a pageSize.
 * The request id of the failing call is logged so a Google support thread can
 * be opened against it.
 */
async function rawSearchStream(
  accessToken: string,
  customerId: string,
  gaql: string,
  loginCustomerId?: string
): Promise<GoogleAdsRow[]> {
  const developerToken = getDeveloperToken();
  const response = await fetch(
    `${ADS_BASE_URL}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({ query: gaql }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    const requestId = response.headers?.get?.("request-id") ?? extractRequestId(errorBody);
    console.error(
      `[google-ads-client] searchStream failed (${response.status})${requestId ? ` request-id=${requestId}` : ""}`
    );
    throw new GoogleAdsApiError(response.status, errorBody);
  }

  const chunks = (await response.json()) as unknown;
  const list: Array<{ results?: GoogleAdsRow[]; requestId?: string }> = Array.isArray(chunks)
    ? (chunks as Array<{ results?: GoogleAdsRow[]; requestId?: string }>)
    : chunks && typeof chunks === "object"
      ? [chunks as { results?: GoogleAdsRow[]; requestId?: string }]
      : [];

  const allRows: GoogleAdsRow[] = [];
  for (const chunk of list) {
    if (Array.isArray(chunk?.results)) allRows.push(...chunk.results);
  }
  return allRows;
}

/** Best-effort request id from a Google Ads error body (GoogleAdsFailure.requestId). */
function extractRequestId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { details?: Array<{ requestId?: string }> };
    };
    for (const detail of parsed.error?.details ?? []) {
      if (detail?.requestId) return String(detail.requestId);
    }
  } catch {
    // not JSON
  }
  return null;
}

// ─── Manager → serving-account resolution ─────────────────────────────────────

interface ServingCustomer {
  /** Customer id metrics queries run against (never a manager account). */
  servingId: string;
  /** Manager id sent as login-customer-id, when access flows through one. */
  loginId?: string;
}

interface CustomerClientRow {
  customerClient?: {
    id?: string;
    descriptiveName?: string;
    level?: string | number;
    manager?: boolean;
    status?: string;
  };
}

let _servingCustomer: Promise<ServingCustomer> | null = null;

/**
 * Resolve the ad-serving customer account for all metric queries.
 *
 * GOOGLE_ADS_CUSTOMER_ID may be a MANAGER account (the account that holds the
 * developer token — OPS LTD 5448339076). Managers cannot be queried for
 * metrics (REQUESTED_METRICS_FOR_MANAGER); the data lives in the client
 * account underneath (OPS 4454506598). When the configured id is a manager,
 * find its single enabled non-manager client and query that, passing the
 * manager as login-customer-id. When the configured id is already a client
 * account, use it directly.
 *
 * GOOGLE_ADS_LOGIN_CUSTOMER_ID (optional) forces the login header; it also
 * disambiguates if a manager ever has multiple enabled clients — in that
 * ambiguous case this throws, listing candidates, rather than guessing.
 *
 * Memoized for the lifetime of the server instance (the account hierarchy is
 * effectively static). Failures are not cached.
 */
async function resolveServingCustomer(accessToken: string): Promise<ServingCustomer> {
  if (_servingCustomer) return _servingCustomer;

  const resolution = (async (): Promise<ServingCustomer> => {
    const configuredId = getCustomerId();
    const loginOverride = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined;

    const rows = (await rawSearch(
      accessToken,
      configuredId,
      `SELECT customer_client.id, customer_client.descriptive_name,
              customer_client.level, customer_client.manager, customer_client.status
       FROM customer_client`,
      loginOverride
    )) as CustomerClientRow[];

    const self = rows
      .map((r) => r.customerClient)
      .find((c) => String(c?.id ?? "") === configuredId || Number(c?.level ?? -1) === 0);

    // Configured id is a normal (non-manager) account — query it directly.
    if (self && self.manager === false) {
      return { servingId: configuredId, loginId: loginOverride };
    }

    // Configured id is a manager: pick its single enabled serving client.
    const candidates = rows
      .map((r) => r.customerClient)
      .filter((c): c is NonNullable<typeof c> => !!c)
      .filter((c) => c.manager === false && c.status === "ENABLED" && c.id);

    if (candidates.length === 1) {
      return {
        servingId: String(candidates[0].id),
        loginId: loginOverride ?? configuredId,
      };
    }

    const listing = candidates
      .map((c) => `${c.id} ("${c.descriptiveName ?? "unnamed"}")`)
      .join(", ");
    throw new Error(
      candidates.length === 0
        ? `GOOGLE_ADS_CUSTOMER_ID ${configuredId} is a manager account with no enabled client accounts underneath`
        : `GOOGLE_ADS_CUSTOMER_ID ${configuredId} is a manager account with multiple enabled clients (${listing}) — set GOOGLE_ADS_CUSTOMER_ID to the serving account id and GOOGLE_ADS_LOGIN_CUSTOMER_ID to the manager id`
    );
  })();

  // Cache the in-flight promise so parallel cold-start queries share one
  // discovery call, but never cache a failure.
  _servingCustomer = resolution;
  try {
    return await resolution;
  } catch (err) {
    _servingCustomer = null;
    throw err;
  }
}

async function queryGoogleAds(gaql: string): Promise<GoogleAdsRow[]> {
  const accessToken = await getAccessToken();
  const { servingId, loginId } = await resolveServingCustomer(accessToken);
  return rawSearchStream(accessToken, servingId, gaql, loginId);
}

/**
 * The resolved serving customer id and (when access flows through a manager)
 * the login customer id. Exported for sibling clients that address the same
 * account through other Google APIs — the Data Manager client sends both as
 * `operatingAccount` / `loginAccount`.
 */
export async function getServingCustomerIds(): Promise<{ servingId: string; loginId?: string }> {
  const accessToken = await getAccessToken();
  const { servingId, loginId } = await resolveServingCustomer(accessToken);
  return { servingId, loginId };
}

// ─── Mutate (googleAds:mutate) ────────────────────────────────────────────────

/**
 * One GoogleAdsService.mutate operation, keyed by its service operation
 * (`campaignBudgetOperation`, `conversionActionOperation`, …) with the
 * create / update+updateMask / remove body inside.
 */
export interface MutateOperation {
  [service: `${string}Operation`]: Record<string, unknown>;
}

/** A per-operation failure decoded from `partialFailureError`. */
export interface MutateFailure {
  /** Index into the submitted operations, or null when Google gave no location. */
  index: number | null;
  /** The enum name of the error, e.g. `POLICY_FINDING`, `ACTION_NOT_PERMITTED`. */
  code: string;
  message: string;
}

export interface MutateResult {
  /** One entry per submitted operation, positionally (empty object on failure). */
  results: Array<Record<string, unknown>>;
  failures: MutateFailure[];
  requestId?: string;
}

interface MutateResponseBody {
  mutateOperationResponses?: Array<Record<string, unknown>>;
  partialFailureError?: {
    code?: number;
    message?: string;
    details?: Array<{
      requestId?: string;
      errors?: Array<{
        errorCode?: Record<string, string>;
        message?: string;
        location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
      }>;
    }>;
  };
}

/**
 * Decode `partialFailureError.details[].errors[]` positionally: the first
 * fieldPathElement carries `index` = the failing operation's position in
 * `mutateOperations`. The first key of `errorCode` names the error enum
 * (`policyFindingError`), its value the member (`POLICY_FINDING`).
 */
function decodePartialFailures(body: MutateResponseBody): { failures: MutateFailure[]; requestId?: string } {
  const failures: MutateFailure[] = [];
  let requestId: string | undefined;
  for (const detail of body.partialFailureError?.details ?? []) {
    if (detail?.requestId && !requestId) requestId = String(detail.requestId);
    for (const err of detail?.errors ?? []) {
      const first = err?.location?.fieldPathElements?.[0];
      const index = typeof first?.index === "number" ? first.index : null;
      const entry = err?.errorCode ? Object.entries(err.errorCode)[0] : undefined;
      failures.push({
        index,
        code: entry ? String(entry[1]) : "UNKNOWN",
        message: String(err?.message ?? ""),
      });
    }
  }
  return { failures, requestId };
}

/**
 * Write to the serving customer through GoogleAdsService.mutate.
 *
 * Defaults: `partialFailure: true` (one bad operation never voids the batch),
 * `validateOnly: false`. Every caller in the engine runs with
 * `validateOnly: true` first and re-sends only on a clean pass — that rule is
 * enforced at the call sites, not here, so this stays a faithful transport.
 * Throws GoogleAdsApiError on a non-2xx (whole-request) failure; per-operation
 * failures come back decoded in `failures`.
 */
export async function mutateGoogleAds(
  operations: MutateOperation[],
  options: { validateOnly?: boolean; partialFailure?: boolean } = {}
): Promise<MutateResult> {
  const accessToken = await getAccessToken();
  const { servingId, loginId } = await resolveServingCustomer(accessToken);
  const developerToken = getDeveloperToken();

  const response = await fetch(
    `${ADS_BASE_URL}/customers/${servingId}/googleAds:mutate`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
        ...(loginId ? { "login-customer-id": loginId } : {}),
      },
      // No responseContentType: asking for MUTABLE_RESOURCE makes Google answer
      // INTERNAL_ERROR on every real conversion-action operation while the
      // validateOnly pass succeeds (requests 5AluX7K36qmzSSUNYDWf3Q and
      // QP1iZPcJnISXeYM0YLDw-g, 2026-09-09). Resource names are enough.
      body: JSON.stringify({
        mutateOperations: operations,
        partialFailure: options.partialFailure ?? true,
        validateOnly: options.validateOnly ?? false,
      }),
    }
  );

  const headerRequestId = response.headers?.get?.("request-id") ?? null;

  if (!response.ok) {
    const errorBody = await response.text();
    const requestId = headerRequestId ?? extractRequestId(errorBody);
    console.error(
      `[google-ads-client] mutate failed (${response.status})${requestId ? ` request-id=${requestId}` : ""}`
    );
    throw new GoogleAdsApiError(response.status, errorBody);
  }

  const body = (await response.json()) as MutateResponseBody;
  const { failures, requestId: failureRequestId } = decodePartialFailures(body);
  const results = (body.mutateOperationResponses ?? []).map((r) => r ?? {});
  const requestId = headerRequestId ?? failureRequestId;
  return requestId ? { results, failures, requestId } : { results, failures };
}

/**
 * One ConversionActionService operation: `create`, `update` + `updateMask`,
 * or `remove` (a resource name).
 */
export interface ConversionActionServiceOperation {
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
  updateMask?: string;
  remove?: string;
}

/**
 * Write conversion actions through ConversionActionService
 * (`customers/{id}/conversionActions:mutate`) rather than the bulk
 * GoogleAdsService.mutate. Same contract as mutateGoogleAds: partialFailure
 * on by default, validateOnly off by default, positional failure decoding,
 * request id on every call. The bulk endpoint validates conversion-action
 * batches cleanly but answers INTERNAL_ERROR on every real operation in a
 * mixed create/update/remove batch (requests 5AluX7K36qmzSSUNYDWf3Q,
 * QP1iZPcJnISXeYM0YLDw-g, hfFhllc6wBjKNxz0TJBlmg, 2026-09-09); the dedicated
 * service is the path Google documents for this resource.
 */
export async function mutateConversionActions(
  operations: ConversionActionServiceOperation[],
  options: { validateOnly?: boolean; partialFailure?: boolean } = {}
): Promise<MutateResult> {
  const accessToken = await getAccessToken();
  const { servingId, loginId } = await resolveServingCustomer(accessToken);
  const developerToken = getDeveloperToken();

  const response = await fetch(
    `${ADS_BASE_URL}/customers/${servingId}/conversionActions:mutate`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
        ...(loginId ? { "login-customer-id": loginId } : {}),
      },
      body: JSON.stringify({
        operations,
        partialFailure: options.partialFailure ?? true,
        validateOnly: options.validateOnly ?? false,
      }),
    }
  );

  const headerRequestId = response.headers?.get?.("request-id") ?? null;

  if (!response.ok) {
    const errorBody = await response.text();
    const requestId = headerRequestId ?? extractRequestId(errorBody);
    console.error(
      `[google-ads-client] conversionActions:mutate failed (${response.status})${requestId ? ` request-id=${requestId}` : ""}`
    );
    throw new GoogleAdsApiError(response.status, errorBody);
  }

  const body = (await response.json()) as MutateResponseBody & {
    results?: Array<Record<string, unknown>>;
  };
  const { failures, requestId: failureRequestId } = decodePartialFailures(body);
  const results = (body.results ?? []).map((r) => r ?? {});
  const requestId = headerRequestId ?? failureRequestId;
  return requestId ? { results, failures, requestId } : { results, failures };
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
      campaign.name,
      ad_group.name,
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
    campaignName: String(row.campaign?.name ?? "Unknown"),
    adGroupName: row.adGroup?.name ? String(row.adGroup.name) : null,
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

/**
 * Query daily search-term metrics for a date range.
 * Returns one row per day, search term, campaign, and ad group.
 */
export async function queryDailySearchTermData(
  startDate: Date,
  endDate: Date,
  limit = 10000
): Promise<{
  date: string;
  search_term: string;
  campaign_name: string;
  ad_group_name: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  waste_flag: string | null;
}[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY segments.date ASC, metrics.cost_micros DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => {
    const spend = microsToDollars(row.metrics?.costMicros);
    const conversions = Number(row.metrics?.conversions ?? 0);
    return {
      date: String(row.segments?.date ?? ""),
      search_term: String(row.searchTermView?.searchTerm ?? ""),
      campaign_name: String(row.campaign?.name ?? "Unknown"),
      ad_group_name: row.adGroup?.name ? String(row.adGroup.name) : "",
      spend,
      clicks: Number(row.metrics?.clicks ?? 0),
      impressions: Number(row.metrics?.impressions ?? 0),
      conversions,
      cpa: conversions > 0 ? spend / conversions : 0,
      ctr: Number(row.metrics?.ctr ?? 0),
      waste_flag: spend >= 100 && conversions === 0 ? "spent_100_no_conversion" : null,
    };
  });
}

/**
 * Conversion-action name → category (SIGNUP / DOWNLOAD / PURCHASE / ...).
 * Categories are how the dashboard decides which actions are signups versus
 * app installs — far sturdier than matching substrings in operator-typed
 * names ("OPS APP First open" is an install; nothing about it says "install").
 * Prefers ENABLED rows when a name has been reused across removed actions.
 */
async function fetchConversionActionCategories(): Promise<Map<string, string>> {
  const rows = await queryGoogleAds(`
    SELECT
      conversion_action.name,
      conversion_action.category,
      conversion_action.status
    FROM conversion_action
  `);

  const byName = new Map<string, { category: string; enabled: boolean }>();
  for (const row of rows) {
    const name = row.conversionAction?.name;
    const category = row.conversionAction?.category;
    if (!name || !category) continue;
    const enabled = row.conversionAction?.status === "ENABLED";
    const existing = byName.get(name);
    if (!existing || (enabled && !existing.enabled)) {
      byName.set(name, { category, enabled });
    }
  }

  return new Map([...byName].map(([name, v]) => [name, v.category]));
}

/**
 * Every non-REMOVED conversion action with the fields the engine's planner
 * reconciles (src/lib/ads/conversion-actions.ts). Live, never cached: the
 * planner must see the account as it is right now.
 */
export async function listConversionActions(): Promise<
  Array<{
    resourceName: string;
    id: string;
    name: string;
    type: string;
    category: string;
    status: string;
    primaryForGoal: boolean;
    includeInConversionsMetric: boolean;
    countingType: string;
    clickThroughLookbackWindowDays: number;
  }>
> {
  const rows = await queryGoogleAds(`
    SELECT
      conversion_action.resource_name,
      conversion_action.id,
      conversion_action.name,
      conversion_action.type,
      conversion_action.category,
      conversion_action.status,
      conversion_action.primary_for_goal,
      conversion_action.include_in_conversions_metric,
      conversion_action.counting_type,
      conversion_action.click_through_lookback_window_days
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
  `);

  return rows
    .map((row) => row.conversionAction)
    .filter((a): a is NonNullable<typeof a> => !!a && !!a.resourceName)
    .map((a) => ({
      resourceName: String(a.resourceName),
      id: String(a.id ?? ""),
      name: String(a.name ?? ""),
      type: String(a.type ?? ""),
      category: String(a.category ?? ""),
      status: String(a.status ?? ""),
      primaryForGoal: a.primaryForGoal === true,
      includeInConversionsMetric: a.includeInConversionsMetric === true,
      countingType: String(a.countingType ?? ""),
      clickThroughLookbackWindowDays: Number(a.clickThroughLookbackWindowDays ?? 0),
    }));
}

/**
 * Aggregate conversion rows by action name, attaching categories and costing
 * each action against total account spend for the window.
 *
 * Google does NOT attribute cost to individual conversion actions (asking for
 * cost alongside `segments.conversion_action_name` is rejected outright with
 * PROHIBITED_SEGMENT_WITH_METRIC_IN_SELECT_OR_WHERE_CLAUSE). So `cost` on every
 * row is the window's TOTAL account spend — the shared numerator — and `cpa`
 * is that total divided by the action's own conversions. This matches how the
 * Google Ads UI reports cost/conv. when segmenting by conversion action.
 */
function aggregateConversionRows(
  rows: GoogleAdsRow[],
  windowSpend: number,
  categories: Map<string, string>
): ConversionBreakdown[] {
  const byAction = new Map<string, ConversionBreakdown>();
  for (const row of rows) {
    const name = String(row.segments?.conversionActionName ?? "Unknown");
    const conversions = Number(row.metrics?.conversions ?? 0);
    const existing = byAction.get(name);
    if (existing) {
      existing.conversions += conversions;
    } else {
      byAction.set(name, {
        actionName: name,
        category: categories.get(name) ?? null,
        conversions,
        cost: windowSpend,
        cpa: 0,
      });
    }
  }

  const out = Array.from(byAction.values());
  for (const action of out) {
    action.cpa = action.conversions > 0 ? windowSpend / action.conversions : 0;
  }

  return out.sort((a, b) => b.conversions - a.conversions);
}

async function getCostPerConversion(days: AdsDayRange): Promise<ConversionBreakdown[]> {
  const [rows, summary, categories] = await Promise.all([
    queryGoogleAds(`
      SELECT
        segments.conversion_action_name,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING ${DURING_MAP[days]}
        AND segments.conversion_action_name != ''
    `),
    getAccountSummary(days),
    fetchConversionActionCategories(),
  ]);

  return aggregateConversionRows(rows, summary.totalSpend, categories);
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

// ─── Bulk Daily-Segmented Queries (for history sync) ──────────────────────────

/**
 * Query daily account-level metrics for a date range.
 * Returns one row per day with segments.date. Used by backfill sync.
 */
export async function queryDailyAccountData(
  startDate: Date,
  endDate: Date
): Promise<{ date: string; spend: number; clicks: number; impressions: number; conversions: number; cpa: number; ctr: number }[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.ctr
    FROM customer
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY segments.date ASC
  `);

  return rows.map((row) => {
    const spend = microsToDollars(row.metrics?.costMicros);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const impressions = Number(row.metrics?.impressions ?? 0);
    const conversions = Number(row.metrics?.conversions ?? 0);
    return {
      date: String(row.segments?.date ?? ""),
      spend,
      clicks,
      impressions,
      conversions,
      cpa: conversions > 0 ? spend / conversions : 0,
      ctr: Number(row.metrics?.ctr ?? 0),
    };
  });
}

/**
 * Query daily campaign-level metrics for a date range.
 * Returns one row per campaign per day. Used by backfill sync.
 */
export async function queryDailyCampaignData(
  startDate: Date,
  endDate: Date
): Promise<{ date: string; campaign_name: string; campaign_status: string; spend: number; clicks: number; impressions: number; conversions: number; cpa: number; ctr: number }[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
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
    ORDER BY segments.date ASC, metrics.cost_micros DESC
  `);

  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    campaign_name: String(row.campaign?.name ?? "Unknown"),
    campaign_status: String(row.campaign?.status ?? "ENABLED"),
    spend: microsToDollars(row.metrics?.costMicros),
    clicks: Number(row.metrics?.clicks ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
    cpa: microsToDollars(row.metrics?.costPerConversion),
    ctr: Number(row.metrics?.ctr ?? 0),
  }));
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

/**
 * Get keyword performance for an explicit date range.
 * Used for range presets wider than the DURING literals (90d/12m/all) —
 * keywords are not warehoused (by design), so history ranges query live.
 */
export async function getKeywordPerformanceForRange(
  startDate: Date,
  endDate: Date,
  limit: number = 50
): Promise<KeywordPerformance[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
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
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
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

/**
 * Get search terms for an explicit date range (page-shape rows, aggregated by
 * Google across the span). Live-path counterpart of getSearchTerms.
 */
export async function getSearchTermsForRange(
  startDate: Date,
  endDate: Date,
  limit: number = 50
): Promise<SearchTermData[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY metrics.impressions DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    searchTerm: String(row.searchTermView?.searchTerm ?? ""),
    campaignName: String(row.campaign?.name ?? "Unknown"),
    adGroupName: row.adGroup?.name ? String(row.adGroup.name) : null,
    impressions: Number(row.metrics?.impressions ?? 0),
    clicks: Number(row.metrics?.clicks ?? 0),
    cost: microsToDollars(row.metrics?.costMicros),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

/**
 * Get conversion-action breakdown for an explicit date range. Conversion
 * actions are not warehoused, so every range preset sources this live.
 */
export async function getCostPerConversionForRange(
  startDate: Date,
  endDate: Date
): Promise<ConversionBreakdown[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const [rows, summary, categories] = await Promise.all([
    queryGoogleAds(`
      SELECT
        segments.conversion_action_name,
        metrics.conversions
      FROM campaign
      WHERE segments.date >= '${start}' AND segments.date <= '${end}'
        AND segments.conversion_action_name != ''
    `),
    getAccountSummaryForRange(startDate, endDate),
    fetchConversionActionCategories(),
  ]);

  return aggregateConversionRows(rows, summary.totalSpend, categories);
}

// ─── Warehouse grain reports (ad group / ad / asset / keyword / click) ────────

/** The part of a Google resource name after the last slash, split on `~`. */
function resourceIds(resourceName: string | undefined): string[] {
  if (!resourceName) return [];
  const tail = resourceName.slice(resourceName.lastIndexOf("/") + 1);
  return tail.split("~");
}

export interface DailyAdGroupRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
}

export async function queryDailyAdGroupData(startDate: Date, endDate: Date): Promise<DailyAdGroupRow[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr
    FROM ad_group
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
      AND ad_group.status != 'REMOVED'
    ORDER BY segments.date ASC
  `);
  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    campaign_id: String(row.campaign?.id ?? ""),
    campaign_name: String(row.campaign?.name ?? ""),
    ad_group_id: String(row.adGroup?.id ?? ""),
    ad_group_name: String(row.adGroup?.name ?? ""),
    status: String(row.adGroup?.status ?? ""),
    spend: microsToDollars(row.metrics?.costMicros),
    clicks: Number(row.metrics?.clicks ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
    ctr: Number(row.metrics?.ctr ?? 0),
  }));
}

export interface DailyAdRow {
  date: string;
  ad_group_id: string;
  ad_id: string;
  ad_type: string;
  status: string;
  ad_strength: string | null;
  approval_status: string | null;
  review_status: string | null;
  final_url: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
}

export async function queryDailyAdData(startDate: Date, endDate: Date): Promise<DailyAdRow[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      ad_group.id,
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.status,
      ad_group_ad.ad_strength,
      ad_group_ad.policy_summary.approval_status,
      ad_group_ad.policy_summary.review_status,
      ad_group_ad.ad.final_urls,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr
    FROM ad_group_ad
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
      AND ad_group_ad.status != 'REMOVED'
    ORDER BY segments.date ASC
  `);
  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    ad_group_id: String(row.adGroup?.id ?? ""),
    ad_id: String(row.adGroupAd?.ad?.id ?? ""),
    ad_type: String(row.adGroupAd?.ad?.type ?? ""),
    status: String(row.adGroupAd?.status ?? ""),
    ad_strength: row.adGroupAd?.adStrength ? String(row.adGroupAd.adStrength) : null,
    approval_status: row.adGroupAd?.policySummary?.approvalStatus
      ? String(row.adGroupAd.policySummary.approvalStatus)
      : null,
    review_status: row.adGroupAd?.policySummary?.reviewStatus
      ? String(row.adGroupAd.policySummary.reviewStatus)
      : null,
    final_url: row.adGroupAd?.ad?.finalUrls?.[0] ? String(row.adGroupAd.ad.finalUrls[0]) : null,
    spend: microsToDollars(row.metrics?.costMicros),
    clicks: Number(row.metrics?.clicks ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
    ctr: Number(row.metrics?.ctr ?? 0),
  }));
}

export interface DailyAssetRow {
  date: string;
  ad_id: string;
  asset_id: string;
  field_type: string;
  performance_label: string | null;
  pinned_field: string | null;
  text: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
}

export async function queryDailyAssetData(startDate: Date, endDate: Date): Promise<DailyAssetRow[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      ad_group_ad_asset_view.ad_group_ad,
      ad_group_ad_asset_view.asset,
      ad_group_ad_asset_view.field_type,
      ad_group_ad_asset_view.performance_label,
      ad_group_ad_asset_view.pinned_field,
      asset.id,
      asset.text_asset.text,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions
    FROM ad_group_ad_asset_view
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY segments.date ASC
  `);
  return rows.map((row) => {
    const view = row.adGroupAdAssetView ?? {};
    const adIds = resourceIds(view.adGroupAd);
    return {
      date: String(row.segments?.date ?? ""),
      ad_id: adIds[1] ?? adIds[0] ?? "",
      asset_id: String(row.asset?.id ?? resourceIds(view.asset)[0] ?? ""),
      field_type: String(view.fieldType ?? ""),
      performance_label: view.performanceLabel ? String(view.performanceLabel) : null,
      pinned_field: view.pinnedField ? String(view.pinnedField) : null,
      text: row.asset?.textAsset?.text ? String(row.asset.textAsset.text) : null,
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
      conversions: Number(row.metrics?.conversions ?? 0),
    };
  });
}

export interface DailyKeywordRow {
  date: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  criterion_id: string;
  keyword: string;
  match_type: string;
  status: string;
  quality_score: number | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  average_cpc: number | null;
}

export async function queryDailyKeywordData(startDate: Date, endDate: Date): Promise<DailyKeywordRow[]> {
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  const rows = await queryGoogleAds(`
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group_criterion.quality_info.quality_score,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.average_cpc
    FROM keyword_view
    WHERE segments.date >= '${start}' AND segments.date <= '${end}'
    ORDER BY segments.date ASC
  `);
  return rows.map((row) => ({
    date: String(row.segments?.date ?? ""),
    campaign_id: String(row.campaign?.id ?? ""),
    campaign_name: String(row.campaign?.name ?? ""),
    ad_group_id: String(row.adGroup?.id ?? ""),
    ad_group_name: String(row.adGroup?.name ?? ""),
    criterion_id: String(row.adGroupCriterion?.criterionId ?? ""),
    keyword: String(row.adGroupCriterion?.keyword?.text ?? ""),
    match_type: String(row.adGroupCriterion?.keyword?.matchType ?? ""),
    status: String(row.adGroupCriterion?.status ?? ""),
    quality_score:
      row.adGroupCriterion?.qualityInfo?.qualityScore != null
        ? Number(row.adGroupCriterion.qualityInfo.qualityScore)
        : null,
    spend: microsToDollars(row.metrics?.costMicros),
    clicks: Number(row.metrics?.clicks ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
    average_cpc: row.metrics?.averageCpc != null ? microsToDollars(row.metrics.averageCpc) : null,
  }));
}

export interface ClickMapRow {
  gclid: string;
  click_date: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  ad_id: string | null;
  criterion_id: string | null;
  keyword: string | null;
}

/**
 * gclid → campaign / ad group / ad / keyword for ONE day. click_view must be
 * filtered to exactly one segments.date per query (Google rejects ranges).
 */
export async function queryClickMap(date: Date): Promise<ClickMapRow[]> {
  const day = formatDate(date);
  const rows = await queryGoogleAds(`
    SELECT
      click_view.gclid,
      click_view.ad_group_ad,
      click_view.keyword,
      click_view.keyword_info.text,
      campaign.id,
      ad_group.id,
      segments.date
    FROM click_view
    WHERE segments.date = '${day}'
  `);
  return rows
    .filter((row) => !!row.clickView?.gclid)
    .map((row) => {
      const view = row.clickView ?? {};
      const adIds = resourceIds(view.adGroupAd);
      const keywordIds = resourceIds(view.keyword);
      return {
        gclid: String(view.gclid),
        click_date: String(row.segments?.date ?? day),
        campaign_id: row.campaign?.id != null ? String(row.campaign.id) : null,
        ad_group_id: row.adGroup?.id != null ? String(row.adGroup.id) : adIds[0] ?? null,
        ad_id: adIds[1] ?? null,
        criterion_id: keywordIds[1] ?? null,
        keyword: view.keywordInfo?.text ? String(view.keywordInfo.text) : null,
      };
    });
}

export type AdsEntityType =
  | "campaign"
  | "campaign_budget"
  | "ad_group"
  | "ad"
  | "keyword"
  | "negative_keyword"
  | "shared_set"
  | "shared_criterion"
  | "label";

export interface EntityRow {
  resource_name: string;
  entity_type: AdsEntityType;
  parent_resource_name: string | null;
  name: string;
  status: string;
  payload: Record<string, unknown>;
  labels: string[];
}

/**
 * One row per structural resource on the account — campaigns, budgets, ad
 * groups, ads (with full RSA assets and pins), keywords, negatives, shared
 * sets and their members, labels — keyed by Google resource name. Nine
 * searchStream calls.
 */
export async function queryEntitySnapshot(): Promise<EntityRow[]> {
  const out: EntityRow[] = [];
  const push = (
    resourceName: string | undefined,
    entity_type: AdsEntityType,
    parent: string | undefined | null,
    name: unknown,
    status: unknown,
    payload: GoogleAdsRow,
    labels?: string[]
  ) => {
    if (!resourceName) return;
    out.push({
      resource_name: String(resourceName),
      entity_type,
      parent_resource_name: parent ? String(parent) : null,
      name: name == null ? "" : String(name),
      status: status == null ? "" : String(status),
      payload: payload as Record<string, unknown>,
      labels: Array.isArray(labels) ? labels.map(String) : [],
    });
  };

  const [campaigns, budgets, adGroups, ads, keywords, negatives, sharedSets, sharedCriteria, labels] =
    await Promise.all([
      queryGoogleAds(`
        SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status,
               campaign.serving_status, campaign.advertising_channel_type, campaign.campaign_budget,
               campaign.bidding_strategy_type, campaign.start_date_time, campaign.end_date_time, campaign.labels,
               campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
               campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network,
               campaign.target_spend.cpc_bid_ceiling_micros
        FROM campaign
        WHERE campaign.status != 'REMOVED'
      `),
      queryGoogleAds(`
        SELECT campaign_budget.resource_name, campaign_budget.id, campaign_budget.name, campaign_budget.status,
               campaign_budget.amount_micros, campaign_budget.delivery_method, campaign_budget.explicitly_shared,
               campaign_budget.period
        FROM campaign_budget
        WHERE campaign_budget.status != 'REMOVED'
      `),
      queryGoogleAds(`
        SELECT ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.campaign,
               ad_group.type, ad_group.cpc_bid_micros, ad_group.labels
        FROM ad_group
        WHERE ad_group.status != 'REMOVED'
      `),
      queryGoogleAds(`
        SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad_group, ad_group_ad.labels,
               ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
               ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
               ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
               ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2
        FROM ad_group_ad
        WHERE ad_group_ad.status != 'REMOVED'
      `),
      queryGoogleAds(`
        SELECT ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.ad_group,
               ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.type,
               ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
               ad_group_criterion.cpc_bid_micros, ad_group_criterion.quality_info.quality_score,
               ad_group_criterion.labels
        FROM ad_group_criterion
        WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'
      `),
      queryGoogleAds(`
        SELECT campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.campaign,
               campaign_criterion.negative, campaign_criterion.type, campaign_criterion.status,
               campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
        FROM campaign_criterion
        WHERE campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE
      `),
      queryGoogleAds(`
        SELECT shared_set.resource_name, shared_set.id, shared_set.name, shared_set.type, shared_set.status,
               shared_set.member_count
        FROM shared_set
        WHERE shared_set.status != 'REMOVED'
      `),
      queryGoogleAds(`
        SELECT shared_criterion.resource_name, shared_criterion.shared_set, shared_criterion.criterion_id,
               shared_criterion.type, shared_criterion.keyword.text, shared_criterion.keyword.match_type
        FROM shared_criterion
      `),
      queryGoogleAds(`
        SELECT label.resource_name, label.id, label.name, label.status
        FROM label
      `),
    ]);

  for (const row of campaigns) {
    push(row.campaign?.resourceName, "campaign", null, row.campaign?.name, row.campaign?.status, row, row.campaign?.labels);
  }
  for (const row of budgets) {
    push(row.campaignBudget?.resourceName, "campaign_budget", null, row.campaignBudget?.name, row.campaignBudget?.status, row);
  }
  for (const row of adGroups) {
    push(row.adGroup?.resourceName, "ad_group", row.adGroup?.campaign, row.adGroup?.name, row.adGroup?.status, row, row.adGroup?.labels);
  }
  for (const row of ads) {
    push(row.adGroupAd?.resourceName, "ad", row.adGroupAd?.adGroup, row.adGroupAd?.ad?.id, row.adGroupAd?.status, row, row.adGroupAd?.labels);
  }
  for (const row of keywords) {
    const c = row.adGroupCriterion;
    push(c?.resourceName, c?.negative ? "negative_keyword" : "keyword", c?.adGroup, c?.keyword?.text, c?.status, row, c?.labels);
  }
  for (const row of negatives) {
    const c = row.campaignCriterion;
    push(c?.resourceName, "negative_keyword", c?.campaign, c?.keyword?.text, (c as { status?: unknown } | undefined)?.status, row);
  }
  for (const row of sharedSets) {
    push(row.sharedSet?.resourceName, "shared_set", null, row.sharedSet?.name, row.sharedSet?.status, row);
  }
  for (const row of sharedCriteria) {
    push(row.sharedCriterion?.resourceName, "shared_criterion", row.sharedCriterion?.sharedSet, row.sharedCriterion?.keyword?.text, "", row);
  }
  for (const row of labels) {
    push(row.label?.resourceName, "label", null, row.label?.name, row.label?.status, row);
  }
  return out;
}

// ─── Readiness probe reads ───────────────────────────────────────────────────

/** customer.conversion_tracking_setting on the serving account. Absent flags read as false. */
export async function getConversionTrackingSetting(): Promise<{
  acceptedCustomerDataTerms: boolean;
  enhancedConversionsForLeadsEnabled: boolean;
  conversionTrackingStatus: string | null;
}> {
  const rows = await queryGoogleAds(`
    SELECT
      customer.conversion_tracking_setting.accepted_customer_data_terms,
      customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled,
      customer.conversion_tracking_setting.conversion_tracking_status
    FROM customer
  `);
  const setting = rows[0]?.customer?.conversionTrackingSetting ?? {};
  return {
    acceptedCustomerDataTerms: setting.acceptedCustomerDataTerms === true,
    enhancedConversionsForLeadsEnabled: setting.enhancedConversionsForLeadsEnabled === true,
    conversionTrackingStatus: setting.conversionTrackingStatus ? String(setting.conversionTrackingStatus) : null,
  };
}

/**
 * The service account's access role on the account that grants access — the
 * manager when access flows through one (login customer), else the serving
 * account itself.
 */
export async function getServiceAccountAccessRole(
  serviceAccountEmail: string
): Promise<{ role: string | null; present: boolean; customerId: string }> {
  const accessToken = await getAccessToken();
  const { servingId, loginId } = await resolveServingCustomer(accessToken);
  const customerId = loginId ?? servingId;
  const rows = await rawSearch(
    accessToken,
    customerId,
    `SELECT customer_user_access.user_id, customer_user_access.email_address,
            customer_user_access.access_role
     FROM customer_user_access`,
    loginId
  );
  const self = rows
    .map((row) => row.customerUserAccess)
    .find((a) => String(a?.emailAddress ?? "").toLowerCase() === serviceAccountEmail.toLowerCase());
  return { role: self?.accessRole ? String(self.accessRole) : null, present: !!self, customerId };
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

// ─── Cached Range Exports (string YYYY-MM-DD args → stable cache keys) ────────

function parseUtcDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export const getCachedAccountSummaryForRange = unstable_cache(
  (startDate: string, endDate: string) =>
    getAccountSummaryForRange(parseUtcDate(startDate), parseUtcDate(endDate)),
  ["google-ads-account-summary-range"],
  { revalidate: 300 }
);

export const getCachedCampaignPerformanceForRange = unstable_cache(
  (startDate: string, endDate: string) =>
    getCampaignPerformanceForRange(parseUtcDate(startDate), parseUtcDate(endDate)),
  ["google-ads-campaigns-range"],
  { revalidate: 300 }
);

export const getCachedKeywordPerformanceForRange = unstable_cache(
  (startDate: string, endDate: string, limit?: number) =>
    getKeywordPerformanceForRange(parseUtcDate(startDate), parseUtcDate(endDate), limit),
  ["google-ads-keywords-range"],
  { revalidate: 300 }
);

export const getCachedSearchTermsForRange = unstable_cache(
  (startDate: string, endDate: string, limit?: number) =>
    getSearchTermsForRange(parseUtcDate(startDate), parseUtcDate(endDate), limit),
  ["google-ads-search-terms-range"],
  { revalidate: 300 }
);

export const getCachedCostPerConversionForRange = unstable_cache(
  (startDate: string, endDate: string) =>
    getCostPerConversionForRange(parseUtcDate(startDate), parseUtcDate(endDate)),
  ["google-ads-conversions-range"],
  { revalidate: 300 }
);

export const getCachedDailySpendForRange = unstable_cache(
  (startDate: string, endDate: string) =>
    getDailySpendForRange(parseUtcDate(startDate), parseUtcDate(endDate)),
  ["google-ads-daily-spend-range"],
  { revalidate: 300 }
);
