"use client";

import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";

interface BlogChartsProps {
  ga4Timeline: { dimension: string; count: number }[];
  ga4ByPost: { dimension: string; count: number }[];
}

/**
 * Convert GA4 date string "20260215" to "Feb 15".
 */
function formatDate(raw: string): string {
  if (raw.length !== 8) return raw;
  const year = parseInt(raw.slice(0, 4), 10);
  const month = parseInt(raw.slice(4, 6), 10) - 1;
  const day = parseInt(raw.slice(6, 8), 10);
  const date = new Date(year, month, day);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Strip "/blog/" prefix and trailing slash, truncate to 20 chars.
 */
function formatPostPath(path: string): string {
  let cleaned = path.replace(/^\/blog\//, "").replace(/\/$/, "");
  if (cleaned.length > 20) {
    cleaned = cleaned.slice(0, 20) + "...";
  }
  return cleaned;
}

export function BlogCharts({ ga4Timeline, ga4ByPost }: BlogChartsProps) {
  const timelineData = ga4Timeline.map((d) => ({
    label: formatDate(d.dimension),
    value: d.count,
  }));

  const topPostsData = ga4ByPost.slice(0, 10).map((d) => ({
    label: formatPostPath(d.dimension),
    value: d.count,
  }));

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Views Over Time */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Views Over Time (30d)
        </p>
        {timelineData.length > 0 ? (
          <AdminLineChart data={timelineData} />
        ) : (
          <p className="font-kosugi text-[12px] text-[#6B6B6B]">
            No timeline data available
          </p>
        )}
      </div>

      {/* Top Posts by Views */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Top Posts by Views
        </p>
        {topPostsData.length > 0 ? (
          <AdminBarChart data={topPostsData} color="#C4A868" />
        ) : (
          <p className="font-kosugi text-[12px] text-[#6B6B6B]">
            No post view data available
          </p>
        )}
      </div>
    </div>
  );
}
