/**
 * OPS Admin — Supabase Aggregate Queries
 *
 * SERVER ONLY. All functions use getAdminSupabase() (service role, bypasses RLS).
 * ~30 query functions powering every admin tab.
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  PLAN_PRICES,
  type CompanyListItem,
  type FeatureAdoption,
  type PlanDistribution,
  type SeatUtilization,
  type PipelineStage,
  type InvoiceAging,
  type FeatureRequest,
  type AppMessage,
  type PromoCode,
  type AuditLogEntry,
  type DataQualityIssue,
  type TableStats,
  type ChartDataPoint,
  type StackedBarDataPoint,
} from "./types";

const db = () => getAdminSupabase();

// ─── Overview Queries ─────────────────────────────────────────────────────────

export async function getTotalCompanies(): Promise<number> {
  const { count } = await db().from("companies").select("*", { count: "exact", head: true }).is("deleted_at", null);
  return count ?? 0;
}

export async function getTrialsExpiringIn(days: number): Promise<number> {
  const cutoff = new Date(Date.now() + days * 86_400_000).toISOString();
  const { count } = await db()
    .from("companies").select("*", { count: "exact", head: true })
    .eq("subscription_status", "trial")
    .lte("trial_end_date", cutoff)
    .gte("trial_end_date", new Date().toISOString())
    .is("deleted_at", null);
  return count ?? 0;
}

export async function getRecentSignups(limit = 10) {
  const { data } = await db()
    .from("companies")
    .select("id, name, subscription_plan, subscription_status, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getCompanySparkline(weeks = 12): Promise<ChartDataPoint[]> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();
  const { data } = await db()
    .from("companies").select("created_at")
    .gte("created_at", since)
    .is("deleted_at", null);

  const weekBuckets: Record<string, number> = {};
  for (const row of data ?? []) {
    const d = new Date(row.created_at);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    weekBuckets[key] = (weekBuckets[key] ?? 0) + 1;
  }
  return Object.entries(weekBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value }));
}

export async function getTasksCreatedSparkline(weeks = 12): Promise<ChartDataPoint[]> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();
  const { data } = await db()
    .from("project_tasks").select("created_at")
    .gte("created_at", since)
    .is("deleted_at", null);

  const weekBuckets: Record<string, number> = {};
  for (const row of data ?? []) {
    const d = new Date(row.created_at);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    weekBuckets[key] = (weekBuckets[key] ?? 0) + 1;
  }
  return Object.entries(weekBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value }));
}

export function getActiveUsersSparkline(
  authUsers: { metadata: { lastSignInTime?: string } }[],
  weeks = 12
): ChartDataPoint[] {
  const now = Date.now();
  const weekBuckets: Record<string, number> = {};

  for (const u of authUsers) {
    const lastSign = u.metadata.lastSignInTime;
    if (!lastSign) continue;
    const d = new Date(lastSign);
    const diff = now - d.getTime();
    if (diff > weeks * 7 * 86_400_000) continue;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    weekBuckets[key] = (weekBuckets[key] ?? 0) + 1;
  }

  return Object.entries(weekBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value }));
}

// ─── Revenue Queries ──────────────────────────────────────────────────────────

export async function computeMRR(): Promise<number> {
  const { data } = await db()
    .from("companies")
    .select("subscription_plan")
    .in("subscription_status", ["active", "grace"])
    .is("deleted_at", null);

  return (data ?? []).reduce((sum, c) => {
    return sum + (PLAN_PRICES[c.subscription_plan ?? ""] ?? 0);
  }, 0);
}

export async function getPayingCompanyCount(): Promise<number> {
  const { count } = await db()
    .from("companies").select("*", { count: "exact", head: true })
    .in("subscription_status", ["active", "grace"])
    .is("deleted_at", null);
  return count ?? 0;
}

export async function getTrialCount(): Promise<number> {
  const { count } = await db()
    .from("companies").select("*", { count: "exact", head: true })
    .eq("subscription_status", "trial")
    .is("deleted_at", null);
  return count ?? 0;
}

export async function getChurnedCount(days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { count } = await db()
    .from("companies").select("*", { count: "exact", head: true })
    .in("subscription_status", ["expired", "cancelled", "canceled"])
    .gte("subscription_end", since)
    .is("deleted_at", null);
  return count ?? 0;
}

export async function getTrialConversionRate(days = 90): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db()
    .from("companies")
    .select("subscription_status")
    .gte("created_at", since)
    .is("deleted_at", null);

  const all = data ?? [];
  const started = all.length;
  const converted = all.filter((c) =>
    ["active", "grace"].includes(c.subscription_status ?? "")
  ).length;
  return started > 0 ? Math.round((converted / started) * 100) : 0;
}

export async function getPlanDistribution(): Promise<PlanDistribution[]> {
  const { data } = await db()
    .from("companies")
    .select("id, subscription_plan, subscription_status, seated_employee_ids")
    .in("subscription_status", ["active", "grace", "trial"])
    .is("deleted_at", null);

  const plans: Record<string, { ids: string[]; seats: number[] }> = {};
  for (const c of data ?? []) {
    const plan = c.subscription_plan ?? "trial";
    if (!plans[plan]) plans[plan] = { ids: [], seats: [] };
    plans[plan].ids.push(c.id);
    plans[plan].seats.push(c.seated_employee_ids?.length ?? 0);
  }

  // Get project counts per company in batch
  const allIds = (data ?? []).map((c) => c.id);
  const { data: projectRows } = await db()
    .from("projects").select("company_id")
    .in("company_id", allIds)
    .is("deleted_at", null);

  const projectsByCompany: Record<string, number> = {};
  for (const p of projectRows ?? []) {
    projectsByCompany[p.company_id] = (projectsByCompany[p.company_id] ?? 0) + 1;
  }

  const PLAN_COLORS: Record<string, string> = {
    trial: "#A0A0A0",
    starter: "#9DB582",
    team: "#8195B5",
    business: "#C4A868",
  };

  return Object.entries(plans).map(([plan, { ids, seats }]) => ({
    plan,
    count: ids.length,
    mrr: ids.length * (PLAN_PRICES[plan] ?? 0),
    avgUsers: seats.length > 0 ? Math.round(seats.reduce((a, b) => a + b, 0) / seats.length * 10) / 10 : 0,
    avgProjects: ids.length > 0
      ? Math.round(ids.reduce((sum, id) => sum + (projectsByCompany[id] ?? 0), 0) / ids.length * 10) / 10
      : 0,
    color: PLAN_COLORS[plan] ?? "#6B6B6B",
  }));
}

export async function getMRRGrowth(months = 12): Promise<ChartDataPoint[]> {
  const { data } = await db()
    .from("companies")
    .select("subscription_plan, subscription_status, created_at")
    .is("deleted_at", null);

  const monthBuckets: Record<string, number> = {};
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    // Count MRR as of that month: companies created before month-end AND active
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const mrr = (data ?? [])
      .filter((c) => {
        const created = new Date(c.created_at);
        return created <= monthEnd && ["active", "grace"].includes(c.subscription_status ?? "");
      })
      .reduce((sum, c) => sum + (PLAN_PRICES[c.subscription_plan ?? ""] ?? 0), 0);
    monthBuckets[key] = mrr;
  }

  return Object.entries(monthBuckets).map(([label, value]) => ({
    label: label.slice(5),
    value,
  }));
}

export async function getNewVsChurned(months = 12): Promise<StackedBarDataPoint[]> {
  const { data } = await db()
    .from("companies")
    .select("subscription_status, subscription_end, created_at")
    .is("deleted_at", null);

  const now = new Date();
  const result: StackedBarDataPoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = d.toISOString().slice(0, 7);
    const monthStart = d;
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);

    const added = (data ?? []).filter((c) => {
      const created = new Date(c.created_at);
      return created >= monthStart && created <= monthEnd &&
        ["active", "grace"].includes(c.subscription_status ?? "");
    }).length;

    const churned = (data ?? []).filter((c) => {
      if (!c.subscription_end) return false;
      const ended = new Date(c.subscription_end);
      return ended >= monthStart && ended <= monthEnd &&
        ["expired", "cancelled", "canceled"].includes(c.subscription_status ?? "");
    }).length;

    result.push({ label: monthKey.slice(5), added, churned });
  }

  return result;
}

export async function getTrialExpirationTimeline(days = 30): Promise<ChartDataPoint[]> {
  const now = new Date();
  const cutoff = new Date(Date.now() + days * 86_400_000).toISOString();

  const { data } = await db()
    .from("companies")
    .select("trial_end_date")
    .eq("subscription_status", "trial")
    .gte("trial_end_date", now.toISOString())
    .lte("trial_end_date", cutoff)
    .is("deleted_at", null);

  const dayBuckets: Record<string, number> = {};
  for (const c of data ?? []) {
    if (!c.trial_end_date) continue;
    const day = c.trial_end_date.slice(0, 10);
    dayBuckets[day] = (dayBuckets[day] ?? 0) + 1;
  }

  return Object.entries(dayBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value }));
}

export async function getSeatUtilization(): Promise<SeatUtilization[]> {
  const { data } = await db()
    .from("companies")
    .select("id, name, subscription_plan, seated_employee_ids, max_seats")
    .in("subscription_status", ["active", "grace"])
    .is("deleted_at", null);

  return (data ?? [])
    .map((c) => {
      const seatsUsed = c.seated_employee_ids?.length ?? 0;
      const maxSeats = c.max_seats ?? 0;
      return {
        companyId: c.id,
        companyName: c.name,
        plan: c.subscription_plan ?? "—",
        seatsUsed,
        maxSeats,
        utilization: maxSeats > 0 ? Math.round((seatsUsed / maxSeats) * 100) : 0,
      };
    })
    .sort((a, b) => b.utilization - a.utilization);
}

// ─── Engagement Queries ───────────────────────────────────────────────────────

export async function getFeatureAdoption(): Promise<FeatureAdoption[]> {
  const totalCompanies = await getTotalCompanies();

  const features: { feature: string; table: string }[] = [
    { feature: "Projects", table: "projects" },
    { feature: "Tasks", table: "project_tasks" },
    { feature: "Clients", table: "clients" },
    { feature: "Sub-Clients", table: "sub_clients" },
    { feature: "Calendar Events", table: "calendar_events" },
    { feature: "Pipeline", table: "pipeline_references" },
    { feature: "Estimates", table: "estimates" },
    { feature: "Invoices", table: "invoices" },
    { feature: "Payments", table: "payments" },
    { feature: "Products", table: "products" },
    { feature: "Task Types", table: "task_types_v2" },
    { feature: "Site Visits", table: "site_visits" },
    { feature: "Photos", table: "photos" },
    { feature: "Notes", table: "notes" },
  ];

  const results = await Promise.all(
    features.map(async ({ feature, table }) => {
      try {
        const [{ count: totalCount }, { data: companyIds }] = await Promise.all([
          db().from(table).select("*", { count: "exact", head: true }).is("deleted_at", null),
          db().from(table).select("company_id").is("deleted_at", null),
        ]);

        const uniqueCompanies = new Set((companyIds ?? []).map((r) => r.company_id));
        const companiesUsing = uniqueCompanies.size;
        const adoptionRate = totalCompanies > 0
          ? Math.round((companiesUsing / totalCompanies) * 100)
          : 0;

        return { feature, table, totalCount: totalCount ?? 0, companiesUsing, adoptionRate };
      } catch {
        return { feature, table, totalCount: 0, companiesUsing: 0, adoptionRate: 0 };
      }
    })
  );

  return results.sort((a, b) => b.adoptionRate - a.adoptionRate);
}

export async function getEngagementDistribution(): Promise<ChartDataPoint[]> {
  const { data: companies } = await db()
    .from("companies").select("id")
    .is("deleted_at", null);

  if (!companies?.length) return [];

  const { data: projects } = await db()
    .from("projects").select("company_id")
    .is("deleted_at", null);

  const { data: tasks } = await db()
    .from("project_tasks").select("company_id")
    .is("deleted_at", null);

  const { data: clients } = await db()
    .from("clients").select("company_id")
    .is("deleted_at", null);

  const entityCounts: Record<string, number> = {};
  for (const c of companies) entityCounts[c.id] = 0;
  for (const p of projects ?? []) entityCounts[p.company_id] = (entityCounts[p.company_id] ?? 0) + 1;
  for (const t of tasks ?? []) entityCounts[t.company_id] = (entityCounts[t.company_id] ?? 0) + 1;
  for (const cl of clients ?? []) entityCounts[cl.company_id] = (entityCounts[cl.company_id] ?? 0) + 1;

  const buckets: Record<string, number> = {
    "0": 0, "1-5": 0, "6-20": 0, "21-50": 0, "51-100": 0, "100+": 0,
  };
  for (const count of Object.values(entityCounts)) {
    if (count === 0) buckets["0"]++;
    else if (count <= 5) buckets["1-5"]++;
    else if (count <= 20) buckets["6-20"]++;
    else if (count <= 50) buckets["21-50"]++;
    else if (count <= 100) buckets["51-100"]++;
    else buckets["100+"]++;
  }

  return Object.entries(buckets).map(([label, value]) => ({ label, value }));
}

export async function getCohortRetention(): Promise<{
  cohort: string; signups: number;
  month1: number; month2: number; month3: number; month6: number; month12: number;
}[]> {
  // This requires Firebase auth data — pass it in from the caller
  // Placeholder: return company signup cohorts with project activity as proxy
  const { data: companies } = await db()
    .from("companies")
    .select("id, created_at")
    .is("deleted_at", null)
    .order("created_at");

  const { data: projects } = await db()
    .from("projects")
    .select("company_id, created_at")
    .is("deleted_at", null);

  const projectsByCompany: Record<string, Date[]> = {};
  for (const p of projects ?? []) {
    if (!projectsByCompany[p.company_id]) projectsByCompany[p.company_id] = [];
    projectsByCompany[p.company_id].push(new Date(p.created_at));
  }

  // Group by signup month
  const cohorts: Record<string, { ids: string[]; signupDates: Date[] }> = {};
  for (const c of companies ?? []) {
    const month = c.created_at.slice(0, 7);
    if (!cohorts[month]) cohorts[month] = { ids: [], signupDates: [] };
    cohorts[month].ids.push(c.id);
    cohorts[month].signupDates.push(new Date(c.created_at));
  }

  // For each cohort, check % with activity at month 1, 2, 3, 6, 12
  return Object.entries(cohorts)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12) // last 12 months
    .map(([cohort, { ids }]) => {
      const signups = ids.length;
      const checkRetention = (months: number) => {
        if (signups === 0) return 0;
        const active = ids.filter((id) => {
          const dates = projectsByCompany[id] ?? [];
          const cohortDate = new Date(cohort + "-01");
          const checkStart = new Date(cohortDate);
          checkStart.setMonth(checkStart.getMonth() + months);
          return dates.some((d) => d >= checkStart);
        }).length;
        return Math.round((active / signups) * 100);
      };

      return {
        cohort,
        signups,
        month1: checkRetention(1),
        month2: checkRetention(2),
        month3: checkRetention(3),
        month6: checkRetention(6),
        month12: checkRetention(12),
      };
    });
}

// ─── Companies Queries ────────────────────────────────────────────────────────

export async function getCompanyList(): Promise<CompanyListItem[]> {
  const { data: companies } = await db()
    .from("companies")
    .select("id, name, subscription_plan, subscription_status, subscription_end, trial_start_date, trial_end_date, created_at, seated_employee_ids, max_seats, stripe_customer_id, has_priority_support, data_setup_completed, data_setup_purchased")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!companies?.length) return [];

  // Batch count queries
  const ids = companies.map((c) => c.id);

  const [
    { data: users },
    { data: projects },
    { data: pipeline },
  ] = await Promise.all([
    db().from("users").select("company_id").in("company_id", ids).is("deleted_at", null),
    db().from("projects").select("company_id").in("company_id", ids).is("deleted_at", null),
    db().from("pipeline_references").select("company_id").in("company_id", ids).is("deleted_at", null),
  ]);

  const count = (rows: { company_id: string }[] | null, id: string) =>
    (rows ?? []).filter((r) => r.company_id === id).length;

  return companies.map((c) => ({
    ...c,
    userCount: count(users, c.id),
    projectCount: count(projects, c.id),
    pipelineCount: count(pipeline, c.id),
    lastActive: null, // filled by Firebase auth data
  }));
}

export async function getCompanyDetail(id: string) {
  const [
    { data: company },
    { data: users },
    { data: projects },
    { count: taskCount },
    { count: clientCount },
    { count: pipelineCount },
    { count: estimateCount },
    { count: invoiceCount },
  ] = await Promise.all([
    db().from("companies").select("*").eq("id", id).is("deleted_at", null).single(),
    db().from("users").select("id, first_name, last_name, email, role, created_at")
      .eq("company_id", id).is("deleted_at", null).order("created_at"),
    db().from("projects").select("id, title, status, created_at")
      .eq("company_id", id).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(20),
    db().from("project_tasks").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
    db().from("clients").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
    db().from("pipeline_references").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
    db().from("estimates").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
    db().from("invoices").select("*", { count: "exact", head: true })
      .eq("company_id", id).is("deleted_at", null),
  ]);

  if (!company) return null;
  return {
    company,
    users: users ?? [],
    projects: projects ?? [],
    taskCount: taskCount ?? 0,
    clientCount: clientCount ?? 0,
    pipelineCount: pipelineCount ?? 0,
    estimateCount: estimateCount ?? 0,
    invoiceCount: invoiceCount ?? 0,
  };
}

export async function getCompanyUsageTimeline(companyId: string, weeks = 12): Promise<{
  projects: ChartDataPoint[];
  tasks: ChartDataPoint[];
  clients: ChartDataPoint[];
}> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();

  const [
    { data: projects },
    { data: tasks },
    { data: clients },
  ] = await Promise.all([
    db().from("projects").select("created_at").eq("company_id", companyId).gte("created_at", since).is("deleted_at", null),
    db().from("project_tasks").select("created_at").eq("company_id", companyId).gte("created_at", since).is("deleted_at", null),
    db().from("clients").select("created_at").eq("company_id", companyId).gte("created_at", since).is("deleted_at", null),
  ]);

  const bucketize = (rows: { created_at: string }[] | null): ChartDataPoint[] => {
    const buckets: Record<string, number> = {};
    for (const r of rows ?? []) {
      const d = new Date(r.created_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      buckets[key] = (buckets[key] ?? 0) + 1;
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label: label.slice(5), value }));
  };

  return {
    projects: bucketize(projects),
    tasks: bucketize(tasks),
    clients: bucketize(clients),
  };
}

// ─── Platform Health Queries ──────────────────────────────────────────────────

export async function getPipelineStats() {
  const { data: pipeline } = await db()
    .from("pipeline_references")
    .select("id, stage, value, created_at, updated_at")
    .is("deleted_at", null);

  const all = pipeline ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const stages: Record<string, { count: number; totalValue: number }> = {};
  for (const p of all) {
    const stage = p.stage ?? "Unknown";
    if (!stages[stage]) stages[stage] = { count: 0, totalValue: 0 };
    stages[stage].count++;
    stages[stage].totalValue += p.value ?? 0;
  }

  const stageDistribution: PipelineStage[] = Object.entries(stages).map(([stage, s]) => ({
    stage,
    count: s.count,
    totalValue: s.totalValue,
    avgDays: 0, // would need status change timestamps
  }));

  const activeDeals = all.filter((p) => !["won", "lost", "closed"].includes((p.stage ?? "").toLowerCase())).length;
  const pipelineValue = all
    .filter((p) => !["won", "lost", "closed"].includes((p.stage ?? "").toLowerCase()))
    .reduce((sum, p) => sum + (p.value ?? 0), 0);
  const wonThisMonth = all.filter((p) =>
    (p.stage ?? "").toLowerCase() === "won" && new Date(p.updated_at ?? p.created_at) >= monthStart
  ).length;
  const totalClosed = all.filter((p) => ["won", "lost"].includes((p.stage ?? "").toLowerCase())).length;
  const totalWon = all.filter((p) => (p.stage ?? "").toLowerCase() === "won").length;
  const winRate = totalClosed > 0 ? Math.round((totalWon / totalClosed) * 100) : 0;

  return { activeDeals, pipelineValue, wonThisMonth, winRate, stageDistribution };
}

export async function getFinancialStats() {
  const [
    { data: estimates },
    { data: invoices },
    { data: payments },
  ] = await Promise.all([
    db().from("estimates").select("id, status, total_amount, created_at").is("deleted_at", null),
    db().from("invoices").select("id, status, total_amount, due_date, created_at").is("deleted_at", null),
    db().from("payments").select("id, amount, created_at").is("deleted_at", null),
  ]);

  const allEstimates = estimates ?? [];
  const allInvoices = invoices ?? [];
  const allPayments = payments ?? [];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const estimateTotal = allEstimates.reduce((sum, e) => sum + (e.total_amount ?? 0), 0);
  const approvedEstimates = allEstimates.filter((e) => e.status === "approved").length;
  const estimateApprovalRate = allEstimates.length > 0
    ? Math.round((approvedEstimates / allEstimates.length) * 100) : 0;

  const outstandingInvoices = allInvoices
    .filter((i) => !["paid", "cancelled"].includes(i.status ?? ""))
    .reduce((sum, i) => sum + (i.total_amount ?? 0), 0);

  const paymentsThisMonth = allPayments
    .filter((p) => new Date(p.created_at) >= monthStart)
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);

  // Invoice aging
  const openInvoices = allInvoices.filter((i) => !["paid", "cancelled"].includes(i.status ?? ""));
  const aging: InvoiceAging[] = [
    { bucket: "Current", count: 0, totalAmount: 0 },
    { bucket: "1-30 days", count: 0, totalAmount: 0 },
    { bucket: "31-60 days", count: 0, totalAmount: 0 },
    { bucket: "61-90 days", count: 0, totalAmount: 0 },
    { bucket: "90+ days", count: 0, totalAmount: 0 },
  ];

  for (const inv of openInvoices) {
    const dueDate = inv.due_date ? new Date(inv.due_date) : new Date(inv.created_at);
    const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
    const amount = inv.total_amount ?? 0;
    if (daysOverdue <= 0) { aging[0].count++; aging[0].totalAmount += amount; }
    else if (daysOverdue <= 30) { aging[1].count++; aging[1].totalAmount += amount; }
    else if (daysOverdue <= 60) { aging[2].count++; aging[2].totalAmount += amount; }
    else if (daysOverdue <= 90) { aging[3].count++; aging[3].totalAmount += amount; }
    else { aging[4].count++; aging[4].totalAmount += amount; }
  }

  // Estimate status distribution
  const estimateStatuses: Record<string, number> = {};
  for (const e of allEstimates) {
    const status = e.status ?? "draft";
    estimateStatuses[status] = (estimateStatuses[status] ?? 0) + 1;
  }

  return {
    estimateTotal,
    estimateApprovalRate,
    outstandingInvoices,
    paymentsThisMonth,
    invoiceAging: aging,
    estimateStatuses,
    totalEstimates: allEstimates.length,
    totalInvoices: allInvoices.length,
  };
}

export async function getPortalStats() {
  // Portal stats from companies table flags
  const { data: companies } = await db()
    .from("companies")
    .select("id, portal_enabled, portal_branding_configured, gmail_connected, accounting_connected")
    .is("deleted_at", null);

  const all = companies ?? [];
  const portalEnabled = all.filter((c) => c.portal_enabled).length;
  const brandingConfigured = all.filter((c) => c.portal_branding_configured).length;
  const gmailConnected = all.filter((c) => c.gmail_connected).length;
  const accountingConnected = all.filter((c) => c.accounting_connected).length;

  return { portalEnabled, brandingConfigured, gmailConnected, accountingConnected, total: all.length };
}

// ─── Feedback Queries ─────────────────────────────────────────────────────────

export async function getFeatureRequests(): Promise<FeatureRequest[]> {
  const { data } = await db()
    .from("feature_requests")
    .select("id, type, title, description, platform, status, user_email, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as FeatureRequest[];
}

export async function updateFeatureRequestStatus(id: string, status: string) {
  await db().from("feature_requests").update({ status }).eq("id", id);
}

export async function getAppMessages(): Promise<AppMessage[]> {
  const { data } = await db()
    .from("app_messages")
    .select("id, title, body, active, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as AppMessage[];
}

export async function getPromoCodes(): Promise<PromoCode[]> {
  const { data } = await db()
    .from("promo_codes")
    .select("id, code, discount_percent, discount_amount, usage_count, max_uses, active, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as PromoCode[];
}

// ─── System Queries ───────────────────────────────────────────────────────────

export async function getAuditLog(limit = 50): Promise<AuditLogEntry[]> {
  const { data } = await db()
    .from("audit_log")
    .select("id, table_name, record_id, action, old_data, new_data, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditLogEntry[];
}

export async function getDataQualityChecks(): Promise<DataQualityIssue[]> {
  const issues: DataQualityIssue[] = [];

  // Orphaned users (no company)
  const { count: orphanedUsers } = await db()
    .from("users").select("*", { count: "exact", head: true })
    .is("company_id", null)
    .is("deleted_at", null);
  if ((orphanedUsers ?? 0) > 0) {
    issues.push({ check: "Orphaned users (no company)", severity: "warning", count: orphanedUsers ?? 0 });
  }

  // Companies with 0 users
  const { data: allCompanies } = await db()
    .from("companies").select("id").is("deleted_at", null);
  const { data: allUsers } = await db()
    .from("users").select("company_id").is("deleted_at", null);
  const companiesWithUsers = new Set((allUsers ?? []).map((u) => u.company_id));
  const companiesWithoutUsers = (allCompanies ?? []).filter((c) => !companiesWithUsers.has(c.id)).length;
  if (companiesWithoutUsers > 0) {
    issues.push({ check: "Companies with 0 users", severity: "warning", count: companiesWithoutUsers });
  }

  // Tasks without projects
  const { count: orphanedTasks } = await db()
    .from("project_tasks").select("*", { count: "exact", head: true })
    .is("project_id", null)
    .is("deleted_at", null);
  if ((orphanedTasks ?? 0) > 0) {
    issues.push({ check: "Tasks without projects", severity: "danger", count: orphanedTasks ?? 0 });
  }

  // Duplicate emails
  const { data: emailUsers } = await db()
    .from("users").select("email").is("deleted_at", null);
  const emailCounts: Record<string, number> = {};
  for (const u of emailUsers ?? []) {
    if (u.email) emailCounts[u.email] = (emailCounts[u.email] ?? 0) + 1;
  }
  const duplicates = Object.values(emailCounts).filter((c) => c > 1).length;
  if (duplicates > 0) {
    issues.push({ check: "Duplicate user emails", severity: "danger", count: duplicates });
  }

  if (issues.length === 0) {
    issues.push({ check: "All checks passed", severity: "info", count: 0 });
  }

  return issues;
}

export async function getTableStats(): Promise<TableStats[]> {
  const tables = [
    "companies", "users", "projects", "project_tasks", "calendar_events",
    "clients", "sub_clients", "task_types_v2", "pipeline_references",
    "estimates", "invoices", "payments", "products", "photos", "notes",
    "site_visits", "feature_requests", "app_messages", "promo_codes",
  ];

  const results = await Promise.all(
    tables.map(async (table) => {
      try {
        const { count } = await db().from(table).select("*", { count: "exact", head: true });
        return { table, rowCount: count ?? 0 };
      } catch {
        return { table, rowCount: -1 }; // table doesn't exist
      }
    })
  );

  return results.filter((r) => r.rowCount >= 0).sort((a, b) => b.rowCount - a.rowCount);
}

// ─── Alert Queries ────────────────────────────────────────────────────────────

export async function getAlerts() {
  const [
    trialsExpiring3d,
    { data: graceCompanies },
    { data: featureRequests },
    { data: emptyCompanies },
  ] = await Promise.all([
    getTrialsExpiringIn(3),
    db().from("companies").select("name")
      .eq("subscription_status", "grace").is("deleted_at", null),
    db().from("feature_requests").select("id")
      .eq("status", "new").limit(10),
    db().from("companies").select("id").is("deleted_at", null),
  ]);

  // Check for companies with 0 projects
  const emptyIds = (emptyCompanies ?? []).map((c) => c.id);
  const { data: projectCompanies } = await db()
    .from("projects").select("company_id")
    .in("company_id", emptyIds)
    .is("deleted_at", null);
  const withProjects = new Set((projectCompanies ?? []).map((p) => p.company_id));
  const zeroProjectCount = emptyIds.filter((id) => !withProjects.has(id)).length;

  const alerts: { severity: "info" | "warning" | "danger"; title: string; detail?: string }[] = [];

  if (trialsExpiring3d > 0) {
    alerts.push({ severity: "danger", title: `${trialsExpiring3d} trial(s) expiring within 3 days` });
  }
  if ((graceCompanies ?? []).length > 0) {
    alerts.push({
      severity: "warning",
      title: `${graceCompanies!.length} company(s) in grace period`,
      detail: graceCompanies!.map((c) => c.name).join(", "),
    });
  }
  if ((featureRequests ?? []).length > 0) {
    alerts.push({ severity: "info", title: `${featureRequests!.length} new feature request(s)` });
  }
  if (zeroProjectCount > 0) {
    alerts.push({ severity: "info", title: `${zeroProjectCount} company(s) with 0 projects` });
  }

  return alerts;
}
