"use client";

import { SubTabs } from "../../../_components/sub-tabs";
import { AdminLineChart } from "../../../_components/charts/line-chart";
import { StatusBadge } from "../../../_components/status-badge";
import type { ChartDataPoint } from "@/lib/admin/types";

const ROLE_COLORS: Record<string, string> = {
  Admin: "#C4A868",
  "Office Crew": "#8195B5",
  "Field Crew": "#9DB582",
};

interface CompanyDetailTabsProps {
  company: Record<string, unknown>;
  users: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    created_at: string;
    lastSignIn: string | null;
  }[];
  projects: { id: string; title: string; status: string; created_at: string }[];
  usageTimeline: { projects: ChartDataPoint[]; tasks: ChartDataPoint[]; clients: ChartDataPoint[] };
  pipeline: { id: string; stage: string; value: number; created_at: string }[];
  estimates: { id: string; status: string; total_amount: number; created_at: string }[];
  invoices: { id: string; status: string; total_amount: number; created_at: string }[];
  recentPayments: { id: string; amount: number; created_at: string }[];
}

const TABS = ["Subscription", "Team", "Usage", "Pipeline", "Portal"];

export function CompanyDetailTabs({
  company,
  users,
  projects,
  usageTimeline,
  pipeline,
  estimates,
  invoices,
  recentPayments,
}: CompanyDetailTabsProps) {
  return (
    <SubTabs tabs={TABS} defaultTab="Subscription">
      {(activeTab) => {
        if (activeTab === "Subscription") return <SubscriptionTab company={company} />;
        if (activeTab === "Team") return <TeamTab users={users} />;
        if (activeTab === "Usage") return <UsageTab usageTimeline={usageTimeline} projects={projects} />;
        if (activeTab === "Pipeline") return (
          <PipelineTab
            pipeline={pipeline}
            estimates={estimates}
            invoices={invoices}
            recentPayments={recentPayments}
          />
        );
        if (activeTab === "Portal") return <PortalTab company={company} />;
        return null;
      }}
    </SubTabs>
  );
}

function deriveStatus(company: Record<string, unknown>): string {
  const status = company.subscription_status as string | null;
  if (status) return status;
  const trialEnd = company.trial_end_date as string | null;
  const stripeId = company.stripe_customer_id as string | null;
  if (trialEnd) return new Date(trialEnd) > new Date() ? "trial" : "expired";
  if (stripeId) return "unknown";
  return "none";
}

function derivePlan(company: Record<string, unknown>): string {
  const plan = company.subscription_plan as string | null;
  if (plan) return plan;
  const status = deriveStatus(company);
  if (status === "trial" || status === "expired") return "trial";
  return "none";
}

