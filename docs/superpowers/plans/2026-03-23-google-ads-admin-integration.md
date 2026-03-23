# Google Ads Admin Panel Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Ads campaign performance data to the OPS admin panel — a dedicated `/admin/google-ads` tab plus integrated KPI widgets on the Acquisition and Overview pages.

**Architecture:** Server-side Google Ads API client (singleton, matching GA4 client pattern) → cached queries (5-min TTL via `unstable_cache`) → server component data fetching → client component tables/charts. Date range switching via client-side API route. All UI follows OPS design system: `#0D0D0D` background, Mohave/Kosugi fonts, borders-only depth, no shadows.

**Tech Stack:** Next.js 14 App Router, TypeScript, `google-ads-api` npm package, Recharts (sparklines), Framer Motion (page load stagger), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-23-google-ads-admin-integration-design.md`

**Design System:** `C:\OPS\.interface-design\system.md`

---

## Design & Animation Decisions

### Interface Design

This is an admin data dashboard — the person using it is Jack, checking ad performance multiple times daily. The interface must be dense with data but scannable at a glance. Military-tactical aesthetic: information arrives crisp and organized, like a mission briefing.

**Intent:** Admin checking paid acquisition performance under time pressure. Get in, read the numbers, get out.
**Palette:** `#0D0D0D` background, `#E5E5E5` primary text, `#6B6B6B` tertiary, `#597794` accent (sparingly — only on the active date range pill and the "View details" link), `#9DB582`/`#C4A868`/`#93321A` for quality score indicators.
**Depth:** Borders only. `rgba(255, 255, 255, 0.08)` for card edges and table dividers.
**Surfaces:** StatCards use `bg-white/[0.02]` with `border border-white/[0.08]` — matching existing admin pattern exactly.
**Typography:** Mohave for all data (numbers, labels, table cells, column headers). Kosugi for captions and metadata only.
**Spacing:** 8dp grid. `p-8` section padding, `gap-4` between stat cards, `gap-8` between sections.

### Animation Decisions

**Emotional beat:** Transition + Discovery. The user arrives at the page (transition from sidebar click) and immediately scans data (discovery). All motion serves information delivery, not decoration.

**Framework:** Framer Motion for stagger reveals (already in the project), CSS for hover states. No GSAP, no Canvas — overkill for a data dashboard.

**Specific animations:**

| Element | Animation | Duration | Easing | Rationale |
|---------|-----------|----------|--------|-----------|
| Page load (StatCards) | Staggered fade+translateY | 200ms per card, 50ms stagger | `EASE_SMOOTH` from `motion.ts` | Cards "arrive" crisply, military precision |
| Page load (Tables) | Fade in after cards complete | 250ms | `EASE_SMOOTH` from `motion.ts` | Sequential information delivery |
| Table sort | No animation — instant re-render | 0ms | — | Sorting is a data operation, not a spectacle. Instant response = respect for the user's time |
| Date range switch | Content area opacity crossfade | 150ms out, 200ms in | ease-out / ease-in | Acknowledges loading without drama |
| Loading skeleton | Tactical bars shimmer (per design system) | 800ms loop | linear | Radar-sweep shimmer on placeholder bars |
| Stat number | No counting animation | — | — | Numbers must be readable instantly. Counting animations delay comprehension and violate "get in, read, get out" |
| Hover on table row | `bg-white/[0.02]` → `bg-white/[0.04]` | 100ms | ease | Subtle discovery feedback |

**Reduced motion:** All stagger animations collapse to simple opacity fade (0 → 1, 200ms). Loading shimmer remains (non-vestibular). Hover states remain.

**Haptics:** None. This is a web admin panel on desktop. No haptic context.

---

## File Structure

### New Files (11)

| File | Responsibility |
|------|---------------|
| `src/lib/utils/safe.ts` | Shared `safe()` error wrapper (extracted from inline defs) |
| `src/lib/analytics/google-ads-types.ts` | TypeScript interfaces for all Google Ads data |
| `src/lib/analytics/google-ads-client.ts` | Singleton API client, all GAQL queries, cached wrappers |
| `src/app/admin/google-ads/page.tsx` | Server component — fetches 30d data, renders page shell |
| `src/app/admin/google-ads/loading.tsx` | Skeleton loading state (tactical shimmer bars) |
| `src/app/admin/google-ads/_components/google-ads-content.tsx` | Client wrapper — date range state, data refresh, stagger animation |
| `src/app/admin/google-ads/_components/campaign-table.tsx` | Sortable campaign performance table |
| `src/app/admin/google-ads/_components/keyword-table.tsx` | Sortable keyword performance table with quality score |
| `src/app/admin/google-ads/_components/search-terms-table.tsx` | Sortable search terms table |
| `src/app/api/admin/google-ads/route.ts` | API route for client-side date range switching |
| `src/app/api/admin/google-ads/auth/route.ts` | One-time OAuth2 refresh token generator |

