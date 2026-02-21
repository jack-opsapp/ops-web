import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { AdminPageHeader } from "../_components/admin-page-header";
import { StatCard } from "../_components/stat-card";
import { SubscriptionsTable } from "./_components/subscriptions-table";

async function fetchSubscriptionData() {
  const db = getAdminSupabase();

  const { data: companies } = await db
    .from("companies")
    .select(`
      id, name, subscription_plan, subscription_status,
      trial_end_date, subscription_end,
      seated_employee_ids, max_seats
    `)
    .is("deleted_at", null)
    .order("trial_end_date", { ascending: true, nullsFirst: false });

  const all = companies ?? [];

  const planCounts = {
    trial: all.filter((c) => c.subscription_plan === "trial").length,
    starter: all.filter((c) => c.subscription_plan === "starter").length,
    team: all.filter((c) => c.subscription_plan === "team").length,
    business: all.filter((c) => c.subscription_plan === "business").length,
    expired: all.filter((c) => ["expired", "cancelled"].includes(c.subscription_status ?? "")).length,
  };

  return { companies: all, planCounts };
}

export default async function SubscriptionsPage() {
  let companies, planCounts;
  try {
    ({ companies, planCounts } = await fetchSubscriptionData());
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Subscriptions Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader title="Subscriptions" caption={`${companies.length} companies`} />
      <div className="p-8 space-y-8">
        <div className="grid grid-cols-5 gap-4">
          <StatCard label="Trial" value={planCounts.trial} />
          <StatCard label="Starter" value={planCounts.starter} />
          <StatCard label="Team" value={planCounts.team} />
          <StatCard label="Business" value={planCounts.business} />
          <StatCard label="Expired / Cancelled" value={planCounts.expired} danger={planCounts.expired > 0} />
        </div>
        <SubscriptionsTable companies={companies} />
      </div>
    </div>
  );
}