function SubscriptionTab({ company }: { company: Record<string, unknown> }) {
  const seatsUsed = (company.seated_employee_ids as string[] | null)?.length ?? 0;
  const status = deriveStatus(company);
  const plan = derivePlan(company);
  const isInferred = !company.subscription_status;

  const rows = [
    ["Plan", plan + (isInferred && plan !== "none" ? " (inferred)" : "")],
    ["Status", status + (isInferred && status !== "none" ? " (inferred)" : "")],
    ["Seats", `${seatsUsed} / ${company.max_seats ?? "?"}`],
    ["Trial Start", company.trial_start_date ? new Date(company.trial_start_date as string).toLocaleDateString() : "—"],
    ["Trial End", company.trial_end_date ? new Date(company.trial_end_date as string).toLocaleDateString() : "—"],
    ["Sub End", company.subscription_end ? new Date(company.subscription_end as string).toLocaleDateString() : "—"],
    ["Priority Support", company.has_priority_support ? "Yes" : "No"],
    ["Data Setup", company.data_setup_completed ? "Completed" : company.data_setup_purchased ? "Purchased" : "No"],
    ["Stripe ID", company.stripe_customer_id ?? "—"],
  ];

  return (
    <div className="space-y-4 max-w-lg">
      {isInferred && (
        <div className="bg-[#C4A868]/10 border border-[#C4A868]/20 rounded-lg px-4 py-2">
          <p className="font-mohave text-[11px] uppercase text-[#C4A868]">
            Subscription data incomplete — status inferred from available fields
          </p>
        </div>
      )}
      <div className="border border-white/[0.08] rounded-lg p-6 space-y-4">
        {rows.map(([label, value]) => (
          <div key={label as string} className="flex justify-between items-center h-10 border-b border-white/[0.05] last:border-0">
            <span className="font-mohave text-[13px] uppercase text-[#6B6B6B]">{label as string}</span>
            <span className="font-kosugi text-[13px] text-[#A0A0A0]">[{value as string}]</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamTab({ users }: { users: CompanyDetailTabsProps["users"] }) {
  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <div className="grid grid-cols-5 px-6 py-3 border-b border-white/[0.08]">
        {["NAME", "EMAIL", "ROLE", "LAST SIGN-IN", "JOINED"].map((h) => (
          <span key={h} className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">{h}</span>
        ))}
      </div>
      {users.map((u) => {
        const roleColor = ROLE_COLORS[u.role] ?? "#6B6B6B";
        const isRecent = u.lastSignIn && Date.now() - new Date(u.lastSignIn).getTime() < 7 * 86_400_000;
        return (
          <div key={u.id} className="grid grid-cols-5 px-6 items-center h-14 border-b border-white/[0.05] last:border-0">
            <span className="font-mohave text-[14px] text-[#E5E5E5]">
              {u.first_name} {u.last_name}
            </span>
            <span className="font-kosugi text-[12px] text-[#6B6B6B] truncate pr-2">{u.email}</span>
            <span>
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full font-mohave text-[11px] uppercase border"
                style={{ color: roleColor, borderColor: roleColor, backgroundColor: `${roleColor}1f` }}
              >
                {u.role}
              </span>
            </span>
            <span className={`font-kosugi text-[12px] ${isRecent ? "text-[#9DB582]" : "text-[#6B6B6B]"}`}>
              {u.lastSignIn ? `[${new Date(u.lastSignIn).toLocaleDateString()}]` : "[never]"}
            </span>
            <span className="font-kosugi text-[11px] text-[#6B6B6B]">
              [{new Date(u.created_at).toLocaleDateString()}]
            </span>
          </div>
        );
      })}
    </div>
  );
}

function UsageTab({
  usageTimeline,
  projects,
}: {
  usageTimeline: CompanyDetailTabsProps["usageTimeline"];
  projects: CompanyDetailTabsProps["projects"];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-6">
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Projects Created [12 weeks]
          </p>
          <AdminLineChart data={usageTimeline.projects} color="#597794" />
        </div>
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Tasks Created [12 weeks]
          </p>
          <AdminLineChart data={usageTimeline.tasks} color="#9DB582" />
        </div>
        <div className="border border-white/[0.08] rounded-lg p-6 bg-white/[0.02]">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Clients Created [12 weeks]
          </p>
          <AdminLineChart data={usageTimeline.clients} color="#C4A868" />
        </div>
      </div>

      {/* Recent Projects */}
      <div className="border border-white/[0.08] rounded-lg p-6">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
          Recent Projects [{projects.length}]
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
  );
}

function PipelineTab({
  pipeline,
  estimates,
  invoices,
  recentPayments,
}: {
  pipeline: CompanyDetailTabsProps["pipeline"];
  estimates: CompanyDetailTabsProps["estimates"];
  invoices: CompanyDetailTabsProps["invoices"];
  recentPayments: CompanyDetailTabsProps["recentPayments"];
}) {
  // Group pipeline by stage
  const stages: Record<string, { count: number; value: number }> = {};
  for (const p of pipeline) {
    const stage = p.stage ?? "Unknown";
    if (!stages[stage]) stages[stage] = { count: 0, value: 0 };
    stages[stage].count++;
    stages[stage].value += p.value ?? 0;
  }

  const estimateTotal = estimates.reduce((s, e) => s + (e.total_amount ?? 0), 0);
  const invoiceTotal = invoices.reduce((s, i) => s + (i.total_amount ?? 0), 0);
  const paymentTotal = recentPayments.reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <div className="border border-white/[0.08] rounded-lg p-4">
          <p className="font-mohave text-[12px] uppercase text-[#6B6B6B]">Pipeline Deals</p>
          <p className="font-mohave text-2xl text-[#E5E5E5] mt-1">{pipeline.length}</p>
        </div>
        <div className="border border-white/[0.08] rounded-lg p-4">
          <p className="font-mohave text-[12px] uppercase text-[#6B6B6B]">Estimates</p>
          <p className="font-mohave text-2xl text-[#E5E5E5] mt-1">${estimateTotal.toLocaleString()}</p>
        </div>
        <div className="border border-white/[0.08] rounded-lg p-4">
          <p className="font-mohave text-[12px] uppercase text-[#6B6B6B]">Invoices</p>
          <p className="font-mohave text-2xl text-[#E5E5E5] mt-1">${invoiceTotal.toLocaleString()}</p>
        </div>
        <div className="border border-white/[0.08] rounded-lg p-4">
          <p className="font-mohave text-[12px] uppercase text-[#6B6B6B]">Payments</p>
          <p className="font-mohave text-2xl text-[#E5E5E5] mt-1">${paymentTotal.toLocaleString()}</p>
        </div>
      </div>

      {/* Stage Breakdown */}
      {Object.keys(stages).length > 0 && (
        <div className="border border-white/[0.08] rounded-lg p-6">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Pipeline Stages
          </p>
          {Object.entries(stages).map(([stage, { count, value }]) => (
            <div key={stage} className="flex items-center justify-between h-10 border-b border-white/[0.05] last:border-0">
              <span className="font-mohave text-[14px] text-[#E5E5E5]">{stage}</span>
              <div className="flex items-center gap-6">
                <span className="font-mohave text-[13px] text-[#A0A0A0]">{count} deals</span>
                <span className="font-mohave text-[14px] text-[#E5E5E5]">${value.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Payments */}
      {recentPayments.length > 0 && (
        <div className="border border-white/[0.08] rounded-lg p-6">
          <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B] mb-4">
            Recent Payments
          </p>
          {recentPayments.map((p) => (
            <div key={p.id} className="flex items-center justify-between h-10 border-b border-white/[0.05] last:border-0">
              <span className="font-kosugi text-[13px] text-[#6B6B6B]">
                [{new Date(p.created_at).toLocaleDateString()}]
              </span>
              <span className="font-mohave text-[14px] text-[#9DB582]">${(p.amount ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PortalTab({ company }: { company: Record<string, unknown> }) {
  const features = [
    ["Portal Enabled", company.portal_enabled ? "Yes" : "No"],
    ["Portal Branding", company.portal_branding_configured ? "Configured" : "Not set up"],
    ["Gmail Connected", company.gmail_connected ? "Connected" : "Not connected"],
    ["Accounting Connected", company.accounting_connected ? "Connected" : "Not connected"],
  ];

  return (
    <div className="border border-white/[0.08] rounded-lg p-6 max-w-lg space-y-4">
      <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
        Portal & Integrations
      </p>
      {features.map(([label, value]) => (
        <div key={label} className="flex justify-between items-center h-10 border-b border-white/[0.05] last:border-0">
          <span className="font-mohave text-[13px] uppercase text-[#6B6B6B]">{label}</span>
          <span className={`font-kosugi text-[13px] ${value === "Yes" || value === "Connected" || value === "Configured" ? "text-[#9DB582]" : "text-[#6B6B6B]"}`}>
            [{value}]
          </span>
        </div>
      ))}
    </div>
  );
}
