"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateRangeControl } from "@/app/admin/_components/date-range-control";
import { StatCard } from "@/app/admin/_components/stat-card";
import { AdminLineChart } from "@/app/admin/_components/charts/line-chart";
import { AdminDonutChart } from "@/app/admin/_components/charts/donut-chart";
import { FunnelChart } from "@/app/admin/_components/charts/funnel-chart";
import { Sparkline } from "@/app/admin/_components/sparkline";
import { SortableTableHeader, useSortState } from "@/app/admin/_components/sortable-table-header";
import type { ChartDataPoint, DonutSegment, Granularity } from "@/lib/admin/types";
import type { AscKpis, AscTrafficSeries, AscTerritoryRow } from "@/lib/admin/app-store-queries";

// Neutral data line — the steel-blue accent (#6F94B0) is reserved for CTA/focus,
// never a data series.
const LINE = "#B5B5B5";

const CHANNEL_LABELS: Record<string, string> = {
  app_store_search: "App Store Search",
  app_store_browse: "App Store Browse",
  app_referrer: "App Referrer",
  web_referrer: "Web Referrer",
  app_clip: "App Clip",
  institutional: "Institutional",
  unavailable: "Unavailable",
  other: "Other",
  unknown: "Unknown",
};

interface Range {
  from: string;
  to: string;
  granularity: Granularity;
}
interface Initial extends Range {
  kpis: AscKpis;
  conversion: ChartDataPoint[];
  traffic: AscTrafficSeries;
  source: DonutSegment[];
  territories: AscTerritoryRow[];
}

const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtPct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(2)}%`);

function trendOf(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || prev === 0) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat", value: `${pct > 0 ? "+" : ""}${pct}%` } as const;
}

async function fetchData<T>(path: string, r: Range): Promise<T> {
  const u = new URLSearchParams({ from: r.from, to: r.to, granularity: r.granularity });
  const res = await fetch(`/api/admin/app-store/${path}?${u.toString()}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()).data as T;
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-white/[0.09] bg-[#121214]/60 p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[#8A8A8A]">// {title}</p>
        {note && <p className="font-mono text-[10px] text-[#6A6A6A]">{note}</p>}
      </div>
      {children}
    </div>
  );
}

