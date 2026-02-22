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
  ]);

  return {
    mrr,
    arr: mrr * 12,
    payingCount,
    trialCount,
    churnedCount,
    trialConversion,
    planDistribution,
    mrrGrowth,
    newVsChurned,
    trialTimeline,
    seatUtilization,
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

  return (
    <div>
      <AdminPageHeader title="Revenue" caption="Supabase data, real-time" />

      <div className="p-8 space-y-8">
        {/* 6 KPI Cards */}
        <div className="grid grid-cols-6 gap-4">
          <StatCard label="MRR" value={`$${data.mrr.toLocaleString()}`} />
          <StatCard label="ARR" value={`$${data.arr.toLocaleString()}`} />
          <StatCard label="Trials" value={data.trialCount} />
          <StatCard label="Paying" value={data.payingCount} accent />
          <StatCard label="Churned (30d)" value={data.churnedCount} danger={data.churnedCount > 0} />
          <StatCard label="Trial Conversion" value={`${data.trialConversion}%`} caption="last 90 days" />
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
