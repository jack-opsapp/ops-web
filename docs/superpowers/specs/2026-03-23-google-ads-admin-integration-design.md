# Google Ads Admin Panel Integration — Design Spec

**Date:** 2026-03-23
**Status:** Reviewed
**Customer ID:** 445-450-6598 (4454506598)

---

## Overview

Add Google Ads campaign performance data to the OPS admin panel. Two surfaces:

1. **Dedicated `/admin/google-ads` tab** — full campaign, keyword, and search term breakdowns
2. **Integrated widgets** on Acquisition page (paid KPIs) and Overview page (CPA in KPI bar)

### User Priorities (ranked)

1. Cost per signup (ad spend ÷ trial signup conversions)
2. Campaign comparison (which campaigns perform best)
3. Keyword performance (which search terms drive conversions)

### Conversion Actions Available

- Website signups (trial starts)
- App installs
- Custom conversions (completed onboarding, first project created)

### Usage Pattern

- Checked multiple times daily — needs near-real-time data
- 5-minute server-side cache with manual refresh button

---

## 1. Data Layer

### 1.1 New File: `src/lib/analytics/google-ads-client.ts`

Singleton pattern matching `src/lib/analytics/ga4-client.ts`.

**Package:** `google-ads-api` (npm). Note: this is a community-maintained package — verify it supports Google Ads API v18+ and check last publish date before installing. If stale, fall back to the official `google-ads-node` or raw REST via `googleapis`. Server-only import.

**Auth:** OAuth2 with refresh token. Reuses existing Google OAuth credentials from `GOOGLE_GMAIL_CLIENT_ID` / `GOOGLE_GMAIL_CLIENT_SECRET` (Google Ads API scope already enabled on this OAuth app).

**Environment Variables:**

| Env Var | New? | Description |
|---------|------|-------------|
| `GOOGLE_GMAIL_CLIENT_ID` | Existing | OAuth2 client ID (shared) |
| `GOOGLE_GMAIL_CLIENT_SECRET` | Existing | OAuth2 client secret (shared) |
| `GOOGLE_ADS_REFRESH_TOKEN` | **New** | Long-lived OAuth2 refresh token |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | **New** | Google Ads API developer token |
| `GOOGLE_ADS_CUSTOMER_ID` | **New** | `4454506598` (no dashes) |

**Client initialization:**

```typescript
import { GoogleAdsApi } from "google-ads-api";

let _client: GoogleAdsApi | null = null;

export function getGoogleAdsClient(): GoogleAdsApi {
  if (_client) return _client;
  _client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
    client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });
  return _client;
}

export function getCustomer() {
  return getGoogleAdsClient().Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID!,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
  });
}
```

### 1.2 Query Functions

All queries use Google Ads Query Language (GAQL). Each returns strongly typed data.

**Date range handling:** GAQL `DURING` only supports predefined literals (`LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS`). Since the UI only offers 7/14/30 day toggles, function signatures use a constrained union type:

```typescript
type AdsDayRange = 7 | 14 | 30;

function buildDuringClause(days: AdsDayRange): string {
  const map: Record<AdsDayRange, string> = {
    7: "LAST_7_DAYS",
    14: "LAST_14_DAYS",
    30: "LAST_30_DAYS",
  };
  return map[days];
}
```

#### `getAccountSummary(days: AdsDayRange)`

Returns totals: spend, clicks, impressions, conversions, avg CPA, avg CTR.

```sql
SELECT
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.cost_per_conversion,
  metrics.ctr
FROM customer
WHERE segments.date DURING LAST_30_DAYS
```

#### `getCampaignPerformance(days: AdsDayRange)`

Returns per-campaign: name, status, impressions, clicks, CTR, cost, conversions, CPA.

```sql
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
WHERE segments.date DURING LAST_30_DAYS
  AND campaign.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
```

#### `getKeywordPerformance(days: AdsDayRange, limit: number)`

Returns per-keyword: text, match type, impressions, clicks, cost, conversions, quality score.

```sql
SELECT
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.historical_quality_score
FROM keyword_view
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.cost_micros DESC
LIMIT 50
```

#### `getSearchTerms(days: AdsDayRange, limit: number)`

Returns actual search queries: term, impressions, clicks, cost, conversions.

```sql
SELECT
  search_term_view.search_term,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
ORDER BY metrics.impressions DESC
LIMIT 50
```

#### `getCostPerConversion(days: AdsDayRange)`