export function AppStoreContent({ initial }: { initial: Initial }) {
  const [range, setRange] = useState<Range>({ from: initial.from, to: initial.to, granularity: initial.granularity });
  const isDefault =
    range.from === initial.from && range.to === initial.to && range.granularity === initial.granularity;
  const seed = <T,>(v: T) => (isDefault ? v : undefined);

  const kpis =
    useQuery({ queryKey: ["asc-kpis", range], queryFn: () => fetchData<AscKpis>("kpis", range), initialData: seed(initial.kpis), staleTime: 300_000 }).data ?? initial.kpis;
  const conversion =
    useQuery({ queryKey: ["asc-conv", range], queryFn: () => fetchData<ChartDataPoint[]>("conversion-series", range), initialData: seed(initial.conversion), staleTime: 300_000 }).data ?? [];
  const traffic =
    useQuery({ queryKey: ["asc-traffic", range], queryFn: () => fetchData<AscTrafficSeries>("traffic-series", range), initialData: seed(initial.traffic), staleTime: 300_000 }).data ?? initial.traffic;
  const source =
    useQuery({ queryKey: ["asc-source", range], queryFn: () => fetchData<DonutSegment[]>("source-breakdown", range), initialData: seed(initial.source), staleTime: 300_000 }).data ?? [];
  const territories =
    useQuery({ queryKey: ["asc-territories", range], queryFn: () => fetchData<AscTerritoryRow[]>("territories", range), initialData: seed(initial.territories), staleTime: 300_000 }).data ?? [];

  const { sort, toggle, sorted } = useSortState("downloads", "desc");
  const sortedTerritories = sorted(territories as unknown as Record<string, unknown>[]) as unknown as AscTerritoryRow[];

  const convChart = conversion.map((p) => ({ label: p.label, value: Number((p.value * 100).toFixed(2)) }));
  const donut = source.map((s) => ({ ...s, name: CHANNEL_LABELS[s.name] ?? s.name }));
  const showProvisional = Date.now() - new Date(range.to).getTime() < 2 * 86_400_000;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[#6A6A6A]">
          [ COMPLETE THROUGH {kpis.finalizedThrough} ]
        </p>
        <DateRangeControl
          defaultPreset="30d"
          showGranularity
          onChange={(p) => setRange({ from: p.from, to: p.to, granularity: p.granularity })}
        />
      </div>

      {showProvisional && (
        <p className="font-mono text-[10px] text-[#6A6A6A]">
          // last 2 days preliminary — Apple finalizes data at +2 days
        </p>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Conversion Rate"
          value={fmtPct(kpis.conversionRate)}
          caption="downloads ÷ unique impressions"
          trend={trendOf(kpis.conversionRate, kpis.prev.conversionRate)}
          sparklineData={convChart}
        />
        <StatCard
          label="Impressions"
          value={fmtInt(kpis.impressions)}
          caption="unique devices"
          trend={trendOf(kpis.impressions, kpis.prev.impressions)}
          sparklineData={traffic.impressions}
        />
        <StatCard
          label="Product Page Views"
          value={fmtInt(kpis.pageViews)}
          caption="store listing views"
          trend={trendOf(kpis.pageViews, kpis.prev.pageViews)}
          sparklineData={traffic.pageViews}
        />
        <StatCard
          label="Downloads"
          value={fmtInt(kpis.downloads)}
          caption="first-time + redownloads"
          trend={trendOf(kpis.downloads, kpis.prev.downloads)}
          sparklineData={traffic.downloads}
        />
      </div>

      {/* Conversion hero */}
      <Panel title="CONVERSION RATE" note="% over time">
        <AdminLineChart data={convChart} color={LINE} height={240} />
      </Panel>

      {/* Funnel + Source */}
      <div className="grid grid-cols-2 gap-4">
        <Panel title="ACQUISITION FUNNEL">
          <FunnelChart
            steps={[
              { step: "Impressions", count: kpis.impressions },
              { step: "Product Page Views", count: kpis.pageViews },
              { step: "Downloads", count: kpis.downloads },
            ]}
          />
        </Panel>
        <Panel title="SOURCE" note="App Store Search includes Apple Search Ads">
          {donut.length > 0 ? (
            <AdminDonutChart data={donut} />
          ) : (
            <p className="py-12 text-center font-mono text-[12px] text-[#6A6A6A]">—</p>
          )}
        </Panel>
      </div>

      {/* Downloads over time */}
      <Panel title="DOWNLOADS OVER TIME">
        <AdminLineChart data={traffic.downloads} color={LINE} height={200} />
      </Panel>

      {/* Territory table */}
      <Panel title="TERRITORY">
        <table className="w-full">
          <SortableTableHeader
            columns={[
              { key: "territory", label: "TERRITORY" },
              { key: "impressions", label: "IMPRESSIONS" },
              { key: "pageViews", label: "PAGE VIEWS" },
              { key: "downloads", label: "DOWNLOADS" },
              { key: "conversionRate", label: "CONVERSION" },
              { key: "spark", label: "TREND", sortable: false },
            ]}
            sort={sort}
            onSort={toggle}
          />
          <tbody>
            {sortedTerritories.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center font-mono text-[12px] text-[#6A6A6A]">—</td>
              </tr>
            )}
            {sortedTerritories.map((t) => (
              <tr key={t.territory} className="border-t border-white/[0.06]">
                <td className="py-2 text-[13px] text-[#EDEDED]">{t.territory}</td>
                <td className="py-2 font-mono text-[13px] tabular-nums text-[#B5B5B5]">{fmtInt(t.impressions)}</td>
                <td className="py-2 font-mono text-[13px] tabular-nums text-[#B5B5B5]">{fmtInt(t.pageViews)}</td>
                <td className="py-2 font-mono text-[13px] tabular-nums text-[#EDEDED]">{fmtInt(t.downloads)}</td>
                <td className="py-2 font-mono text-[13px] tabular-nums text-[#B5B5B5]">{fmtPct(t.conversionRate)}</td>
                <td className="py-2">
                  <Sparkline data={t.sparkline} color={LINE} height={28} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
