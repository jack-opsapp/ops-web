import { listAllAuthUsers, calcActiveUsers } from "@/lib/firebase/admin-sdk";
import {
  getTotalCompanies,
  getTrialsExpiringIn,
  getRecentSignups,
  getCompanySparkline,
  getTasksCreatedSparkline,
  getActiveUsersSparkline,
  computeMRR,
  getTrialConversionRate,
  getAlerts,
} from "@/lib/admin/admin-queries";
import { getFeatureRequests } from "@/lib/admin/admin-queries";
import { PLAN_PRICES } from "@/lib/admin/types";
import { StatCard } from "./_components/stat-card";
import { AdminPageHeader } from "./_components/admin-page-header";
import { Sparkline } from "./_components/sparkline";
import { AlertList } from "./_components/alert-list";
import { PlanBadge } from "./_components/plan-badge";

async function fetchOverviewData() {
  const [
    totalCompanies,
    authUsers,
    mrr,
    trialConversion,
    trialsExpiring,
    recentSignups,
    companySparkline,
    taskSparkline,
    alerts,
    featureRequests,
  ] = await Promise.all([
    getTotalCompanies(),
    listAllAuthUsers(),
    computeMRR(),
    getTrialConversionRate(90),
    getTrialsExpiringIn(14),
    getRecentSignups(10),
    getCompanySparkline(12),
    getTasksCreatedSparkline(12),
    getAlerts(),
    getFeatureRequests(),
  ]);

  const { mau, wau } = calcActiveUsers(authUsers);
  const activeUsersSparkline = getActiveUsersSparkline(authUsers, 12);

  // Revenue sparkline: approximate from company sparkline data
  // Each new paying company adds avg revenue
  const avgPrice = Object.values(PLAN_PRICES).reduce((a, b) => a + b, 0) / Object.keys(PLAN_PRICES).length;
  const revenueSparkline = companySparkline.map((d) => ({
    label: d.label,
    value: Math.round(d.value * avgPrice),
  }));

  return {
    totalCompanies,
    mau,
    wau,
    mrr,
    trialConversion,
    trialsExpiring,
    recentSignups,
    companySparkline,
    taskSparkline,
    activeUsersSparkline,
    revenueSparkline,
    alerts,
    latestFeatureRequests: featureRequests.slice(0, 5),
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
    <div>
      <AdminPageHeader
        title="Overview"
        caption={`last updated ${new Date().toLocaleTimeString()}`}
      />

      <div className="p-8 space-y-8">
        {/* 6 KPI Cards */}
        <div className="grid grid-cols-6 gap-4">
          <StatCard label="Total Companies" value={data.totalCompanies} />
          <StatCard label="MAU" value={data.mau} caption="Firebase Auth" />
          <StatCard label="WAU" value={data.wau} caption="Firebase Auth" />
          <StatCard label="MRR" value={`$${data.mrr.toLocaleString()}`} />
          <StatCard label="Trial Conversion" value={`${data.trialConversion}%`} caption="last 90 days" />
          <StatCard
            label="Trials Expiring"
            value={data.trialsExpiring}
            caption="within 14 days"
            accent={data.trialsExpiring > 0}
          />
        </div>

        {/* 4 Sparklines */}
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
            <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              New Companies
            </p>
            <Sparkline data={data.companySparkline} color="#597794" />
          </div>
          <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
            <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Active Users
            </p>
            <Sparkline data={data.activeUsersSparkline} color="#9DB582" />
          </div>
          <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
            <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Tasks Created
            </p>
            <Sparkline data={data.taskSparkline} color="#8195B5" />
          </div>
          <div className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02]">
            <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Revenue
            </p>
            <Sparkline data={data.revenueSparkline} color="#C4A868" />
          </div>
        </div>

        {/* Alerts */}
        <div className="border border-white/[0.08] rounded-lg bg-white/[0.02]">
          <div className="px-6 py-4 border-b border-white/[0.08]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
              Action Items
            </p>
          </div>
          <AlertList alerts={data.alerts} />
        </div>

        {/* Two Columns: Recent Signups + Feature Requests */}
        <div className="grid grid-cols-2 gap-6">
          {/* Recent Signups */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
              Recent Signups
            </p>
            <div className="space-y-0">
              {data.recentSignups.map((company, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between h-14 border-b border-white/[0.05] last:border-0"
                >
                  <span className="font-mohave text-[14px] text-[#E5E5E5]">
                    {company.name}
                  </span>
                  <div className="flex items-center gap-3">
                    <PlanBadge plan={company.subscription_plan ?? "trial"} />
                    <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                      [{new Date(company.created_at).toLocaleDateString()}]
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Latest Feature Requests */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
              Latest Feature Requests
            </p>
            <div className="space-y-0">
              {data.latestFeatureRequests.length === 0 ? (
                <p className="font-mohave text-[14px] uppercase text-[#6B6B6B] py-4 text-center">
                  No feature requests
                </p>
              ) : (
                data.latestFeatureRequests.map((fr) => (
                  <div
                    key={fr.id}
                    className="flex items-center justify-between h-14 border-b border-white/[0.05] last:border-0"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="font-mohave text-[14px] text-[#E5E5E5] truncate">{fr.title}</p>
                      <p className="font-kosugi text-[11px] text-[#6B6B6B]">{fr.type}</p>
                    </div>
                    <span className="font-kosugi text-[12px] text-[#6B6B6B] flex-shrink-0">
                      [{new Date(fr.created_at).toLocaleDateString()}]
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
