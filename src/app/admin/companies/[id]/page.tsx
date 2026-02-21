import { notFound } from "next/navigation";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { AdminPageHeader } from "../../_components/admin-page-header";
import { StatCard } from "../../_components/stat-card";
import { PlanBadge } from "../../_components/plan-badge";
import { StatusBadge } from "../../_components/status-badge";

async function fetchCompanyDetail(id: string) {
  const db = getAdminSupabase();

  const [
    { data: company },
    { data: users },
    { data: projects },
    { count: taskCount },
    { count: clientCount },
  ] = await Promise.all([
    db.from("companies").select("*").eq("id", id).is("deleted_at", null).single(),
    db.from("users").select("id, first_name, last_name, role, created_at")
      .eq("company_id", id).is("deleted_at", null).order("created_at"),
    db.from("projects").select("id, title, status, created_at")
      .eq("company_id", id).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(20),
    db.from("project_tasks").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
    db.from("clients").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
  ]);

  if (!company) return null;
  return { company, users: users ?? [], projects: projects ?? [], taskCount: taskCount ?? 0, clientCount: clientCount ?? 0 };
}

const ROLE_COLORS: Record<string, string> = {
  "Admin": "#C4A868",
  "Office Crew": "#8195B5",
  "Field Crew": "#9DB582",
};

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await fetchCompanyDetail(id);
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

  const { company, users, projects, taskCount, clientCount } = data;
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
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Users" value={users.length} />
          <StatCard label="Projects" value={projects.length} />
          <StatCard label="Tasks" value={taskCount} />
          <StatCard label="Clients" value={clientCount} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Subscription Section */}
          <div className="border border-white/[0.08] rounded-lg p-6 space-y-4">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
              Subscription
            </p>
            {[
              ["Plan", company.subscription_plan ?? "—"],
              ["Status", company.subscription_status ?? "—"],
              ["Seats", `${seatsUsed} / ${company.max_seats ?? "?"}`],
              ["Trial Start", company.trial_start_date ? new Date(company.trial_start_date).toLocaleDateString() : "—"],
              ["Trial End", company.trial_end_date ? new Date(company.trial_end_date).toLocaleDateString() : "—"],
              ["Sub End", company.subscription_end ? new Date(company.subscription_end).toLocaleDateString() : "—"],
              ["Priority Support", company.has_priority_support ? "Yes" : "No"],
              ["Data Setup", company.data_setup_completed ? "Completed" : company.data_setup_purchased ? "Purchased" : "No"],
              ["Stripe ID", company.stripe_customer_id ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between items-center h-10 border-b border-white/[0.05] last:border-0">
                <span className="font-mohave text-[13px] uppercase text-[#6B6B6B]">{label}</span>
                <span className="font-kosugi text-[13px] text-[#A0A0A0]">[{value}]</span>
              </div>
            ))}
          </div>

          {/* Team Section */}
          <div className="border border-white/[0.08] rounded-lg p-6">
            <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
              Team
            </p>
            <div className="space-y-0">
              {users.map((u) => {
                const roleColor = ROLE_COLORS[u.role] ?? "#6B6B6B";
                return (
                  <div key={u.id} className="flex items-center justify-between h-12 border-b border-white/[0.05] last:border-0">
                    <span className="font-mohave text-[14px] text-[#E5E5E5]">
                      {u.first_name} {u.last_name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full font-mohave text-[11px] uppercase border"
                        style={{ color: roleColor, borderColor: roleColor, backgroundColor: `${roleColor}1f` }}
                      >
                        {u.role}
                      </span>
                      <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                        [{new Date(u.created_at).toLocaleDateString()}]
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Projects Section */}
        <div className="border border-white/[0.08] rounded-lg p-6">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Projects [{projects.length}]
          </p>
          <div className="space-y-0">
            {projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between h-12 border-b border-white/[0.05] last:border-0">
                <span className="font-mohave text-[14px] text-[#E5E5E5]">{p.title}</span>
                <div className="flex items-center gap-3">
                  <StatusBadge status={p.status} />
                  <span className="font-kosugi text-[12px] text-[#6B6B6B]">
                    [{new Date(p.created_at).toLocaleDateString()}]
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
