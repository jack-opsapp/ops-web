"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PlanBadge } from "./plan-badge";
import { StatusBadge } from "./status-badge";
import { SubTabs } from "./sub-tabs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompanyData {
  company: Record<string, unknown>;
  usersWithAuth: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    created_at: string;
    lastSignIn: string | null;
  }[];
  projects: { id: string; title: string; status: string; created_at: string }[];
  taskCount: number;
  clientCount: number;
  pipelineCount: number;
  estimateCount: number;
  invoiceCount: number;
  usageTimeline: { projects: { label: string; value: number }[]; tasks: { label: string; value: number }[]; clients: { label: string; value: number }[] };
  pipeline: { id: string; stage: string; value: number; created_at: string }[];
  estimates: { id: string; status: string; total_amount: number; created_at: string }[];
  invoices: { id: string; status: string; total_amount: number; created_at: string }[];
  recentPayments: { id: string; amount: number; created_at: string }[];
}

interface CompanySheetProps {
  companyId: string | null;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveStatus(company: Record<string, unknown>): string {
  const status = company.subscription_status as string | null;
  if (status) return status;

  const trialEnd = company.trial_end_date as string | null;
  const stripeId = company.stripe_customer_id as string | null;

  if (trialEnd) {
    return new Date(trialEnd) > new Date() ? "trial" : "expired";
  }
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

const ROLE_COLORS: Record<string, string> = {
  Admin: "#C4A868",
  "Office Crew": "#8195B5",
  "Field Crew": "#9DB582",
};

function timeAgo(date: string | null): string {
  if (!date) return "never";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CompanySheet({ companyId, onClose }: CompanySheetProps) {
  const [data, setData] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/admin/company/${companyId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  return (
    <Sheet open={!!companyId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="max-w-[560px] w-full">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-white/[0.08]">
          {data ? (
            <>
              <SheetTitle className="font-mohave text-xl text-[#E5E5E5]">
                {(data.company.name as string) ?? "Company"}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 mt-1">
                <PlanBadge plan={derivePlan(data.company)} />
                <StatusBadge status={deriveStatus(data.company)} />
              </SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle className="font-mohave text-xl text-[#E5E5E5]">
                {loading ? "Loading..." : "Company"}
              </SheetTitle>
              <SheetDescription>
                {error ? "Failed to load" : ""}
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        <SheetBody className="px-6 py-4">
          {loading && <LoadingState />}
          {error && <ErrorState message={error} />}
          {data && !loading && <CompanyContent data={data} />}
        </SheetBody>

        {/* Full page link */}
        {companyId && (
          <div className="shrink-0 px-6 py-3 border-t border-white/[0.08]">
            <Link
              href={`/admin/companies/${companyId}`}
              className="font-mohave text-[13px] uppercase tracking-widest text-[#597794] hover:text-[#E5E5E5] transition-colors"
            >
              Open Full Detail →
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Loading / Error ─────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#597794] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="font-mohave text-[14px] text-[#93321A] uppercase">Error</p>
      <p className="font-kosugi text-[12px] text-[#A0A0A0] mt-2">{message}</p>
    </div>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

function CompanyContent({ data }: { data: CompanyData }) {
  const { company } = data;
  const seatsUsed = (company.seated_employee_ids as string[] | null)?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Users" value={data.usersWithAuth.length} />
        <MiniStat label="Projects" value={data.projects.length} />
        <MiniStat label="Tasks" value={data.taskCount} />
        <MiniStat label="Clients" value={data.clientCount} />
        <MiniStat label="Pipeline" value={data.pipelineCount} />
        <MiniStat label="Seats" value={`${seatsUsed}/${company.max_seats ?? "?"}`} />
      </div>

      {/* Tabs */}
      <SubTabs tabs={["Overview", "Team", "Pipeline", "Subscription"]}>
        {(tab) => {
          if (tab === "Overview") return <OverviewTab data={data} />;
          if (tab === "Team") return <TeamTab users={data.usersWithAuth} />;
          if (tab === "Pipeline") return <PipelineTab data={data} />;
          if (tab === "Subscription") return <SubscriptionTab company={company} />;
          return null;
        }}
      </SubTabs>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-white/[0.08] rounded-lg p-3 bg-white/[0.02]">
      <p className="font-mohave text-[11px] uppercase text-[#6B6B6B]">{label}</p>
      <p className="font-mohave text-lg text-[#E5E5E5] mt-0.5">{value}</p>
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: CompanyData }) {
  return (
    <div className="space-y-4">
      {/* Recent Projects */}
      <div>
        <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Recent Projects
        </p>
        {data.projects.length === 0 ? (
          <p className="font-kosugi text-[12px] text-[#6B6B6B] py-2">No projects</p>
        ) : (
          <div className="border border-white/[0.08] rounded-lg overflow-hidden">
            {data.projects.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 h-10 border-b border-white/[0.05] last:border-0">
                <span className="font-mohave text-[13px] text-[#E5E5E5] truncate pr-4">{p.title}</span>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Summary */}
      <div>
        <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Activity [12 weeks]
        </p>
        <div className="border border-white/[0.08] rounded-lg overflow-hidden">
          <ActivityRow
            label="Projects Created"
            data={data.usageTimeline.projects}
          />
          <ActivityRow
            label="Tasks Created"
            data={data.usageTimeline.tasks}
          />
          <ActivityRow
            label="Clients Created"
            data={data.usageTimeline.clients}
          />
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ label, data }: { label: string; data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const recent = data.slice(-4).reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.05] last:border-0">
      <span className="font-mohave text-[13px] text-[#A0A0A0]">{label}</span>
      <div className="flex items-center gap-4">
        <span className="font-kosugi text-[11px] text-[#6B6B6B]">last 4w: {recent}</span>
        <span className="font-mohave text-[13px] text-[#E5E5E5]">{total} total</span>
      </div>
    </div>
  );
}

function TeamTab({ users }: { users: CompanyData["usersWithAuth"] }) {
  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      {users.length === 0 ? (
        <p className="font-kosugi text-[12px] text-[#6B6B6B] py-4 px-4 text-center">No users</p>
      ) : (
        users.map((u) => {
          const roleColor = ROLE_COLORS[u.role] ?? "#6B6B6B";
          return (
            <div key={u.id} className="px-4 py-3 border-b border-white/[0.05] last:border-0">
              <div className="flex items-center justify-between">
                <span className="font-mohave text-[14px] text-[#E5E5E5]">
                  {u.first_name} {u.last_name}
                </span>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full font-mohave text-[10px] uppercase border"
                  style={{ color: roleColor, borderColor: roleColor, backgroundColor: `${roleColor}1f` }}
                >
                  {u.role}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1">
                <span className="font-kosugi text-[11px] text-[#6B6B6B] truncate">{u.email}</span>
                <span className="font-kosugi text-[11px] text-[#6B6B6B] shrink-0">
                  Last: {timeAgo(u.lastSignIn)}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function PipelineTab({ data }: { data: CompanyData }) {
  const stages: Record<string, { count: number; value: number }> = {};
  for (const p of data.pipeline) {
    const stage = p.stage ?? "Unknown";
    if (!stages[stage]) stages[stage] = { count: 0, value: 0 };
    stages[stage].count++;
    stages[stage].value += p.value ?? 0;
  }

  const estimateTotal = data.estimates.reduce((s, e) => s + (e.total_amount ?? 0), 0);
  const invoiceTotal = data.invoices.reduce((s, i) => s + (i.total_amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Est. Value" value={`$${estimateTotal.toLocaleString()}`} />
        <MiniStat label="Inv. Value" value={`$${invoiceTotal.toLocaleString()}`} />
      </div>

      {Object.keys(stages).length > 0 && (
        <div>
          <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Pipeline Stages
          </p>
          <div className="border border-white/[0.08] rounded-lg overflow-hidden">
            {Object.entries(stages).map(([stage, { count, value }]) => (
              <div key={stage} className="flex items-center justify-between px-4 h-10 border-b border-white/[0.05] last:border-0">
                <span className="font-mohave text-[13px] text-[#E5E5E5]">{stage}</span>
                <div className="flex items-center gap-4">
                  <span className="font-kosugi text-[11px] text-[#6B6B6B]">{count} deals</span>
                  <span className="font-mohave text-[13px] text-[#E5E5E5]">${value.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentPayments.length > 0 && (
        <div>
          <p className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
            Recent Payments
          </p>
          <div className="border border-white/[0.08] rounded-lg overflow-hidden">
            {data.recentPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 h-10 border-b border-white/[0.05] last:border-0">
                <span className="font-kosugi text-[11px] text-[#6B6B6B]">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
                <span className="font-mohave text-[14px] text-[#9DB582]">
                  ${(p.amount ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.pipeline.length === 0 && data.estimates.length === 0 && (
        <p className="font-kosugi text-[12px] text-[#6B6B6B] py-4 text-center">No pipeline data</p>
      )}
    </div>
  );
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
    ["Stripe ID", (company.stripe_customer_id as string) ?? "—"],
    ["Priority Support", company.has_priority_support ? "Yes" : "No"],
  ];

  return (
    <div className="space-y-3">
      {isInferred && (
        <div className="bg-[#C4A868]/10 border border-[#C4A868]/20 rounded-lg px-4 py-2">
          <p className="font-mohave text-[11px] uppercase text-[#C4A868]">
            Subscription data incomplete — status inferred from available fields
          </p>
        </div>
      )}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between items-center px-4 h-10 border-b border-white/[0.05] last:border-0">
            <span className="font-mohave text-[12px] uppercase text-[#6B6B6B]">{label}</span>
            <span className="font-kosugi text-[12px] text-[#A0A0A0]">[{value}]</span>
          </div>
        ))}
      </div>
    </div>
  );
}
