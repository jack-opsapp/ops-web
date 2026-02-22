import { notFound } from "next/navigation";
import { getCompanyDetail, getCompanyUsageTimeline } from "@/lib/admin/admin-queries";
import { listAllAuthUsers } from "@/lib/firebase/admin-sdk";
import { AdminPageHeader } from "../../_components/admin-page-header";
import { StatCard } from "../../_components/stat-card";
import { PlanBadge } from "../../_components/plan-badge";
import { StatusBadge } from "../../_components/status-badge";
import { CompanyDetailTabs } from "./_components/company-detail-tabs";

async function fetchData(id: string) {
  const [detail, usageTimeline, authUsers] = await Promise.all([
    getCompanyDetail(id),
    getCompanyUsageTimeline(id, 12),
    listAllAuthUsers(),
  ]);

  if (!detail) return null;

  // Match auth users to company users by email
  const authByEmail: Record<string, { lastSignIn: string | null; creationTime: string | null }> = {};
  for (const u of authUsers) {
    if (u.email) {
      authByEmail[u.email] = {
        lastSignIn: u.metadata.lastSignInTime ?? null,
        creationTime: u.metadata.creationTime ?? null,
      };
    }
  }

  const usersWithAuth = detail.users.map((u) => {
    const auth = authByEmail[u.email ?? ""];
    return {
      ...u,
      lastSignIn: auth?.lastSignIn ?? null,
    };
  });

  // Pipeline data
  const db = (await import("@/lib/supabase/admin-client")).getAdminSupabase();
  const [
    { data: pipelineData },
    { data: estimateData },
    { data: invoiceData },
    { data: paymentData },
  ] = await Promise.all([
    db.from("pipeline_references").select("id, stage, value, created_at")
      .eq("company_id", id).is("deleted_at", null),
    db.from("estimates").select("id, status, total_amount, created_at")
      .eq("company_id", id).is("deleted_at", null),
    db.from("invoices").select("id, status, total_amount, created_at")
      .eq("company_id", id).is("deleted_at", null),
    db.from("payments").select("id, amount, created_at")
      .eq("company_id", id).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(10),
  ]);

  return {
    ...detail,
    usersWithAuth,
    usageTimeline,
    pipeline: pipelineData ?? [],
    estimates: estimateData ?? [],
    invoices: invoiceData ?? [],
    recentPayments: paymentData ?? [],
  };
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await fetchData(id);
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Company Detail Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }
  if (!data) notFound();

  const { company } = data;
  const seatsUsed = company.seated_employee_ids?.length ?? 0;

  return (
    <div>
      <AdminPageHeader title={company.name} caption={company.id} />

      <div className="p-8 space-y-8">
        {/* Plan + Status */}
        <div className="flex items-center gap-3">
          <PlanBadge plan={company.subscription_plan ?? "trial"} />
          <StatusBadge status={company.subscription_status ?? "trial"} />
        </div>

        {/* Mini Stats */}
        <div className="grid grid-cols-6 gap-4">
          <StatCard label="Users" value={data.usersWithAuth.length} />
          <StatCard label="Projects" value={data.projects.length} />
          <StatCard label="Tasks" value={data.taskCount} />
          <StatCard label="Clients" value={data.clientCount} />
          <StatCard label="Pipeline" value={data.pipelineCount} />
          <StatCard label="Seats" value={`${seatsUsed}/${company.max_seats ?? "?"}`} />
        </div>

        {/* Sub-Tabs */}
        <CompanyDetailTabs
          company={company}
          users={data.usersWithAuth}
          projects={data.projects}
          usageTimeline={data.usageTimeline}
          pipeline={data.pipeline}
          estimates={data.estimates}
          invoices={data.invoices}
          recentPayments={data.recentPayments}
        />
      </div>
    </div>
  );
}