### Modified Files (7)

| File | Change |
|------|--------|
| `src/app/admin/_components/sidebar.tsx` | Add GOOGLE ADS nav item at index 2 |
| `src/app/admin/_components/date-range-control.tsx` | Add `"14d"` to `DatePreset` type and presets array |
| `src/app/admin/page.tsx` | Add Ad CPA KPI item to overview bar |
| `src/app/admin/acquisition/page.tsx` | Add Paid Acquisition section, switch to shared `safe()` |
| `src/app/admin/blog/page.tsx` | Switch to shared `safe()` (cleanup) |
| `src/lib/admin/types.ts` | Add `"14d"` to `DatePreset` type |
| `.env.example` | Add 3 new env vars |

---

## Task 1: Install dependency + env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install google-ads-api**

```bash
cd /c/OPS/ops-web && npm install google-ads-api
```

Verify the package is recent (check npm page for last publish date and Google Ads API version support). If stale (>6 months old or no v18+ support), use `google-ads-node` instead.

- [ ] **Step 2: Add env vars to .env.example**

Add these lines to `.env.example` after the existing Google env vars (around line 57):

```
GOOGLE_ADS_DEVELOPER_TOKEN=                           # [V]
GOOGLE_ADS_REFRESH_TOKEN=                             # [V]
GOOGLE_ADS_CUSTOMER_ID=4454506598                     # [V]
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add google-ads-api dependency and env var placeholders"
```

---

## Task 2: Extract shared `safe()` utility

**Files:**
- Create: `src/lib/utils/safe.ts`
- Modify: `src/app/admin/acquisition/page.tsx`
- Modify: `src/app/admin/blog/page.tsx`

- [ ] **Step 1: Create shared safe utility**

Create `src/lib/utils/safe.ts`:

```typescript
/** Wrap a promise so it returns a fallback on error instead of rejecting. */
export async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 2: Update acquisition page to use shared safe**

In `src/app/admin/acquisition/page.tsx`, remove the local `safe()` definition (lines 10-12) and add this import at the top:

```typescript
import { safe } from "@/lib/utils/safe";
```

- [ ] **Step 3: Update blog page to use shared safe**

In `src/app/admin/blog/page.tsx`, remove the local `safe()` definition (lines 15-21, the entire function including its multi-line body) and add this import:

```typescript
import { safe } from "@/lib/utils/safe";
```

- [ ] **Step 4: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/safe.ts src/app/admin/acquisition/page.tsx src/app/admin/blog/page.tsx
git commit -m "refactor: extract shared safe() utility from admin pages"
```

---

## Task 3: Type definitions

**Files:**
- Create: `src/lib/analytics/google-ads-types.ts`

- [ ] **Step 1: Create type definitions file**

Create `src/lib/analytics/google-ads-types.ts`:

```typescript
/**
 * OPS Admin — Google Ads API Types
 *
 * SERVER + CLIENT. Safe to import from any component.
 */

/** Constrained day range matching GAQL DURING clause literals */
export type AdsDayRange = 7 | 14 | 30;

export interface GoogleAdsAccountSummary {
  totalSpend: number;       // dollars (converted from micros)
  totalClicks: number;
  totalImpressions: number;
  totalConversions: number;
  avgCpa: number;           // dollars
  avgCtr: number;           // 0-1 decimal
}

export interface CampaignPerformance {
  name: string;
  status: "ENABLED" | "PAUSED" | "REMOVED";
  impressions: number;
  clicks: number;
  ctr: number;              // 0-1 decimal
  cost: number;             // dollars
  conversions: number;
  cpa: number;              // dollars
}

export interface KeywordPerformance {
  keyword: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  impressions: number;
  clicks: number;
  cost: number;             // dollars
  conversions: number;
  qualityScore: number | null;
}

export interface SearchTermData {
  searchTerm: string;
  impressions: number;
  clicks: number;
  cost: number;             // dollars
  conversions: number;
}

export interface ConversionBreakdown {
  actionName: string;
  conversions: number;
  cpa: number;              // dollars
  cost: number;             // dollars
}

export interface DailySpend {
  date: string;             // YYYY-MM-DD
  spend: number;            // dollars
  clicks: number;
  conversions: number;
}

/** Full data payload for the Google Ads admin page */
export interface GoogleAdsPageData {
  adsAvailable: boolean;
  summary: GoogleAdsAccountSummary | null;
  campaigns: CampaignPerformance[];
  keywords: KeywordPerformance[];
  searchTerms: SearchTermData[];
  dailySpend: DailySpend[];
  conversions: ConversionBreakdown[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/analytics/google-ads-types.ts
git commit -m "feat: add Google Ads type definitions"
```

