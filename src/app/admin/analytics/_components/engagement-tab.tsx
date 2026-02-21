"use client";

import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminLineChart } from "../../_components/charts/line-chart";

interface EngagementTabProps {
  topScreens: { label: string; value: number }[];
  taskCreatedByDate: { label: string; value: number }[];
  projectCreatedByDate: { label: string; value: number }[];
}

export function EngagementTab({ topScreens, taskCreatedByDate, projectCreatedByDate }: EngagementTabProps) {
  return (
    <div className="space-y-8">
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
          Top Screens [last 30 days, GA4]
        </p>
        <AdminBarChart data={topScreens} color="#8195B5" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Tasks Created [last 30 days]
          </p>
          <AdminLineChart data={taskCreatedByDate} color="#9DB582" />
        </div>
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Projects Created [last 30 days]
          </p>
          <AdminLineChart data={projectCreatedByDate} color="#597794" />
        </div>
      </div>
    </div>
  );
}
