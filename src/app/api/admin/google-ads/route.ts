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
