"use client";

import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminDonutChart } from "../../_components/charts/donut-chart";
import { StackedBarChart } from "../../_components/charts/stacked-bar-chart";
import { PlanBadge } from "../../_components/plan-badge";
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

export function RevenueCharts({
  planDistribution,
  mrrGrowth,
  newVsChurned,
  trialTimeline,
  seatUtilization,
}: RevenueChartsProps) {
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
            <AdminDonutChart data={donutData} />
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
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            MRR Growth [12 months]
          </p>
          <AdminLineChart data={mrrGrowth} color="#9DB582" />
        </div>
      </div>

      {/* New vs Churned + Trial Expiration */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            New vs Churned [12 months]
          </p>
          <StackedBarChart data={newVsChurned} />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Trial Expirations [next 30 days]
          </p>
          <AdminBarChart data={trialTimeline} color="#C4A868" />
        </div>
      </div>

      {/* Seat Utilization */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Seat Utilization [paying companies]
        </p>
        <div className="space-y-0">
          <div className="grid grid-cols-5 py-2 border-b border-white/[0.08]">
            {["COMPANY", "PLAN", "SEATS USED", "MAX SEATS", "UTILIZATION"].map((h) => (
              <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                {h}
              </span>
            ))}
          </div>
          {seatUtilization.map((s) => (
            <div key={s.companyId} className="grid grid-cols-5 py-2.5 border-b border-white/[0.05] last:border-0 items-center">
              <span className="font-mohave text-[14px] text-[#E5E5E5] truncate pr-4">{s.companyName}</span>
              <span><PlanBadge plan={s.plan} /></span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{s.seatsUsed}</span>
              <span className="font-mohave text-[14px] text-[#A0A0A0]">{s.maxSeats}</span>
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
            </div>
          ))}
          {seatUtilization.length === 0 && (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] py-8 text-center">
              No paying companies
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
