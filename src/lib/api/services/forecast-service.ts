/**
 * OPS Web - Forecast Service
 *
 * Forward-looking financial projections for dashboard forecast widgets.
 * Combines pipeline opportunity data, invoice receivables, and expense
 * run rate to produce cash flow and revenue forecasts.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

// ── Types ─────────────────────────────────────────────────────────────

/** Weighted pipeline value grouped by stage */
export interface WeightedPipelineResult {
  /** Total weighted value: SUM(estimated_value × win_probability / 100) */
  totalWeighted: number;
  /** Number of open opportunities included */
  opportunityCount: number;
  /** Per-stage breakdown */
  byStage: {
    stage: string;
    count: number;
    rawValue: number;
    weightedValue: number;
    avgProbability: number;
  }[];
}

/** Single day in a cash flow forecast */
export interface CashFlowDay {
  date: string; // ISO date string (YYYY-MM-DD)
  expectedInflow: number;
  expectedOutflow: number;
  netCashFlow: number;
}

/** Revenue projection across 30/60/90 day windows */
export interface RevenueProjection {
  thirtyDay: {
    fromPipeline: number;
    fromInvoices: number;
    total: number;
  };
  sixtyDay: {
    fromPipeline: number;
    fromInvoices: number;
    total: number;
  };
  ninetyDay: {
    fromPipeline: number;
    fromInvoices: number;
    total: number;
  };
}

// ── Terminal stages — opportunities in these stages are excluded ──────

const TERMINAL_STAGES = ["won", "lost", "discarded"];

// ── Helpers ───────────────────────────────────────────────────────────

