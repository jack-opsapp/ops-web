/**
 * OPS Web - Business Context Service
 *
 * Sprint E2: Provides structured summaries of live business data for AI consumption.
 * Each method queries real Supabase tables and returns concise, LLM-friendly summaries
 * (not raw database rows) for injection into AI draft prompts.
 *
 * This is Layer 3 of the Knowledge Stack — live business data (RAG over DB).
 * Gated behind phase_c feature flag at the caller level (ai-draft-service).
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { parseStringArray } from "@/lib/utils/parse";

// ─── Return Types ──────────────────────────────────────────────────────────────

export interface ClientContext {
  found: boolean;
  clientId: string | null;
  clientName: string | null;
  clientEmail: string | null;
  phoneNumber: string | null;
  address: string | null;
  notes: string | null;
  /** Structured project history */
  projects: Array<{
    id: string;
    title: string;
    status: string;
    address: string | null;
    startDate: string | null;
    endDate: string | null;
  }>;
  /** Invoice summary */
  invoices: {
    total: number;
    totalRevenue: number;
    paid: number;
    outstanding: number;
    outstandingAmount: number;
    overdue: number;
    overdueAmount: number;
    lastInvoiceDate: string | null;
  };
  /** Estimate summary */
  estimates: {
    total: number;
    approved: number;
    pending: number;
    totalValue: number;
    averageValue: number;
    lastEstimateDate: string | null;
  };
  /** Computed metrics */
  metrics: {
    totalRevenue: number;
    averageProjectValue: number;
    paymentTimeliness: "excellent" | "good" | "fair" | "poor" | "unknown";
    lastInteractionDate: string | null;
    relationshipDuration: string | null;
  };
  /** LLM-ready text summary */
  summary: string;
}

export interface PricingContext {
  /** Per-service pricing intelligence */
  services: Array<{
    serviceName: string;
    taskTypeId: string | null;
    estimateCount: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    commonLineItems: Array<{
      name: string;
      avgUnitPrice: number;
      avgQuantity: number;
      unit: string;
      frequency: number;
    }>;
  }>;
  /** Overall pricing stats */
  overall: {
    totalEstimates: number;
    avgEstimateTotal: number;
    medianEstimateTotal: number;
    avgTaxRate: number | null;
  };
  /** LLM-ready text summary */
  summary: string;
}

export interface ProjectContext {
  found: boolean;
  projectId: string | null;
  title: string | null;
  status: string | null;
  address: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Client info */
  client: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  /** Task breakdown */
  tasks: Array<{
    id: string;
    taskType: string | null;
    status: string;
    customTitle: string | null;
    startDate: string | null;
    endDate: string | null;
    teamMemberIds: string[];
  }>;
  /** Team members assigned */
  teamMembers: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  /** Financial summary */
  financials: {
    estimateTotal: number;
    invoicedTotal: number;
    paidTotal: number;
    outstandingBalance: number;
  };
  /** Computed metrics */
  metrics: {
    completionPercent: number;
    budgetStatus: "under" | "on_track" | "over" | "unknown";
    timelineStatus: "ahead" | "on_track" | "behind" | "unknown";
  };
  /** LLM-ready text summary */
  summary: string;
}

