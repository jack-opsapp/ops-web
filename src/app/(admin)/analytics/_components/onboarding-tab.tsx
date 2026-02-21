"use client";

import { FunnelChart } from "../../_components/charts/funnel-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";

interface OnboardingTabProps {
  onboardingFunnel: { step: string; eventName: string; count: number }[];
  formAbandonment: { dimension: string; count: number }[];
}

export function OnboardingTab({ onboardingFunnel, formAbandonment }: OnboardingTabProps) {
  const abandonmentData = formAbandonment.map((d) => ({
    label: d.dimension,
    value: d.count,
  }));

  return (
    <div className="space-y-8">
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Onboarding Funnel
        </p>
        <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-8">
          [last 90 days · GA4 data · all platforms]
        </p>
        <FunnelChart steps={onboardingFunnel} />
      </div>

      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Form Abandonment by Type
        </p>
        <p className="font-kosugi text-[12px] text-[#6B6B6B] mb-6">
          [last 30 days · where users quit without saving]
        </p>
        <AdminBarChart data={abandonmentData} color="#C4A868" />
      </div>
    </div>
  );
}
