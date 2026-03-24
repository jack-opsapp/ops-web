# Google Ads History Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live Google Ads API calls with a sync-to-Supabase architecture. Import full history, daily sync going forward, richer briefing context.

**Architecture:** Daily cron syncs yesterday's finalized data into 3 Supabase tables (account, campaign, keyword). Admin page reads from Supabase instead of live API. One-time backfill imports ~2 years of history. Briefings get 90-day trend context.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (service role), Google Ads API (GAQL), existing google-ads-client.ts functions

**Spec:** `docs/superpowers/specs/2026-03-23-google-ads-history-sync-design.md`

---

## File Structure

### New Files (7)

| File | Responsibility |
|------|---------------|
| `src/lib/admin/ads-history-types.ts` | TypeScript types for synced data rows |
| `src/lib/admin/ads-history-queries.ts` | Supabase CRUD (upsert, query by date range) |
| `src/lib/admin/ads-history-sync.ts` | Core sync logic — syncDay(), syncDateRange() |
| `src/app/api/cron/ads-sync/route.ts` | Daily cron (CRON_SECRET auth) |
| `src/app/api/admin/google-ads/backfill/route.ts` | Manual backfill trigger |
| `src/app/api/admin/google-ads/sync-status/route.ts` | GET sync/backfill status |
| `src/app/admin/google-ads/_components/sync-status.tsx` | Sync status + backfill button UI |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/app/api/admin/google-ads/route.ts` | Read from Supabase, fall back to live API |
| `src/app/admin/google-ads/_components/google-ads-content.tsx` | Add 90d/all presets, sync status |
| `src/app/admin/google-ads/page.tsx` | Pass sync status data |
| `src/lib/admin/briefing-steps/pull-ads-data.ts` | Add 90-day trend context |
| `vercel.json` | Add ads-sync cron entry |

---

## Task 1: Supabase Migration — Create Tables

- [ ] **Step 1: Create all 4 tables via Supabase MCP**

Run this SQL:

```sql
-- Daily account-level metrics
CREATE TABLE ads_daily_account (
  date date PRIMARY KEY,
  spend numeric NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  conversions numeric NOT NULL DEFAULT 0,
  cpa numeric NOT NULL DEFAULT 0,
  ctr numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- Daily campaign-level metrics
CREATE TABLE ads_daily_campaign (
  date date NOT NULL,
  campaign_name text NOT NULL,
  campaign_status text NOT NULL DEFAULT 'ENABLED',
  spend numeric NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  conversions numeric NOT NULL DEFAULT 0,
  cpa numeric NOT NULL DEFAULT 0,
  ctr numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, campaign_name)
);

-- Daily keyword-level metrics
CREATE TABLE ads_daily_keyword (
  date date NOT NULL,
  keyword text NOT NULL,
  match_type text NOT NULL DEFAULT 'BROAD',
  spend numeric NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  conversions numeric NOT NULL DEFAULT 0,
  quality_score integer,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, keyword)
);

