import {
  getWebsiteOverview,
  getSessionsByDate,
  getTopPages,
  getTopReferrers,
  getDeviceBreakdown,
} from "@/lib/admin/analytics-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { AnalyticsContent } from "./_components/analytics-content";
import { getPropertyId } from "@/lib/analytics/ga4-client";

async function fetchAnalyticsData() {
  const propertyId = getPropertyId("marketing").replace("properties/", "");
  const [overview, sessionsByDate, topPages, topReferrers, deviceBreakdown] =
    await Promise.all([
      getWebsiteOverview("marketing", 30),
      getSessionsByDate("marketing", 30),
      getTopPages("marketing", 30, 10),
      getTopReferrers("marketing", 30, 10),
      getDeviceBreakdown("marketing", 30),
    ]);

  return {
    overview,
    sessionsByDate,
    topPages,
    topReferrers,
    deviceBreakdown,
    propertyId,
  };
}

export default async function AnalyticsPage() {
  let data;
  try {
    data = await fetchAnalyticsData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">
          Analytics Data Fetch Failed
        </h1>
        <pre className="text-[13px] text-[#EDEDED] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Analytics"
        caption={`MARKETING GA4 · PROPERTY ${data.propertyId} · 24–48H DELAY`}
      />
      <div className="p-8">
        <AnalyticsContent
          overview={data.overview}
          sessionsByDate={data.sessionsByDate}
          topPages={data.topPages}
          topReferrers={data.topReferrers}
          deviceBreakdown={data.deviceBreakdown}
        />
      </div>
    </div>
  );
}
