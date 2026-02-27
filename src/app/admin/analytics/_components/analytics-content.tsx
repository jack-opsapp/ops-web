"use client";

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
  );
}
