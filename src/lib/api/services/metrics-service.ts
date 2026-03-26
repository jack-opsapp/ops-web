/**
 * OPS Web - Metrics Service
 *
 * Aggregated metric computations for tab-level MetricsHeader.
 * Each function returns pre-computed metrics for a specific tab.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type { MetricColumnConfig, InlineMetricConfig } from "@/components/metrics/types";
import { formatMetricCurrency } from "@/components/metrics/format";

// ── Helpers ────────────────────────────────────────────────────────────

function trend(current: number, previous: number): { direction: "up" | "down" | "flat"; value: string; sentiment: "positive" | "negative" | "neutral" } | undefined {
  if (previous === 0 && current === 0) return undefined;
  if (previous === 0) return { direction: "up", value: "new", sentiment: "positive" };
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (Math.abs(pct) < 1) return { direction: "flat", value: "flat", sentiment: "neutral" };
  return {
    direction: pct > 0 ? "up" : "down",
    value: `${Math.abs(pct)}%`,
    sentiment: pct > 0 ? "positive" : "negative",
  };
}

/** Invert sentiment — for metrics where "down" is good (e.g., past due, overdue) */
function trendInverted(current: number, previous: number) {
  const t = trend(current, previous);
  if (!t || t.sentiment === "neutral") return t;
  return { ...t, sentiment: (t.sentiment === "positive" ? "negative" : "positive") as "positive" | "negative" };
}

async function dailyTrend(
  table: string,
  dateColumn: string,
  sumColumn: string | null,
  companyId: string,
  days: number,
): Promise<number[]> {
  const supabase = requireSupabase();
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = supabase
    .from(table)
    .select(sumColumn ? `${dateColumn}, ${sumColumn}` : dateColumn)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .gte(dateColumn, since.toISOString())
    .order(dateColumn, { ascending: true });

  const { data: rows } = await query;
  if (!rows?.length) return [];

  // Group by day
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const date = new Date(row[dateColumn as keyof typeof row] as string);
    const key = date.toISOString().slice(0, 10);
    const val = sumColumn ? Number(row[sumColumn as keyof typeof row] ?? 0) : 1;
    buckets.set(key, (buckets.get(key) ?? 0) + val);
  }

  // Fill in missing days with 0
  const result: number[] = [];
  const cursor = new Date(since);
  for (let i = 0; i < days; i++) {
    const key = cursor.toISOString().slice(0, 10);
    result.push(buckets.get(key) ?? 0);
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

// ── Invoice Metrics (Full Tier) ────────────────────────────────────────

export async function fetchInvoiceMetrics(companyId: string): Promise<MetricColumnConfig[]> {
  const supabase = requireSupabase();
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: invoices = [] } = await supabase
    .from("invoices")
    .select("total, amount_paid, balance_due, status, issue_date, due_date, paid_at")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const revenue = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid ?? 0), 0);
  const pastDue = invoices
    .filter((inv) => inv.due_date && new Date(inv.due_date) < now && inv.status !== "paid" && inv.status !== "void")
    .reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);
  const receivables = invoices
    .filter((inv) => inv.status !== "paid" && inv.status !== "void")
    .reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);
  const totalBilled = invoices.filter((inv) => inv.status !== "void").reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
  const collectionRate = totalBilled > 0 ? (revenue / totalBilled) * 100 : 0;

  const paidInvoices = invoices.filter(
    (inv) => inv.paid_at && inv.issue_date && new Date(inv.paid_at) >= ninetyDaysAgo
  );
  const avgDaysToPay = paidInvoices.length > 0
    ? paidInvoices.reduce((sum, inv) => {
        const days = (new Date(inv.paid_at!).getTime() - new Date(inv.issue_date!).getTime()) / 86400000;
        return sum + Math.max(0, days);
      }, 0) / paidInvoices.length
    : 0;

  const prevRevenue = invoices
    .filter((inv) => inv.paid_at && new Date(inv.paid_at) >= sixtyDaysAgo && new Date(inv.paid_at) < thirtyDaysAgo)
    .reduce((sum, inv) => sum + Number(inv.amount_paid ?? 0), 0);
  const currRevenue = invoices
    .filter((inv) => inv.paid_at && new Date(inv.paid_at) >= thirtyDaysAgo)
    .reduce((sum, inv) => sum + Number(inv.amount_paid ?? 0), 0);

  const revenueTrend = await dailyTrend("invoices", "paid_at", "amount_paid", companyId, 30);
  const pastDueTrend = await dailyTrend("invoices", "due_date", "balance_due", companyId, 30);
  const receivablesTrend = await dailyTrend("invoices", "issue_date", "balance_due", companyId, 30);

  const last7Paid = paidInvoices
    .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())
    .slice(0, 7)
    .reverse()
    .map((inv) => Math.max(0, (new Date(inv.paid_at!).getTime() - new Date(inv.issue_date!).getTime()) / 86400000));

  return [
    {
      label: "Revenue",
      value: revenue,
      formatType: "currency",
      trend: trend(currRevenue, prevRevenue),
      viz: { type: "sparkline", data: revenueTrend, color: "#597794" },
    },
    {
      label: "Past Due",
      value: pastDue,
      formatType: "currency",
      trend: pastDue > 0 ? trendInverted(pastDue, 0) : undefined,
      viz: pastDue > 0 ? { type: "sparkline", data: pastDueTrend, color: "#93321A" } : undefined,
      color: pastDue > 0 ? "#93321A" : undefined,
    },
    {
      label: "Receivables",
      value: receivables,
      formatType: "currency",
      viz: { type: "sparkline", data: receivablesTrend, color: "#C4A868" },
      color: "#C4A868",
    },
    {
      label: "Collection",
      value: collectionRate,
      formatType: "percentage",
      viz: { type: "progress", data: [collectionRate], color: "#A5B368" },
    },
    {
      label: "Avg Days to Pay",
      value: avgDaysToPay,
      formatType: "days",
      viz: last7Paid.length > 0 ? { type: "bars", data: last7Paid, color: "#597794" } : undefined,
    },
  ];
}

