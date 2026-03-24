/**
 * Briefing Step 1: Pull Google Ads performance data.
 * Current 7 days + prior 7 days for comparison.
 */
import {
  getAccountSummaryForRange,
  getCampaignPerformanceForRange,
  getDailySpendForRange,
} from "@/lib/analytics/google-ads-client";
import type { PerformanceSnapshot } from "../briefing-types";

export async function pullAdsData(): Promise<PerformanceSnapshot> {
  const now = new Date();
  const currentEnd = new Date(now);
  currentEnd.setDate(currentEnd.getDate() - 1); // yesterday
  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - 6); // 7 days

  const priorEnd = new Date(currentStart);
  priorEnd.setDate(priorEnd.getDate() - 1); // day before current period
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - 6); // 7 days

  const [current, prior, campaigns, dailySpend] = await Promise.all([
    getAccountSummaryForRange(currentStart, currentEnd),
    getAccountSummaryForRange(priorStart, priorEnd),
    getCampaignPerformanceForRange(currentStart, currentEnd),
    getDailySpendForRange(currentStart, currentEnd),
  ]);

  // Compute percentage deltas (negative = decrease)
  const delta = (curr: number, prev: number) =>
    prev === 0 ? (curr === 0 ? 0 : 1) : (curr - prev) / prev;

  const deltas = {
    spend: delta(current.totalSpend, prior.totalSpend),
    cpa: delta(current.avgCpa, prior.avgCpa),
    ctr: delta(current.avgCtr, prior.avgCtr),
    clicks: delta(current.totalClicks, prior.totalClicks),
    impressions: delta(current.totalImpressions, prior.totalImpressions),
    conversions: delta(current.totalConversions, prior.totalConversions),
  };

  // Find top campaign (most conversions) and worst (highest CPA with spend)
  const withSpend = campaigns.filter((c) => c.cost > 0);
  const topCampaign = [...withSpend].sort((a, b) => b.conversions - a.conversions)[0];
  const worstCampaign = [...withSpend].sort((a, b) => b.cpa - a.cpa)[0];

  return {
    current: {
      spend: current.totalSpend,
      cpa: current.avgCpa,
      ctr: current.avgCtr,
      clicks: current.totalClicks,
      impressions: current.totalImpressions,
      conversions: current.totalConversions,
    },
    prior: {
      spend: prior.totalSpend,
      cpa: prior.avgCpa,
      ctr: prior.avgCtr,
      clicks: prior.totalClicks,
      impressions: prior.totalImpressions,
      conversions: prior.totalConversions,
    },
    deltas,
    topCampaign: topCampaign
      ? { name: topCampaign.name, conversions: topCampaign.conversions, cpa: topCampaign.cpa }
      : { name: "N/A", conversions: 0, cpa: 0 },
    worstCampaign: worstCampaign
      ? { name: worstCampaign.name, spend: worstCampaign.cost, conversions: worstCampaign.conversions, cpa: worstCampaign.cpa }
      : { name: "N/A", spend: 0, conversions: 0, cpa: 0 },
    dailySpend: dailySpend.map((d) => ({ date: d.date, spend: d.spend })),
  };
}