-- Sync status tracking
CREATE TABLE ads_sync_status (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle',
  last_synced_date date,
  backfill_progress jsonb,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ads_daily_account_date ON ads_daily_account (date DESC);
CREATE INDEX idx_ads_daily_campaign_date ON ads_daily_campaign (date DESC);
CREATE INDEX idx_ads_daily_keyword_date ON ads_daily_keyword (date DESC);

-- RLS
ALTER TABLE ads_daily_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_daily_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_daily_keyword ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_sync_status ENABLE ROW LEVEL SECURITY;

-- Seed sync status rows
INSERT INTO ads_sync_status (id, status) VALUES ('daily-sync', 'idle'), ('backfill', 'idle');
```

- [ ] **Step 2: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ads_%' ORDER BY table_name;
```

Expected: `ads_daily_account`, `ads_daily_campaign`, `ads_daily_keyword`, `ads_sync_status`

---

## Task 2: Type Definitions

**Files:**
- Create: `src/lib/admin/ads-history-types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
/**
 * OPS Admin — Google Ads History Sync Types
 * Maps to ads_daily_account, ads_daily_campaign, ads_daily_keyword Supabase tables.
 */

export interface AdsDailyAccount {
  date: string;           // YYYY-MM-DD
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  synced_at: string;
}

export interface AdsDailyCampaign {
  date: string;
  campaign_name: string;
  campaign_status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  synced_at: string;
}

export interface AdsDailyKeyword {
  date: string;
  keyword: string;
  match_type: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  quality_score: number | null;
  synced_at: string;
}

export interface AdsSyncStatus {
  id: string;
  status: "idle" | "running" | "complete" | "failed";
  last_synced_date: string | null;
  backfill_progress: {
    currentDate: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    completedDays: number;
  } | null;
  error: string | null;
  updated_at: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/ads-history-types.ts
git commit -m "feat(ads-sync): add type definitions for synced ads data"
```

---

## Task 3: Supabase CRUD Queries

**Files:**
- Create: `src/lib/admin/ads-history-queries.ts`

- [ ] **Step 1: Create queries module**

```typescript
/**
 * OPS Admin — Google Ads History Supabase Queries
 * SERVER ONLY. Uses admin client (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type {
  AdsDailyAccount,
  AdsDailyCampaign,
  AdsDailyKeyword,
  AdsSyncStatus,
} from "./ads-history-types";
import type {
  GoogleAdsAccountSummary,
  CampaignPerformance,
  KeywordPerformance,
  DailySpend,
} from "@/lib/analytics/google-ads-types";

const db = () => getAdminSupabase();

// ─── Upserts (used by sync) ──────────────────────────────────────────────────

export async function upsertDailyAccount(row: Omit<AdsDailyAccount, "synced_at">): Promise<void> {
  await db()
    .from("ads_daily_account")
    .upsert({ ...row, synced_at: new Date().toISOString() }, { onConflict: "date" });
}

export async function upsertDailyCampaigns(rows: Omit<AdsDailyCampaign, "synced_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const withTimestamp = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  await db()
    .from("ads_daily_campaign")
    .upsert(withTimestamp, { onConflict: "date,campaign_name" });
}

export async function upsertDailyKeywords(rows: Omit<AdsDailyKeyword, "synced_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const withTimestamp = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
  await db()
    .from("ads_daily_keyword")
    .upsert(withTimestamp, { onConflict: "date,keyword" });
}

// ─── Reads (used by admin page) ──────────────────────────────────────────────

export async function getAccountSummaryFromHistory(
  startDate: string,
  endDate: string
): Promise<GoogleAdsAccountSummary | null> {
  const { data } = await db()
    .from("ads_daily_account")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return null;

  const totals = (data as AdsDailyAccount[]).reduce(
    (acc, row) => ({
      totalSpend: acc.totalSpend + Number(row.spend),
      totalClicks: acc.totalClicks + Number(row.clicks),
      totalImpressions: acc.totalImpressions + Number(row.impressions),
      totalConversions: acc.totalConversions + Number(row.conversions),
    }),
    { totalSpend: 0, totalClicks: 0, totalImpressions: 0, totalConversions: 0 }
  );

  return {
    ...totals,
    avgCpa: totals.totalConversions > 0 ? totals.totalSpend / totals.totalConversions : 0,
    avgCtr: totals.totalImpressions > 0 ? totals.totalClicks / totals.totalImpressions : 0,
  };
}

export async function getCampaignsFromHistory(
  startDate: string,
  endDate: string
): Promise<CampaignPerformance[]> {
  const { data } = await db()
    .from("ads_daily_campaign")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return [];

  // Aggregate by campaign name across the date range
  const byCampaign = new Map<string, { status: string; spend: number; clicks: number; impressions: number; conversions: number }>();
  for (const row of data as AdsDailyCampaign[]) {
    const existing = byCampaign.get(row.campaign_name);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.clicks += Number(row.clicks);
      existing.impressions += Number(row.impressions);
      existing.conversions += Number(row.conversions);
    } else {
      byCampaign.set(row.campaign_name, {
        status: row.campaign_status,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        conversions: Number(row.conversions),
      });
    }
  }

  return Array.from(byCampaign.entries())
    .map(([name, d]) => ({
      name,
      status: d.status as CampaignPerformance["status"],
      impressions: d.impressions,
      clicks: d.clicks,
      ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
      cost: d.spend,
      conversions: d.conversions,
      cpa: d.conversions > 0 ? d.spend / d.conversions : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

export async function getKeywordsFromHistory(
  startDate: string,
  endDate: string,
  limit = 50
): Promise<KeywordPerformance[]> {
  const { data } = await db()
    .from("ads_daily_keyword")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!data || data.length === 0) return [];

  // Aggregate by keyword across the date range
  const byKeyword = new Map<string, { matchType: string; spend: number; clicks: number; impressions: number; conversions: number; qualityScore: number | null }>();
  for (const row of data as AdsDailyKeyword[]) {
    const existing = byKeyword.get(row.keyword);
    if (existing) {
      existing.spend += Number(row.spend);
      existing.clicks += Number(row.clicks);
      existing.impressions += Number(row.impressions);
      existing.conversions += Number(row.conversions);
      if (row.quality_score != null) existing.qualityScore = row.quality_score;
    } else {
      byKeyword.set(row.keyword, {
        matchType: row.match_type,
        spend: Number(row.spend),
        clicks: Number(row.clicks),
        impressions: Number(row.impressions),
        conversions: Number(row.conversions),
        qualityScore: row.quality_score,
      });
    }
  }

  return Array.from(byKeyword.entries())
    .map(([keyword, d]) => ({
      keyword,
      matchType: d.matchType as KeywordPerformance["matchType"],
      impressions: d.impressions,
      clicks: d.clicks,
      cost: d.spend,
      conversions: d.conversions,
      qualityScore: d.qualityScore,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export async function getDailySpendFromHistory(
  startDate: string,
  endDate: string
): Promise<DailySpend[]> {
  const { data } = await db()
    .from("ads_daily_account")
    .select("date, spend, clicks, conversions")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  return (data ?? []).map((row) => ({
    date: row.date,
    spend: Number(row.spend),
    clicks: Number(row.clicks),
    conversions: Number(row.conversions),
  }));
}

/** Check if we have synced data for a given date range. */
export async function hasHistoryData(startDate: string, endDate: string): Promise<boolean> {
  const { count } = await db()
    .from("ads_daily_account")
    .select("*", { count: "exact", head: true })
    .gte("date", startDate)
    .lte("date", endDate);
  return (count ?? 0) > 0;
}

// ─── Sync Status ─────────────────────────────────────────────────────────────

export async function getSyncStatus(id: "daily-sync" | "backfill"): Promise<AdsSyncStatus | null> {
  const { data } = await db()
    .from("ads_sync_status")
    .select("*")
    .eq("id", id)
    .single();
  return data as AdsSyncStatus | null;
}

export async function updateSyncStatus(
  id: "daily-sync" | "backfill",
  update: Partial<Omit<AdsSyncStatus, "id">>
): Promise<void> {
  await db()
    .from("ads_sync_status")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/ads-history-queries.ts
git commit -m "feat(ads-sync): add Supabase CRUD for ads history tables"
```

---

## Task 4: Core Sync Logic

**Files:**
- Create: `src/lib/admin/ads-history-sync.ts`

- [ ] **Step 1: Create sync module**

```typescript
/**
 * OPS Admin — Google Ads History Sync Engine
 * SERVER ONLY. Pulls data from Google Ads API and upserts into Supabase.
 */
import {
  getAccountSummaryForRange,
  getCampaignPerformanceForRange,
} from "@/lib/analytics/google-ads-client";
import {
  upsertDailyAccount,
  upsertDailyCampaigns,
  upsertDailyKeywords,
  updateSyncStatus,
} from "./ads-history-queries";

/** Format Date to YYYY-MM-DD */
function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Sleep for ms (rate limiting between API calls) */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync a single day's data from Google Ads API into Supabase.
 * Idempotent — safe to re-run for the same date.
 */
export async function syncDay(date: Date): Promise<void> {
  const dateStr = fmt(date);
  const start = date;
  const end = date;

  // Pull from Google Ads API
  const [accountSummary, campaigns] = await Promise.all([
    getAccountSummaryForRange(start, end),
    getCampaignPerformanceForRange(start, end),
  ]);

  // Note: keyword-level data uses the same date range query from google-ads-client.
  // We import keywords via campaign data for now — getKeywordPerformanceForRange
  // would need to be added. For v1, we sync account + campaign level.
  // Keyword sync can be added as an enhancement.

  // Upsert account-level
  await upsertDailyAccount({
    date: dateStr,
    spend: accountSummary.totalSpend,
    clicks: accountSummary.totalClicks,
    impressions: accountSummary.totalImpressions,
    conversions: accountSummary.totalConversions,
    cpa: accountSummary.avgCpa,
    ctr: accountSummary.avgCtr,
  });

  // Upsert campaign-level
  await upsertDailyCampaigns(
    campaigns.map((c) => ({
      date: dateStr,
      campaign_name: c.name,
      campaign_status: c.status,
      spend: c.cost,
      clicks: c.clicks,
      impressions: c.impressions,
      conversions: c.conversions,
      cpa: c.cpa,
      ctr: c.ctr,
    }))
  );
}

/**
 * Sync a range of dates. Used by both daily cron and backfill.
 * Processes one day at a time with rate limiting.
 */
export async function syncDateRange(
  startDate: Date,
  endDate: Date,
  options?: { trackProgress?: boolean; rateLimitMs?: number }
): Promise<{ synced: number; failed: number }> {
  const trackProgress = options?.trackProgress ?? false;
  const rateLimitMs = options?.rateLimitMs ?? 100;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  let synced = 0;
  let failed = 0;
  const current = new Date(start);

  while (current <= end) {
    try {
      await syncDay(current);
      synced++;

      if (trackProgress) {
        await updateSyncStatus("backfill", {
          status: "running",
          last_synced_date: fmt(current),
          backfill_progress: {
            currentDate: fmt(current),
            startDate: fmt(start),
            endDate: fmt(end),
            totalDays,
            completedDays: synced + failed,
          },
        });
      }
    } catch (err) {
      console.error(`[ads-sync] Failed to sync ${fmt(current)}:`, err);
      failed++;
    }

    current.setDate(current.getDate() + 1);

    // Rate limit to avoid Google Ads API throttling
    if (current <= end) await sleep(rateLimitMs);
  }

  return { synced, failed };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/admin/ads-history-sync.ts
git commit -m "feat(ads-sync): add core sync logic — syncDay() and syncDateRange()"
```

---

## Task 5: API Routes — Cron + Backfill + Status

**Files:**
- Create: `src/app/api/cron/ads-sync/route.ts`
- Create: `src/app/api/admin/google-ads/backfill/route.ts`
- Create: `src/app/api/admin/google-ads/sync-status/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create daily cron route**

Create `src/app/api/cron/ads-sync/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncDay } from "@/lib/admin/ads-history-sync";
import { updateSyncStatus } from "@/lib/admin/ads-history-queries";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await updateSyncStatus("daily-sync", { status: "running" });

    // Sync yesterday (Google Ads finalizes data ~24h after)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await syncDay(yesterday);

    const dateStr = yesterday.toISOString().split("T")[0];
    await updateSyncStatus("daily-sync", {
      status: "complete",
      last_synced_date: dateStr,
      error: null,
    });

    return NextResponse.json({ status: "synced", date: dateStr });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus("daily-sync", { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create backfill route**

Create `src/app/api/admin/google-ads/backfill/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import { syncDateRange } from "@/lib/admin/ads-history-sync";
import { getSyncStatus, updateSyncStatus } from "@/lib/admin/ads-history-queries";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if already running
  const current = await getSyncStatus("backfill");
  if (current?.status === "running") {
    return NextResponse.json({ error: "Backfill already in progress" }, { status: 409 });
  }

  // Default: 2 years ago → yesterday
  const body = await req.json().catch(() => ({}));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const startDate = body.startDate ? new Date(body.startDate) : twoYearsAgo;
  const endDate = body.endDate ? new Date(body.endDate) : yesterday;

  try {
    await updateSyncStatus("backfill", {
      status: "running",
      error: null,
      backfill_progress: {
        currentDate: startDate.toISOString().split("T")[0],
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        totalDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
        completedDays: 0,
      },
    });

    const result = await syncDateRange(startDate, endDate, {
      trackProgress: true,
      rateLimitMs: 150,
    });

    await updateSyncStatus("backfill", {
      status: "complete",
      last_synced_date: endDate.toISOString().split("T")[0],
      error: null,
    });

    return NextResponse.json({ status: "complete", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus("backfill", { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create sync status route**

Create `src/app/api/admin/google-ads/sync-status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import { getSyncStatus } from "@/lib/admin/ads-history-queries";

export const GET = withAdmin(async (_req: NextRequest) => {
  const [dailySync, backfill] = await Promise.all([
    getSyncStatus("daily-sync"),
    getSyncStatus("backfill"),
  ]);

  return NextResponse.json({ dailySync, backfill });
});
```

- [ ] **Step 4: Add cron entry to vercel.json**

Add to the existing `crons` array:

```json
{
  "path": "/api/cron/ads-sync",
  "schedule": "0 8 * * *"
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/ads-sync/route.ts src/app/api/admin/google-ads/backfill/route.ts src/app/api/admin/google-ads/sync-status/route.ts vercel.json
git commit -m "feat(ads-sync): add cron, backfill, and status API routes"
```

---

## Task 6: Switch Admin API to Read from Supabase

**Files:**
- Modify: `src/app/api/admin/google-ads/route.ts`

- [ ] **Step 1: Update the GET handler to read from Supabase with live API fallback**

Replace the entire contents of `src/app/api/admin/google-ads/route.ts`:

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
import {
  hasHistoryData,
  getAccountSummaryFromHistory,
  getCampaignsFromHistory,
  getKeywordsFromHistory,
  getDailySpendFromHistory,
} from "@/lib/admin/ads-history-queries";
import type { AdsDayRange, GoogleAdsPageData } from "@/lib/analytics/google-ads-types";

const VALID_DAYS = new Set([7, 14, 30, 90]);

function parseDays(value: string | null): number {
  const num = Number(value);
  if (VALID_DAYS.has(num)) return num;
  return 30;
}

function dateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
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
  const { startDate, endDate } = dateRange(days);

  // Try Supabase first (instant, no API call)
  const hasSyncedData = await hasHistoryData(startDate, endDate);

  if (hasSyncedData) {
    const [summary, campaigns, keywords, dailySpend] = await Promise.all([
      safe(getAccountSummaryFromHistory(startDate, endDate), null),
      safe(getCampaignsFromHistory(startDate, endDate), []),
      safe(getKeywordsFromHistory(startDate, endDate, 50), []),
      safe(getDailySpendFromHistory(startDate, endDate), []),
    ]);

    return NextResponse.json({
      adsAvailable: true,
      summary,
      campaigns,
      keywords,
      searchTerms: [], // Search terms not synced yet — would need separate table
      dailySpend,
      conversions: [],  // Conversion breakdown not synced yet
    } satisfies GoogleAdsPageData);
  }

  // Fallback: live API (for days not yet synced)
  const liveDays = (days <= 30 ? days : 30) as AdsDayRange;
  const [summary, campaigns, keywords, searchTerms, dailySpend, conversions] =
    await Promise.all([
      safe(getCachedAccountSummary(liveDays), null),
      safe(getCachedCampaignPerformance(liveDays), []),
      safe(getCachedKeywordPerformance(liveDays, 50), []),
      safe(getCachedSearchTerms(liveDays, 50), []),
      safe(getCachedDailySpend(liveDays), []),
      safe(getCachedCostPerConversion(liveDays), []),
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
git commit -m "feat(ads-sync): switch admin API to read from Supabase with live API fallback"
```

---

## Task 7: Add 90d Preset to Admin UI

**Files:**
- Modify: `src/app/admin/google-ads/_components/google-ads-content.tsx`

- [ ] **Step 1: Add 90d preset to date range control**

In `google-ads-content.tsx`, change the DateRangeControl presets and the days mapping:

Change:
```typescript
presets={["7d", "14d", "30d"]}
```
To:
```typescript
presets={["7d", "14d", "30d", "90d"]}
```

And update the `handleRangeChange` function to support 90d:
```typescript
const days: number = diffDays <= 7 ? 7 : diffDays <= 14 ? 14 : diffDays <= 30 ? 30 : 90;
```

Also update the `AdsDayRange` type cast to just use `number` since we're no longer constrained to the GAQL `DURING` literal.

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/google-ads/_components/google-ads-content.tsx
git commit -m "feat(ads-sync): add 90-day preset to Google Ads admin UI"
```

---

## Task 8: Sync Status UI Component

**Files:**
- Create: `src/app/admin/google-ads/_components/sync-status.tsx`
- Modify: `src/app/admin/google-ads/page.tsx`

- [ ] **Step 1: Create sync status component**

```typescript
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { AdsSyncStatus } from "@/lib/admin/ads-history-types";

export function SyncStatusBar() {
  const [dailySync, setDailySync] = useState<AdsSyncStatus | null>(null);
  const [backfill, setBackfill] = useState<AdsSyncStatus | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/google-ads/sync-status");
      if (!res.ok) return;
      const data = await res.json();
      setDailySync(data.dailySync);
      setBackfill(data.backfill);
      setBackfillRunning(data.backfill?.status === "running");
    } catch { /* silent */ }
  }, []);

  // Poll while backfill is running
  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [fetchStatus]);

  useEffect(() => {
    if (!backfillRunning) return;
    const poll = () => {
      pollRef.current = setTimeout(async () => {
        await fetchStatus();
        poll();
      }, 3000);
    };
    poll();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [backfillRunning, fetchStatus]);

  const handleBackfill = useCallback(async () => {
    setBackfillRunning(true);
    try {
      await fetch("/api/admin/google-ads/backfill", { method: "POST" });
    } catch { /* silent */ }
  }, []);

  const progress = backfill?.backfill_progress;
  const pct = progress ? Math.round((progress.completedDays / progress.totalDays) * 100) : 0;

  return (
    <div className="flex items-center gap-4 font-mohave text-[12px]">
      {/* Last synced */}
      {dailySync?.last_synced_date && (
        <span className="text-[#6B6B6B]">
          [synced through {dailySync.last_synced_date}]
        </span>
      )}

      {/* Backfill state */}
      {backfillRunning && progress ? (
        <div className="flex items-center gap-2">
          <div className="w-24 h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#597794] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[#597794]">{pct}% — {progress.currentDate}</span>
        </div>
      ) : backfill?.status === "complete" ? (
        <span className="text-[#9DB582]">History imported</span>
      ) : (
        <button
          onClick={handleBackfill}
          className="text-[#597794] hover:text-[#E5E5E5] transition-colors duration-100 uppercase tracking-wider"
        >
          Import History
        </button>
      )}

      {/* Error */}
      {(backfill?.status === "failed" && backfill.error) && (
        <span className="text-[#93321A] truncate max-w-[200px]" title={backfill.error}>
          {backfill.error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add SyncStatusBar to the Google Ads page**

In `src/app/admin/google-ads/page.tsx`, add after the AdminPageHeader:

```typescript
import { SyncStatusBar } from "./_components/sync-status";
```

And in the JSX, add between the AdminPageHeader and BriefingHero:
```tsx
<div className="px-8 pt-4">
  <SyncStatusBar />
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/google-ads/_components/sync-status.tsx src/app/admin/google-ads/page.tsx
git commit -m "feat(ads-sync): add sync status bar with backfill trigger"
```

---

## Task 9: Enhance Briefings with 90-Day Trend Context

**Files:**
- Modify: `src/lib/admin/briefing-steps/pull-ads-data.ts`
- Modify: `src/lib/admin/briefing-steps/ai-analysis.ts`
- Modify: `src/lib/admin/briefing-types.ts`

- [ ] **Step 1: Add trendContext to PerformanceSnapshot**

In `src/lib/admin/briefing-types.ts`, add to the `PerformanceSnapshot` interface:

```typescript
  /** 90-day weekly aggregates for trend context (null if no history synced) */
  trendContext: {
    weeklySpend: { week: string; spend: number }[];
    avgCpa90d: number;
    avgCtr90d: number;
    totalConversions90d: number;
  } | null;
```

- [ ] **Step 2: Update pull-ads-data.ts to fetch 90-day trends**

Add to `pullAdsData()` after the existing logic, before the return:

```typescript
import { getDailySpendFromHistory, hasHistoryData } from "../ads-history-queries";

// Fetch 90-day trend context from Supabase (if history is synced)
let trendContext: PerformanceSnapshot["trendContext"] = null;
const ninetyDaysAgo = new Date(currentStart);
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
const has90d = await hasHistoryData(
  ninetyDaysAgo.toISOString().split("T")[0],
  currentEnd.toISOString().split("T")[0]
);

if (has90d) {
  const { getAccountSummaryFromHistory } = await import("../ads-history-queries");
  const dailyData = await getDailySpendFromHistory(
    ninetyDaysAgo.toISOString().split("T")[0],
    currentEnd.toISOString().split("T")[0]
  );
  const summary90d = await getAccountSummaryFromHistory(
    ninetyDaysAgo.toISOString().split("T")[0],
    currentEnd.toISOString().split("T")[0]
  );

  // Aggregate into weekly buckets
  const weeklyMap = new Map<string, number>();
  for (const d of dailyData) {
    const weekStart = new Date(d.date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
    const weekKey = weekStart.toISOString().split("T")[0];
    weeklyMap.set(weekKey, (weeklyMap.get(weekKey) ?? 0) + d.spend);
  }
  const weeklySpend = Array.from(weeklyMap.entries())
    .map(([week, spend]) => ({ week, spend }))
    .sort((a, b) => a.week.localeCompare(b.week));

  trendContext = {
    weeklySpend,
    avgCpa90d: summary90d?.avgCpa ?? 0,
    avgCtr90d: summary90d?.avgCtr ?? 0,
    totalConversions90d: summary90d?.totalConversions ?? 0,
  };
}
```

Add `trendContext` to the return object.

- [ ] **Step 3: Update AI prompt to include trend context**

In `ai-analysis.ts`, add after the performance data section of the prompt:

```typescript
${performanceData.trendContext ? `
## 90-DAY TREND CONTEXT
Weekly Spend Trend: ${performanceData.trendContext.weeklySpend.map(w => `${w.week}: $${w.spend.toFixed(0)}`).join(" → ")}
90-Day Avg CPA: $${performanceData.trendContext.avgCpa90d.toFixed(2)}
90-Day Avg CTR: ${(performanceData.trendContext.avgCtr90d * 100).toFixed(2)}%
90-Day Total Conversions: ${performanceData.trendContext.totalConversions90d}
` : ""}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/briefing-types.ts src/lib/admin/briefing-steps/pull-ads-data.ts src/lib/admin/briefing-steps/ai-analysis.ts
git commit -m "feat(ads-sync): enhance briefings with 90-day trend context from history"
```

---

## Task 10: TypeScript Check + Final Commit

- [ ] **Step 1: TypeScript check**

```bash
cd /c/OPS/ops-web && npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 2: Verify all new files exist**

```bash
ls src/lib/admin/ads-history-types.ts src/lib/admin/ads-history-queries.ts src/lib/admin/ads-history-sync.ts src/app/api/cron/ads-sync/route.ts src/app/api/admin/google-ads/backfill/route.ts src/app/api/admin/google-ads/sync-status/route.ts src/app/admin/google-ads/_components/sync-status.tsx
```

- [ ] **Step 3: Final commit if anything uncommitted**

```bash
git status
```

---

## Post-Implementation

1. **Deploy** — Push to trigger Vercel deploy
2. **Import history** — Click "Import History" on the Google Ads page, or hit `POST /api/admin/google-ads/backfill` directly. Takes ~3 invocations for 2 years (300s max duration each)
3. **Verify cron** — `ads-sync` cron runs daily at 8:00 UTC, syncing yesterday's data
4. **Verify admin page** — Should load instantly from Supabase instead of hitting Google Ads API
5. **Generate briefing** — Next briefing will include 90-day trend context if history is synced
