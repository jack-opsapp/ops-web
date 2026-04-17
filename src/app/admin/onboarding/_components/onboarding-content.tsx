"use client";

import { StatCard } from "../../_components/stat-card";
import { FunnelChart } from "../../_components/charts/funnel-chart";
import { AdminBarChart } from "../../_components/charts/bar-chart";
import { AdminLineChart } from "../../_components/charts/line-chart";
import type {
  OnboardingOverview,
  OnboardingFunnelData,
  TriageBreakdown,
  DailyOnboardingEvent,
} from "@/lib/admin/onboarding-queries";

const VARIANT_LABELS: Record<string, string> = {
  a: "Interactive",
  b: "Video",
  c: "Animation",
};

interface OnboardingContentProps {
  data: {
    overview: OnboardingOverview;
    funnel: OnboardingFunnelData[];
    triage: TriageBreakdown[];
    daily: DailyOnboardingEvent[];
  };
}

export function OnboardingContent({ data }: OnboardingContentProps) {
  const { overview, funnel, triage, daily } = data;

  return (
    <div className="space-y-10">
      {/* ── KPI Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Events"
          value={overview.totalEvents.toLocaleString()}
          caption="last 30 days"
        />
        <StatCard
          label="Tutorial Completes"
          value={overview.totalTutorialCompletes.toLocaleString()}
          caption="last 30 days"
        />
        <StatCard
          label="Signups"
          value={overview.totalSignups.toLocaleString()}
          caption="last 30 days"
          accent
        />
        <StatCard
          label="Variant Leader"
          value={
            overview.variantWinner
              ? `${VARIANT_LABELS[overview.variantWinner] || overview.variantWinner} (${overview.variantWinnerRate}%)`
              : "N/A"
          }
          caption="highest conversion rate"
          accent
        />
      </div>

      {/* ── Funnel by Variant ────────────────────────────────────── */}
      <div>
        <h2 className="font-cakemono text-[16px] font-light uppercase text-[#E5E5E5] mb-4">
          Funnel by Variant
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {funnel.map((v) => (
            <div
              key={v.variant}
              className="border border-white/[0.08] rounded-md p-4"
            >
              <p className="font-mohave text-[14px] uppercase text-[#A0A0A0] mb-3">
                Variant {v.variant.toUpperCase()} —{" "}
                {VARIANT_LABELS[v.variant] || v.variant}
              </p>
              <FunnelChart
                steps={[
                  { step: "Tutorial Start", count: v.tutorialStarts },
                  { step: "Tutorial Complete", count: v.tutorialCompletes },
                  { step: "Signup Start", count: v.signupStarts },
                  { step: "Signup Complete", count: v.signupCompletes },
                  { step: "Download / Web", count: v.downloads },
                ]}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Triage Breakdown ─────────────────────────────────────── */}
      <div>
        <h2 className="font-cakemono text-[16px] font-light uppercase text-[#E5E5E5] mb-4">
          Returning User Triage
        </h2>
        <div className="border border-white/[0.08] rounded-md p-4 max-w-lg">
          {triage.length > 0 ? (
            <AdminBarChart
              data={triage.map((t) => ({
                label: t.decision.replace(/_/g, " "),
                value: t.count,
              }))}
              height={200}
            />
          ) : (
            <p className="font-kosugi text-[12px] text-[#6B6B6B]">
              [no triage events yet]
            </p>
          )}
        </div>
      </div>

      {/* ── Daily Trend ──────────────────────────────────────────── */}
      <div>
        <h2 className="font-cakemono text-[16px] font-light uppercase text-[#E5E5E5] mb-4">
          Daily Signups &amp; Completions
        </h2>
        <div className="border border-white/[0.08] rounded-md p-4">
          {daily.length > 0 ? (
            <AdminLineChart
              data={daily.map((d) => ({
                label: d.date.slice(5), // MM-DD
                value: d.signups,
              }))}
              height={240}
            />
          ) : (
            <p className="font-kosugi text-[12px] text-[#6B6B6B]">
              [no daily data yet]
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