Returns CPA broken down by conversion action name. Queries `FROM campaign` with `segments.conversion_action` as a dimension (not `FROM conversion_action`, which only returns metadata).

```sql
SELECT
  segments.conversion_action_name,
  metrics.conversions,
  metrics.cost_per_conversion,
  metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
  AND segments.conversion_action_name != ''
```

#### `getDailySpend(days: AdsDayRange)`

Returns day-by-day spend for sparkline charts.

```sql
SELECT
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions
FROM customer
WHERE segments.date DURING LAST_30_DAYS
ORDER BY segments.date ASC
```

### 1.3 Type Definitions

New file: `src/lib/analytics/google-ads-types.ts`

```typescript
export type AdsDayRange = 7 | 14 | 30;

export interface GoogleAdsAccountSummary {
  totalSpend: number;       // dollars (converted from micros)
  totalClicks: number;
  totalImpressions: number;
  totalConversions: number;
  avgCpa: number;           // dollars
  avgCtr: number;           // percentage
}

export interface CampaignPerformance {
  name: string;
  status: "ENABLED" | "PAUSED" | "REMOVED";
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;             // dollars
  conversions: number;
  cpa: number;              // dollars
}

export interface KeywordPerformance {
  keyword: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  qualityScore: number | null;
}

export interface SearchTermData {
  searchTerm: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

export interface ConversionBreakdown {
  actionName: string;
  conversions: number;
  cpa: number;
  cost: number;
}

export interface DailySpend {
  date: string;             // YYYY-MM-DD
  spend: number;
  clicks: number;
  conversions: number;
}
```

### 1.4 Shared `safe()` Utility

The `safe()` error wrapper is currently defined inline in both `acquisition/page.tsx` and `blog/page.tsx`. Extract to a shared utility:

**New file:** `src/lib/utils/safe.ts`

```typescript
/** Wrap a promise so it returns a fallback on error instead of rejecting. */
export async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}
```

Update existing `acquisition/page.tsx` and `blog/page.tsx` to import from `@/lib/utils/safe` instead of defining locally.

### 1.5 Caching Strategy

```typescript
import { unstable_cache } from "next/cache";

export const getCachedAccountSummary = unstable_cache(
  (days: AdsDayRange) => getAccountSummary(days),
  ["google-ads-account-summary"],
  { revalidate: 300 }  // 5 min auto-expiry, same as existing admin queries
);

// Same pattern for all query functions
```

**Note on refresh button:** The existing admin pages use only time-based `revalidate: 300` without tag-based invalidation. For v1, we match this existing pattern (5-minute auto-expiry only). The refresh button will use `router.refresh()` to re-render the server component, which will get fresh data if the cache has expired. This avoids introducing `revalidateTag` as a new pattern.

### 1.6 API Quota Awareness

Google Ads API basic access allows 15,000 requests/day. With 5 parallel queries per page load and a 5-minute cache, even aggressive usage (checking every 5 minutes for 12 hours) = ~720 requests/day — well within limits. No additional rate limiting needed beyond the cache TTL.

---

## 2. Dedicated Google Ads Tab

### 2.1 Route: `/admin/google-ads`

New sidebar item positioned after ACQUISITION (related: organic traffic → paid traffic → testing):

```typescript
// sidebar.tsx NAV_ITEMS — insert at index 2
{ href: "/admin/google-ads", label: "GOOGLE ADS" },
```

### 2.2 Page Layout

Server component: `src/app/admin/google-ads/page.tsx`

**Structure (top to bottom):**

1. `AdminPageHeader` — title "GOOGLE ADS", caption "near real-time · 5 min cache"
2. **Date range selector + refresh button** — reuse existing `DateRangeControl` component
3. **KPI Grid** — 4 StatCards:
   - Total Spend (with daily sparkline)
   - Cost per Signup (trend arrow vs prior period)
   - Cost per Install (trend arrow)
   - Avg CTR (trend arrow)
4. **Campaign Performance Table** — sortable, full campaign breakdown
5. **Keyword Performance Table** — sorted by cost desc, quality score indicators
6. **Search Terms Table** — sorted by impressions desc

### 2.3 Loading State

New file: `src/app/admin/google-ads/loading.tsx`

Google Ads API can take 2-5 seconds per query (5 queries in parallel). Provide a skeleton loading state using the same pattern as other admin pages — shimmer placeholders for StatCards and table rows.

### 2.4 Components

New directory: `src/app/admin/google-ads/_components/`

#### `google-ads-content.tsx` (client component — main wrapper)

