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