---

## Task 4: Google Ads API client + cached queries

**Files:**
- Create: `src/lib/analytics/google-ads-client.ts`

This is the largest single file. It follows the exact singleton pattern of `src/lib/analytics/ga4-client.ts`.

- [ ] **Step 1: Create the client file**

Create `src/lib/analytics/google-ads-client.ts`:

```typescript
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

  // Customer-level query returns one aggregated row
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
```

- [ ] **Step 2: Verify types compile**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/google-ads-client.ts
git commit -m "feat: add Google Ads API client with cached GAQL queries"
```

---

## Task 5: Add "14d" preset to DateRangeControl

**Files:**
- Modify: `src/lib/admin/types.ts`
- Modify: `src/app/admin/_components/date-range-control.tsx`

- [ ] **Step 1: Add "14d" to DatePreset type**

In `src/lib/admin/types.ts`, line 236, change:

```typescript
export type DatePreset = "today" | "7d" | "30d" | "90d" | "12m" | "all";
```

to:

```typescript
export type DatePreset = "today" | "7d" | "14d" | "30d" | "90d" | "12m" | "all";
```

- [ ] **Step 2: Add "14d" to DateRangeControl presets and logic**

In `src/app/admin/_components/date-range-control.tsx`:

Add to `PRESETS` array (line 13, after the `7d` entry):

```typescript
{ key: "14d", label: "14D" },
```

Add to `AUTO_GRANULARITY` (line 21, after `"7d": "daily"`):

```typescript
"14d": "daily",
```

Add to `presetToRange` switch (line 30, after `case "7d"`):

```typescript
case "14d":
  return { from: subDays(now, 14), to };
```

- [ ] **Step 3: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/types.ts src/app/admin/_components/date-range-control.tsx
git commit -m "feat: add 14-day preset to DateRangeControl"
```

---

## Task 6: Sidebar navigation update

**Files:**
- Modify: `src/app/admin/_components/sidebar.tsx`

- [ ] **Step 1: Add GOOGLE ADS nav item**

In `src/app/admin/_components/sidebar.tsx`, insert at index 2 in `NAV_ITEMS` (after ACQUISITION, before A/B TESTING):

```typescript
{ href: "/admin/google-ads", label: "GOOGLE ADS" },
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/_components/sidebar.tsx
git commit -m "feat: add Google Ads to admin sidebar navigation"
```

---

## Task 7: API route for date range switching

**Files:**
- Create: `src/app/api/admin/google-ads/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/admin/google-ads/route.ts`. Uses the `withAdmin` wrapper from `@/lib/admin/api-auth` (the newer centralized pattern with proper error handling):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import { safe } from "@/lib/utils/safe";
import {
  isGoogleAdsConfigured,
  getCachedAccountSummary,
  getCachedCampaignPerformance,
  getCachedKeywordPerformance,
  getCachedSearchTerms,
  getCachedDailySpend,
  getCachedCostPerConversion,
} from "@/lib/analytics/google-ads-client";
import type { AdsDayRange, GoogleAdsPageData } from "@/lib/analytics/google-ads-types";

const VALID_DAYS = new Set<AdsDayRange>([7, 14, 30]);

function parseDays(value: string | null): AdsDayRange {
  const num = Number(value);
  if (VALID_DAYS.has(num as AdsDayRange)) return num as AdsDayRange;
  return 30;
}

