import {
  computeMRR,
  getPayingCompanyCount,
  getTrialCount,
  getChurnedCount,
  getTrialConversionRate,
  getPlanDistribution,
  getMRRGrowth,
  getNewVsChurned,
  getTrialExpirationTimeline,
  getSeatUtilization,
} from "@/lib/admin/admin-queries";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { RevenueCharts } from "./_components/revenue-charts";

async function fetchRevenueData() {
  const [
    mrr,
    payingCount,
    trialCount,
    churnedCount,
    trialConversion,
    planDistribution,
    mrrGrowth,
    newVsChurned,
    trialTimeline,
    seatUtilization,
    // Previous period for trend comparison
    prevChurnedCount,
    prevTrialConversion,
  ] = await Promise.all([
    computeMRR(),
    getPayingCompanyCount(),
    getTrialCount(),
    getChurnedCount(30),
    getTrialConversionRate(90),
    getPlanDistribution(),
    getMRRGrowth(12),
    getNewVsChurned(12),
    getTrialExpirationTimeline(30),
    getSeatUtilization(),
    getChurnedCount(60), // 30-60 days ago for comparison
    getTrialConversionRate(180), // previous 90 days for comparison
  ]);

  // Compute previous period churn (days 31-60 churn = 60d total - current 30d)
  const prevPeriodChurn = Math.max(0, prevChurnedCount - churnedCount);

  return {
    mrr,
    arr: mrr * 12,
    payingCount,
    trialCount,
    churnedCount,
    trialConversion,
    prevPeriodChurn,
    prevTrialConversion,
    planDistribution,
    mrrGrowth,
    newVsChurned,
    trialTimeline,
    seatUtilization,
  };
}

function computeTrend(current: number, previous: number): { direction: "up" | "down" | "flat"; value: string } {
  if (previous === 0) return { direction: current > 0 ? "up" : "flat", value: "N/A" };
  const pctChange = Math.round(((current - previous) / previous) * 100);
  if (pctChange === 0) return { direction: "flat", value: "0%" };
  return {
    direction: pctChange > 0 ? "up" : "down",
    value: `${Math.abs(pctChange)}%`,
  };
}

export default async function RevenuePage() {
  let data;
  try {
    data = await fetchRevenueData();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Revenue Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  const churnTrend = computeTrend(data.churnedCount, data.prevPeriodChurn);
  // For churn, "up" is bad — flip the direction semantics
  const churnTrendAdjusted = {
    ...churnTrend,
    direction: churnTrend.direction === "up" ? "down" as const : churnTrend.direction === "down" ? "up" as const : "flat" as const,
  };
  const conversionTrend = computeTrend(data.trialConversion, data.prevTrialConversion);

  return (
    <div>
      <AdminPageHeader title="Revenue" caption="Supabase data, real-time" />

      <div className="p-8 space-y-8">
        {/* 6 KPI Cards */}
        <div className="grid grid-cols-6 gap-4">
          <StatCard label="MRR" value={`$${data.mrr.toLocaleString()}`} href="#mrr-growth" />
          <StatCard label="ARR" value={`$${data.arr.toLocaleString()}`} />
          <StatCard label="Trials" value={data.trialCount} />
          <StatCard label="Paying" value={data.payingCount} accent href="/admin/companies" />
          <StatCard
            label="Churned (30d)"
            value={data.churnedCount}
            danger={data.churnedCount > 0}
            trend={churnTrendAdjusted}
          />
          <StatCard
            label="Trial Conversion"
            value={`${data.trialConversion}%`}
            caption="last 90 days"
            trend={conversionTrend}
          />
        </div>

        {/* Charts (client component) */}
        <RevenueCharts
          planDistribution={data.planDistribution}
          mrrGrowth={data.mrrGrowth}
          newVsChurned={data.newVsChurned}
          trialTimeline={data.trialTimeline}
          seatUtilization={data.seatUtilization}
        />
      </div>
    </div>
  );
}
