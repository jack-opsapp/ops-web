"use client";

import { AdminBarChart } from "../../_components/charts/bar-chart";
import { FunnelChart } from "../../_components/charts/funnel-chart";
import { AdminDonutChart } from "../../_components/charts/donut-chart";

interface GrowthTabProps {
  subscribeByPlatform: { dimension: string; count: number }[];
  beginTrialByPlatform: { dimension: string; count: number }[];
  teamInvitedByPlatform: { dimension: string; count: number }[];
}

export function GrowthTab({ subscribeByPlatform, beginTrialByPlatform, teamInvitedByPlatform }: GrowthTabProps) {
  const totalTrials = beginTrialByPlatform.reduce((s, d) => s + d.count, 0);
  const totalSubscribers = subscribeByPlatform.reduce((s, d) => s + d.count, 0);
  const conversionRate = totalTrials > 0 ? Math.round((totalSubscribers / totalTrials) * 100) : 0;

  const conversionFunnel = [
    { step: "BEGIN TRIAL", eventName: "begin_trial", count: totalTrials },
    { step: "SUBSCRIBE", eventName: "subscribe", count: totalSubscribers },
  ];

  const platformColors: Record<string, string> = {
    iOS: "#8195B5",
    Android: "#9DB582",
    web: "#597794",
    "(not set)": "#6B6B6B",
  };

  const teamData = teamInvitedByPlatform.map((d) => ({
    label: d.dimension,
    value: d.count,
  }));

  const subscribeDonut = subscribeByPlatform.map((d) => ({
    name: d.dimension,
    value: d.count,
    color: platformColors[d.dimension] ?? "#6B6B6B",
  }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02] col-span-1">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Trial → Paid Conversion
          </p>
          <p className="font-mohave text-5xl font-semibold text-[#9DB582] mt-4">
            {conversionRate}%
          </p>
          <p className="font-kosugi text-[12px] text-[#6B6B6B] mt-2">
            [{totalSubscribers} of {totalTrials} trials converted · last 90 days]
          </p>
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02] col-span-2">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Conversion Funnel [last 90 days]
          </p>
          <FunnelChart steps={conversionFunnel} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Team Member Invitations by Platform [last 30 days]
          </p>
          <AdminBarChart data={teamData} color="#C4A868" />
        </div>

        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
            Subscriptions by Platform [last 90 days]
          </p>
          {subscribeDonut.length > 0 ? (
            <AdminDonutChart data={subscribeDonut} />
          ) : (
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] text-center pt-8">
              No data yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
