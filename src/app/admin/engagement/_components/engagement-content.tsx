"use client";

import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { HorizontalBarChart } from "../../_components/horizontal-bar-chart";
import type { FeatureAdoption, ChartDataPoint } from "@/lib/admin/types";

interface EngagementContentProps {
  activeUsersSparkline: ChartDataPoint[];
  featureAdoption: FeatureAdoption[];
  engagementDist: ChartDataPoint[];
  cohortRetention: {
    cohort: string;
    signups: number;
    month1: number;
    month2: number;
    month3: number;
    month6: number;
    month12: number;
  }[];
}

export function EngagementContent({
  activeUsersSparkline,
  featureAdoption,
  engagementDist,
  cohortRetention,
}: EngagementContentProps) {
  return (
    <div className="space-y-8">
      {/* Active Users Trend */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
          Active Users Trend [90 days, Firebase Auth]
        </p>
        <AdminLineChart data={activeUsersSparkline} color="#597794" />
      </div>

      {/* Feature Adoption Table + Bar Chart */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Feature Adoption
          </p>
          <div className="space-y-0">
            <div className="grid grid-cols-4 py-2 border-b border-white/[0.08]">
              {["FEATURE", "TOTAL", "COMPANIES", "ADOPTION"].map((h) => (
                <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                  {h}
                </span>
              ))}
            </div>
            {featureAdoption.map((f) => (
              <div key={f.feature} className="grid grid-cols-4 py-2.5 border-b border-white/[0.05] last:border-0 items-center">
                <span className="font-mohave text-[13px] text-[#E5E5E5]">{f.feature}</span>
                <span className="font-mohave text-[14px] text-[#A0A0A0]">{f.totalCount.toLocaleString()}</span>
                <span className="font-mohave text-[14px] text-[#A0A0A0]">{f.companiesUsing}</span>
                <span className="font-mohave text-[14px] text-[#E5E5E5]">{f.adoptionRate}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Feature Adoption Rates
          </p>
          <HorizontalBarChart
            data={featureAdoption.map((f) => ({
              label: f.feature,
              value: f.adoptionRate,
              maxValue: 100,
            }))}
            color="#597794"
            suffix="%"
          />
        </div>
      </div>

      {/* Engagement Distribution + Cohort Retention */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Engagement Distribution
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
            [companies by total entity count (projects + tasks + clients)]
          </p>
          <AdminBarChart data={engagementDist} color="#8195B5" />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Cohort Retention
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-4">
            [% active at month N, proxy: project creation]
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  {["COHORT", "SIGNUPS", "M1", "M2", "M3", "M6", "M12"].map((h) => (
                    <th key={h} className="py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohortRetention.map((row) => (
                  <tr key={row.cohort} className="border-b border-white/[0.05] last:border-0">
                    <td className="py-2 font-mohave text-[13px] text-[#E5E5E5] pr-3">{row.cohort}</td>
                    <td className="py-2 font-mohave text-[13px] text-[#A0A0A0] pr-3">{row.signups}</td>
                    {[row.month1, row.month2, row.month3, row.month6, row.month12].map((pct, i) => (
                      <td key={i} className="py-2 pr-3">
                        <span
                          className="font-mohave text-[13px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `rgba(89, 119, 148, ${pct / 100 * 0.5})`,
                            color: pct > 0 ? "#E5E5E5" : "#6B6B6B",
                          }}
                        >
                          {pct}%
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
