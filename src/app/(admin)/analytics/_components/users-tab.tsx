"use client";

import { StatCard } from "../../_components/stat-card";
import { AdminLineChart } from "../../_components/charts/line-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";

interface UsersTabProps {
  dau: number;
  wau: number;
  mau: number;
  signupTrend: { label: string; value: number }[];
  signupsByPlatform: { dimension: string; count: number }[];
}

export function UsersTab({ dau, wau, mau, signupTrend, signupsByPlatform }: UsersTabProps) {
  const platformData = signupsByPlatform.map((d) => ({ label: d.dimension, value: d.count }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Daily Active Users" value={dau} caption="last 24 hours, Firebase Auth" />
        <StatCard label="Weekly Active Users" value={wau} caption="last 7 days, Firebase Auth" />
        <StatCard label="Monthly Active Users" value={mau} caption="last 30 days, Firebase Auth" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            New Signups [per week, last 12 weeks]
          </p>
          <AdminLineChart data={signupTrend} />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Signups by Platform [last 30 days, GA4]
          </p>
          <AdminBarChart data={platformData} color="#9DB582" />
        </div>
      </div>
    </div>
  );
}
