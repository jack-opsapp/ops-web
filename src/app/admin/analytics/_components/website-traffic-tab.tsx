"use client";

import { StatCard } from "../../_components/stat-card";
import { AdminLineChart } from "../../_components/charts/line-chart";
import type { WebsiteOverview, ChartDataPoint } from "@/lib/admin/types";

interface WebsiteTrafficTabProps {
  overview: WebsiteOverview;
  sessionsByDate: ChartDataPoint[];
  topPages: { dimension: string; count: number }[];
  topReferrers: { dimension: string; count: number }[];
  deviceBreakdown: { dimension: string; count: number }[];
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function WebsiteTrafficTab({
  overview,
  sessionsByDate,
  topPages,
  topReferrers,
  deviceBreakdown,
}: WebsiteTrafficTabProps) {
  const totalDeviceSessions = deviceBreakdown.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-6">
      {/* Row 1: Primary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Sessions" value={overview.sessions.toLocaleString()} />
        <StatCard label="Active Users" value={overview.activeUsers.toLocaleString()} />
        <StatCard label="Pageviews" value={overview.pageviews.toLocaleString()} />
        <StatCard
          label="Bounce Rate"
          value={`${(overview.bounceRate * 100).toFixed(1)}%`}
          danger={overview.bounceRate > 0.7}
        />
      </div>

      {/* Row 2: Secondary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="New Users" value={overview.newUsers.toLocaleString()} />
        <StatCard label="Avg Session Duration" value={formatDuration(overview.avgSessionDuration)} />
      </div>

      {/* Row 3: Daily sessions chart */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Daily Sessions (30 days)
        </p>
        <AdminLineChart data={sessionsByDate} height={240} />
      </div>

      {/* Row 4: Top Pages + Top Referrers */}
      <div className="grid grid-cols-2 gap-4">
        <DimensionTable title="Top Pages" rows={topPages} dimensionLabel="Page Path" />
        <DimensionTable title="Top Referrers" rows={topReferrers} dimensionLabel="Source" />
      </div>

      {/* Row 5: Device breakdown */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="grid grid-cols-3 px-6 py-3 border-b border-white/[0.08]">
          {["DEVICE", "SESSIONS", "% OF TOTAL"].map((h) => (
            <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
          ))}
        </div>
        {deviceBreakdown.map((d) => {
          const pct = totalDeviceSessions > 0
            ? ((d.count / totalDeviceSessions) * 100).toFixed(1)
            : "0.0";
          return (
            <div key={d.dimension} className="grid grid-cols-3 px-6 items-center h-12 border-b border-white/[0.05] last:border-0">
              <span className="font-mohave text-[14px] text-[#E5E5E5] capitalize">{d.dimension}</span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{d.count.toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#597794] rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="font-mohave text-[12px] text-[#6B6B6B]">{pct}%</span>
              </div>
            </div>
          );
        })}
        {deviceBreakdown.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No device data</p>
          </div>
        )}
      </div>

      {/* Latency caption */}
      <p className="font-kosugi text-[11px] text-[#6B6B6B]">
        [ga4 data · ~24-48hr latency]
      </p>
    </div>
  );
}

// ─── Reusable dimension table ────────────────────────────────────────────────

function DimensionTable({
  title,
  rows,
  dimensionLabel,
}: {
  title: string;
  rows: { dimension: string; count: number }[];
  dimensionLabel: string;
}) {
  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="px-6 py-3 border-b border-white/[0.08]">
        <span className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">{title}</span>
      </div>
      <div className="grid grid-cols-2 px-6 py-2 border-b border-white/[0.08]">
        <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{dimensionLabel}</span>
        <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] text-right">Count</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 px-6 items-center h-10 border-b border-white/[0.05] last:border-0">
          <span className="font-kosugi text-[13px] text-[#E5E5E5] truncate">{r.dimension}</span>
          <span className="font-mohave text-[14px] text-[#A0A0A0] text-right">{r.count.toLocaleString()}</span>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="px-6 py-8 text-center">
          <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">No data</p>
        </div>
      )}
    </div>
  );
}
