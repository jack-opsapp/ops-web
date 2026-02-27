"use client";

import { StatCard } from "../../_components/stat-card";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import type { EmailOverviewStats } from "@/lib/admin/types";

interface OverviewTabProps {
  stats: EmailOverviewStats;
}

export function OverviewTab({ stats }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Sent" value={stats.totalSent.toLocaleString()} />
        <StatCard label="Delivered" value={stats.totalDelivered.toLocaleString()} accent />
        <StatCard label="Failed" value={stats.totalFailed.toLocaleString()} danger={stats.totalFailed > 0} />
        <StatCard label="Delivery Rate" value={`${stats.deliveryRate}%`} accent />
      </div>

      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Daily Send Volume (Last 30 Days)
        </p>
        {stats.dailyVolume.length > 0 ? (
          <AdminBarChart data={stats.dailyVolume} color="#597794" height={240} />
        ) : (
          <div className="flex items-center justify-center h-[240px]">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
              No email data yet
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