export const GET = withAdmin(async (req: NextRequest) => {
  if (!isGoogleAdsConfigured()) {
    return NextResponse.json({
      adsAvailable: false,
      summary: null,
      campaigns: [],
      keywords: [],
      searchTerms: [],
      dailySpend: [],
      conversions: [],
    } satisfies GoogleAdsPageData);
  }

  const days = parseDays(req.nextUrl.searchParams.get("days"));

  const [summary, campaigns, keywords, searchTerms, dailySpend, conversions] =
    await Promise.all([
      safe(getCachedAccountSummary(days), null),
      safe(getCachedCampaignPerformance(days), []),
      safe(getCachedKeywordPerformance(days, 50), []),
      safe(getCachedSearchTerms(days, 50), []),
      safe(getCachedDailySpend(days), []),
      safe(getCachedCostPerConversion(days), []),
    ]);

  return NextResponse.json({
    adsAvailable: true,
    summary,
    campaigns,
    keywords,
    searchTerms,
    dailySpend,
    conversions,
  } satisfies GoogleAdsPageData);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/google-ads/route.ts
git commit -m "feat: add Google Ads API route for date range switching"
```

---

## Task 8: Loading skeleton

**Files:**
- Create: `src/app/admin/google-ads/loading.tsx`

- [ ] **Step 1: Create loading skeleton**

Create `src/app/admin/google-ads/loading.tsx`. Uses the tactical shimmer loading pattern from the OPS design system — vertical bars with a radar-sweep ripple in `colorAccent` (#597794).

```typescript
export default function GoogleAdsLoading() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="border-b border-white/[0.08] px-8 py-6">
        <div className="h-7 w-48 bg-white/[0.04] rounded animate-pulse" />
        <div className="h-4 w-64 bg-white/[0.03] rounded mt-2 animate-pulse" />
      </div>

      <div className="p-8 space-y-8">
        {/* Date range skeleton */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 w-12 bg-white/[0.04] rounded-full animate-pulse" />
          ))}
        </div>

        {/* KPI cards skeleton */}
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
              <div className="h-3 w-20 bg-white/[0.04] rounded animate-pulse mb-3" />
              <div className="h-9 w-24 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-3 w-16 bg-white/[0.03] rounded animate-pulse mt-2" />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-40 bg-white/[0.04] rounded animate-pulse mb-4" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-white/[0.06]">
              <div className="h-4 w-32 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/[0.03] rounded animate-pulse" />
              <div className="h-4 w-20 bg-white/[0.03] rounded animate-pulse" />
              <div className="h-4 w-16 bg-white/[0.04] rounded animate-pulse" />
              <div className="h-4 w-20 bg-white/[0.03] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/loading.tsx
git commit -m "feat: add Google Ads loading skeleton"
```

---

## Task 9: Campaign table component

**Files:**
- Create: `src/app/admin/google-ads/_components/campaign-table.tsx`

- [ ] **Step 1: Create campaign table**

Create `src/app/admin/google-ads/_components/campaign-table.tsx`:

```typescript
"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { CampaignPerformance } from "@/lib/analytics/google-ads-types";

const COLUMNS = [
  { key: "name", label: "Campaign" },
  { key: "status", label: "Status" },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "ctr", label: "CTR" },
  { key: "cost", label: "Cost" },
  { key: "conversions", label: "Conv." },
  { key: "cpa", label: "CPA" },
];

const STATUS_STYLES: Record<string, string> = {
  ENABLED: "bg-[#597794]/20 text-[#597794]",
  PAUSED: "bg-white/[0.06] text-[#6B6B6B]",
  REMOVED: "bg-white/[0.04] text-[#444444]",
};

interface CampaignTableProps {
  campaigns: CampaignPerformance[];
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
  const { sort, toggle, sorted } = useSortState("cost");

