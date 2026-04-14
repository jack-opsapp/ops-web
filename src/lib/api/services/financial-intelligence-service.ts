/**
 * OPS Web — Financial Intelligence Service
 *
 * Sprint I3: Core analytics engine providing revenue forecasting, seasonal
 * pattern detection, pricing optimization, and cash flow projections.
 * All methods return structured data for both UI rendering and AI draft
 * context injection.
 *
 * Read-only — never writes to invoices/estimates/payments tables.
 * Gated behind phase_c feature flag.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { ApprovalQueueService } from "./approval-queue-service";
import type {
  FinancialAlert,
  FinancialInsightActionData,
  FinancialIntelligenceSettings,
  AgentActionPriority,
} from "@/lib/types/approval-queue";

// ─── Return Types ─────────────────────────────────────────────────────────────

export interface MonthlyRevenue {
  month: string;
  amount: number;
}

export interface RevenueForecast {
  monthlyRevenue: MonthlyRevenue[];
  avgMonthly: number;
  pipelineValue: number;
  forecast: Array<{ month: string; projected: number }>;
  yoyChange: number | null;
}

export interface SeasonalPatterns {
  monthlyIndex: Array<{ month: string; index: number }>;
  peakMonths: string[];
  slowMonths: string[];
  servicePatterns: Array<{
    service: string;
    peakMonths: string[];
  }>;
}

export interface ServicePricingAnalysis {
  service: string;
  winRate: number;
  avgWinPrice: number;
  avgLossPrice: number;
  estimateCount: number;
  suggestion: {
    type: "increase" | "decrease" | "neutral";
    params: Record<string, number>;
  };
}

export interface PricingOptimization {
  serviceAnalysis: ServicePricingAnalysis[];
}

export interface CashFlowProjection {
  outstanding: number;
  overdue: number;
  receivedThisMonth: number;
  projection: Array<{
    period: string;
    expected: number;
    pipeline: number;
  }>;
  alerts: FinancialAlert[];
}

// ─── Settings Helpers ─────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: FinancialIntelligenceSettings = {
  enabled: true,
  overdue_pct_threshold: 30,
  concentration_pct_threshold: 40,
  aging_days_threshold: 60,
  aging_min_count: 3,
  win_rate_increase_threshold: 80,
  win_rate_decrease_threshold: 40,
  min_estimates_for_analysis: 5,
};

async function getFinancialSettings(
  companyId: string
): Promise<FinancialIntelligenceSettings> {
  const supabase = requireSupabase();

  const { data } = await supabase
    .from("companies")
    .select("invoice_settings")
    .eq("id", companyId)
    .single();

  if (!data?.invoice_settings) return DEFAULT_SETTINGS;

  const settings = data.invoice_settings as Record<string, unknown>;
  const fin = settings.financial_intelligence as Record<string, unknown> | undefined;
  if (!fin) return DEFAULT_SETTINGS;

  return {
    enabled: (fin.enabled as boolean) ?? DEFAULT_SETTINGS.enabled,
    overdue_pct_threshold: clamp(Number(fin.overdue_pct_threshold) || DEFAULT_SETTINGS.overdue_pct_threshold, 1, 100),
    concentration_pct_threshold: clamp(Number(fin.concentration_pct_threshold) || DEFAULT_SETTINGS.concentration_pct_threshold, 1, 100),
    aging_days_threshold: clamp(Number(fin.aging_days_threshold) || DEFAULT_SETTINGS.aging_days_threshold, 1, 365),
    aging_min_count: clamp(Number(fin.aging_min_count) || DEFAULT_SETTINGS.aging_min_count, 1, 50),
    win_rate_increase_threshold: clamp(Number(fin.win_rate_increase_threshold) || DEFAULT_SETTINGS.win_rate_increase_threshold, 1, 100),
    win_rate_decrease_threshold: clamp(Number(fin.win_rate_decrease_threshold) || DEFAULT_SETTINGS.win_rate_decrease_threshold, 1, 100),
    min_estimates_for_analysis: clamp(Number(fin.min_estimates_for_analysis) || DEFAULT_SETTINGS.min_estimates_for_analysis, 1, 100),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${labels[parseInt(month, 10) - 1]} ${year}`;
}

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ─── Admin User Lookup ────────────────────────────────────────────────────────

async function getCompanyAdminUserId(companyId: string): Promise<string | null> {
  const supabase = requireSupabase();

  const { data: company } = await supabase
    .from("companies")
    .select("admin_ids")
    .eq("id", companyId)
    .single();

  if (!company?.admin_ids) return null;

  const adminIdsStr = company.admin_ids as string;
  const adminIds = adminIdsStr.split(",").map((s: string) => s.trim()).filter(Boolean);
  return adminIds[0] ?? null;
}

// ─── Phase C Gate ─────────────────────────────────────────────────────────────

async function requirePhaseC(companyId: string): Promise<boolean> {
  return AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c");
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const FinancialIntelligenceService = {
  /**
   * Revenue forecasting: last 12 months of actual + 3-month projection.
   * Combines historical invoice data with pipeline-weighted opportunities.
   */
  async getRevenueForecasting(
    companyId: string,
    months = 12
  ): Promise<RevenueForecast> {
    const enabled = await requirePhaseC(companyId);
    if (!enabled) return { monthlyRevenue: [], avgMonthly: 0, pipelineValue: 0, forecast: [], yoyChange: null };

    const supabase = requireSupabase();

    const cutoff = monthsAgo(months);

    // Fetch paid/partially_paid invoices for the last N months
    const { data: invoices } = await supabase
      .from("invoices")
      .select("total, paid_at, issue_date, status")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("status", ["paid", "partially_paid"])
      .gte("issue_date", cutoff.toISOString())
      .order("issue_date", { ascending: true });

    // Fetch pipeline opportunities (active stages)
    const { data: opportunities } = await supabase
      .from("opportunities")
      .select("estimated_value, win_probability, expected_close_date, stage")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("stage", ["quoting", "quoted", "follow_up", "negotiation"]);

    // Group invoices by month
    const monthlyMap = new Map<string, number>();
    for (const inv of invoices ?? []) {
      const issueDate = new Date(inv.issue_date as string);
      const key = getMonthKey(issueDate);
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + Number(inv.total ?? 0));
    }

    // Build ordered monthly revenue array
    const monthlyRevenue: MonthlyRevenue[] = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = getMonthKey(d);
      monthlyRevenue.push({
        month: getMonthLabel(key),
        amount: monthlyMap.get(key) ?? 0,
      });
    }

    // Average monthly revenue (exclude months with zero if < 3 months of data)
    const nonZeroMonths = monthlyRevenue.filter((m) => m.amount > 0);
    const avgMonthly =
      nonZeroMonths.length > 0
        ? nonZeroMonths.reduce((sum, m) => sum + m.amount, 0) / nonZeroMonths.length
        : 0;

    // Pipeline weighted value
    const pipelineValue = (opportunities ?? []).reduce((sum, opp) => {
      const value = Number(opp.estimated_value ?? 0);
      const prob = Number(opp.win_probability ?? 50) / 100;
      return sum + value * prob;
    }, 0);

    // 3-month forecast: weighted average of recent trend + pipeline
    const recentMonths = monthlyRevenue.slice(-3);
    const recentAvg =
      recentMonths.length > 0
        ? recentMonths.reduce((s, m) => s + m.amount, 0) / recentMonths.length
        : avgMonthly;

    // Pipeline contributions spread over expected close dates
    const pipelineByMonth = new Map<string, number>();
    for (const opp of opportunities ?? []) {
      if (opp.expected_close_date) {
        const closeDate = new Date(opp.expected_close_date as string);
        const key = getMonthKey(closeDate);
        const weightedValue = Number(opp.estimated_value ?? 0) * (Number(opp.win_probability ?? 50) / 100);
        pipelineByMonth.set(key, (pipelineByMonth.get(key) ?? 0) + weightedValue);
      }
    }

    const forecast: Array<{ month: string; projected: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = getMonthKey(d);
      const pipelineContribution = pipelineByMonth.get(key) ?? 0;
      // Blend: 70% trend-based, 30% pipeline-based (if pipeline exists for that month)
      const projected = pipelineContribution > 0
        ? recentAvg * 0.7 + pipelineContribution * 0.3
        : recentAvg;
      forecast.push({ month: getMonthLabel(key), projected: Math.round(projected) });
    }

    // Year-over-year comparison — compare same calendar months across years
    // Requires invoices older than the requested window for the prior-year comparison
    let yoyChange: number | null = null;
    {
      const priorYearCutoff = monthsAgo(months + 12);
      const { data: priorYearInvoices } = await supabase
        .from("invoices")
        .select("total, issue_date")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .in("status", ["paid", "partially_paid"])
        .gte("issue_date", priorYearCutoff.toISOString())
        .lt("issue_date", cutoff.toISOString());

      if (priorYearInvoices && priorYearInvoices.length > 0) {
        const priorTotal = priorYearInvoices.reduce(
          (sum, inv) => sum + Number(inv.total ?? 0), 0
        );
        const currentTotal = monthlyRevenue.reduce((sum, m) => sum + m.amount, 0);
        if (priorTotal > 0) {
          yoyChange = Math.round(((currentTotal - priorTotal) / priorTotal) * 100);
        }
      }
    }

    return { monthlyRevenue, avgMonthly: Math.round(avgMonthly), pipelineValue: Math.round(pipelineValue), forecast, yoyChange };
  },

  /**
   * Seasonal pattern analysis: identifies peak/slow months and service-specific patterns.
   */
  async getSeasonalPatterns(companyId: string): Promise<SeasonalPatterns> {
    const enabled = await requirePhaseC(companyId);
    if (!enabled) return { monthlyIndex: [], peakMonths: [], slowMonths: [], servicePatterns: [] };

    const supabase = requireSupabase();

    const cutoff = monthsAgo(24);

    // Fetch invoices with line items for service-level seasonality
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, total, issue_date")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("status", ["paid", "partially_paid", "sent", "awaiting_payment"])
      .gte("issue_date", cutoff.toISOString());

    if (!invoices || invoices.length === 0) {
      return {
        monthlyIndex: [],
        peakMonths: [],
        slowMonths: [],
        servicePatterns: [],
      };
    }

    // Group total revenue by calendar month (1-12)
    const monthTotals = new Map<number, number>();
    const monthCounts = new Map<number, number>();

    for (const inv of invoices) {
      const month = new Date(inv.issue_date as string).getMonth() + 1;
      monthTotals.set(month, (monthTotals.get(month) ?? 0) + Number(inv.total ?? 0));
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    }

    // Compute monthly indices (100 = average)
    const totalRevenue = Array.from(monthTotals.values()).reduce((s, v) => s + v, 0);
    const activeMonthCount = monthTotals.size;
    const avgMonthRevenue = activeMonthCount > 0 ? totalRevenue / activeMonthCount : 0;

    const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyIndex: Array<{ month: string; index: number }> = [];
    const peakMonths: string[] = [];
    const slowMonths: string[] = [];

    for (let m = 1; m <= 12; m++) {
      const revenue = monthTotals.get(m) ?? 0;
      const index = avgMonthRevenue > 0 ? Math.round((revenue / avgMonthRevenue) * 100) : 0;
      const label = monthLabels[m - 1];
      monthlyIndex.push({ month: label, index });

      if (index > 120) peakMonths.push(label);
      else if (index < 80 && index > 0) slowMonths.push(label);
    }

    // Service-specific seasonality via line items
    const invoiceIds = invoices.map((i) => i.id as string);
    const lineItemChunkSize = 80;
    const allLineItems: Array<Record<string, unknown>> = [];

    for (let i = 0; i < invoiceIds.length; i += lineItemChunkSize) {
      const chunk = invoiceIds.slice(i, i + lineItemChunkSize);
      const { data: items } = await supabase
        .from("line_items")
        .select("invoice_id, task_type_id, name, line_total")
        .in("invoice_id", chunk);
      if (items) allLineItems.push(...items);
    }

    // Map invoice_id → issue month
    const invoiceMonthMap = new Map<string, number>();
    for (const inv of invoices) {
      invoiceMonthMap.set(inv.id as string, new Date(inv.issue_date as string).getMonth() + 1);
    }

    // Fetch task type names for labeling
    const taskTypeIds = [...new Set(allLineItems.map((li) => li.task_type_id as string).filter(Boolean))];
    const taskTypeNames = new Map<string, string>();

    if (taskTypeIds.length > 0) {
      for (let i = 0; i < taskTypeIds.length; i += lineItemChunkSize) {
        const chunk = taskTypeIds.slice(i, i + lineItemChunkSize);
        const { data: types } = await supabase
          .from("task_types_v2")
          .select("id, display")
          .in("id", chunk);
        if (types) {
          for (const t of types) {
            taskTypeNames.set(t.id as string, t.display as string);
          }
        }
      }
    }

    // Group line item totals by service + month
    const serviceMonthRevenue = new Map<string, Map<number, number>>();

    for (const li of allLineItems) {
      const invoiceId = li.invoice_id as string;
      const month = invoiceMonthMap.get(invoiceId);
      if (!month) continue;

      const taskTypeId = li.task_type_id as string;
      const serviceName = taskTypeId
        ? (taskTypeNames.get(taskTypeId) ?? (li.name as string) ?? "Unknown")
        : ((li.name as string) ?? "Unknown");

      if (!serviceMonthRevenue.has(serviceName)) {
        serviceMonthRevenue.set(serviceName, new Map());
      }
      const monthMap = serviceMonthRevenue.get(serviceName)!;
      monthMap.set(month, (monthMap.get(month) ?? 0) + Number(li.line_total ?? 0));
    }

    // Identify peak months per service
    const servicePatterns: Array<{ service: string; peakMonths: string[] }> = [];

    for (const [service, monthMap] of serviceMonthRevenue) {
      const values = Array.from(monthMap.values());
      if (values.length < 3) continue; // Need enough data points

      const serviceAvg = values.reduce((s, v) => s + v, 0) / values.length;
      const peaks: string[] = [];

      for (const [m, revenue] of monthMap) {
        if (revenue > serviceAvg * 1.2) {
          peaks.push(monthLabels[m - 1]);
        }
      }

      if (peaks.length > 0) {
        servicePatterns.push({ service, peakMonths: peaks });
      }
    }

    return { monthlyIndex, peakMonths, slowMonths, servicePatterns };
  },

  /**
   * Pricing optimization: win/loss rates by service type from estimate outcomes.
   */
  async getPricingOptimization(companyId: string): Promise<PricingOptimization> {
    const enabled = await requirePhaseC(companyId);
    if (!enabled) return { serviceAnalysis: [] };

    const supabase = requireSupabase();
    const settings = await getFinancialSettings(companyId);

    // Fetch estimates with terminal statuses (approved, declined, expired)
    const { data: estimates } = await supabase
      .from("estimates")
      .select("id, total, status")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("status", ["approved", "converted", "declined", "expired"]);

    if (!estimates || estimates.length === 0) {
      return { serviceAnalysis: [] };
    }

    // Fetch line items for these estimates to group by service type
    const estimateIds = estimates.map((e) => e.id as string);
    const allLineItems: Array<Record<string, unknown>> = [];
    const chunkSize = 80;

    for (let i = 0; i < estimateIds.length; i += chunkSize) {
      const chunk = estimateIds.slice(i, i + chunkSize);
      const { data: items } = await supabase
        .from("line_items")
        .select("estimate_id, task_type_id, name")
        .in("estimate_id", chunk);
      if (items) allLineItems.push(...items);
    }

    // Map estimate_id → primary service type (most common task_type or first line item name)
    const estimateServiceMap = new Map<string, string>();
    const estimateServiceGroups = new Map<string, Array<Record<string, unknown>>>();

    for (const li of allLineItems) {
      const estimateId = li.estimate_id as string;
      if (!estimateServiceGroups.has(estimateId)) {
        estimateServiceGroups.set(estimateId, []);
      }
      estimateServiceGroups.get(estimateId)!.push(li);
    }

    // Resolve task type names
    const taskTypeIds = [...new Set(allLineItems.map((li) => li.task_type_id as string).filter(Boolean))];
    const taskTypeNames = new Map<string, string>();

    if (taskTypeIds.length > 0) {
      for (let i = 0; i < taskTypeIds.length; i += chunkSize) {
        const chunk = taskTypeIds.slice(i, i + chunkSize);
        const { data: types } = await supabase
          .from("task_types_v2")
          .select("id, display")
          .in("id", chunk);
        if (types) {
          for (const t of types) {
            taskTypeNames.set(t.id as string, t.display as string);
          }
        }
      }
    }

    // Determine primary service for each estimate
    for (const [estimateId, items] of estimateServiceGroups) {
      // Use the most common task_type_id in the estimate's line items
      const typeCounts = new Map<string, number>();
      for (const li of items) {
        const taskTypeId = li.task_type_id as string;
        if (taskTypeId) {
          typeCounts.set(taskTypeId, (typeCounts.get(taskTypeId) ?? 0) + 1);
        }
      }

      if (typeCounts.size > 0) {
        const topTypeId = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        estimateServiceMap.set(estimateId, taskTypeNames.get(topTypeId) ?? "Unknown");
      } else if (items.length > 0) {
        estimateServiceMap.set(estimateId, (items[0].name as string) ?? "General");
      }
    }

    // Group estimates by service type and compute win/loss rates
    const serviceGroups = new Map<string, {
      won: Array<{ total: number }>;
      lost: Array<{ total: number }>;
    }>();

    for (const est of estimates) {
      const service = estimateServiceMap.get(est.id as string) ?? "General";
      if (!serviceGroups.has(service)) {
        serviceGroups.set(service, { won: [], lost: [] });
      }

      const group = serviceGroups.get(service)!;
      const total = Number(est.total ?? 0);
      const status = est.status as string;

      if (status === "approved" || status === "converted") {
        group.won.push({ total });
      } else {
        group.lost.push({ total });
      }
    }

    // Build analysis per service
    const serviceAnalysis: ServicePricingAnalysis[] = [];

    for (const [service, { won, lost }] of serviceGroups) {
      const totalEstimates = won.length + lost.length;
      if (totalEstimates < settings.min_estimates_for_analysis) continue;

      const winRate = Math.round((won.length / totalEstimates) * 100);
      const avgWinPrice = won.length > 0
        ? Math.round(won.reduce((s, e) => s + e.total, 0) / won.length)
        : 0;
      const avgLossPrice = lost.length > 0
        ? Math.round(lost.reduce((s, e) => s + e.total, 0) / lost.length)
        : 0;

      let suggestion: ServicePricingAnalysis["suggestion"];
      if (winRate > settings.win_rate_increase_threshold) {
        suggestion = { type: "increase", params: { winRate, threshold: settings.win_rate_increase_threshold } };
      } else if (winRate < settings.win_rate_decrease_threshold) {
        suggestion = { type: "decrease", params: { winRate, threshold: settings.win_rate_decrease_threshold } };
      } else {
        suggestion = { type: "neutral", params: { winRate } };
      }

      serviceAnalysis.push({
        service,
        winRate,
        avgWinPrice,
        avgLossPrice,
        estimateCount: totalEstimates,
        suggestion,
      });
    }

    // Sort by estimate count descending (most data = most reliable)
    serviceAnalysis.sort((a, b) => b.estimateCount - a.estimateCount);

    return { serviceAnalysis };
  },

  /**
   * Cash flow projection: current state + 30/60/90-day forecast.
   * Weights expected inflows by each client's historical on-time rate.
   */
  /**
   * Cash flow projection: current outstanding/overdue + 30/60/90-day forecast.
   * Projection periods are cumulative — the 60-day period includes all invoices
   * due within 60 days from today, not just those between day 30 and day 60.
   */
  async getCashFlowProjection(
    companyId: string,
    days = 90
  ): Promise<CashFlowProjection> {
    const enabled = await requirePhaseC(companyId);
    if (!enabled) return { outstanding: 0, overdue: 0, receivedThisMonth: 0, projection: [], alerts: [] };

    const supabase = requireSupabase();
    const settings = await getFinancialSettings(companyId);
    const today = new Date();

    // Current state: outstanding invoices
    const { data: outstandingInvoices } = await supabase
      .from("invoices")
      .select("id, client_id, balance_due, due_date, status, total")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("status", ["sent", "awaiting_payment", "partially_paid", "past_due"])
      .gt("balance_due", 0);

    const outstanding = (outstandingInvoices ?? []).reduce(
      (sum, inv) => sum + Number(inv.balance_due ?? 0), 0
    );

    const overdue = (outstandingInvoices ?? []).reduce((sum, inv) => {
      const dueDate = new Date(inv.due_date as string);
      return dueDate < today ? sum + Number(inv.balance_due ?? 0) : sum;
    }, 0);

    // Cash received this month
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const { data: payments } = await supabase
      .from("payments")
      .select("amount")
      .eq("company_id", companyId)
      .is("voided_at", null)
      .gte("payment_date", monthStart.toISOString());

    const receivedThisMonth = (payments ?? []).reduce(
      (sum, p) => sum + Number(p.amount ?? 0), 0
    );

    // Build client payment history map for weighting
    const clientIds = [...new Set((outstandingInvoices ?? []).map((inv) => inv.client_id as string).filter(Boolean))];
    const clientOnTimeRates = new Map<string, number>();

    if (clientIds.length > 0) {
      // Batch fetch historical paid invoices per client
      const chunkSize = 80;
      for (let i = 0; i < clientIds.length; i += chunkSize) {
        const chunk = clientIds.slice(i, i + chunkSize);
        const { data: paidInvoices } = await supabase
          .from("invoices")
          .select("client_id, due_date, paid_at")
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .in("status", ["paid"])
          .in("client_id", chunk);

        // Compute on-time rate per client
        const clientCounts = new Map<string, { onTime: number; total: number }>();
        for (const inv of paidInvoices ?? []) {
          const clientId = inv.client_id as string;
          if (!clientCounts.has(clientId)) {
            clientCounts.set(clientId, { onTime: 0, total: 0 });
          }
          const counts = clientCounts.get(clientId)!;
          counts.total++;

          const dueDate = new Date(inv.due_date as string);
          const paidAt = inv.paid_at ? new Date(inv.paid_at as string) : null;
          if (paidAt && paidAt <= dueDate) {
            counts.onTime++;
          }
        }

        for (const [clientId, counts] of clientCounts) {
          clientOnTimeRates.set(
            clientId,
            counts.total > 0 ? counts.onTime / counts.total : 0.5
          );
        }
      }
    }

    // Projection periods
    const periods = [
      { label: "30-day", daysOut: 30 },
      { label: "60-day", daysOut: 60 },
      { label: "90-day", daysOut: days >= 90 ? 90 : days },
    ];

    // Pipeline opportunities closing in each period
    const { data: pipelineOpps } = await supabase
      .from("opportunities")
      .select("estimated_value, win_probability, expected_close_date")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("stage", ["quoting", "quoted", "follow_up", "negotiation"]);

    const projection: CashFlowProjection["projection"] = [];

    for (const period of periods) {
      const periodEnd = new Date(today);
      periodEnd.setDate(periodEnd.getDate() + period.daysOut);

      // Expected inflow: invoices due in period, weighted by client on-time rate
      let expected = 0;
      for (const inv of outstandingInvoices ?? []) {
        const dueDate = new Date(inv.due_date as string);
        if (dueDate <= periodEnd) {
          const clientId = inv.client_id as string;
          const onTimeRate = clientOnTimeRates.get(clientId) ?? 0.5;
          expected += Number(inv.balance_due ?? 0) * onTimeRate;
        }
      }

      // Pipeline inflow: opportunities expected to close in period
      let pipeline = 0;
      for (const opp of pipelineOpps ?? []) {
        if (opp.expected_close_date) {
          const closeDate = new Date(opp.expected_close_date as string);
          if (closeDate <= periodEnd && closeDate >= today) {
            pipeline += Number(opp.estimated_value ?? 0) * (Number(opp.win_probability ?? 50) / 100);
          }
        }
      }

      projection.push({
        period: period.label,
        expected: Math.round(expected),
        pipeline: Math.round(pipeline),
      });
    }

    // Generate alerts
    const alerts: FinancialAlert[] = [];

    // Low cash alert: overdue > threshold% of outstanding
    if (outstanding > 0 && (overdue / outstanding) * 100 > settings.overdue_pct_threshold) {
      alerts.push({
        type: "low_cash",
        params: {
          outstanding: Math.round(outstanding),
          overdue: Math.round(overdue),
        },
      });
    }

    // Concentration risk: one client > threshold% of outstanding
    if (outstanding > 0) {
      const clientOutstanding = new Map<string, { amount: number; name: string }>();
      for (const inv of outstandingInvoices ?? []) {
        const clientId = inv.client_id as string;
        if (!clientOutstanding.has(clientId)) {
          clientOutstanding.set(clientId, { amount: 0, name: "" });
        }
        clientOutstanding.get(clientId)!.amount += Number(inv.balance_due ?? 0);
      }

      // Fetch client names for alerts
      const topClientIds = [...clientOutstanding.entries()]
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 5)
        .map(([id]) => id);

      if (topClientIds.length > 0) {
        const { data: clients } = await supabase
          .from("clients")
          .select("id, name")
          .eq("company_id", companyId)
          .in("id", topClientIds);

        for (const c of clients ?? []) {
          const entry = clientOutstanding.get(c.id as string);
          if (entry) entry.name = c.name as string;
        }
      }

      for (const [, { amount, name }] of clientOutstanding) {
        const pct = Math.round((amount / outstanding) * 100);
        if (pct > settings.concentration_pct_threshold) {
          alerts.push({
            type: "concentration_risk",
            params: {
              clientName: name || "Unknown",
              percentage: pct,
            },
          });
        }
      }
    }

    // Aging warning: N+ invoices > threshold days overdue
    const agingInvoices = (outstandingInvoices ?? []).filter((inv) => {
      const dueDate = new Date(inv.due_date as string);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysOverdue > settings.aging_days_threshold;
    });

    if (agingInvoices.length >= settings.aging_min_count) {
      const agingTotal = agingInvoices.reduce(
        (sum, inv) => sum + Number(inv.balance_due ?? 0), 0
      );
      alerts.push({
        type: "aging_warning",
        params: {
          count: agingInvoices.length,
          days: settings.aging_days_threshold,
          totalAmount: Math.round(agingTotal),
        },
      });
    }

    return {
      outstanding: Math.round(outstanding),
      overdue: Math.round(overdue),
      receivedThisMonth: Math.round(receivedThisMonth),
      projection,
      alerts,
    };
  },

  /**
   * Weekly financial digest: compiles all four analyses and proposes
   * via approval queue as 'financial_insight' action type.
   * Deduplicates by ISO week number.
   */
  async generateFinancialDigest(
    companyId: string,
    userId: string
  ): Promise<string | null> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return null;

    const settings = await getFinancialSettings(companyId);
    if (!settings.enabled) return null;

    // Run all four analyses in parallel
    const [revenue, cashflow, pricing, seasonal] = await Promise.all([
      this.getRevenueForecasting(companyId),
      this.getCashFlowProjection(companyId),
      this.getPricingOptimization(companyId),
      this.getSeasonalPatterns(companyId),
    ]);

    // Collect all alerts
    const allAlerts = [...cashflow.alerts];

    // Build action data
    const actionData: FinancialInsightActionData = {
      digest_type: "weekly_summary",
      revenue: {
        monthly_revenue: revenue.monthlyRevenue,
        avg_monthly: revenue.avgMonthly,
        pipeline_value: revenue.pipelineValue,
        forecast: revenue.forecast,
        yoy_change: revenue.yoyChange,
      },
      cashflow: {
        outstanding: cashflow.outstanding,
        overdue: cashflow.overdue,
        received_this_month: cashflow.receivedThisMonth,
        projection: cashflow.projection,
        alerts: cashflow.alerts,
      },
      pricing: {
        service_analysis: pricing.serviceAnalysis.map((s) => ({
          service: s.service,
          win_rate: s.winRate,
          avg_win_price: s.avgWinPrice,
          avg_loss_price: s.avgLossPrice,
          suggestion: s.suggestion,
        })),
      },
      seasonal: {
        monthly_index: seasonal.monthlyIndex,
        peak_months: seasonal.peakMonths,
        slow_months: seasonal.slowMonths,
        service_patterns: seasonal.servicePatterns.map((sp) => ({
          service: sp.service,
          peak_months: sp.peakMonths,
        })),
      },
      alerts: allAlerts,
      generated_at: new Date().toISOString(),
    };

    // Deduplicate by week number
    const now = new Date();
    const weekNumber = getISOWeekNumber(now);
    const sourceId = `financial:weekly:${now.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;

    const priority: AgentActionPriority = allAlerts.some((a) => a.type === "low_cash")
      ? "high"
      : "normal";

    const monthLabel = getMonthLabel(getMonthKey(now));
    const alertCount = allAlerts.length;
    const contextSummary = `Weekly financial digest — ${monthLabel}. Outstanding: $${cashflow.outstanding.toLocaleString()}, Pipeline: $${revenue.pipelineValue.toLocaleString()}${alertCount > 0 ? `, ${alertCount} alert${alertCount > 1 ? "s" : ""}` : ""}`;

    const actionId = await ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "financial_insight",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary,
      contextSource: "financial_analysis",
      sourceId,
      confidence: 1.0,
      priority,
    });

    // Store key insights as agent memories for AI draft context
    if (actionId) {
      await storeFinancialMemories(companyId, revenue, cashflow, pricing, seasonal);
    }

    return actionId;
  },
};

// ─── Memory Storage ───────────────────────────────────────────────────────────

async function storeFinancialMemories(
  companyId: string,
  revenue: RevenueForecast,
  cashflow: CashFlowProjection,
  pricing: PricingOptimization,
  seasonal: SeasonalPatterns
): Promise<void> {
  const supabase = requireSupabase();

  const memories: Array<{
    company_id: string;
    memory_type: string;
    category: string;
    content: string;
    confidence: number;
    source: string;
  }> = [];

  // Revenue trend memory
  if (revenue.yoyChange !== null) {
    const direction = revenue.yoyChange > 0 ? "up" : revenue.yoyChange < 0 ? "down" : "flat";
    memories.push({
      company_id: companyId,
      memory_type: "fact",
      category: "seasonal_pattern",
      content: `Revenue trending ${direction} ${Math.abs(revenue.yoyChange)}% year-over-year. Average monthly revenue: ${revenue.avgMonthly.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
      confidence: 1.0,
      source: "financial_analysis",
    });
  }

  // Pricing insights
  for (const service of pricing.serviceAnalysis.slice(0, 3)) {
    if (service.suggestion.type !== "neutral") {
      memories.push({
        company_id: companyId,
        memory_type: "fact",
        category: "pricing",
        content: `${service.service} estimates: ${service.winRate}% win rate. Average winning estimate: ${service.avgWinPrice.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}. ${service.suggestion.type === "increase" ? "Win rate suggests room for price increase." : "Low win rate suggests pricing review needed."}`,
        confidence: 1.0,
        source: "financial_analysis",
      });
    }
  }

  // Seasonal patterns memory
  if (seasonal.peakMonths.length > 0) {
    memories.push({
      company_id: companyId,
      memory_type: "fact",
      category: "seasonal_pattern",
      content: `Peak business months: ${seasonal.peakMonths.join(", ")}. Slow months: ${seasonal.slowMonths.length > 0 ? seasonal.slowMonths.join(", ") : "none identified"}.`,
      confidence: 1.0,
      source: "financial_analysis",
    });
  }

  // Insert memories (upsert pattern: delete old financial_analysis memories first)
  if (memories.length > 0) {
    try {
      // Remove stale financial analysis memories
      await supabase
        .from("agent_memories")
        .delete()
        .eq("company_id", companyId)
        .eq("source", "financial_analysis");

      // Insert fresh ones
      await supabase.from("agent_memories").insert(memories);
    } catch (err) {
      // Non-fatal — memories are supplementary
      console.error("[financial-intelligence] Failed to store memories:", err);
    }
  }
}