The page is a server component that fetches data, but date range switching needs client interactivity. This wrapper component:
- Receives initial data (30d default) from server
- Contains `DateRangeControl` (reused from `src/app/admin/_components/date-range-control.tsx`) with `presets={["7d", "30d"]}` plus a custom "14D" preset added to the component
- On range change, fetches new data via API route (see 2.5)
- Renders all child components (KPIs, tables)

**Note:** The existing `DateRangeControl` supports configurable preset subsets via the `presets` prop. It uses client-side callbacks (not URL search params), which aligns with how other admin pages work. If "14d" preset is needed, extend the `DatePreset` type and add to the component.

#### `campaign-table.tsx` (client component)

- Uses existing `SortableTableHeader` + `useSortState` from `src/app/admin/_components/sortable-table-header.tsx`
- Column headers: `font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]` (matches existing)
- Data cells: `font-mohave text-[14px] text-[#E5E5E5]`
- Status column: OpsStatusBadge — ENABLED = accent color, PAUSED = muted
- Cost displayed as `$X.XX`, CPA as `$X.XX`
- Row dividers: `border-b border-white/[0.08]` (matches existing convention)

#### `keyword-table.tsx` (client component)

- Uses existing `SortableTableHeader` + `useSortState`
- Match type shown as small badge: `[EXACT]` `[PHRASE]` `[BROAD]`
- Quality score color coding:
  - 7-10: `text-[#9DB582]` (green)
  - 4-6: `text-[#C4A868]` (amber)
  - 1-3: `text-[#93321A]` (red)
  - null: `text-[#6B6B6B]` with "—"
- Default sort: cost descending

#### `search-terms-table.tsx` (client component)

- Uses existing `SortableTableHeader` + `useSortState`
- Default sort: impressions descending
- Simpler — no quality score, no match type

### 2.5 API Route for Client-Side Date Range Switching

New file: `src/app/api/admin/google-ads/route.ts`

Since the page server component fetches 30d data on initial load, switching to 7d or 14d needs a client-side fetch. This API route handles that:

```typescript
// GET /api/admin/google-ads?days=7
export async function GET(req: Request) {
  // Verify admin auth (same pattern as other admin API routes)
  const days = parseDays(new URL(req.url).searchParams.get("days"));
  const data = await fetchGoogleAdsData(days);
  return Response.json(data);
}
```

### 2.6 Sparkline Data Mapping

`StatCard` accepts `sparklineData` typed as `ChartDataPoint[]` (from `@/lib/admin/types`):

```typescript
interface ChartDataPoint { label: string; value: number; }
```

Map `DailySpend[]` to `ChartDataPoint[]`:

```typescript
const sparklineData: ChartDataPoint[] = dailySpend.map(d => ({
  label: d.date,
  value: d.spend,
}));
```

---

## 3. Acquisition Page Integration

### 3.1 New "Paid Acquisition" Section

Added below the existing organic KPI grid in `src/app/admin/acquisition/page.tsx`.

**Section header:** `font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B]` — "PAID ACQUISITION"

**3 new StatCards in a row:**

| Card | Value | Source |
|------|-------|--------|
| Ad Spend (30d) | `$X,XXX` | `getAccountSummary(30).totalSpend` |
| Paid Signups | `XX` | signup conversion count from `getCostPerConversion(30)` |
| Paid CPA | `$XX.XX` | signup CPA from `getCostPerConversion(30)` |

**Link:** Small "View details →" link to `/admin/google-ads` after the cards, styled as `font-kosugi text-[11px] text-[#597794] hover:text-[#E5E5E5]`.

### 3.2 Data Fetching Changes

Add Google Ads queries to `fetchAcquisitionData()`:

```typescript
// Add to existing Promise.all
const [/* ...existing */, adsSummary, adsConversions] = await Promise.all([
  /* ...existing queries */,
  safe(getCachedAccountSummary(30), null),
  safe(getCachedCostPerConversion(30), []),
]);
```

### 3.3 Graceful Degradation

If Google Ads data fails or isn't configured:
- The "Paid Acquisition" section is hidden entirely
- Existing organic metrics display normally — no impact

---

## 4. Overview Page Integration

### 4.1 New KPI Item

Add to the KPI bar in `src/app/admin/page.tsx`:

```typescript
// After MRR, before Trial Conv
<KpiItem label="Ad CPA" value={data.adCpa ? `$${data.adCpa}` : "—"} href="/admin/google-ads" />
```

