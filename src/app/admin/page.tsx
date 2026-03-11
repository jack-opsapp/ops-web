import Link from "next/link";
import { listAllAuthUsers, calcActiveUsers } from "@/lib/firebase/admin-sdk";
import {
  getTotalCompanies,
  getTrialsExpiringIn,
  computeMRR,
  getTrialConversionRate,
} from "@/lib/admin/admin-queries";
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

function KpiItem({ label, value, href, accent }: { label: string; value: string | number; href?: string; accent?: boolean }) {
  const inner = (
    <span className={`flex items-center gap-2 ${href ? 'hover:text-[#A0A0A0] cursor-pointer' : ''} transition-colors`}>
      <span className="font-kosugi text-[10px] uppercase tracking-wider text-[#6B6B6B]">{label}</span>
      <span className={`font-mohave text-[15px] font-semibold ${accent ? 'text-[#C4A868]' : 'text-[#E5E5E5]'}`}>{value}</span>
    </span>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
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
    <div className="flex flex-col h-screen overflow-hidden">
      <AdminPageHeader
        title="Overview"
        caption={`last updated ${new Date().toLocaleTimeString()}`}
      />

      {/* Compact KPI bar */}
      <div className="flex items-center gap-6 px-6 py-2 border-b border-white/[0.06] flex-shrink-0">
        <KpiItem label="Companies" value={data.totalCompanies} href="/admin/companies" />
        <span className="w-px h-3 bg-white/[0.06]" />
        <KpiItem label="MAU" value={data.mau} href="/admin/engagement" />
        <KpiItem label="WAU" value={data.wau} href="/admin/engagement" />
        <span className="w-px h-3 bg-white/[0.06]" />
        <KpiItem label="MRR" value={`$${data.mrr.toLocaleString()}`} href="/admin/revenue" />
        <KpiItem label="Trial Conv" value={`${data.trialConversion}%`} />
        <span className="w-px h-3 bg-white/[0.06]" />
        <KpiItem label="Trials Expiring" value={data.trialsExpiring} accent={data.trialsExpiring > 0} />
      </div>

      <FlowGalaxyDashboard />
    </div>
  );
}
