/**
 * OPS Admin — Google Ads page data assembly (shared by page + API route)
 *
 * SERVER ONLY. One data path for /admin/google-ads regardless of entry point:
 *
 *   range preset ── resolve to explicit dates ──▶ warehouse-first:
 *     • summary / campaigns / search terms / daily spend from ads_daily_*
 *       when the window has synced rows (instant, no API quota)
 *     • keywords + conversion-action breakdown ALWAYS live (not warehoused —
 *       keywords by design, conversion actions have no warehouse table)
 *     • whole window live (explicit-date queries) when the warehouse has no
 *       rows for it — e.g. recent days before the nightly sync lands
 *
 * Every response carries the warehouse activity bounds so the UI can orient
 * the operator when the selected window is empty (ads paused).
 */
import { safe } from "@/lib/utils/safe";
import {
  isGoogleAdsConfigured,
  getCachedAccountSummaryForRange,
  getCachedCampaignPerformanceForRange,
  getCachedKeywordPerformanceForRange,
  getCachedSearchTermsForRange,
  getCachedCostPerConversionForRange,
  getCachedDailySpendForRange,
} from "@/lib/analytics/google-ads-client";
import {
  hasHistoryData,
  getHistoryBounds,
  getAccountSummaryFromHistory,
  getCampaignsFromHistory,
  getSearchTermsFromHistory,
  getDailySpendFromHistory,
} from "@/lib/admin/ads-history-queries";
import type { GoogleAdsPageData } from "@/lib/analytics/google-ads-types";

/** Range presets the ads page offers. A subset of the admin DatePreset union. */
export type AdsRangePreset = "7d" | "14d" | "30d" | "90d" | "12m" | "all";

const PRESET_DAYS: Record<Exclude<AdsRangePreset, "all">, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};

export function isAdsRangePreset(value: string | null): value is AdsRangePreset {
  return value === "7d" || value === "14d" || value === "30d" || value === "90d"
    || value === "12m" || value === "all";
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Yesterday at UTC midnight — Google finalizes data ~24h behind. */
function yesterdayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export interface ResolvedAdsRange {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
}

/**
 * Resolve a preset to explicit dates. "all" spans from the first day with
 * warehouse activity (falling back to two years when history is absent).
 */
export async function resolveAdsRange(
  preset: AdsRangePreset,
  historyBounds: { firstDay: string; lastDay: string } | null
): Promise<ResolvedAdsRange> {
  const end = yesterdayUtc();

  if (preset === "all") {
    if (historyBounds?.firstDay) {
      return { startDate: historyBounds.firstDay, endDate: fmt(end) };
    }
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    return { startDate: fmt(start), endDate: fmt(end) };
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - PRESET_DAYS[preset] + 1);
  return { startDate: fmt(start), endDate: fmt(end) };
}

const EMPTY_PAGE_DATA: GoogleAdsPageData = {
  adsAvailable: false,
  summary: null,
  campaigns: [],
  keywords: [],
  searchTerms: [],
  dailySpend: [],
  conversions: [],
  history: null,
};

/** Assemble everything the /admin/google-ads page renders for one range. */
export async function getGoogleAdsPageData(
  preset: AdsRangePreset
): Promise<GoogleAdsPageData> {
  if (!isGoogleAdsConfigured()) return EMPTY_PAGE_DATA;

  const history = await safe(getHistoryBounds(), null);
  const { startDate, endDate } = await resolveAdsRange(preset, history);

  // Keywords and conversion actions are never warehoused — always live.
  const livePartials = Promise.all([
    safe(getCachedKeywordPerformanceForRange(startDate, endDate, 50), []),
    safe(getCachedCostPerConversionForRange(startDate, endDate), []),
  ]);

  const hasSyncedData = await safe(hasHistoryData(startDate, endDate), false);

  if (hasSyncedData) {
    const [summary, campaigns, searchTerms, dailySpend, [keywords, conversions]] =
      await Promise.all([
        safe(getAccountSummaryFromHistory(startDate, endDate), null),
        safe(getCampaignsFromHistory(startDate, endDate), []),
        safe(getSearchTermsFromHistory(startDate, endDate, 50), []),
        safe(getDailySpendFromHistory(startDate, endDate), []),
        livePartials,
      ]);

    return {
      adsAvailable: true,
      summary,
      campaigns,
      keywords,
      searchTerms,
      dailySpend,
      conversions,
      history,
    };
  }

  // Window has no synced rows (recent days, or pre-import) — go fully live.
  const [summary, campaigns, searchTerms, dailySpend, [keywords, conversions]] =
    await Promise.all([
      safe(getCachedAccountSummaryForRange(startDate, endDate), null),
      safe(getCachedCampaignPerformanceForRange(startDate, endDate), []),
      safe(getCachedSearchTermsForRange(startDate, endDate, 50), []),
      safe(getCachedDailySpendForRange(startDate, endDate), []),
      livePartials,
    ]);

  return {
    adsAvailable: true,
    summary,
    campaigns,
    keywords,
    searchTerms,
    dailySpend,
    conversions,
    history,
  };
}
