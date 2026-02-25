"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminDonutChart } from "../../_components/charts/donut-chart";
import { StackedBarChart } from "../../_components/charts/stacked-bar-chart";
import { PlanBadge } from "../../_components/plan-badge";
import { useCompanySheet } from "../../_components/company-sheet-provider";
import { DateRangeControl } from "../../_components/date-range-control";
import {
  SortableTableHeader,
  useSortState,
} from "../../_components/sortable-table-header";
import type {
  PlanDistribution,
  ChartDataPoint,
  StackedBarDataPoint,
  SeatUtilization,
} from "@/lib/admin/types";

interface RevenueChartsProps {
  planDistribution: PlanDistribution[];
  mrrGrowth: ChartDataPoint[];
  newVsChurned: StackedBarDataPoint[];
  trialTimeline: ChartDataPoint[];
  seatUtilization: SeatUtilization[];
}

const MONTHS_FOR_PRESET: Record<string, number> = {
  "7d": 6,
  "30d": 6,
  "90d": 12,
  "12m": 24,
  all: 48,
};

const DAYS_FOR_PRESET: Record<string, number> = {
  "7d": 7,
  "30d": 14,
  "90d": 30,
  "12m": 60,
};

const SEAT_COLUMNS = [
  { key: "companyName", label: "Company" },
  { key: "plan", label: "Plan" },
  { key: "seatsUsed", label: "Seats Used" },
  { key: "maxSeats", label: "Max Seats" },
  { key: "utilization", label: "Utilization" },
];

