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
  queryDailyAccountData,
  queryDailyCampaignData,
} from "@/lib/analytics/google-ads-client";
import {
  upsertDailyAccount,
  upsertDailyCampaigns,
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
}

/**
 * Sync a chunk of dates (up to ~30 days) using bulk daily-segmented queries.
 * Two API calls per chunk instead of 2 per day.
 */
async function syncChunk(chunkStart: Date, chunkEnd: Date): Promise<number> {
  const [accountRows, campaignRows] = await Promise.all([
    queryDailyAccountData(chunkStart, chunkEnd),
    queryDailyCampaignData(chunkStart, chunkEnd),
  ]);

  let synced = 0;

  // Upsert account rows
  for (const row of accountRows) {
    await upsertDailyAccount(row);
    synced++;
  }

  // Group campaign rows by date and upsert in batches
  const campaignsByDate = new Map<string, typeof campaignRows>();
  for (const row of campaignRows) {
    const existing = campaignsByDate.get(row.date) ?? [];
    existing.push(row);
    campaignsByDate.set(row.date, existing);
  }
  for (const [, rows] of campaignsByDate) {
    await upsertDailyCampaigns(rows);
  }

  return synced;
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