// ── Project Metrics (Full Tier) ────────────────────────────────────────

export async function fetchProjectMetrics(companyId: string): Promise<MetricColumnConfig[]> {
  const supabase = requireSupabase();
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: projects = [] } = await supabase
    .from("projects")
    .select("id, status, start_date, end_date, created_at")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const activeStatuses = ["rfq", "estimated", "accepted", "in_progress"];
  const active = projects.filter((p) => activeStatuses.includes(p.status));
  const completed = projects.filter((p) => p.status === "completed" || p.status === "closed");
  const completionDenominator = projects.filter((p) => ["completed", "in_progress", "accepted"].includes(p.status));
  const completionRate = completionDenominator.length > 0
    ? (completed.length / completionDenominator.length) * 100
    : 0;

  const { data: tasks = [] } = await supabase
    .from("scheduled_tasks")
    .select("id, end_date, status")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .lt("end_date", now.toISOString())
    .neq("status", "completed");

  const overdueTasks = tasks.length;

  const recentCompleted = completed.filter(
    (p) => p.start_date && p.end_date && new Date(p.end_date) >= ninetyDaysAgo
  );
  const avgDuration = recentCompleted.length > 0
    ? recentCompleted.reduce((sum, p) => {
        return sum + (new Date(p.end_date!).getTime() - new Date(p.start_date!).getTime()) / 86400000;
      }, 0) / recentCompleted.length
    : 0;

  const { data: invoices = [] } = await supabase
    .from("invoices")
    .select("total, project_id")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .not("project_id", "is", null);

  const totalValue = invoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);

  const activeTrend = await dailyTrend("projects", "created_at", null, companyId, 30);
  const valueTrend = await dailyTrend("invoices", "issue_date", "total", companyId, 30);

  const last7Durations = recentCompleted
    .sort((a, b) => new Date(b.end_date!).getTime() - new Date(a.end_date!).getTime())
    .slice(0, 7)
    .reverse()
    .map((p) => Math.max(1, (new Date(p.end_date!).getTime() - new Date(p.start_date!).getTime()) / 86400000));

  return [
    {
      label: "Active",
      value: active.length,
      formatType: "count",
      viz: { type: "sparkline", data: activeTrend, color: "#597794" },
    },
    {
      label: "Total Value",
      value: totalValue,
      formatType: "currency",
      viz: { type: "sparkline", data: valueTrend, color: "#C4A868" },
      color: "#C4A868",
    },
    {
      label: "Completion",
      value: completionRate,
      formatType: "percentage",
      viz: { type: "progress", data: [completionRate], color: "#A5B368" },
    },
    {
      label: "Overdue Tasks",
      value: overdueTasks,
      formatType: "count",
      viz: overdueTasks > 0 ? { type: "dots", data: Array(Math.min(overdueTasks, 8)).fill(1), color: "#93321A" } : undefined,
      color: overdueTasks > 0 ? "#93321A" : "#6B6B6B",
    },
    {
      label: "Avg Duration",
      value: avgDuration,
      formatType: "days",
      viz: last7Durations.length > 0 ? { type: "bars", data: last7Durations, color: "#597794" } : undefined,
    },
  ];
}