export function RevenueCharts({
  planDistribution,
  mrrGrowth,
  newVsChurned,
  trialTimeline,
  seatUtilization,
}: RevenueChartsProps) {
  const { openCompany } = useCompanySheet();
  const [mrrMonths, setMrrMonths] = useState(12);
  const [churnedMonths, setChurnedMonths] = useState(12);
  const [trialDays, setTrialDays] = useState(30);
  const [planFilter, setPlanFilter] = useState<string | null>(null);

  // MRR Growth query
  const mrrQuery = useQuery({
    queryKey: ["revenue-mrr-growth", mrrMonths],
    queryFn: async () => {
      const res = await fetch(`/api/admin/revenue/mrr-growth?months=${mrrMonths}`);
      if (!res.ok) throw new Error("Failed to fetch MRR growth");
      const json = await res.json();
      return json.data as ChartDataPoint[];
    },
    initialData: mrrGrowth,
  });

  // New vs Churned query
  const churnedQuery = useQuery({
    queryKey: ["revenue-new-vs-churned", churnedMonths],
    queryFn: async () => {
      const res = await fetch(`/api/admin/revenue/new-vs-churned?months=${churnedMonths}`);
      if (!res.ok) throw new Error("Failed to fetch new vs churned");
      const json = await res.json();
      return json.data as StackedBarDataPoint[];
    },
    initialData: newVsChurned,
  });

  // Trial timeline query
  const trialQuery = useQuery({
    queryKey: ["revenue-trial-timeline", trialDays],
    queryFn: async () => {
      const res = await fetch(`/api/admin/revenue/trial-timeline?days=${trialDays}`);
      if (!res.ok) throw new Error("Failed to fetch trial timeline");
      const json = await res.json();
      return json.data as ChartDataPoint[];
    },
    initialData: trialTimeline,
  });

  // Seat utilization — sortable + plan filter
  const seatSort = useSortState("utilization");
  const filteredSeats = planFilter
    ? seatUtilization.filter((s) => s.plan === planFilter)
    : seatUtilization;
  const sortedSeats = seatSort.sorted(filteredSeats);

  const donutData = planDistribution.map((p) => ({
    name: p.plan,
    value: p.count,
    color: p.color,
  }));

  return (
    <div className="space-y-8">
      {/* Plan Distribution + MRR Growth */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Plan Distribution
          </p>
          {donutData.length > 0 ? (
            <AdminDonutChart
              data={donutData}
              onSegmentClick={(seg) => {
                setPlanFilter(planFilter === seg.name ? null : seg.name);
              }}
            />
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No data
            </p>
          )}

          {/* Breakdown Table */}
          <div className="mt-6 space-y-0">
            <div className="grid grid-cols-5 py-2 border-b border-white/[0.08]">
              {["PLAN", "COUNT", "MRR", "AVG USERS", "AVG PROJECTS"].map((h) => (
                <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                  {h}
                </span>
              ))}
            </div>
            {planDistribution.map((p) => (
              <div key={p.plan} className="grid grid-cols-5 py-2.5 border-b border-white/[0.05] last:border-0 items-center">
                <span><PlanBadge plan={p.plan} /></span>
                <span className="font-mohave text-[14px] text-[#A0A0A0]">{p.count}</span>
                <span className="font-mohave text-[14px] text-[#E5E5E5]">${p.mrr.toLocaleString()}</span>
                <span className="font-mohave text-[14px] text-[#A0A0A0]">{p.avgUsers}</span>
                <span className="font-mohave text-[14px] text-[#A0A0A0]">{p.avgProjects}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-6">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
              MRR Growth
            </p>
            <DateRangeControl
              defaultPreset="12m"
              presets={["90d", "12m", "all"]}
              onChange={(p) => {
                const key = Object.entries(MONTHS_FOR_PRESET).find(
                  ([, v]) => v === MONTHS_FOR_PRESET[p.granularity === "monthly" ? "12m" : "90d"]
                );
                // Map date range to months
                const diffMs = new Date(p.to).getTime() - new Date(p.from).getTime();
                const months = Math.max(1, Math.round(diffMs / (30 * 86_400_000)));
                setMrrMonths(months);
              }}
            />
          </div>
          <AdminLineChart
            data={mrrQuery.data ?? []}
            color="#9DB582"
            isLoading={mrrQuery.isFetching && !mrrQuery.data?.length}
          />
        </div>
      </div>

      {/* New vs Churned + Trial Expiration */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-6">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
              New vs Churned
            </p>
            <DateRangeControl
              defaultPreset="12m"
              presets={["90d", "12m", "all"]}
              onChange={(p) => {
                const diffMs = new Date(p.to).getTime() - new Date(p.from).getTime();
                const months = Math.max(1, Math.round(diffMs / (30 * 86_400_000)));
                setChurnedMonths(months);
              }}
            />
          </div>
          <StackedBarChart
            data={churnedQuery.data ?? []}
            isLoading={churnedQuery.isFetching && !churnedQuery.data?.length}
          />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-6">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
              Trial Expirations
            </p>
            <div className="flex items-center gap-1">
              {[
                { label: "7D", days: 7 },
                { label: "14D", days: 14 },
                { label: "30D", days: 30 },
                { label: "60D", days: 60 },
              ].map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setTrialDays(opt.days)}
                  className={`px-3 py-1 rounded-full font-mohave text-[12px] uppercase tracking-wider transition-colors ${
                    trialDays === opt.days
                      ? "bg-[#597794]/20 text-[#597794]"
                      : "bg-white/[0.06] text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.08]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <AdminBarChart
            data={trialQuery.data ?? []}
            color="#C4A868"
            isLoading={trialQuery.isFetching && !trialQuery.data?.length}
          />
        </div>
      </div>

      {/* Seat Utilization */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <div className="flex items-center justify-between mb-4">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
            Seat Utilization [paying companies]
          </p>
          {planFilter && (
            <button
              onClick={() => setPlanFilter(null)}
              className="font-kosugi text-[11px] text-[#597794] hover:text-[#E5E5E5] transition-colors"
            >
              Clear filter: {planFilter} &times;
            </button>
          )}
        </div>
        <div className="space-y-0">
          <table className="w-full">
            <thead>
              <SortableTableHeader
                columns={SEAT_COLUMNS}
                sort={seatSort.sort}
                onSort={seatSort.toggle}
              />
            </thead>
            <tbody>
              {sortedSeats.map((s) => (
                <tr
                  key={s.companyId}
                  className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-2.5 pr-4">
                    <button
                      type="button"
                      onClick={() => openCompany(s.companyId)}
                      className="font-mohave text-[14px] text-[#E5E5E5] truncate text-left hover:text-[#597794] transition-colors cursor-pointer"
                    >
                      {s.companyName}
                    </button>
                  </td>
                  <td className="py-2.5"><PlanBadge plan={s.plan} /></td>
                  <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0]">{s.seatsUsed}</td>
                  <td className="py-2.5 font-mohave text-[14px] text-[#A0A0A0]">{s.maxSeats}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(s.utilization, 100)}%`,
                            backgroundColor: s.utilization > 90 ? "#C4A868" : "#597794",
                          }}
                        />
                      </div>
                      <span className="font-mohave text-[13px] text-[#A0A0A0]">{s.utilization}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedSeats.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] py-8 text-center">
                      {planFilter ? `No companies on ${planFilter} plan` : "No paying companies"}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