export interface CompanyContext {
  companyId: string;
  companyName: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  industries: string[];
  /** Services offered (from task types) */
  services: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  /** Active team members */
  team: Array<{
    id: string;
    name: string;
    role: string;
    email: string | null;
  }>;
  /** Operational stats */
  stats: {
    teamSize: number;
    activeProjectCount: number;
    servicesOffered: number;
  };
  /** LLM-ready text summary */
  summary: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** @deprecated Use parseStringArray from @/lib/utils/parse — kept as re-export for back-compat */

/**
 * Batch a Supabase .in() query into chunks to avoid PostgREST URL length limits.
 * Returns concatenated results from all chunks.
 */
async function batchedIn<T>(
  queryFn: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ids: string[],
  chunkSize = 80
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await queryFn(chunk);
    if (error) throw new Error(error.message);
    if (data) results.push(...data);
  }
  return results;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Empty Fallbacks ───────────────────────────────────────────────────────────

function emptyClientContext(clientEmail: string, reason: string): ClientContext {
  return {
    found: false, clientId: null, clientName: null, clientEmail,
    phoneNumber: null, address: null, notes: null, projects: [],
    invoices: { total: 0, totalRevenue: 0, paid: 0, outstanding: 0, outstandingAmount: 0, overdue: 0, overdueAmount: 0, lastInvoiceDate: null },
    estimates: { total: 0, approved: 0, pending: 0, totalValue: 0, averageValue: 0, lastEstimateDate: null },
    metrics: { totalRevenue: 0, averageProjectValue: 0, paymentTimeliness: "unknown", lastInteractionDate: null, relationshipDuration: null },
    summary: reason,
  };
}

function emptyPricingContext(reason: string): PricingContext {
  return { services: [], overall: { totalEstimates: 0, avgEstimateTotal: 0, medianEstimateTotal: 0, avgTaxRate: null }, summary: reason };
}

function emptyProjectContext(projectId: string, reason: string): ProjectContext {
  return {
    found: false, projectId, title: null, status: null, address: null, description: null,
    startDate: null, endDate: null, client: null, tasks: [], teamMembers: [],
    financials: { estimateTotal: 0, invoicedTotal: 0, paidTotal: 0, outstandingBalance: 0 },
    metrics: { completionPercent: 0, budgetStatus: "unknown", timelineStatus: "unknown" },
    summary: reason,
  };
}

function emptyCompanyContext(companyId: string, reason: string): CompanyContext {
  return {
    companyId, companyName: "Unknown", description: null, address: null,
    phone: null, email: null, website: null, industries: [], services: [], team: [],
    stats: { teamSize: 0, activeProjectCount: 0, servicesOffered: 0 }, summary: reason,
  };
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const BusinessContextService = {
  /**
   * Get comprehensive context about a client by email.
   * Returns their history, projects, invoices, estimates, and computed metrics.
   */
  async getClientContext(
    companyId: string,
    clientEmail: string
  ): Promise<ClientContext> {
    try {
    const supabase = requireSupabase();

    // Look up client by email
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id, name, email, phone_number, address, notes, created_at")
      .eq("company_id", companyId)
      .ilike("email", clientEmail)
      .is("deleted_at", null)
      .limit(1)
      .single();

    if (!clientRow) {
      return emptyClientContext(clientEmail, `No client record found for ${clientEmail}.`);
    }

    const clientId = clientRow.id as string;

    // Fetch projects, invoices, estimates in parallel
    const [projectsResult, invoicesResult, estimatesResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id, title, status, address, start_date, end_date")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("invoices")
        .select("id, status, total, amount_paid, balance_due, issue_date, due_date, paid_at")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("issue_date", { ascending: false })
        .limit(50),
      supabase
        .from("estimates")
        .select("id, status, total, issue_date, approved_at")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("issue_date", { ascending: false })
        .limit(50),
    ]);

    const projects = (projectsResult.data ?? []) as Record<string, unknown>[];
    const invoices = (invoicesResult.data ?? []) as Record<string, unknown>[];
    const estimates = (estimatesResult.data ?? []) as Record<string, unknown>[];

    // Compute invoice metrics
    const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid ?? 0), 0);
    const paidInvoices = invoices.filter((inv) => inv.status === "paid");
    const outstandingInvoices = invoices.filter((inv) =>
      inv.status === "sent" || inv.status === "viewed" || inv.status === "overdue"
    );
    const overdueInvoices = invoices.filter((inv) => {
      if (inv.status === "paid" || inv.status === "void") return false;
      const dueDate = inv.due_date ? new Date(inv.due_date as string) : null;
      return dueDate && dueDate < new Date();
    });
    const outstandingAmount = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);

    // Compute estimate metrics
    const approvedEstimates = estimates.filter((est) => est.status === "approved" || est.status === "converted");
    const pendingEstimates = estimates.filter((est) => est.status === "draft" || est.status === "sent");
    const estimateTotalValue = estimates.reduce((sum, est) => sum + Number(est.total ?? 0), 0);

