import {
  getWebsiteOverview,
  getSessionsByDate,
  getTopPages,
  getTopReferrers,
  getDeviceBreakdown,
} from "@/lib/admin/analytics-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { AnalyticsContent } from "./_components/analytics-content";

async function fetchAnalyticsData() {
  const [overview, sessionsByDate, topPages, topReferrers, deviceBreakdown] =
    await Promise.all([
      getWebsiteOverview(30),
      getSessionsByDate(30),
      getTopPages(30, 10),
      getTopReferrers(30, 10),
      getDeviceBreakdown(30),
    ]);

  return { overview, sessionsByDate, topPages, topReferrers, deviceBreakdown };
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
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Analytics" caption="website traffic & vercel projects" />
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
