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
