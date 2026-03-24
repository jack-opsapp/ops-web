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
): Promise<{ synced: number; failed: number; firstError: string | null }> {
  const trackProgress = options?.trackProgress ?? false;
  const rateLimitMs = options?.rateLimitMs ?? 100;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  let synced = 0;
  let failed = 0;
  let firstError: string | null = null;
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
      if (!firstError) {
        firstError = err instanceof Error ? err.message : String(err);
      }
      // If all attempts so far have failed, bail early (likely a config/auth issue)
      if (synced === 0 && failed >= 3) {
        console.error("[ads-sync] 3 consecutive failures with 0 successes — aborting");
        break;
      }
    }

    current.setDate(current.getDate() + 1);

    // Rate limit to avoid Google Ads API throttling
    if (current <= end) await sleep(rateLimitMs);
  }

  return { synced, failed, firstError };
}
