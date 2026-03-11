"use client";

import Link from "next/link";
import { SubTabs } from "../../_components/sub-tabs";
import { WebsiteTrafficTab } from "./website-traffic-tab";
import { VercelProjectsTab } from "./vercel-projects-tab";
import type { WebsiteOverview, ChartDataPoint } from "@/lib/admin/types";

interface AnalyticsContentProps {
  overview: WebsiteOverview;
  sessionsByDate: ChartDataPoint[];
  topPages: { dimension: string; count: number }[];
  topReferrers: { dimension: string; count: number }[];
  deviceBreakdown: { dimension: string; count: number }[];
}

export function AnalyticsContent({
  overview,
  sessionsByDate,
  topPages,
  topReferrers,
  deviceBreakdown,
}: AnalyticsContentProps) {
  return (
    <>
      <div className="flex items-center justify-end mb-6">
        <Link
          href="/admin/analytics/flow"
          className="px-4 py-2 font-mohave text-[12px] uppercase tracking-wider text-[#597794] border border-[#597794]/30 rounded hover:bg-[#597794]/10 transition-colors"
        >
          User Flow Visualization &rarr;
        </Link>
      </div>
    <SubTabs tabs={["Website Traffic", "Vercel Projects"]}>
      {(tab) => {
        if (tab === "Website Traffic") {
          return (
            <WebsiteTrafficTab
              overview={overview}
              sessionsByDate={sessionsByDate}
              topPages={topPages}
              topReferrers={topReferrers}
              deviceBreakdown={deviceBreakdown}
            />
          );
        }
        if (tab === "Vercel Projects") {
          return <VercelProjectsTab />;
        }
        return null;
      }}
    </SubTabs>
    </>
  );
}
