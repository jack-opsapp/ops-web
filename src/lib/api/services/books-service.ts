/**
 * OPS Web - Books Service
 *
 * Period-scoped ledger aggregates for the /books instrument strip
 * (WEB OVERHAUL P3.1). Mirrors the iOS MoneyDashboard semantics:
 * - NET / CASH FLOW / JOBS respect the selected period
 * - A/R ignores the period (always all-open)
 * Sources: payments (in), expenses (out), invoices (A/R),
 * expense_project_allocations + payments (per-job profit).
 *
 * All math lives in the exported pure `computeLedger` so it is testable
 * without a Supabase client; `fetchLedger` only gathers rows.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

function rows<T>(result: { data: T[] | null }): T[] {
  return result.data ?? [];
}

const MS_PER_DAY = 86_400_000;

// ─── Periods ──────────────────────────────────────────────────────────────────

/** Mirrors the iOS PeriodPill options (BooksTabView §15). */
export type BooksPeriod =
  | "30d"
  | "90d"
  | "6m"
  | "1y"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "ytd";

export const BOOKS_PERIODS: BooksPeriod[] = [
  "30d",
  "90d",
  "6m",
  "1y",
  "this_month",
  "last_month",
  "this_quarter",
  "ytd",
];

export function periodRange(period: BooksPeriod, now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(now);
  switch (period) {
    case "30d":
      start.setDate(start.getDate() - 30);
      return { start, end };
    case "90d":
      start.setDate(start.getDate() - 90);
      return { start, end };
    case "6m":
      start.setMonth(start.getMonth() - 6);
      return { start, end };
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      return { start, end };
    case "this_month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
    case "last_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      };
    case "this_quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { start: new Date(now.getFullYear(), q * 3, 1), end };
    }
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end };
  }
}

/** Monday-start week bucket key (ISO date of that Monday), matching the iOS
 *  weekly-net computation (Postgres/Swift week starts Monday). */
export function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BooksLedger {
  net: number;
  paymentsIn: number;
  expensesOut: number;
  /** Net margin (net / paymentsIn), 0 when no payments. */
  marginPct: number;
  weeklyNets: Array<{ weekStart: string; net: number }>;
  avgPerWeek: number;
  lowWeek: { weekStart: string; net: number } | null;
  ar: {
    total: number;
    /** b0_30 includes not-yet-due balances (current), per the iOS ARCard ramp. */
    buckets: { b0_30: number; b31_60: number; b61_90: number; b90p: number };
    overdueTotal: number;
    overdueCount: number;
    topChase: { clientId: string; amount: number } | null;
  };
  jobs: {
    profitable: number;
    losers: number;
    avgMarginPct: number;
    /** Display slice: top earners by net plus the period's worst loser. */
    bars: Array<{ projectId: string; title: string; net: number }>;
  };
}

export interface PaymentRow {
  amount: number | null;
  payment_date: string | null;
  invoice_id: string | null;
}
export interface ExpenseRow {
  id: string;
  amount: number | null;
  expense_date: string | null;
}
export interface InvoiceArRow {
  id: string;
  client_id: string | null;
  project_id: string | null;
  status: string;
  due_date: string | null;
  balance_due: number | null;
}
export interface AllocationRow {
  expense_id: string;
  project_id: string;
  percentage: number | null;
  amount: number | null;
}
interface ProjectTitleRow {
  id: string;
  title: string | null;
}

// Expense statuses that count as money out (excludes drafts and rejected lines).
const EXPENSE_OUT_STATUSES = ["submitted", "approved", "reimbursed"];
// Invoice statuses that can never carry receivables.
const AR_EXCLUDED_STATUSES = ["paid", "void", "draft", "written_off"];

/** Display floor below which a small negative job is treated as noise
 *  (mirrors the iOS worstLossFloor). */
const WORST_LOSS_FLOOR = -500;