function rows<T>(result: { data: T[] | null }): T[] {
  return result.data ?? [];
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Service ───────────────────────────────────────────────────────────

export const ForecastService = {
  /**
   * Weighted pipeline value: SUM(estimated_value × win_probability / 100)
   * for all open (non-terminal) opportunities. Grouped by stage.
   */
  async fetchWeightedPipelineValue(
    companyId: string
  ): Promise<WeightedPipelineResult> {
    const supabase = requireSupabase();

    const opportunities = rows(
      await supabase
        .from("opportunities")
        .select("stage, estimated_value, win_probability")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .is("archived_at", null)
    );

    // Filter to open stages only
    const open = opportunities.filter(
      (o) => !TERMINAL_STAGES.includes(o.stage as string)
    );

    // Group by stage
    const stageMap = new Map<
      string,
      { count: number; rawValue: number; weightedValue: number; probSum: number }
    >();

    for (const o of open) {
      const stage = o.stage as string;
      const estimated = Number(o.estimated_value ?? 0);
      const probability = Number(o.win_probability ?? 0);
      const weighted = estimated * (probability / 100);

      const entry = stageMap.get(stage) ?? {
        count: 0,
        rawValue: 0,
        weightedValue: 0,
        probSum: 0,
      };
      entry.count += 1;
      entry.rawValue += estimated;
      entry.weightedValue += weighted;
      entry.probSum += probability;
      stageMap.set(stage, entry);
    }

    const byStage = Array.from(stageMap.entries()).map(([stage, entry]) => ({
      stage,
      count: entry.count,
      rawValue: entry.rawValue,
      weightedValue: entry.weightedValue,
      avgProbability: entry.count > 0 ? entry.probSum / entry.count : 0,
    }));

    const totalWeighted = byStage.reduce((sum, s) => sum + s.weightedValue, 0);

    return {
      totalWeighted,
      opportunityCount: open.length,
      byStage,
    };
  },

  /**
   * Cash flow forecast for the next N days.
   *
   * Inflow: unpaid invoices grouped by due_date (sum of balance_due per day).
   * Outflow: average daily expenses over the last 30 days, projected forward.
   */
  async fetchCashFlowForecast(
    companyId: string,
    days: number
  ): Promise<CashFlowDay[]> {
    const supabase = requireSupabase();
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + days);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch unpaid invoices with due dates in the forecast window
    const allInvoices = rows(
      await supabase
        .from("invoices")
        .select("balance_due, due_date, status")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .gte("due_date", now.toISOString())
        .lte("due_date", futureDate.toISOString())
    );

    const CLOSED_STATUSES = ["paid", "void", "written_off", "draft"];
    const invoices = allInvoices.filter(
      (inv) => !CLOSED_STATUSES.includes(inv.status as string)
    );

    // Build inflow map by day
    const inflowByDay = new Map<string, number>();
    for (const inv of invoices) {
      if (!inv.due_date) continue;
      const key = toDateKey(new Date(inv.due_date as string));
      inflowByDay.set(key, (inflowByDay.get(key) ?? 0) + Number(inv.balance_due ?? 0));
    }

    // Fetch recent expenses for run-rate calculation
    const expenses = rows(
      await supabase
        .from("expenses")
        .select("amount")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .gte("created_at", thirtyDaysAgo.toISOString())
    );

    const totalRecentExpenses = expenses.reduce(
      (sum, e) => sum + Number(e.amount ?? 0),
      0
    );
    const dailyExpenseRate = totalRecentExpenses / 30;

    // Build daily forecast
    const result: CashFlowDay[] = [];
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);

    for (let i = 0; i < days; i++) {
      const key = toDateKey(cursor);
      const expectedInflow = inflowByDay.get(key) ?? 0;
      const expectedOutflow = dailyExpenseRate;
      result.push({
        date: key,
        expectedInflow,
        expectedOutflow,
        netCashFlow: expectedInflow - expectedOutflow,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  },

  /**
   * Revenue projection for next 30/60/90 days.
   *
   * Pipeline contribution: weighted pipeline value (estimated_value × win_probability / 100)
   * for opportunities with expected_close_date within each window.
   *
   * Invoice contribution: balance_due on sent/awaiting invoices with due_date
   * within each window.
   */
  async fetchRevenueProjection(
    companyId: string
  ): Promise<RevenueProjection> {
    const supabase = requireSupabase();
    const now = new Date();
    const thirtyOut = new Date(now);
    thirtyOut.setDate(thirtyOut.getDate() + 30);
    const sixtyOut = new Date(now);
    sixtyOut.setDate(sixtyOut.getDate() + 60);
    const ninetyOut = new Date(now);
    ninetyOut.setDate(ninetyOut.getDate() + 90);

    // Pipeline: open opportunities with expected_close_date
    const allOpportunities = rows(
      await supabase
        .from("opportunities")
        .select("stage, estimated_value, win_probability, expected_close_date")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .not("expected_close_date", "is", null)
        .gte("expected_close_date", now.toISOString())
        .lte("expected_close_date", ninetyOut.toISOString())
    );

    const openOpps = allOpportunities.filter(
      (o) => !TERMINAL_STAGES.includes(o.stage as string)
    );

    // Invoices: unpaid with due_date in window
    const EXCLUDED_STATUSES = ["paid", "void", "written_off", "draft"];
    const allInvoices = rows(
      await supabase
        .from("invoices")
        .select("balance_due, due_date, status")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .gte("due_date", now.toISOString())
        .lte("due_date", ninetyOut.toISOString())
    );

    const invoices = allInvoices.filter(
      (inv) => !EXCLUDED_STATUSES.includes(inv.status as string)
    );

    // Bucket pipeline values into 30/60/90
    let pipeline30 = 0;
    let pipeline60 = 0;
    let pipeline90 = 0;

    for (const o of openOpps) {
      const closeDate = new Date(o.expected_close_date as string);
      const weighted =
        Number(o.estimated_value ?? 0) * (Number(o.win_probability ?? 0) / 100);

      // Cumulative: 30-day total is subset of 60-day, which is subset of 90-day
      if (closeDate <= thirtyOut) pipeline30 += weighted;
      if (closeDate <= sixtyOut) pipeline60 += weighted;
      if (closeDate <= ninetyOut) pipeline90 += weighted;
    }

    // Bucket invoice values into 30/60/90
    let invoices30 = 0;
    let invoices60 = 0;
    let invoices90 = 0;

    for (const inv of invoices) {
      const dueDate = new Date(inv.due_date as string);
      const balance = Number(inv.balance_due ?? 0);

      if (dueDate <= thirtyOut) invoices30 += balance;
      if (dueDate <= sixtyOut) invoices60 += balance;
      if (dueDate <= ninetyOut) invoices90 += balance;
    }

    return {
      thirtyDay: {
        fromPipeline: pipeline30,
        fromInvoices: invoices30,
        total: pipeline30 + invoices30,
      },
      sixtyDay: {
        fromPipeline: pipeline60,
        fromInvoices: invoices60,
        total: pipeline60 + invoices60,
      },
      ninetyDay: {
        fromPipeline: pipeline90,
        fromInvoices: invoices90,
        total: pipeline90 + invoices90,
      },
    };
  },
};