// ── Pipeline Metrics (Full Tier) ───────────────────────────────────────

export async function fetchPipelineMetrics(companyId: string): Promise<MetricColumnConfig[]> {
  const supabase = requireSupabase();
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: opportunities = [] } = await supabase
    .from("opportunities")
    .select("id, stage, estimated_value, stage_entered_at, created_at")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const openStages = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const pipelineValue = openStages.reduce((sum, o) => sum + Number(o.estimated_value ?? 0), 0);
  const won = opportunities.filter((o) => o.stage === "won");
  const lost = opportunities.filter((o) => o.stage === "lost");
  const winRate = (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : 0;
  const avgDeal = openStages.length > 0
    ? openStages.reduce((sum, o) => sum + Number(o.estimated_value ?? 0), 0) / openStages.length
    : 0;

  const { data: transitions = [] } = await supabase
    .from("stage_transitions")
    .select("from_stage, to_stage, duration_in_stage")
    .eq("company_id", companyId);

  const avgVelocity = transitions.length > 0
    ? transitions.reduce((sum, t) => sum + Number(t.duration_in_stage ?? 0), 0) / transitions.length / 86400000
    : 0;

  const stageNames = ["prospect", "lead", "qualified", "proposal", "negotiating"];
  const stageDurations = stageNames.map((stage) => {
    const stageTransitions = transitions.filter((t) => t.from_stage === stage);
    if (stageTransitions.length === 0) return 0;
    return stageTransitions.reduce((sum, t) => sum + Number(t.duration_in_stage ?? 0), 0) / stageTransitions.length / 86400000;
  });

  const valueTrend = await dailyTrend("opportunities", "created_at", "estimated_value", companyId, 30);
  const countTrend = await dailyTrend("opportunities", "created_at", null, companyId, 30);

  const last7Deals = openStages
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 7)
    .reverse()
    .map((o) => Number(o.estimated_value ?? 0));

  return [
    {
      label: "Pipeline Value",
      value: pipelineValue,
      formatType: "currency",
      viz: { type: "sparkline", data: valueTrend, color: "#C4A868" },
      color: "#C4A868",
    },
    {
      label: "Win Rate",
      value: winRate,
      formatType: "percentage",
      viz: { type: "progress", data: [winRate], color: "#A5B368" },
    },
    {
      label: "Opportunities",
      value: openStages.length,
      formatType: "count",
      viz: { type: "sparkline", data: countTrend, color: "#597794" },
    },
    {
      label: "Avg Deal",
      value: avgDeal,
      formatType: "currency",
      viz: last7Deals.length > 0 ? { type: "bars", data: last7Deals, color: "#597794" } : undefined,
    },
    {
      label: "Velocity",
      value: avgVelocity,
      formatType: "days",
      trend: avgVelocity > 0 ? { direction: "down", value: `${Math.round(avgVelocity)}d`, sentiment: "positive" } : undefined,
      viz: stageDurations.some((d) => d > 0) ? { type: "bars", data: stageDurations, color: "#597794" } : undefined,
    },
  ];
}