    // Payment timeliness (based on paid invoices — how often paid before due date)
    let paymentTimeliness: ClientContext["metrics"]["paymentTimeliness"] = "unknown";
    if (paidInvoices.length >= 3) {
      const onTimeCount = paidInvoices.filter((inv) => {
        const paidAt = inv.paid_at ? new Date(inv.paid_at as string) : null;
        const dueDate = inv.due_date ? new Date(inv.due_date as string) : null;
        if (!paidAt || !dueDate) return true; // give benefit of the doubt
        return paidAt <= dueDate;
      }).length;
      const onTimeRate = onTimeCount / paidInvoices.length;
      if (onTimeRate >= 0.9) paymentTimeliness = "excellent";
      else if (onTimeRate >= 0.7) paymentTimeliness = "good";
      else if (onTimeRate >= 0.5) paymentTimeliness = "fair";
      else paymentTimeliness = "poor";
    }

    // Last interaction date (most recent invoice or estimate)
    const allDates = [
      ...invoices.map((inv) => inv.issue_date as string | null),
      ...estimates.map((est) => est.issue_date as string | null),
    ].filter(Boolean) as string[];
    const lastInteractionDate = allDates.length > 0
      ? allDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : null;

    // Relationship duration
    const clientCreatedAt = clientRow.created_at
      ? new Date(clientRow.created_at as string)
      : null;
    const relationshipDuration = clientCreatedAt
      ? `${Math.floor(daysBetween(clientCreatedAt, new Date()) / 30)} months`
      : null;

    const avgProjectValue = projects.length > 0 ? totalRevenue / projects.length : 0;

    // Build LLM summary
    const summaryParts: string[] = [
      `Client: ${clientRow.name} (${clientEmail})`,
    ];
    if (clientRow.address) summaryParts.push(`Address: ${clientRow.address}`);
    if (projects.length > 0) {
      summaryParts.push(`Projects: ${projects.length} (${projects.filter((p) => p.status === "in_progress").length} active)`);
    }
    if (invoices.length > 0) {
      summaryParts.push(`Revenue: ${formatCurrency(totalRevenue)} across ${invoices.length} invoices`);
      if (outstandingAmount > 0) summaryParts.push(`Outstanding: ${formatCurrency(outstandingAmount)}`);
      if (overdueAmount > 0) summaryParts.push(`Overdue: ${formatCurrency(overdueAmount)}`);
    }
    if (estimates.length > 0) {
      summaryParts.push(`Estimates: ${estimates.length} total (${approvedEstimates.length} approved, ${pendingEstimates.length} pending)`);
    }
    if (paymentTimeliness !== "unknown") {
      summaryParts.push(`Payment history: ${paymentTimeliness}`);
    }
    if (clientRow.notes) summaryParts.push(`Notes: ${(clientRow.notes as string).slice(0, 200)}`);