  if (campaigns.length === 0) {
    return (
      <div className="border-l-2 border-l-white/[0.08] py-3 px-3">
        <p className="font-mohave text-[14px] text-[#6B6B6B]">No campaign data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Campaign Performance
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <SortableTableHeader columns={COLUMNS} sort={sort} onSort={toggle} />
          </thead>
          <tbody>
            {sorted(campaigns).map((c) => (
              <tr
                key={c.name}
                className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100"
              >
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">{c.name}</td>
                <td className="py-3 pr-3">
                  <span className={`inline-block px-2 py-0.5 rounded font-mohave text-[11px] uppercase ${STATUS_STYLES[c.status] ?? STATUS_STYLES.PAUSED}`}>
                    {c.status}
                  </span>
                </td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{c.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{c.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{(c.ctr * 100).toFixed(1)}%</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${c.cost.toFixed(2)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{c.conversions.toFixed(1)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${c.cpa.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/_components/campaign-table.tsx
git commit -m "feat: add campaign performance table component"
```

---

## Task 10: Keyword table component

**Files:**
- Create: `src/app/admin/google-ads/_components/keyword-table.tsx`

- [ ] **Step 1: Create keyword table**

Create `src/app/admin/google-ads/_components/keyword-table.tsx`:

```typescript
"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { KeywordPerformance } from "@/lib/analytics/google-ads-types";

const COLUMNS = [
  { key: "keyword", label: "Keyword" },
  { key: "matchType", label: "Match" },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "cost", label: "Cost" },
  { key: "conversions", label: "Conv." },
  { key: "qualityScore", label: "QS" },
];

function QualityScore({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-[#6B6B6B]">—</span>;
  }
  const color =
    score >= 7 ? "text-[#9DB582]" :
    score >= 4 ? "text-[#C4A868]" :
    "text-[#93321A]";
  return <span className={color}>{score}/10</span>;
}

interface KeywordTableProps {
  keywords: KeywordPerformance[];
}

export function KeywordTable({ keywords }: KeywordTableProps) {
  const { sort, toggle, sorted } = useSortState("cost");

  if (keywords.length === 0) {
    return (
      <div className="border-l-2 border-l-white/[0.08] py-3 px-3">
        <p className="font-mohave text-[14px] text-[#6B6B6B]">No keyword data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Keyword Performance
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <SortableTableHeader columns={COLUMNS} sort={sort} onSort={toggle} />
          </thead>
          <tbody>
            {sorted(keywords).map((k, i) => (
              <tr
                key={`${k.keyword}-${i}`}
                className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100"
              >
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">{k.keyword}</td>
                <td className="py-3 pr-3">
                  <span className="font-kosugi text-[10px] text-[#6B6B6B] uppercase">
                    [{k.matchType}]
                  </span>
                </td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{k.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{k.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${k.cost.toFixed(2)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{k.conversions.toFixed(1)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] tabular-nums">
                  <QualityScore score={k.qualityScore} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/_components/keyword-table.tsx
git commit -m "feat: add keyword performance table component"
```

---

## Task 11: Search terms table component

**Files:**
- Create: `src/app/admin/google-ads/_components/search-terms-table.tsx`

- [ ] **Step 1: Create search terms table**

Create `src/app/admin/google-ads/_components/search-terms-table.tsx`:

```typescript
"use client";

import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type { SearchTermData } from "@/lib/analytics/google-ads-types";

const COLUMNS = [
  { key: "searchTerm", label: "Search Term" },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "cost", label: "Cost" },
  { key: "conversions", label: "Conv." },
];

interface SearchTermsTableProps {
  searchTerms: SearchTermData[];
}

export function SearchTermsTable({ searchTerms }: SearchTermsTableProps) {
  const { sort, toggle, sorted } = useSortState("impressions");

  if (searchTerms.length === 0) {
    return (
      <div className="border-l-2 border-l-white/[0.08] py-3 px-3">
        <p className="font-mohave text-[14px] text-[#6B6B6B]">No search term data available</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
        Search Terms
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <SortableTableHeader columns={COLUMNS} sort={sort} onSort={toggle} />
          </thead>
          <tbody>
            {sorted(searchTerms).map((t, i) => (
              <tr
                key={`${t.searchTerm}-${i}`}
                className="border-b border-white/[0.08] hover:bg-white/[0.02] transition-colors duration-100"
              >
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5]">{t.searchTerm}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{t.impressions.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{t.clicks.toLocaleString()}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#E5E5E5] tabular-nums">${t.cost.toFixed(2)}</td>
                <td className="py-3 pr-3 font-mohave text-[14px] text-[#A0A0A0] tabular-nums">{t.conversions.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/_components/search-terms-table.tsx
git commit -m "feat: add search terms table component"
```

---

## Task 12: Google Ads content wrapper (client component)

**Files:**
- Create: `src/app/admin/google-ads/_components/google-ads-content.tsx`

This is the main client component that handles date range state, data fetching on range change, and stagger animation on page load.

- [ ] **Step 1: Create the content wrapper**

Create `src/app/admin/google-ads/_components/google-ads-content.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { DateRangeControl } from "../../_components/date-range-control";
import { StatCard } from "../../_components/stat-card";
import { CampaignTable } from "./campaign-table";
import { KeywordTable } from "./keyword-table";
import { SearchTermsTable } from "./search-terms-table";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { GoogleAdsPageData, AdsDayRange } from "@/lib/analytics/google-ads-types";
import type { ChartDataPoint, DateRangeParams } from "@/lib/admin/types";

// ─── Animation (per design system: EASE_SMOOTH, no spring/bounce) ─────────────

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
};

// Reduced motion: collapse to simple fade
const fadeOnly = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface GoogleAdsContentProps {
  initialData: GoogleAdsPageData;
}

export function GoogleAdsContent({ initialData }: GoogleAdsContentProps) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Check reduced motion preference
  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const variant = prefersReducedMotion ? fadeOnly : fadeUp;

  const handleRangeChange = useCallback(async (params: DateRangeParams) => {
    // Map DateRangeParams to AdsDayRange
    const diffMs = new Date(params.to).getTime() - new Date(params.from).getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const days: AdsDayRange = diffDays <= 7 ? 7 : diffDays <= 14 ? 14 : 30;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/google-ads?days=${days}`);
      if (res.ok) {
        const newData: GoogleAdsPageData = await res.json();
        setData(newData);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const sparklineData: ChartDataPoint[] = data.dailySpend.map((d) => ({
    label: d.date,
    value: d.spend,
  }));

  // Find signup CPA from conversion breakdown
  const signupConversion = data.conversions.find(
    (c) => c.actionName.toLowerCase().includes("signup") || c.actionName.toLowerCase().includes("sign_up") || c.actionName.toLowerCase().includes("trial")
  );
  const installConversion = data.conversions.find(
    (c) => c.actionName.toLowerCase().includes("install")
  );

  return (
    <div className={`p-8 space-y-8 transition-opacity duration-150 ${loading ? "opacity-60" : "opacity-100"}`}>
      {/* Date range + refresh */}
      <div className="flex items-center justify-between">
        <DateRangeControl
          defaultPreset="30d"
          presets={["7d", "14d", "30d"]}
          onChange={handleRangeChange}
        />
        <button
          onClick={handleRefresh}
          className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B] hover:text-[#A0A0A0] transition-colors px-3 py-1"
        >
          Refresh
        </button>
      </div>

      {/* KPI Cards — staggered entry */}
      <motion.div
        className="grid grid-cols-4 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={variant}>
          <StatCard
            label="Total Spend"
            value={data.summary ? `$${data.summary.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
            caption="last period"
            sparklineData={sparklineData}
          />
        </motion.div>
        <motion.div variants={variant}>
          <StatCard
            label="Cost per Signup"
            value={signupConversion ? `$${signupConversion.cpa.toFixed(2)}` : "—"}
            caption={signupConversion ? `${signupConversion.conversions.toFixed(0)} conversions` : "no signup data"}
          />
        </motion.div>
        <motion.div variants={variant}>
          <StatCard
            label="Cost per Install"
            value={installConversion ? `$${installConversion.cpa.toFixed(2)}` : "—"}
            caption={installConversion ? `${installConversion.conversions.toFixed(0)} installs` : "no install data"}
          />
        </motion.div>
        <motion.div variants={variant}>
          <StatCard
            label="Avg CTR"
            value={data.summary ? `${(data.summary.avgCtr * 100).toFixed(1)}%` : "—"}
            caption={data.summary ? `${data.summary.totalClicks.toLocaleString()} clicks` : "no data"}
          />
        </motion.div>
      </motion.div>

      {/* Tables — fade in after cards */}
      <motion.div
        className="space-y-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, delay: 0.25, ease: EASE_SMOOTH }}
      >
        <CampaignTable campaigns={data.campaigns} />
        <KeywordTable keywords={data.keywords} />
        <SearchTermsTable searchTerms={data.searchTerms} />
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/_components/google-ads-content.tsx
git commit -m "feat: add Google Ads content wrapper with date range and stagger animation"
```

---

## Task 13: Google Ads server page

**Files:**
- Create: `src/app/admin/google-ads/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/admin/google-ads/page.tsx`:

```typescript
import { AdminPageHeader } from "../_components/admin-page-header";
import { GoogleAdsContent } from "./_components/google-ads-content";
import { safe } from "@/lib/utils/safe";
import {
  isGoogleAdsConfigured,
  getCachedAccountSummary,
  getCachedCampaignPerformance,
  getCachedKeywordPerformance,
  getCachedSearchTerms,
  getCachedDailySpend,
  getCachedCostPerConversion,
} from "@/lib/analytics/google-ads-client";
import type { GoogleAdsPageData } from "@/lib/analytics/google-ads-types";

async function fetchGoogleAdsData(): Promise<GoogleAdsPageData> {
  if (!isGoogleAdsConfigured()) {
    return {
      adsAvailable: false,
      summary: null,
      campaigns: [],
      keywords: [],
      searchTerms: [],
      dailySpend: [],
      conversions: [],
    };
  }

  const [summary, campaigns, keywords, searchTerms, dailySpend, conversions] =
    await Promise.all([
      safe(getCachedAccountSummary(30), null),
      safe(getCachedCampaignPerformance(30), []),
      safe(getCachedKeywordPerformance(30, 50), []),
      safe(getCachedSearchTerms(30, 50), []),
      safe(getCachedDailySpend(30), []),
      safe(getCachedCostPerConversion(30), []),
    ]);

  return { adsAvailable: true, summary, campaigns, keywords, searchTerms, dailySpend, conversions };
}

export default async function GoogleAdsPage() {
  let data: GoogleAdsPageData;
  try {
    data = await fetchGoogleAdsData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-[#93321A] font-mohave text-lg mb-4">Google Ads Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  if (!data.adsAvailable) {
    return (
      <div>
        <AdminPageHeader title="Google Ads" caption="not configured" />
        <div className="p-8">
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02] max-w-lg">
            <h2 className="font-mohave text-[16px] text-[#E5E5E5] mb-3">SETUP REQUIRED</h2>
            <p className="font-kosugi text-[13px] text-[#6B6B6B] leading-relaxed">
              Set the following environment variables to enable Google Ads data:
            </p>
            <ul className="font-mohave text-[13px] text-[#A0A0A0] mt-3 space-y-1">
              <li>GOOGLE_ADS_DEVELOPER_TOKEN</li>
              <li>GOOGLE_ADS_REFRESH_TOKEN</li>
              <li>GOOGLE_ADS_CUSTOMER_ID</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Google Ads" caption="near real-time · 5 min cache" />
      <GoogleAdsContent initialData={data} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/google-ads/page.tsx
git commit -m "feat: add Google Ads admin page with server-side data fetching"
```

---

## Task 14: Acquisition page integration

**Files:**
- Modify: `src/app/admin/acquisition/page.tsx`

- [ ] **Step 1: Add Google Ads imports**

At the top of `src/app/admin/acquisition/page.tsx`, add:

```typescript
import Link from "next/link";
import {
  isGoogleAdsConfigured,
  getCachedAccountSummary,
  getCachedCostPerConversion,
} from "@/lib/analytics/google-ads-client";
```

Also replace the local `safe()` import (if not done in Task 2 already):

```typescript
import { safe } from "@/lib/utils/safe";
```

- [ ] **Step 2: Add Google Ads queries to fetchAcquisitionData**

Add two more items to the existing `Promise.all` in `fetchAcquisitionData()` (parallel, not sequential):

```typescript
const adsConfigured = isGoogleAdsConfigured();

// Add to the END of the existing Promise.all array:
// ..., (last existing query),
adsConfigured ? safe(getCachedAccountSummary(30), null) : Promise.resolve(null),
adsConfigured ? safe(getCachedCostPerConversion(30), []) : Promise.resolve([]),

// Add to the destructured results:
// ..., adsSummary, adsConversions
```

Return them in the data object:

```typescript
return {
  // ...existing fields
  adsSummary,
  adsConversions,
};
```

- [ ] **Step 3: Add Paid Acquisition section to the JSX**

After the existing charts section (after `<AcquisitionCharts ... />`), add:

```tsx
{/* Paid Acquisition — Google Ads */}
{data.adsSummary && (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <p className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B]">
        Paid Acquisition
      </p>
      <Link
        href="/admin/google-ads"
        className="font-kosugi text-[11px] text-[#597794] hover:text-[#E5E5E5] transition-colors"
      >
        View details →
      </Link>
    </div>
    <div className="grid grid-cols-3 gap-4">
      <StatCard
        label="Ad Spend (30d)"
        value={`$${data.adsSummary.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
      />
      <StatCard
        label="Paid Signups"
        value={(() => {
          const signup = data.adsConversions.find(
            (c: { actionName: string }) => c.actionName.toLowerCase().includes("signup") || c.actionName.toLowerCase().includes("trial")
          );
          return signup ? signup.conversions.toFixed(0) : "—";
        })()}
      />
      <StatCard
        label="Paid CPA"
        value={(() => {
          const signup = data.adsConversions.find(
            (c: { actionName: string }) => c.actionName.toLowerCase().includes("signup") || c.actionName.toLowerCase().includes("trial")
          );
          return signup ? `$${signup.cpa.toFixed(2)}` : "—";
        })()}
      />
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/acquisition/page.tsx
git commit -m "feat: integrate Google Ads paid acquisition KPIs into acquisition page"
```

---

## Task 15: Overview page integration

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Add Google Ads imports**

At the top of `src/app/admin/page.tsx`, add:

```typescript
import {
  isGoogleAdsConfigured,
  getCachedAccountSummary,
} from "@/lib/analytics/google-ads-client";
import { safe } from "@/lib/utils/safe";
```

- [ ] **Step 2: Add to fetchOverviewData**

Add Google Ads query to the existing `Promise.all` (parallel, not sequential):

```typescript
const [
  // ...existing destructured results
  adsSummary,
] = await Promise.all([
  // ...existing queries
  isGoogleAdsConfigured() ? safe(getCachedAccountSummary(30), null) : Promise.resolve(null),
]);
```

Return it in the data object:

```typescript
return {
  // ...existing fields
  adCpa: adsSummary?.avgCpa ?? null,
};
```

- [ ] **Step 3: Add KPI item to the bar**

In the KPI bar JSX (around line 82), after the MRR `KpiItem` and before Trial Conv, add:

```tsx
<span className="w-px h-3 bg-white/[0.06]" />
<KpiItem label="Ad CPA" value={data.adCpa ? `$${data.adCpa.toFixed(2)}` : "—"} href="/admin/google-ads" />
```

- [ ] **Step 4: Verify build**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat: add Ad CPA to admin overview KPI bar"
```

---

## Task 16: OAuth2 auth route (one-time setup utility)

**Files:**
- Create: `src/app/api/admin/google-ads/auth/route.ts`

- [ ] **Step 1: Create the auth route**

Create `src/app/api/admin/google-ads/auth/route.ts`.

**Important:** The OAuth callback from Google is a raw browser redirect — it won't carry Firebase auth headers. So we only enforce admin auth on the initial request (no `?code=`), not on the callback. The callback is safe because the auth code is single-use and the response only displays the token (not stored):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";

const SCOPES = ["https://www.googleapis.com/auth/adwords"];
const REDIRECT_URI_PATH = "/api/admin/google-ads/auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  // Only enforce admin auth on the initial request (not the OAuth callback)
  if (!code) {
    try {
      await requireAdmin(req);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Missing Google OAuth credentials" }, { status: 500 });
  }

  // Step 1: No code — redirect to Google consent
  if (!code) {
    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}${REDIRECT_URI_PATH}`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return NextResponse.redirect(authUrl.toString());
  }

  // Step 2: Have code — exchange for refresh token
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}${REDIRECT_URI_PATH}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Token exchange failed", details: tokenData }, { status: 500 });
  }

  // Display the refresh token for manual copy to env vars
  return new NextResponse(
    `<html>
      <body style="background:#0D0D0D;color:#E5E5E5;font-family:monospace;padding:40px;">
        <h1 style="color:#597794;">Google Ads Refresh Token</h1>
        <p>Copy this value to your GOOGLE_ADS_REFRESH_TOKEN environment variable:</p>
        <pre style="background:#1D1D1D;padding:16px;border-radius:4px;word-break:break-all;margin:16px 0;">
${tokenData.refresh_token ?? "No refresh token returned — you may need to revoke access and try again with prompt=consent"}
        </pre>
        <p style="color:#6B6B6B;">You can now close this page.</p>
      </body>
    </html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/google-ads/auth/route.ts
git commit -m "feat: add one-time OAuth2 refresh token generation route"
```

---

## Task 17: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Verify dev server starts**

```bash
cd /c/OPS/ops-web && npm run dev
```

Expected: Server starts without errors. Navigate to `/admin/google-ads` — should show the "Setup Required" state (since env vars aren't set locally).

- [ ] **Step 3: Verify sidebar shows Google Ads**

Navigate to `/admin` — sidebar should show GOOGLE ADS between ACQUISITION and A/B TESTING.

- [ ] **Step 4: Verify acquisition page still works**

Navigate to `/admin/acquisition` — should render normally. The "Paid Acquisition" section should be hidden (no Google Ads configured).

- [ ] **Step 5: Verify overview page still works**

Navigate to `/admin` — KPI bar should show "Ad CPA" with value "—".

- [ ] **Step 6: Final commit (if any unstaged changes remain)**

```bash
git status
# Only stage specific files that were missed in prior commits — do NOT use git add -A
git commit -m "feat: complete Google Ads admin panel integration

Adds dedicated /admin/google-ads tab with campaign, keyword, and search
term performance tables. Integrates paid acquisition KPIs into the
existing Acquisition page and Ad CPA into the Overview KPI bar.

- Google Ads API client with singleton pattern matching GA4 client
- 5-min cached queries for near real-time data
- Staggered page load animation (200ms, decelerate ease)
- Sortable tables using existing SortableTableHeader
- Reuses DateRangeControl with new 14d preset
- Extracted shared safe() utility
- OAuth2 auth route for one-time refresh token setup
- Graceful degradation when Google Ads not configured"
```

---

## Post-Implementation: Setup Steps

Once the code is deployed, the user needs to:

1. **Apply for Google Ads API developer token** at https://ads.google.com/aw/apicenter (if not already done)
2. **Generate refresh token**: Visit `https://app.opsapp.co/api/admin/google-ads/auth` while logged in as admin
3. **Set environment variables** in Vercel:
   - `GOOGLE_ADS_DEVELOPER_TOKEN` = (from Google)
   - `GOOGLE_ADS_REFRESH_TOKEN` = (from step 2)
   - `GOOGLE_ADS_CUSTOMER_ID` = `4454506598`
4. **Redeploy** to pick up new env vars
