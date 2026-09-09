/**
 * OPS Admin — Google Ads History Sync Engine
 * SERVER ONLY. Pulls data from Google Ads API and upserts into Supabase.
 *
 * Uses bulk queries with segments.date to fetch daily data in monthly chunks,
 * minimizing API calls (~24 calls for 2 years instead of ~1460).
 */
import {
  getAccountSummaryForRange,
  getCampaignPerformanceForRange,
  queryClickMap,
  queryDailyAccountData,
  queryDailyAdData,
  queryDailyAdGroupData,
  queryDailyAssetData,
  queryDailyCampaignData,
  queryDailyKeywordData,
  queryDailySearchTermData,
  queryEntitySnapshot,
} from "@/lib/analytics/google-ads-client";
import {
  upsertClickMap,
  upsertDailyAccount,
  upsertDailyAccountBatch,
  upsertDailyAdGroups,
  upsertDailyAds,
  upsertDailyAssets,
  upsertDailyCampaigns,
  upsertDailyKeywords,
  upsertDailySearchTerms,
  upsertEntitySnapshot,
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
 * Used by the daily cron for yesterday's data only.
 * Idempotent — safe to re-run for the same date.
 */
export async function syncDay(date: Date): Promise<void> {
  const dateStr = fmt(date);

  const [accountSummary, campaigns] = await Promise.all([
    getAccountSummaryForRange(date, date),
    getCampaignPerformanceForRange(date, date),
  ]);
  const searchTerms = await queryDailySearchTermData(date, date);

  await upsertDailyAccount({
    date: dateStr,
    spend: accountSummary.totalSpend,
    clicks: accountSummary.totalClicks,
    impressions: accountSummary.totalImpressions,
    conversions: accountSummary.totalConversions,
    cpa: accountSummary.avgCpa,
    ctr: accountSummary.avgCtr,
  });

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

  await upsertDailySearchTerms(searchTerms);
}

/**
 * Sync a chunk of dates (up to ~30 days) using bulk daily-segmented queries.
 * Two API calls + two batched upserts per chunk.
 * Returns the count of account rows synced (= days with data in the range).
 */
export async function syncChunk(chunkStart: Date, chunkEnd: Date): Promise<number> {
  const [accountRows, campaignRows, searchTermRows] = await Promise.all([
    queryDailyAccountData(chunkStart, chunkEnd),
    queryDailyCampaignData(chunkStart, chunkEnd),
    queryDailySearchTermData(chunkStart, chunkEnd),
  ]);

  await upsertDailyAccountBatch(accountRows);
  await upsertDailyCampaigns(campaignRows);
  await upsertDailySearchTerms(searchTermRows);

  return accountRows.length;
}

/**
 * Sync a range of dates in monthly chunks.
 * Used by both daily cron (1 day) and backfill (up to 2 years).
 */
export async function syncDateRange(
  startDate: Date,
  endDate: Date,
  options?: { trackProgress?: boolean; rateLimitMs?: number }
): Promise<{ synced: number; failed: number; firstError: string | null }> {
  const trackProgress = options?.trackProgress ?? false;
  const rateLimitMs = options?.rateLimitMs ?? 200;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  let synced = 0;
  let failed = 0;
  let firstError: string | null = null;
  let chunkStart = new Date(start);

  while (chunkStart <= end) {
    // Chunk end: up to 30 days or the overall end date
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 29);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    try {
      const chunkSynced = await syncChunk(chunkStart, chunkEnd);
      synced += chunkSynced;

      if (trackProgress) {
        await updateSyncStatus("backfill", {
          status: "running",
          last_synced_date: fmt(chunkEnd),
          backfill_progress: {
            currentDate: fmt(chunkEnd),
            startDate: fmt(start),
            endDate: fmt(end),
            totalDays,
            completedDays: synced,
          },
        });
      }
    } catch (err) {
      console.error(`[ads-sync] Failed chunk ${fmt(chunkStart)}→${fmt(chunkEnd)}:`, err);
      // Count failed days in this chunk
      const chunkDays = Math.ceil((chunkEnd.getTime() - chunkStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      failed += chunkDays;
      if (!firstError) {
        firstError = err instanceof Error ? err.message : String(err);
      }
      // If all attempts so far have failed, bail early
      if (synced === 0 && failed >= 30) {
        console.error("[ads-sync] First chunk failed with 0 successes — aborting");
        break;
      }
    }

    // Move to next chunk
    chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);

    // Rate limit between chunks
    if (chunkStart <= end) await sleep(rateLimitMs);
  }

  return { synced, failed, firstError };
}

// ─── Warehouse extension: grains, click map, entity snapshot ─────────────────

export interface GrainSyncSummary {
  adGroups: number;
  ads: number;
  assets: number;
  keywords: number;
  clicks: number;
  /** searchStream calls made: four range reports + one click_view query per day. */
  apiCalls: number;
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Sync the ad-group, ad, asset, and keyword grains for a date range (one
 * report each) and the click map for every day in it (click_view accepts a
 * single day per query). Account, campaign, and search-term grains are the
 * existing syncDay / syncChunk path.
 */
export async function syncGrains(startDate: Date, endDate: Date): Promise<GrainSyncSummary> {
  const [adGroups, ads, assets, keywords] = await Promise.all([
    queryDailyAdGroupData(startDate, endDate),
    queryDailyAdData(startDate, endDate),
    queryDailyAssetData(startDate, endDate),
    queryDailyKeywordData(startDate, endDate),
  ]);
  await upsertDailyAdGroups(adGroups);
  await upsertDailyAds(ads);
  await upsertDailyAssets(assets);
  await upsertDailyKeywords(keywords);

  const clicks: Awaited<ReturnType<typeof queryClickMap>> = [];
  let days = 0;
  for (let day = utcDay(startDate); day <= utcDay(endDate); day = new Date(day.getTime() + 86_400_000)) {
    clicks.push(...(await queryClickMap(day)));
    days += 1;
  }
  await upsertClickMap(clicks);

  return {
    adGroups: adGroups.length,
    ads: ads.length,
    assets: assets.length,
    keywords: keywords.length,
    clicks: clicks.length,
    apiCalls: 4 + days,
  };
}

/** Snapshot every structural resource on the account (nine searchStream calls). */
export async function syncEntitySnapshot(): Promise<number> {
  const rows = await queryEntitySnapshot();
  await upsertEntitySnapshot(rows);
  return rows.length;
}

/**
 * The window the daily sync re-syncs: the trailing three days ending
 * yesterday, widened to thirty on Mondays because Google restates metrics
 * inside its lookback window.
 */
export function trailingGrainWindow(now: Date): { start: Date; end: Date; days: number } {
  const end = utcDay(now);
  end.setUTCDate(end.getUTCDate() - 1);
  const days = now.getUTCDay() === 1 ? 30 : 3;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start, end, days };
}

/** Everything the daily sync adds on top of syncDay: snapshot + trailing grains. */
export async function runWarehouseExtension(now: Date = new Date()): Promise<{
  window: { start: string; end: string; days: number };
  grains: GrainSyncSummary;
  entityRows: number;
}> {
  const window = trailingGrainWindow(now);
  const entityRows = await syncEntitySnapshot();
  const grains = await syncGrains(window.start, window.end);
  return {
    window: { start: fmt(window.start), end: fmt(window.end), days: window.days },
    grains,
    entityRows,
  };
}