    return {
      found: true,
      clientId,
      clientName: clientRow.name as string,
      clientEmail: clientRow.email as string,
      phoneNumber: (clientRow.phone_number as string) ?? null,
      address: (clientRow.address as string) ?? null,
      notes: (clientRow.notes as string) ?? null,
      projects: projects.map((p) => ({
        id: p.id as string,
        title: p.title as string,
        status: p.status as string,
        address: (p.address as string) ?? null,
        startDate: (p.start_date as string) ?? null,
        endDate: (p.end_date as string) ?? null,
      })),
      invoices: {
        total: invoices.length,
        totalRevenue,
        paid: paidInvoices.length,
        outstanding: outstandingInvoices.length,
        outstandingAmount,
        overdue: overdueInvoices.length,
        overdueAmount,
        lastInvoiceDate: invoices.length > 0 ? (invoices[0].issue_date as string) : null,
      },
      estimates: {
        total: estimates.length,
        approved: approvedEstimates.length,
        pending: pendingEstimates.length,
        totalValue: estimateTotalValue,
        averageValue: estimates.length > 0 ? estimateTotalValue / estimates.length : 0,
        lastEstimateDate: estimates.length > 0 ? (estimates[0].issue_date as string) : null,
      },
      metrics: {
        totalRevenue,
        averageProjectValue: avgProjectValue,
        paymentTimeliness,
        lastInteractionDate,
        relationshipDuration,
      },
      summary: summaryParts.join("\n"),
    };
    } catch (err) {
      console.error("[business-context] getClientContext failed:", err);
      return emptyClientContext(clientEmail, `Error retrieving client context.`);
    }
  },

  /**
   * Get pricing intelligence from recent estimates.
   * Groups by service type (task type) and computes per-service statistics.
   */
  async getPricingContext(
    companyId: string,
    serviceType?: string
  ): Promise<PricingContext> {
    try {
    const supabase = requireSupabase();

    // Fetch recent estimates (last 12 months) with their line items
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const { data: estimateRows } = await supabase
      .from("estimates")
      .select("id, total, tax_rate, status, issue_date")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .gte("issue_date", twelveMonthsAgo.toISOString())
      .order("issue_date", { ascending: false })
      .limit(200);

    const estimates = (estimateRows ?? []) as Record<string, unknown>[];

    if (estimates.length === 0) {
      return emptyPricingContext("No estimates found in the last 12 months.");
    }

    const estimateIds = estimates.map((e) => e.id as string);

    // Fetch all line items for these estimates (batched to avoid URL length limits)
    const lineItems = await batchedIn<Record<string, unknown>>(
      (ids) =>
        supabase
          .from("line_items")
          .select("id, estimate_id, name, description, quantity, unit, unit_price, line_total, task_type_id, type, category")
          .eq("company_id", companyId)
          .in("estimate_id", ids)
          .order("sort_order")
          .limit(1000),
      estimateIds
    );

    // Fetch task types for label lookup
    const { data: taskTypeRows } = await supabase
      .from("task_types")
      .select("id, display")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    const taskTypeMap = new Map<string, string>();
    for (const tt of (taskTypeRows ?? []) as Record<string, unknown>[]) {
      taskTypeMap.set(tt.id as string, tt.display as string);
    }

    // Group line items by service type (task_type_id or category or name)
    const serviceGroups = new Map<string, {
      taskTypeId: string | null;
      serviceName: string;
      lineItems: Array<{ name: string; unitPrice: number; quantity: number; unit: string; lineTotal: number }>;
      estimateIds: Set<string>;
    }>();

    for (const li of lineItems) {
      const taskTypeId = (li.task_type_id as string) ?? null;
      const groupKey = taskTypeId ?? (li.category as string) ?? (li.name as string) ?? "general";
      const serviceName = taskTypeId
        ? (taskTypeMap.get(taskTypeId) ?? groupKey)
        : (li.category as string) ?? (li.name as string) ?? "General";

      if (serviceType && serviceName.toLowerCase() !== serviceType.toLowerCase() && groupKey !== serviceType) {
        continue;
      }

      if (!serviceGroups.has(groupKey)) {
        serviceGroups.set(groupKey, {
          taskTypeId,
          serviceName,
          lineItems: [],
          estimateIds: new Set(),
        });
      }

      const group = serviceGroups.get(groupKey)!;
      group.lineItems.push({
        name: li.name as string,
        unitPrice: Number(li.unit_price ?? 0),
        quantity: Number(li.quantity ?? 0),
        unit: (li.unit as string) ?? "each",
        lineTotal: Number(li.line_total ?? 0),
      });
      group.estimateIds.add(li.estimate_id as string);
    }

    // Build per-service pricing summaries
    const services: PricingContext["services"] = [];

    for (const [, group] of serviceGroups) {
      const totals = group.lineItems.map((li) => li.lineTotal);
      const avgPrice = totals.length > 0
        ? totals.reduce((s, t) => s + t, 0) / totals.length
        : 0;

      // Count frequency of each line item name
      const itemFrequency = new Map<string, { count: number; totalPrice: number; totalQty: number; unit: string }>();
      for (const li of group.lineItems) {
        const key = li.name.toLowerCase().trim();
        const entry = itemFrequency.get(key) ?? { count: 0, totalPrice: 0, totalQty: 0, unit: li.unit };
        entry.count++;
        entry.totalPrice += li.unitPrice;
        entry.totalQty += li.quantity;
        itemFrequency.set(key, entry);
      }

      const commonLineItems = Array.from(itemFrequency.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8)
        .map(([name, data]) => ({
          name,
          avgUnitPrice: data.totalPrice / data.count,
          avgQuantity: data.totalQty / data.count,
          unit: data.unit,
          frequency: data.count,
        }));

      services.push({
        serviceName: group.serviceName,
        taskTypeId: group.taskTypeId,
        estimateCount: group.estimateIds.size,
        avgPrice,
        minPrice: totals.length > 0 ? Math.min(...totals) : 0,
        maxPrice: totals.length > 0 ? Math.max(...totals) : 0,
        commonLineItems,
      });
    }

    // Sort by estimate count descending
    services.sort((a, b) => b.estimateCount - a.estimateCount);

    // Overall stats
    const estimateTotals = estimates.map((e) => Number(e.total ?? 0));
    const taxRates = estimates
      .map((e) => e.tax_rate as number | null)
      .filter((r): r is number => r != null && r > 0);
    const avgTaxRate = taxRates.length > 0
      ? taxRates.reduce((s, r) => s + r, 0) / taxRates.length
      : null;

    const overall = {
      totalEstimates: estimates.length,
      avgEstimateTotal: estimateTotals.reduce((s, t) => s + t, 0) / estimateTotals.length,
      medianEstimateTotal: median(estimateTotals),
      avgTaxRate,
    };

    // Build LLM summary
    const summaryParts: string[] = [
      `Pricing based on ${estimates.length} estimates from the last 12 months.`,
      `Average estimate: ${formatCurrency(overall.avgEstimateTotal)}, Median: ${formatCurrency(overall.medianEstimateTotal)}`,
    ];
    if (avgTaxRate != null) {
      summaryParts.push(`Standard tax rate: ${(avgTaxRate * 100).toFixed(1)}%`);
    }
    for (const svc of services.slice(0, 5)) {
      summaryParts.push(
        `${svc.serviceName}: ${formatCurrency(svc.avgPrice)} avg (${formatCurrency(svc.minPrice)}-${formatCurrency(svc.maxPrice)}) from ${svc.estimateCount} estimates`
      );
      for (const item of svc.commonLineItems.slice(0, 3)) {
        summaryParts.push(
          `  - ${item.name}: ${formatCurrency(item.avgUnitPrice)}/${item.unit} × ${item.avgQuantity.toFixed(1)} avg`
        );
      }
    }

    return { services, overall, summary: summaryParts.join("\n") };
    } catch (err) {
      console.error("[business-context] getPricingContext failed:", err);
      return emptyPricingContext("Error retrieving pricing context.");
    }
  },

  /**
   * Get comprehensive context about a specific project.
   */
  async getProjectContext(
    companyId: string,
    projectId: string
  ): Promise<ProjectContext> {
    try {
    const supabase = requireSupabase();

    // Fetch project with client
    const { data: projectRow } = await supabase
      .from("projects")
      .select("id, title, status, address, description, start_date, end_date, client_id, team_member_ids")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .single();

    if (!projectRow) {
      return emptyProjectContext(projectId, `Project ${projectId} not found.`);
    }

    const clientId = projectRow.client_id as string | null;
    const teamMemberIds = parseStringArray(projectRow.team_member_ids);

    // Fetch related data in parallel
    const [tasksResult, clientResult, estimatesResult, invoicesResult, teamResult] = await Promise.all([
      // Tasks with task type names (left join — don't drop tasks without a task type)
      supabase
        .from("project_tasks")
        .select("id, status, custom_title, task_type_id, start_date, end_date, team_member_ids, task_types(display)")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("display_order"),
      // Client (scoped to company for defense-in-depth)
      clientId
        ? supabase
            .from("clients")
            .select("id, name, email")
            .eq("id", clientId)
            .eq("company_id", companyId)
            .single()
        : Promise.resolve({ data: null }),
      // Estimates
      supabase
        .from("estimates")
        .select("id, total, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .is("deleted_at", null),
      // Invoices
      supabase
        .from("invoices")
        .select("id, total, amount_paid, balance_due, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .is("deleted_at", null),
      // Team members (from project's team_member_ids — defensively parsed)
      teamMemberIds.length > 0
        ? supabase
            .from("users")
            .select("id, first_name, last_name, role")
            .in("id", teamMemberIds)
            .eq("is_active", true)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] }),
    ]);

    const tasks = (tasksResult.data ?? []) as Record<string, unknown>[];
    const clientData = clientResult.data as Record<string, unknown> | null;
    const estimates = (estimatesResult.data ?? []) as Record<string, unknown>[];
    const invoices = (invoicesResult.data ?? []) as Record<string, unknown>[];
    const teamMembers = (teamResult.data ?? []) as Record<string, unknown>[];

    // Financials
    const estimateTotal = estimates
      .filter((e) => e.status === "approved" || e.status === "converted")
      .reduce((sum, e) => sum + Number(e.total ?? 0), 0);
    const invoicedTotal = invoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    const paidTotal = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid ?? 0), 0);
    const outstandingBalance = invoices.reduce((sum, inv) => sum + Number(inv.balance_due ?? 0), 0);

    // Completion % (task statuses are lowercase in production — see data
    // architecture reference §1c).
    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    const completionPercent = tasks.length > 0
      ? Math.round((completedTasks / tasks.length) * 100)
      : 0;

    // Budget status
    let budgetStatus: ProjectContext["metrics"]["budgetStatus"] = "unknown";
    if (estimateTotal > 0 && invoicedTotal > 0) {
      const ratio = invoicedTotal / estimateTotal;
      if (ratio <= 0.9) budgetStatus = "under";
      else if (ratio <= 1.1) budgetStatus = "on_track";
      else budgetStatus = "over";
    }

    // Timeline status
    let timelineStatus: ProjectContext["metrics"]["timelineStatus"] = "unknown";
    const endDate = projectRow.end_date ? new Date(projectRow.end_date as string) : null;
    if (endDate) {
      const now = new Date();
      if (projectRow.status === "completed") {
        timelineStatus = "on_track";
      } else if (now > endDate) {
        timelineStatus = "behind";
      } else {
        // Check if progress matches expected timeline
        const startDate = projectRow.start_date ? new Date(projectRow.start_date as string) : null;
        if (startDate) {
          const totalDuration = daysBetween(startDate, endDate);
          const elapsed = daysBetween(startDate, now);
          const expectedProgress = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;
          timelineStatus = completionPercent >= expectedProgress * 0.8 ? "on_track" : "behind";
        }
      }
    }

    // Build LLM summary
    const summaryParts: string[] = [
      `Project: ${projectRow.title} (${projectRow.status})`,
    ];
    if (projectRow.address) summaryParts.push(`Location: ${projectRow.address}`);
    if (clientData) summaryParts.push(`Client: ${clientData.name}`);
    if (tasks.length > 0) {
      summaryParts.push(`Tasks: ${completedTasks}/${tasks.length} complete (${completionPercent}%)`);
    }
    if (estimateTotal > 0) {
      summaryParts.push(`Budget: ${formatCurrency(estimateTotal)} estimated, ${formatCurrency(invoicedTotal)} invoiced, ${formatCurrency(paidTotal)} paid`);
    }
    if (outstandingBalance > 0) {
      summaryParts.push(`Outstanding: ${formatCurrency(outstandingBalance)}`);
    }
    if (teamMembers.length > 0) {
      summaryParts.push(`Team: ${teamMembers.map((m) => `${m.first_name} ${m.last_name} (${m.role})`).join(", ")}`);
    }

    return {
      found: true,
      projectId: projectRow.id as string,
      title: projectRow.title as string,
      status: projectRow.status as string,
      address: (projectRow.address as string) ?? null,
      description: (projectRow.description as string) ?? null,
      startDate: (projectRow.start_date as string) ?? null,
      endDate: (projectRow.end_date as string) ?? null,
      client: clientData
        ? {
            id: clientData.id as string,
            name: clientData.name as string,
            email: (clientData.email as string) ?? null,
          }
        : null,
      tasks: tasks.map((t) => {
        const taskTypeJoin = t.task_types as Record<string, unknown> | null;
        return {
          id: t.id as string,
          taskType: taskTypeJoin ? (taskTypeJoin.display as string) : null,
          status: t.status as string,
          customTitle: (t.custom_title as string) ?? null,
          startDate: (t.start_date as string) ?? null,
          endDate: (t.end_date as string) ?? null,
          teamMemberIds: (t.team_member_ids as string[]) ?? [],
        };
      }),
      teamMembers: teamMembers.map((m) => ({
        id: m.id as string,
        name: `${m.first_name} ${m.last_name}`,
        role: (m.role as string) ?? "unassigned",
      })),
      financials: { estimateTotal, invoicedTotal, paidTotal, outstandingBalance },
      metrics: { completionPercent, budgetStatus, timelineStatus },
      summary: summaryParts.join("\n"),
    };
    } catch (err) {
      console.error("[business-context] getProjectContext failed:", err);
      return emptyProjectContext(projectId, "Error retrieving project context.");
    }
  },

  /**
   * Get lightweight company overview — services, team, basic info.
   * Designed to be called on every draft (cached per request at caller level).
   */
  async getCompanyContext(companyId: string): Promise<CompanyContext> {
    try {
    const supabase = requireSupabase();

    // Fetch company, task types, active team members, and active project count in parallel
    const [companyResult, taskTypesResult, teamResult, projectCountResult] = await Promise.all([
      supabase
        .from("companies")
        .select("id, name, description, address, phone, email, website, industries")
        .eq("id", companyId)
        .single(),
      supabase
        .from("task_types")
        .select("id, display, color")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("display_order"),
      supabase
        .from("users")
        .select("id, first_name, last_name, role, email")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("first_name"),
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .in("status", ["rfq", "estimated", "accepted", "in_progress"]),
    ]);

    const company = companyResult.data as Record<string, unknown> | null;
    const taskTypes = (taskTypesResult.data ?? []) as Record<string, unknown>[];
    const team = (teamResult.data ?? []) as Record<string, unknown>[];
    const activeProjectCount = projectCountResult.count ?? 0;

    if (!company) {
      return emptyCompanyContext(companyId, "Company not found.");
    }

    const services = taskTypes.map((tt) => ({
      id: tt.id as string,
      name: tt.display as string,
      color: tt.color as string,
    }));

    const teamList = team.map((u) => ({
      id: u.id as string,
      name: `${u.first_name} ${u.last_name}`,
      role: (u.role as string) ?? "unassigned",
      email: (u.email as string) ?? null,
    }));

    // Build LLM summary
    const summaryParts: string[] = [
      `Company: ${company.name}`,
    ];
    if (company.description) summaryParts.push(`About: ${(company.description as string).slice(0, 200)}`);
    if (company.address) summaryParts.push(`Location: ${company.address}`);
    if ((company.industries as string[])?.length) {
      summaryParts.push(`Industries: ${(company.industries as string[]).join(", ")}`);
    }
    if (services.length > 0) {
      summaryParts.push(`Services: ${services.map((s) => s.name).join(", ")}`);
    }
    summaryParts.push(`Team: ${teamList.length} members, ${activeProjectCount} active projects`);

    return {
      companyId,
      companyName: company.name as string,
      description: (company.description as string) ?? null,
      address: (company.address as string) ?? null,
      phone: (company.phone as string) ?? null,
      email: (company.email as string) ?? null,
      website: (company.website as string) ?? null,
      industries: (company.industries as string[]) ?? [],
      services,
      team: teamList,
      stats: {
        teamSize: teamList.length,
        activeProjectCount,
        servicesOffered: services.length,
      },
      summary: summaryParts.join("\n"),
    };
    } catch (err) {
      console.error("[business-context] getCompanyContext failed:", err);
      return emptyCompanyContext(companyId, "Error retrieving company context.");
    }
  },
};
