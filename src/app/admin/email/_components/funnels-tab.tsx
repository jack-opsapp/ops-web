"use client";

import { StatCard } from "../../_components/stat-card";
import { FunnelChart } from "../../_components/charts/funnel-chart";
import type { EmailFunnelData } from "@/lib/admin/types";

interface FunnelsTabProps {
  data: EmailFunnelData;
}

export function FunnelsTab({ data }: FunnelsTabProps) {
  const { segmentCounts } = data;

  return (
    <div className="space-y-6">
      {/* Segment count cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Bubble Re-auth"
          value={segmentCounts.bubble_reauth.toLocaleString()}
          caption="invalid email domain"
        />
        <StatCard
          label="Unverified"
          value={segmentCounts.unverified.toLocaleString()}
          caption="onboarding incomplete"
        />
        <StatCard
          label="Auth / Lifecycle"
          value={segmentCounts.auth_lifecycle.toLocaleString()}
          caption="onboarded users"
        />
        <StatCard
          label="Removed"
          value={segmentCounts.removed.toLocaleString()}
          caption="opted out"
          danger={segmentCounts.removed > 0}
        />
      </div>

      {/* Bubble + Unverified funnels side by side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Bubble Re-auth Funnel
          </p>
          <FunnelChart steps={data.bubble} />
        </div>
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Unverified Funnel
          </p>
          <FunnelChart steps={data.unverified} />
        </div>
      </div>

      {/* Auth / Lifecycle funnel full-width */}
      <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Auth / Lifecycle Funnel
        </p>
        <FunnelChart steps={data.auth} />
      </div>
    </div>
  );
}
