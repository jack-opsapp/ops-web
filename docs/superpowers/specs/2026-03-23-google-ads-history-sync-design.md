# Google Ads History Sync — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Depends on:** Google Ads Admin Integration (complete), Intelligence Briefing (complete)

---

## Overview

Replace the live-API-on-every-page-load pattern with a proper sync-to-own-database architecture. Daily cron pulls finalized Google Ads data into Supabase. Admin page reads from Supabase. One-time backfill imports ~2 years of history. Briefings get 90-day trend context.

**Current state:** `unstable_cache` with 5-min TTL → Google Ads API on every cache miss. No persistent storage. Max 30-day window.

**Target state:** Supabase is the source of truth for all Google Ads data. API calls happen only during daily sync (3 calls/day). Admin page is instant. Any date range is queryable.

---

## 1. Data Model

### `ads_daily_account`

One row per day. Account-level totals.

| Column | Type | Purpose |
|--------|------|---------|
| `date` | date (PK) | The day |
| `spend` | numeric | Total spend in dollars |
| `clicks` | integer | Total clicks |
| `impressions` | integer | Total impressions |
| `conversions` | numeric | Total conversions |
| `cpa` | numeric | Cost per acquisition |
| `ctr` | numeric | Click-through rate (0-1) |
| `synced_at` | timestamptz | When this row was last synced |

### `ads_daily_campaign`

One row per campaign per day.

| Column | Type | Purpose |
|--------|------|---------|
| `date` | date (PK part) | The day |
| `campaign_name` | text (PK part) | Campaign name |
| `campaign_status` | text | ENABLED, PAUSED, REMOVED |
| `spend` | numeric | |
| `clicks` | integer | |
| `impressions` | integer | |
| `conversions` | numeric | |
| `cpa` | numeric | |
| `ctr` | numeric | |
| `synced_at` | timestamptz | |

### `ads_daily_keyword`

One row per keyword per day.

| Column | Type | Purpose |
|--------|------|---------|
| `date` | date (PK part) | The day |
| `keyword` | text (PK part) | Keyword text |
| `match_type` | text | EXACT, PHRASE, BROAD |
| `spend` | numeric | |
| `clicks` | integer | |
| `impressions` | integer | |
| `conversions` | numeric | |
| `quality_score` | integer | Nullable |
| `synced_at` | timestamptz | |

### `ads_sync_status`

Tracks sync/backfill progress.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text (PK) | `daily-sync` or `backfill` |
| `status` | text | `idle`, `running`, `complete`, `failed` |
| `last_synced_date` | date | Most recent day successfully synced |
| `backfill_progress` | jsonb | `{ currentDate, startDate, endDate, totalDays, completedDays }` |
| `error` | text | Last error message |
| `updated_at` | timestamptz | |

All tables use **RLS enabled, service role for writes**. Same pattern as `ad_briefings`.

---

## 2. Sync Mechanism

### Daily Sync (`/api/cron/ads-sync`)

- Runs daily at 8:00 UTC (3am EST) — after Google Ads finalizes yesterday's data
- Pulls yesterday's data from Google Ads API (3 queries: account, campaigns, keywords)
- Upserts into all 3 tables
- Updates `ads_sync_status` row
- Idempotent — re-running for the same day just overwrites

### Backfill (`POST /api/admin/google-ads/backfill`)

- Admin-only, manual trigger
- Accepts `{ startDate, endDate }` — defaults to 2 years ago → yesterday
- Processes one day at a time in a loop
- Updates `ads_sync_status.backfill_progress` after each day (for UI polling)
- Rate-limited: 100ms delay between days to avoid Google Ads API throttling
- Resumable: if interrupted, reads `last_synced_date` and continues from there
- `maxDuration = 300` (5 minutes) — processes ~250 days per invocation. For 2 years (~730 days), user triggers 3 times or we auto-chain.

### Shared Sync Function

Both cron and backfill call the same `syncDay(date)` function:
1. Query Google Ads API for that date (account summary, campaigns, keywords)
2. Upsert into `ads_daily_account`
3. Upsert into `ads_daily_campaign` (batch)
4. Upsert into `ads_daily_keyword` (batch)

---

## 3. Admin Page Changes

### API Route (`/api/admin/google-ads`)

Currently calls live Google Ads API. Change to query Supabase:
- `?days=7` → `SELECT * FROM ads_daily_account WHERE date >= now() - interval '7 days'`
- Same for campaigns and keywords
- Falls back to live API if no synced data exists (graceful migration)

### Date Range

Currently limited to 7/14/30 days. With Supabase:
- Add "90d" and "all" presets
- Any custom range is queryable

### Backfill UI

Add a "Sync History" button to the Google Ads page:
- Shows sync status (last synced date, backfill progress)
- "Import All History" button triggers backfill
- Progress indicator while backfill is running

---

## 4. Briefing Enhancement

Update `briefing-steps/pull-ads-data.ts`:
- After pulling current + prior 7-day data (existing), also query 90-day trend from Supabase
- Pass 90-day summary to AI prompt: weekly aggregates, trend direction, anomalies
- AI gets richer context for better recommendations

---

## 5. File Inventory

### New Files

| File | Purpose |
|------|---------|
| `src/lib/admin/ads-history-types.ts` | TypeScript types for synced data |
| `src/lib/admin/ads-history-queries.ts` | Supabase CRUD for ads_daily_* tables |
| `src/lib/admin/ads-history-sync.ts` | Core sync logic — syncDay(), syncDateRange() |
| `src/app/api/cron/ads-sync/route.ts` | Daily cron route |
| `src/app/api/admin/google-ads/backfill/route.ts` | Manual backfill trigger |
| `src/app/api/admin/google-ads/sync-status/route.ts` | GET sync status (for UI polling) |
| `src/app/admin/google-ads/_components/sync-status.tsx` | Sync status + backfill trigger UI |

### Modified Files

| File | Change |
|------|--------|
| `src/app/api/admin/google-ads/route.ts` | Read from Supabase instead of live API |
| `src/app/admin/google-ads/page.tsx` | Add sync status indicator |
| `src/app/admin/google-ads/_components/google-ads-content.tsx` | Add 90d/all presets, pass sync status |
| `src/lib/admin/briefing-steps/pull-ads-data.ts` | Add 90-day trend context from Supabase |
| `vercel.json` | Add ads-sync cron entry |

### Supabase Migration

- Create `ads_daily_account`, `ads_daily_campaign`, `ads_daily_keyword`, `ads_sync_status` tables
- Indexes on `(date)` for all daily tables
- Composite unique constraints for upsert safety