// ── Estimate Metrics (Full Tier) ───────────────────────────────────────

export async function fetchEstimateMetrics(companyId: string): Promise<MetricColumnConfig[]> {
  const supabase = requireSupabase();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: estimates = [] } = await supabase
    .from("estimates")
    .select("id, total, status, sent_at, approved_at, estimate_id, created_at")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const pending = estimates.filter((e) => e.status === "sent");
  const pendingValue = pending.reduce((sum, e) => sum + Number(e.total ?? 0), 0);

  const reviewable = estimates.filter((e) => ["sent", "approved", "declined"].includes(e.status));
  const approved = estimates.filter((e) => e.status === "approved");
  const approvalRate = reviewable.length > 0 ? (approved.length / reviewable.length) * 100 : 0;

  const sentThisMonth = estimates.filter((e) => e.sent_at && new Date(e.sent_at) >= monthStart).length;

  const nonDraft = estimates.filter((e) => e.status !== "draft" && new Date(e.created_at) >= ninetyDaysAgo);
  const avgEstimate = nonDraft.length > 0
    ? nonDraft.reduce((sum, e) => sum + Number(e.total ?? 0), 0) / nonDraft.length
    : 0;

  const { data: invoicesWithEstimate = [] } = await supabase
    .from("invoices")
    .select("estimate_id")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .not("estimate_id", "is", null);

  const convertedIds = new Set(invoicesWithEstimate.map((i) => i.estimate_id));
  const convertedCount = approved.filter((e) => convertedIds.has(e.id)).length;
  const convertRate = approved.length > 0 ? (convertedCount / approved.length) * 100 : 0;

  const pendingTrend = await dailyTrend("estimates", "sent_at", "total", companyId, 30);
  const sentTrend = await dailyTrend("estimates", "sent_at", null, companyId, 30);

  const last7Sent = nonDraft
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 7)
    .reverse()
    .map((e) => Number(e.total ?? 0));

  return [
    {
      label: "Pending Value",
      value: pendingValue,
      formatType: "currency",
      viz: { type: "sparkline", data: pendingTrend, color: "#C4A868" },
      color: "#C4A868",
    },
    {
      label: "Approval Rate",
      value: approvalRate,
      formatType: "percentage",
      viz: { type: "progress", data: [approvalRate], color: "#A5B368" },
    },
    {
      label: "Sent This Month",
      value: sentThisMonth,
      formatType: "count",
      viz: { type: "sparkline", data: sentTrend, color: "#597794" },
    },
    {
      label: "Avg Estimate",
      value: avgEstimate,
      formatType: "currency",
      viz: last7Sent.length > 0 ? { type: "bars", data: last7Sent, color: "#597794" } : undefined,
    },
    {
      label: "Convert Rate",
      value: convertRate,
      formatType: "percentage",
      viz: { type: "progress", data: [convertRate], color: "#A5B368" },
    },
  ];
}

// ── Accounting Metrics (Full Tier) ─────────────────────────────────────

export async function fetchAccountingMetrics(companyId: string): Promise<MetricColumnConfig[]> {
  const supabase = requireSupabase();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: invoices = [] } = await supabase
    .from("invoices")
    .select("total, amount_paid, balance_due, status, due_date")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const { data: payments = [] } = await supabase
    .from("payments")
    .select("amount, payment_date")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .gte("payment_date", monthStart.toISOString());

  const outstanding = invoices
    .filter((inv) => inv.status !== "paid" && inv.status !== "void")
    .reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);

  const collectedMtd = payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  const overdue = invoices
    .filter((inv) => inv.due_date && new Date(inv.due_date) < now && inv.status !== "paid" && inv.status !== "void")
    .reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);

  const aging90 = invoices
    .filter((inv) => {
      if (!inv.due_date || inv.status === "paid" || inv.status === "void") return false;
      return new Date(inv.due_date) < ninetyDaysAgo;
    })
    .reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);

  const outstandingTrend = await dailyTrend("invoices", "issue_date", "balance_due", companyId, 30);
  const collectedTrend = await dailyTrend("payments", "payment_date", "amount", companyId, 30);

  return [
    {
      label: "Outstanding",
      value: outstanding,
      formatType: "currency",
      viz: { type: "sparkline", data: outstandingTrend, color: "#C4A868" },
      color: "#C4A868",
    },
    {
      label: "Collected MTD",
      value: collectedMtd,
      formatType: "currency",
      viz: { type: "sparkline", data: collectedTrend, color: "#A5B368" },
    },
    {
      label: "Overdue",
      value: overdue,
      formatType: "currency",
      color: overdue > 0 ? "#93321A" : undefined,
    },
    {
      label: "Aging 90+",
      value: aging90,
      formatType: "currency",
      color: aging90 > 0 ? "#93321A" : undefined,
    },
  ];
}

