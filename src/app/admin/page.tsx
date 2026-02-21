import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { listAllAuthUsers, calcActiveUsers } from "@/lib/firebase/admin-sdk";
import { StatCard } from "./_components/stat-card";
import { AdminPageHeader } from "./_components/admin-page-header";
import { AdminBarChart } from "./_components/charts/bar-chart";
import { PlanBadge } from "./_components/plan-badge";

async function fetchOverviewData() {
  const db = getAdminSupabase();
  const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalCompanies },
    { count: activeSubscriptions },
    { count: trialsExpiring },
    { data: allCompanies },
    { data: recentCompanies },
    authUsers,
  ] = await Promise.all([
    db.from("companies").select("*", { count: "exact", head: true }).is("deleted_at", null),
    db.from("companies").select("*", { count: "exact", head: true })
      .in("subscription_status", ["active", "grace"]).is("deleted_at", null),
    db.from("companies").select("*", { count: "exact", head: true })
      .eq("subscription_status", "trial")
      .lte("trial_end_date", twoWeeksFromNow)
      .is("deleted_at", null),
    db.from("companies").select("created_at")
      .gte("created_at", twelveMonthsAgo)
      .is("deleted_at", null),
    db.from("companies").select("name, subscription_plan, subscription_status, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    listAllAuthUsers(),
  ]);

  const { mau } = calcActiveUsers(authUsers);

  // Group companies by month for bar chart
  const monthCounts: Record<string, number> = {};
  for (const c of allCompanies ?? []) {
    const month = c.created_at?.slice(0, 7) ?? "";
    monthCounts[month] = (monthCounts[month] ?? 0) + 1;
  }
  const companiesByMonth = Object.entries(monthCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value })); // "MM" format

  return {
    totalCompanies: totalCompanies ?? 0,
    activeSubscriptions: activeSubscriptions ?? 0,
    trialsExpiring: trialsExpiring ?? 0,
    mau,
    companiesByMonth,
    recentCompanies: recentCompanies ?? [],
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
        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Companies" value={data.totalCompanies} />
          <StatCard label="Monthly Active Users" value={data.mau} caption="last 30 days, Firebase Auth" />
          <StatCard label="Active Subscriptions" value={data.activeSubscriptions} />
          <StatCard
            label="Trials Expiring"
            value={data.trialsExpiring}
            caption="within 14 days"
            accent={data.trialsExpiring > 0}
          />
        </div>

        {/* Charts + Recent */}
        <div className="grid grid-cols-2 gap-6">
          {/* New Companies Chart */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-6">
              New Companies
            </p>
            <AdminBarChart data={data.companiesByMonth} />
          </div>

          {/* Recent Signups Table */}
          <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
              Recent Signups
            </p>
            <div className="space-y-0">
              {data.recentCompanies.map((company, i) => (
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
        </div>
      </div>
    </div>
  );
}
