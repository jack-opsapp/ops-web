import { notFound } from "next/navigation";
import { getBriefingById } from "@/lib/admin/briefing-queries";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { StatCard } from "../../../_components/stat-card";
import { ActionItems } from "../_components/action-items";
import { AdPreview } from "../_components/ad-preview";
import { ABComparison } from "../_components/ab-comparison";
import { CompetitorIntel } from "../_components/competitor-card";
import { MarketPulse } from "../_components/market-pulse";
import type { ChartDataPoint } from "@/lib/admin/types";

function deltaTrend(value: number): { direction: "up" | "down" | "flat"; value: string } {
  const pct = `${Math.abs(value * 100).toFixed(1)}%`;
  if (value > 0.005) return { direction: "up", value: pct };
  if (value < -0.005) return { direction: "down", value: pct };
  return { direction: "flat", value: "flat" };
}

export default async function BriefingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const briefing = await getBriefingById(id);
  if (!briefing || briefing.status !== "complete") return notFound();

  const perf = briefing.performance_data;
  const sparklineData: ChartDataPoint[] = perf?.dailySpend.map((d) => ({
    label: d.date,
    value: d.spend,
  })) ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Intelligence Briefing"
        caption={`${briefing.period_start} — ${briefing.period_end} · ${briefing.triggered_by}`}
      />

      <div className="p-8 space-y-8">
        {/* Summary */}
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[16px] text-[#E5E5E5] leading-relaxed">
            {briefing.summary}
          </p>
        </div>

        {/* Action Items — THE primary section */}
        <ActionItems items={briefing.action_items} />

        {/* Performance Snapshot */}
        {perf && (
          <div>
            <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
              Performance Snapshot
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Spend"
                value={`$${perf.current.spend.toFixed(0)}`}
                trend={deltaTrend(perf.deltas.spend)}
                sparklineData={sparklineData}
              />
              <StatCard
                label="CPA"
                value={`$${perf.current.cpa.toFixed(2)}`}
                trend={deltaTrend(perf.deltas.cpa)}
              />
              <StatCard
                label="Conversions"
                value={String(perf.current.conversions)}
                trend={deltaTrend(perf.deltas.conversions)}
              />
            </div>
          </div>
        )}

        {/* Ad Suggestions + Keywords */}
        <AdPreview
          suggestions={briefing.ad_suggestions}
          keywords={briefing.keyword_recs}
        />

        {/* A/B Test Proposals */}
        <ABComparison proposals={briefing.ab_test_proposals} />

        {/* Insights */}
        {briefing.insights.length > 0 && (
          <div>
            <h2 className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B] mb-4">
              Insights
            </h2>
            <div className="space-y-3">
              {briefing.insights
                .sort((a, b) => b.impactScore - a.impactScore)
                .map((insight, i) => (
                  <div key={i} className="border border-white/[0.08] rounded p-4 bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`font-mohave text-[11px] uppercase ${
                        insight.severity === "high" ? "text-[#93321A]" :
                        insight.severity === "medium" ? "text-[#C4A868]" : "text-[#6B6B6B]"
                      }`}>[{insight.severity}]</span>
                      <span className="font-mohave text-[14px] text-[#E5E5E5]">{insight.title}</span>
                      <span className="font-kosugi text-[10px] text-[#444444] bg-white/[0.04] px-1.5 py-0.5 rounded ml-auto">
                        {insight.impactScore}/10
                      </span>
                    </div>
                    <p className="font-mohave text-[13px] text-[#A0A0A0] mb-1">{insight.explanation}</p>
                    <p className="font-mohave text-[13px] text-[#597794]">{insight.recommendation}</p>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Competitor Intel */}
        <CompetitorIntel competitors={briefing.competitor_intel} />

        {/* Market Pulse */}
        <MarketPulse themes={briefing.market_sentiment} />
      </div>
    </div>
  );
}