// ── Inventory Metrics (Full Tier) ──────────────────────────────────────

export async function fetchInventoryMetrics(companyId: string): Promise<MetricColumnConfig[]> {
  const supabase = requireSupabase();

  const { data: items = [] } = await supabase
    .from("inventory_items")
    .select("id, quantity, min_threshold, reorder_quantity")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const total = items.length;
  const lowStock = items.filter((item) => {
    const threshold = Number(item.min_threshold ?? 0);
    const qty = Number(item.quantity ?? 0);
    return threshold > 0 && qty <= threshold * 1.2 && qty > threshold;
  }).length;
  const critical = items.filter((item) => {
    const threshold = Number(item.min_threshold ?? 0);
    const qty = Number(item.quantity ?? 0);
    return threshold > 0 && qty <= threshold;
  }).length;
  const reorderNeeded = items.filter((item) => {
    const reorder = Number(item.reorder_quantity ?? 0);
    const qty = Number(item.quantity ?? 0);
    return reorder > 0 && qty <= reorder;
  }).length;

  return [
    { label: "Total Items", value: total, formatType: "count" },
    { label: "Low Stock", value: lowStock, formatType: "count", color: lowStock > 0 ? "#C4A868" : undefined },
    { label: "Critical", value: critical, formatType: "count", color: critical > 0 ? "#93321A" : undefined },
    { label: "Reorder Needed", value: reorderNeeded, formatType: "count", color: reorderNeeded > 0 ? "#C4A868" : undefined },
  ];
}

// ── Compact Tier Functions ─────────────────────────────────────────────

export async function fetchClientMetrics(companyId: string): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { count: total } = await supabase
    .from("clients").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).is("deleted_at", null);

  const { count: subContacts } = await supabase
    .from("sub_clients").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).is("deleted_at", null);

  const { count: newClients } = await supabase
    .from("clients").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).is("deleted_at", null)
    .gte("created_at", thirtyDaysAgo.toISOString());

  const { data: invoices = [] } = await supabase
    .from("invoices").select("amount_paid")
    .eq("company_id", companyId).is("deleted_at", null);

  const revenue = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid ?? 0), 0);

  return [
    { value: total ?? 0, label: "total" },
    { value: subContacts ?? 0, label: "sub" },
    { value: newClients ?? 0, label: "new", color: (newClients ?? 0) > 0 ? "#A5B368" : undefined },
    { value: formatMetricCurrency(revenue), label: "rev", color: "#C4A868" },
  ];
}

export async function fetchTeamMetrics(companyId: string, maxSeats: number): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();

  const { data: users = [] } = await supabase
    .from("users").select("id, is_active")
    .eq("company_id", companyId).is("deleted_at", null);

  const members = users.length;
  const active = users.filter((u) => u.is_active).length;

  return [
    { value: members, label: "members" },
    { value: `${active}/${maxSeats}`, label: "seats" },
    { value: active, label: "active" },
  ];
}

export async function fetchProductMetrics(companyId: string): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();

  const { data: products = [] } = await supabase
    .from("products").select("id, is_active, default_price, unit_cost")
    .eq("company_id", companyId).is("deleted_at", null);

  const total = products.length;
  const activeCount = products.filter((p) => p.is_active).length;
  const withMargin = products.filter((p) => Number(p.default_price) > 0 && Number(p.unit_cost) > 0);
  const avgMargin = withMargin.length > 0
    ? withMargin.reduce((sum, p) => {
        return sum + ((Number(p.default_price) - Number(p.unit_cost)) / Number(p.default_price)) * 100;
      }, 0) / withMargin.length
    : 0;

  return [
    { value: total, label: "total" },
    { value: activeCount, label: "active" },
    { value: `${Math.round(avgMargin)}%`, label: "avg margin", color: "#A5B368" },
  ];
}