No accent threshold — the value speaks for itself. Accent is reserved for boolean alert conditions (like `trialsExpiring > 0`) per existing convention.

### 4.2 Data Fetching Changes

Add to `fetchOverviewData()`:

```typescript
const adsSummary = await safe(getCachedAccountSummary(30), null);
```

### 4.3 Graceful Degradation

If unavailable, the KPI item shows "—" as value instead of being hidden (maintains consistent KPI bar layout).

---

## 5. Error Handling

### 5.1 Missing Configuration

Check `process.env.GOOGLE_ADS_DEVELOPER_TOKEN` — if missing, show:
- Google Ads page: full-page "Google Ads not configured" message with setup instructions
- Acquisition/Overview: hide ads widgets silently

### 5.2 API Errors

- Auth expired (refresh token revoked): show "Re-authentication required" with instructions
- Quota exceeded: show "API quota exceeded, try again later" with timestamp
- Network/timeout: show "Failed to fetch" with retry button
- Each section fails independently — campaign table error doesn't break keyword table

### 5.3 Empty State

No campaigns / no keywords / no search terms: show `OpsEmptyState` component with contextual message.

---

## 6. OAuth2 Setup (One-Time)

### 6.1 Refresh Token Generation

Build a one-time utility route: `src/app/api/admin/google-ads/auth/route.ts`

- GET: redirects to Google OAuth consent URL with `https://www.googleapis.com/auth/adwords` scope
- Callback receives auth code, exchanges for refresh token, displays it
- Admin copies refresh token to Vercel env vars
- Route can be removed after setup (or kept behind admin auth for token rotation)

### 6.2 Developer Token

- Applied for at https://ads.google.com/aw/apicenter
- Basic access (own account) is typically approved within a few business days
- Store as `GOOGLE_ADS_DEVELOPER_TOKEN` env var

---

## 7. File Inventory

### New Files

| File | Type | Purpose |
|------|------|---------|
| `src/lib/analytics/google-ads-client.ts` | Server | API client, singleton, all GAQL queries |
| `src/lib/analytics/google-ads-types.ts` | Shared | TypeScript interfaces |
| `src/lib/utils/safe.ts` | Shared | Extracted `safe()` error wrapper utility |
| `src/app/admin/google-ads/page.tsx` | Server component | Dedicated ads page |
| `src/app/admin/google-ads/loading.tsx` | Server component | Skeleton loading state |
| `src/app/admin/google-ads/_components/google-ads-content.tsx` | Client component | Main wrapper with date range state |
| `src/app/admin/google-ads/_components/campaign-table.tsx` | Client component | Sortable campaign table |
| `src/app/admin/google-ads/_components/keyword-table.tsx` | Client component | Keyword performance table |
| `src/app/admin/google-ads/_components/search-terms-table.tsx` | Client component | Search term report table |
| `src/app/api/admin/google-ads/route.ts` | API route | Client-side date range switching |
| `src/app/api/admin/google-ads/auth/route.ts` | API route | One-time OAuth2 token generation |

### Modified Files

| File | Change |
|------|--------|
| `src/app/admin/_components/sidebar.tsx` | Add GOOGLE ADS nav item |
| `src/app/admin/_components/date-range-control.tsx` | Add "14d" preset option |
| `src/app/admin/page.tsx` | Add Ad CPA to KPI bar |
| `src/app/admin/acquisition/page.tsx` | Add Paid Acquisition section, import from `@/lib/utils/safe` |
| `src/app/admin/blog/page.tsx` | Import from `@/lib/utils/safe` (cleanup) |
| `.env.example` | Add 3 new env vars |
| `package.json` | Add `google-ads-api` dependency |

---

## 8. Dependencies

### npm

- `google-ads-api` — Google Ads API client (TypeScript, community-maintained). Verify supports API v18+ and recent publish date. Fallback: `google-ads-node` (official) or `googleapis` REST.

### Environment

- Google Ads API developer token (pending application)
- OAuth2 refresh token (one-time generation via auth route)
- Customer ID: 4454506598

---

## 9. Out of Scope (v1)

- Ad group level breakdown (future: expandable campaign rows)
- Budget utilization / pacing
- ROAS calculation (requires revenue attribution)
- Automated alerts (CPA spike, budget exhausted)
- Historical trend charts (sparklines in v1, full charts in v2)
- Google Ads conversion tracking setup (assumes already configured)
- Tag-based cache invalidation (use time-based TTL for v1, match existing pattern)