function toDateOnly(value: string | null): Date | null {
  if (!value) return null;
  // Postgres DATE columns arrive as "YYYY-MM-DD"; new Date(...) would parse
  // that as UTC midnight and shift a day in western timezones — parse local.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Pure computation ─────────────────────────────────────────────────────────

export interface LedgerInputs {
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  invoices: InvoiceArRow[];
  allocations: AllocationRow[];
  now?: Date;
}

export function computeLedger({
  payments,
  expenses,
  invoices,
  allocations,
  now = new Date(),
}: LedgerInputs): BooksLedger {
  // ── NET ──────────────────────────────────────────────────────────────
  const paymentsIn = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const expensesOut = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const net = paymentsIn - expensesOut;
  const marginPct = paymentsIn > 0 ? (net / paymentsIn) * 100 : 0;

  // ── CASH FLOW (weekly nets, Monday-start) ────────────────────────────
  const weekMap = new Map<string, number>();
  for (const p of payments) {
    const d = toDateOnly(p.payment_date);
    if (!d) continue;
    const wk = mondayOf(d);
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + Number(p.amount ?? 0));
  }
  for (const e of expenses) {
    const d = toDateOnly(e.expense_date);
    if (!d) continue;
    const wk = mondayOf(d);
    weekMap.set(wk, (weekMap.get(wk) ?? 0) - Number(e.amount ?? 0));
  }
  const weeklyNets = [...weekMap.entries()]
    .map(([weekStart, weekNet]) => ({ weekStart, net: weekNet }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const avgPerWeek =
    weeklyNets.length > 0 ? weeklyNets.reduce((s, w) => s + w.net, 0) / weeklyNets.length : 0;
  const lowWeek =
    weeklyNets.length > 0
      ? weeklyNets.reduce((min, w) => (w.net < min.net ? w : min), weeklyNets[0])
      : null;

  // ── A/R (all open, period-independent) ───────────────────────────────
  const buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
  let arTotal = 0;
  let overdueTotal = 0;
  let overdueCount = 0;
  const byClient = new Map<string, number>();

  for (const inv of invoices) {
    if (AR_EXCLUDED_STATUSES.includes(inv.status)) continue;
    const balance = Number(inv.balance_due ?? 0);
    if (balance <= 0) continue;

    arTotal += balance;
    if (inv.client_id) byClient.set(inv.client_id, (byClient.get(inv.client_id) ?? 0) + balance);

    const due = toDateOnly(inv.due_date);
    const overdueDays = due ? Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY) : 0;
    if (overdueDays > 0) {
      overdueTotal += balance;
      overdueCount += 1;
    }
    if (overdueDays <= 30) buckets.b0_30 += balance;
    else if (overdueDays <= 60) buckets.b31_60 += balance;
    else if (overdueDays <= 90) buckets.b61_90 += balance;
    else buckets.b90p += balance;
  }

  let topChase: BooksLedger["ar"]["topChase"] = null;
  for (const [clientId, amount] of byClient) {
    if (!topChase || amount > topChase.amount) topChase = { clientId, amount };
  }

  // ── JOBS (per-job profit, period-scoped) ─────────────────────────────
  const invoiceProject = new Map<string, string>();
  for (const inv of invoices) {
    if (inv.project_id) invoiceProject.set(inv.id, String(inv.project_id));
  }

  const jobNet = new Map<string, number>();
  const jobRevenue = new Map<string, number>();
  for (const p of payments) {
    const projectId = p.invoice_id ? invoiceProject.get(p.invoice_id) : undefined;
    if (!projectId) continue;
    const amount = Number(p.amount ?? 0);
    jobNet.set(projectId, (jobNet.get(projectId) ?? 0) + amount);
    jobRevenue.set(projectId, (jobRevenue.get(projectId) ?? 0) + amount);
  }

  const expenseAmount = new Map(expenses.map((e) => [e.id, Number(e.amount ?? 0)]));
  for (const a of allocations) {
    if (!expenseAmount.has(a.expense_id)) continue;
    const cost =
      a.amount != null
        ? Number(a.amount)
        : (expenseAmount.get(a.expense_id) ?? 0) * (Number(a.percentage ?? 0) / 100);
    jobNet.set(a.project_id, (jobNet.get(a.project_id) ?? 0) - cost);
  }

  const nets = [...jobNet.entries()].map(([projectId, jobNetAmount]) => ({
    projectId,
    net: jobNetAmount,
  }));
  const profitable = nets.filter((j) => j.net > 0).length;
  const losers = nets.filter((j) => j.net < 0).length;

  const margins = nets
    .filter((j) => (jobRevenue.get(j.projectId) ?? 0) > 0)
    .map((j) => (j.net / (jobRevenue.get(j.projectId) as number)) * 100);
  const avgMarginPct = margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : 0;

  // Display slice: top 4 by net, then ensure the worst loser below the
  // noise floor is shown (iOS worst-loser displacement rule).
  const sorted = [...nets].sort((a, b) => b.net - a.net);
  const slice = sorted.slice(0, 4);
  const worst = sorted[sorted.length - 1];
  if (worst && worst.net < WORST_LOSS_FLOOR && !slice.some((j) => j.projectId === worst.projectId)) {
    slice[slice.length - 1] = worst;
  }

  return {
    net,
    paymentsIn,
    expensesOut,
    marginPct,
    weeklyNets,
    avgPerWeek,
    lowWeek,
    ar: { total: arTotal, buckets, overdueTotal, overdueCount, topChase },
    jobs: {
      profitable,
      losers,
      avgMarginPct,
      bars: slice.map((j) => ({ projectId: j.projectId, title: "—", net: j.net })),
    },
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const BooksService = {
  async fetchLedger(companyId: string, period: BooksPeriod): Promise<BooksLedger> {
    const supabase = requireSupabase();
    const { start, end } = periodRange(period);
    const startIso = start.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);

    const [paymentsRes, expensesRes, invoicesRes] = await Promise.all([
      supabase
        .from("payments")
        .select("amount, payment_date, invoice_id")
        .eq("company_id", companyId)
        .is("voided_at", null)
        .gte("payment_date", startIso)
        .lte("payment_date", endIso),
      supabase
        .from("expenses")
        .select("id, amount, expense_date")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .in("status", EXPENSE_OUT_STATUSES)
        .gte("expense_date", startIso)
        .lte("expense_date", endIso),
      supabase
        .from("invoices")
        .select("id, client_id, project_id, status, due_date, balance_due")
        .eq("company_id", companyId)
        .is("deleted_at", null),
    ]);

    const payments = rows<PaymentRow>(paymentsRes);
    const expenses = rows<ExpenseRow>(expensesRes);
    const invoices = rows<InvoiceArRow>(invoicesRes);

    let allocations: AllocationRow[] = [];
    if (expenses.length > 0) {
      const allocRes = await supabase
        .from("expense_project_allocations")
        .select("expense_id, project_id, percentage, amount")
        .in("expense_id", expenses.map((e) => e.id));
      allocations = rows<AllocationRow>(allocRes);
    }

    const ledger = computeLedger({ payments, expenses, invoices, allocations });

    if (ledger.jobs.bars.length > 0) {
      const titleRes = await supabase
        .from("projects")
        .select("id, title")
        .in("id", ledger.jobs.bars.map((j) => j.projectId));
      const titles = new Map(
        rows<ProjectTitleRow>(titleRes).map((p) => [String(p.id), p.title ?? "—"]),
      );
      ledger.jobs.bars = ledger.jobs.bars.map((j) => ({
        ...j,
        title: titles.get(j.projectId) ?? "—",
      }));
    }

    return ledger;
  },
};