export async function fetchJobBoardMetrics(companyId: string): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();

  const { data: projects = [] } = await supabase
    .from("projects").select("id, status, opportunity_id")
    .eq("company_id", companyId).is("deleted_at", null);

  const activeStatuses = ["rfq", "estimated", "accepted", "in_progress"];
  const active = projects.filter((p) => activeStatuses.includes(p.status));

  const oppIds = active.map((p) => p.opportunity_id).filter(Boolean);
  let totalValue = 0;
  if (oppIds.length > 0) {
    const { data: opps = [] } = await supabase
      .from("opportunities").select("estimated_value")
      .in("id", oppIds);
    totalValue = opps.reduce((sum, o) => sum + Number(o.estimated_value ?? 0), 0);
  }

  return [
    { value: active.length, label: "active" },
    { value: formatMetricCurrency(totalValue), label: "value", color: "#C4A868" },
  ];
}

export async function fetchCalendarMetrics(companyId: string): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const { data: tasks = [] } = await supabase
    .from("scheduled_tasks").select("id, team_member_ids, end_date, status")
    .eq("company_id", companyId).is("deleted_at", null)
    .gte("start_date", monday.toISOString())
    .lte("start_date", sunday.toISOString());

  const thisWeek = tasks.length;
  const unassigned = tasks.filter((t) => !t.team_member_ids || t.team_member_ids.length === 0).length;

  const { count: overdue } = await supabase
    .from("scheduled_tasks").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).is("deleted_at", null)
    .lt("end_date", now.toISOString()).neq("status", "completed");

  return [
    { value: thisWeek, label: "this week" },
    { value: unassigned, label: "unassigned", color: unassigned > 0 ? "#C4A868" : undefined },
    { value: overdue ?? 0, label: "overdue", color: (overdue ?? 0) > 0 ? "#93321A" : undefined },
  ];
}

export async function fetchMapMetrics(companyId: string): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();

  const { data: projects = [] } = await supabase
    .from("projects").select("id, latitude, status")
    .eq("company_id", companyId).is("deleted_at", null);

  const mapped = projects.filter((p) => p.latitude != null).length;
  const activeStatuses = ["accepted", "in_progress"];
  const missingAddress = projects.filter(
    (p) => p.latitude == null && !["closed", "archived"].includes(p.status)
  ).length;
  const activeSites = projects.filter(
    (p) => p.latitude != null && activeStatuses.includes(p.status)
  ).length;

  return [
    { value: mapped, label: "mapped" },
    { value: missingAddress, label: "missing", color: missingAddress > 0 ? "#C4A868" : undefined },
    { value: activeSites, label: "active sites", color: "#A5B368" },
  ];
}

export async function fetchInboxMetrics(companyId: string): Promise<InlineMetricConfig[]> {
  const supabase = requireSupabase();

  const { data: threads = [] } = await supabase
    .from("email_threads").select("id, unread_count, opportunity_id")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  const unread = threads.reduce((sum, t) => sum + Number(t.unread_count ?? 0), 0);
  const pipeline = threads.filter((t) => t.opportunity_id != null).length;

  return [
    { value: unread, label: "unread", color: unread > 0 ? "#C4A868" : undefined },
    { value: pipeline, label: "pipeline" },
  ];
}

export const MetricsService = {
  fetchInvoiceMetrics,
  fetchProjectMetrics,
  fetchPipelineMetrics,
  fetchEstimateMetrics,
  fetchAccountingMetrics,
  fetchInventoryMetrics,
  fetchClientMetrics,
  fetchTeamMetrics,
  fetchProductMetrics,
  fetchJobBoardMetrics,
  fetchCalendarMetrics,
  fetchMapMetrics,
  fetchInboxMetrics,
};
