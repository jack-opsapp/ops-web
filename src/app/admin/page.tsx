import { listAllAuthUsers, calcActiveUsers } from "@/lib/firebase/admin-sdk";
import {
  getTotalCompanies,
  getTrialsExpiringIn,
  computeMRR,
  getTrialConversionRate,
} from "@/lib/admin/admin-queries";
import { StatCard } from "./_components/stat-card";
import { AdminPageHeader } from "./_components/admin-page-header";
import { FlowGalaxyDashboard } from "./_components/flow-galaxy/flow-galaxy-dashboard";

async function fetchOverviewData() {
  const [
    totalCompanies,
    authUsers,
    mrr,
    trialConversion,
    trialsExpiring,
  ] = await Promise.all([
    getTotalCompanies(),
    listAllAuthUsers(),
    computeMRR(),
    getTrialConversionRate(90),
    getTrialsExpiringIn(14),
  ]);

  const { mau, wau } = calcActiveUsers(authUsers);

  return {
    totalCompanies,
    mau,
    wau,
    mrr,
    trialConversion,
    trialsExpiring,
  };
}

export default async function OverviewPage() {
  let data;
  try {
    data = await fetchOverviewData();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Admin Data Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 overflow-auto whitespace-pre-wrap">
          {msg}
          {stack && `\n\n${stack}`}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <AdminPageHeader
        title="Overview"
        caption={`last updated ${new Date().toLocaleTimeString()}`}
      />

      <div className="p-8 pb-4">
        {/* 6 KPI Cards — clickable */}
        <div className="grid grid-cols-6 gap-4">
          <StatCard label="Total Companies" value={data.totalCompanies} href="/admin/companies" />
          <StatCard label="MAU" value={data.mau} caption="Firebase Auth" href="/admin/engagement" />
          <StatCard label="WAU" value={data.wau} caption="Firebase Auth" href="/admin/engagement" />
          <StatCard label="MRR" value={`$${data.mrr.toLocaleString()}`} href="/admin/revenue" />
          <StatCard label="Trial Conversion" value={`${data.trialConversion}%`} caption="last 90 days" />
          <StatCard
            label="Trials Expiring"
            value={data.trialsExpiring}
            caption="within 14 days"
            accent={data.trialsExpiring > 0}
          />
        </div>
      </div>

      <FlowGalaxyDashboard />
    </div>
  );
}
