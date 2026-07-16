/**
 * OPS Web — Invoice Suggestion Service
 *
 * Sprint I1: Analyzes project/estimate context and suggests invoice creation.
 * All suggestions flow through the approval queue — invoices are NEVER auto-created.
 *
 * Includes dollar-amount safety rails:
 *   - All invoices require approval (never auto-execute)
 *   - High-value warning (>$5,000 default, configurable)
 *   - Duplicate detection (same estimate, or same client+project+similar total)
 *   - Line item price deviation (>20% from historical average)
 *   - Missing data warnings (no email, no payment terms, zero tax)
 *
 * Gated behind phase_c feature flag.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { ApprovalQueueService } from "./approval-queue-service";
import { BusinessContextService } from "./business-context-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getCompanyManagerUserIds } from "./company-managers";
import { resolveNewEmailConversationConnectionId } from "@/lib/email/email-connection-selection";
import type {
  CreateInvoiceActionData,
  InvoiceWarning,
  AgentActionPriority,
} from "@/lib/types/approval-queue";

// ─── Invoice Settings ───────────────────────────────────────────────────────

export interface InvoiceAutomationSettings {
  default_payment_terms: string;
  default_tax_rate: number;
  auto_suggest_on_completion: boolean;
  auto_suggest_from_estimate: boolean;
  high_value_threshold: number;
  include_cover_email: boolean;
}

const DEFAULT_INVOICE_SETTINGS: InvoiceAutomationSettings = {
  default_payment_terms: "NET-30",
  default_tax_rate: 0,
  auto_suggest_on_completion: true,
  auto_suggest_from_estimate: true,
  high_value_threshold: 5000,
  include_cover_email: true,
};

async function getInvoiceSettings(
  companyId: string
): Promise<InvoiceAutomationSettings> {
  const supabase = requireSupabase();

  const { data } = await supabase
    .from("companies")
    .select("invoice_settings")
    .eq("id", companyId)
    .single();

  if (!data?.invoice_settings) return DEFAULT_INVOICE_SETTINGS;

  const settings = data.invoice_settings as Record<string, unknown>;
  return {
    default_payment_terms:
      (settings.default_payment_terms as string) ??
      DEFAULT_INVOICE_SETTINGS.default_payment_terms,
    default_tax_rate:
      (settings.default_tax_rate as number) ??
      DEFAULT_INVOICE_SETTINGS.default_tax_rate,
    auto_suggest_on_completion:
      (settings.auto_suggest_on_completion as boolean) ??
      DEFAULT_INVOICE_SETTINGS.auto_suggest_on_completion,
    auto_suggest_from_estimate:
      (settings.auto_suggest_from_estimate as boolean) ??
      DEFAULT_INVOICE_SETTINGS.auto_suggest_from_estimate,
    high_value_threshold:
      (settings.high_value_threshold as number) ??
      DEFAULT_INVOICE_SETTINGS.high_value_threshold,
    include_cover_email:
      (settings.include_cover_email as boolean) ??
      DEFAULT_INVOICE_SETTINGS.include_cover_email,
  };
}

// ─── Safety Rails ───────────────────────────────────────────────────────────

interface SafetyRailResult {
  warnings: InvoiceWarning[];
  priority: AgentActionPriority;
  shouldSkip: boolean;
  skipReason?: string;
}

/**
 * Check for duplicate invoices that would indicate this suggestion is redundant.
 */
async function checkDuplicates(
  companyId: string,
  clientId: string,
  projectId: string | null,
  estimateId: string | null,
  total: number
): Promise<{ isExactDuplicate: boolean; isSimilarDuplicate: boolean }> {
  const supabase = requireSupabase();

  // Exact duplicate: same estimate_id
  if (estimateId) {
    const { data: exact } = await supabase
      .from("invoices")
      .select("id")
      .eq("company_id", companyId)
      .eq("estimate_id", estimateId)
      .is("deleted_at", null)
      .limit(1);

    if (exact && exact.length > 0) {
      return { isExactDuplicate: true, isSimilarDuplicate: false };
    }
  }

  // Similar duplicate: same client + same project + total within 10%
  if (projectId) {
    const lowerBound = total * 0.9;
    const upperBound = total * 1.1;

    const { data: similar } = await supabase
      .from("invoices")
      .select("id, total")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .gte("total", lowerBound)
      .lte("total", upperBound)
      .limit(1);

    if (similar && similar.length > 0) {
      return { isExactDuplicate: false, isSimilarDuplicate: true };
    }
  }

  return { isExactDuplicate: false, isSimilarDuplicate: false };
}

/**
 * Check line item prices against historical averages.
 * Flags items where price deviates >20% from average.
 */
async function checkPriceDeviations(
  companyId: string,
  lineItems: CreateInvoiceActionData["line_items"]
): Promise<InvoiceWarning[]> {
  const warnings: InvoiceWarning[] = [];

  try {
    const pricingCtx = await BusinessContextService.getPricingContext(companyId);
    if (!pricingCtx || pricingCtx.services.length === 0) return warnings;

    // Build a lookup of average prices by service/line item name
    const avgPrices = new Map<string, { avg: number; unit: string }>();
    for (const svc of pricingCtx.services) {
      for (const item of svc.commonLineItems) {
        avgPrices.set(item.name.toLowerCase(), {
          avg: item.avgUnitPrice,
          unit: item.unit,
        });
      }
    }

    for (const item of lineItems) {
      const hist = avgPrices.get(item.name.toLowerCase());
      if (hist && hist.avg > 0) {
        const deviation = Math.abs(item.unit_price - hist.avg) / hist.avg;
        if (deviation > 0.2) {
          warnings.push({
            type: "price_deviation",
            params: {
              item_name: item.name,
              item_price: item.unit_price,
              item_unit: item.unit,
              avg_price: hist.avg,
              deviation_pct: Math.round(deviation * 100),
            },
          });
        }
      }
    }
  } catch {
    // Non-critical — don't block on pricing context failures
  }

  return warnings;
}

/**
 * Apply all safety rails to a proposed invoice.
 */
async function applySafetyRails(
  companyId: string,
  clientId: string,
  projectId: string | null,
  estimateId: string | null,
  clientEmail: string | null,
  total: number,
  taxRate: number | null,
  paymentTerms: string | null,
  lineItems: CreateInvoiceActionData["line_items"],
  settings: InvoiceAutomationSettings
): Promise<SafetyRailResult> {
  const warnings: InvoiceWarning[] = [];
  let priority: AgentActionPriority = "normal";

  // 1. Duplicate detection
  const { isExactDuplicate, isSimilarDuplicate } = await checkDuplicates(
    companyId,
    clientId,
    projectId,
    estimateId,
    total
  );

  if (isExactDuplicate) {
    return {
      warnings: [],
      priority: "normal",
      shouldSkip: true,
      skipReason: "Invoice already exists from this estimate",
    };
  }

  if (isSimilarDuplicate) {
    warnings.push({ type: "duplicate_similar" });
  }

  // 2. High-value warning
  if (total > settings.high_value_threshold) {
    priority = "high";
    warnings.push({
      type: "high_value",
      params: { total, threshold: settings.high_value_threshold },
    });
  }

  // 3. Missing data warnings
  if (!clientEmail) {
    warnings.push({ type: "no_client_email" });
  }

  if (!paymentTerms) {
    warnings.push({
      type: "no_payment_terms",
      params: { default_terms: settings.default_payment_terms },
    });
  }

  // Only flag zero tax when the company has a non-zero default configured
  // (0% is intentional in many jurisdictions)
  if ((taxRate === 0 || taxRate === null) && settings.default_tax_rate > 0) {
    warnings.push({ type: "zero_tax" });
  }

  // 4. Line item price deviation
  const priceWarnings = await checkPriceDeviations(companyId, lineItems);
  warnings.push(...priceWarnings);

  return { warnings, priority, shouldSkip: false };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeDueDate(paymentTerms: string): string {
  const now = new Date();
  let daysToAdd = 30; // default

  const termMap: Record<string, number> = {
    "NET-15": 15,
    "NET-30": 30,
    "NET-45": 45,
    "NET-60": 60,
  };

  if (termMap[paymentTerms]) {
    daysToAdd = termMap[paymentTerms];
  }

  now.setDate(now.getDate() + daysToAdd);
  return now.toISOString();
}

/**
 * Get an admin user ID for attributing proposals.
 */
async function getCompanyAdminUserId(
  companyId: string
): Promise<string | null> {
  const supabase = requireSupabase();

  const managerIds = await getCompanyManagerUserIds(supabase, companyId);
  return managerIds[0] ?? null;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const InvoiceSuggestionService = {
  /**
   * Suggest creating an invoice from an accepted/approved estimate.
   * Copies line items, applies company payment terms, and proposes via queue.
   */
  async suggestInvoiceFromEstimate(
    companyId: string,
    userId: string,
    estimateId: string
  ): Promise<string | null> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return null;

    const settings = await getInvoiceSettings(companyId);
    if (!settings.auto_suggest_from_estimate) return null;

    const supabase = requireSupabase();

    // Fetch the estimate with line items
    const { data: estimate } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .single();

    if (!estimate) {
      console.log(
        `[invoice-suggestion] Estimate ${estimateId} not found`
      );
      return null;
    }

    const { data: lineItemRows } = await supabase
      .from("line_items")
      .select("*")
      .eq("estimate_id", estimateId)
      .eq("company_id", companyId)
      .order("sort_order");

    const lineItems: CreateInvoiceActionData["line_items"] = (
      lineItemRows ?? []
    ).map((row, idx) => ({
      name: (row.name as string) ?? "",
      description: (row.description as string) ?? null,
      quantity: Number(row.quantity ?? 0),
      unit: (row.unit as string) ?? "ea",
      unit_price: Number(row.unit_price ?? 0),
      type: ((row.type as string) ?? "LABOR") as "LABOR" | "MATERIAL",
      task_type_id: (row.task_type_id as string) ?? null,
      is_taxable: (row.is_taxable as boolean) ?? true,
      sort_order: (row.sort_order as number) ?? idx,
      category: (row.category as string) ?? null,
    }));

    // Get client and project context
    const clientId = estimate.client_id as string;
    const projectId = (estimate.project_id as string) ?? null;

    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email, phone_number, address")
      .eq("id", clientId)
      .single();

    const clientName = (client?.name as string) ?? "Unknown Client";
    const clientEmail = (client?.email as string) ?? null;

    let projectTitle = "Untitled Project";
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("title")
        .eq("id", projectId)
        .single();

      projectTitle = (project?.title as string) ?? projectTitle;
    }

    // Compute pricing from estimate
    const subtotal = Number(estimate.subtotal ?? 0);
    const discountType = (estimate.discount_type as string) ?? null;
    const discountValue =
      estimate.discount_value != null
        ? Number(estimate.discount_value)
        : null;
    const discountAmount = Number(estimate.discount_amount ?? 0);
    const taxRate =
      estimate.tax_rate != null
        ? Number(estimate.tax_rate)
        : settings.default_tax_rate;
    const taxAmount = Number(estimate.tax_amount ?? 0);
    const total = Number(estimate.total ?? 0);

    // Determine payment terms and due date
    const paymentTerms =
      (estimate.terms as string) ?? settings.default_payment_terms;
    const dueDate = computeDueDate(paymentTerms);

    // Apply safety rails
    const rails = await applySafetyRails(
      companyId,
      clientId,
      projectId,
      estimateId,
      clientEmail,
      total,
      taxRate,
      paymentTerms,
      lineItems,
      settings
    );

    if (rails.shouldSkip) {
      console.log(
        `[invoice-suggestion] Skipping estimate ${estimateId}: ${rails.skipReason}`
      );
      return null;
    }

    // Build the cover email info
    const coverEmail =
      settings.include_cover_email && clientEmail
        ? {
            to: clientEmail,
            subject: `Invoice for ${projectTitle}`,
            draft_text: null as string | null,
            connection_id: null as string | null,
          }
        : null;

    // Find a user email connection for the cover email
    if (coverEmail) {
      coverEmail.connection_id =
        await resolveNewEmailConversationConnectionId({
          supabase,
          companyId,
          actorUserId: userId,
        });
    }

    const estimateNumber =
      (estimate.estimate_number as string) ?? estimateId.slice(0, 8);

    const actionData: CreateInvoiceActionData = {
      estimate_id: estimateId,
      project_id: projectId,
      client_id: clientId,
      client_name: clientName,
      project_title: projectTitle,
      line_items: lineItems,
      subtotal,
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount: discountAmount,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      payment_terms: paymentTerms,
      due_date: dueDate,
      notes: (estimate.client_message as string) ?? null,
      terms: paymentTerms,
      cover_email: coverEmail,
      warnings: rails.warnings,
    };

    const contextSummary = `Invoice $${total.toFixed(2)} for ${clientName} — project "${projectTitle}" from estimate #${estimateNumber}`;

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "create_invoice",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary,
      contextSource: "estimate_conversion",
      sourceId: estimateId,
      confidence: 0.85,
      priority: rails.priority,
    });
  },

  /**
   * Suggest creating an invoice when a project reaches "Complete" stage.
   * Compares existing invoices against estimate totals to find uninvoiced delta.
   */
  async suggestInvoiceFromCompletion(
    companyId: string,
    userId: string,
    projectId: string
  ): Promise<string | null> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return null;

    const settings = await getInvoiceSettings(companyId);
    if (!settings.auto_suggest_on_completion) return null;

    const supabase = requireSupabase();

    // Get project context
    const { data: project } = await supabase
      .from("projects")
      .select("id, title, client_id, status")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .single();

    if (!project) return null;

    const clientId = project.client_id as string;
    if (!clientId) return null;

    const projectTitle = (project.title as string) ?? "Untitled Project";

    // Get client info
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email, phone_number")
      .eq("id", clientId)
      .single();

    const clientName = (client?.name as string) ?? "Unknown Client";
    const clientEmail = (client?.email as string) ?? null;

    // Get financial context: estimates vs invoiced
    let projectCtx;
    try {
      projectCtx = await BusinessContextService.getProjectContext(
        companyId,
        projectId
      );
    } catch {
      // If context unavailable, query manually
      projectCtx = null;
    }

    const estimateTotal = projectCtx?.financials?.estimateTotal ?? 0;
    const invoicedTotal = projectCtx?.financials?.invoicedTotal ?? 0;

    // Check if there are uninvoiced estimates
    const { data: estimates } = await supabase
      .from("estimates")
      .select("id, total, status, estimate_number")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .in("status", ["approved", "sent", "viewed"])
      .is("deleted_at", null);

    // Find estimates that haven't been converted to invoices (batch query)
    const estimateIds = (estimates ?? []).map((e) => e.id as string);
    const { data: invoicesWithEstimates } = estimateIds.length > 0
      ? await supabase
          .from("invoices")
          .select("estimate_id")
          .eq("company_id", companyId)
          .in("estimate_id", estimateIds)
          .is("deleted_at", null)
      : { data: [] };

    const invoicedEstimateIds = new Set(
      (invoicesWithEstimates ?? []).map((i) => i.estimate_id as string)
    );

    const uninvoicedEstimates = (estimates ?? [])
      .filter((est) => !invoicedEstimateIds.has(est.id as string))
      .map((est) => ({
        id: est.id as string,
        total: Number(est.total ?? 0),
        number: (est.estimate_number as string) ?? "",
      }));

    // If we have uninvoiced estimates, suggest from the first one
    if (uninvoicedEstimates.length > 0) {
      const bestEstimate = uninvoicedEstimates[0];
      return InvoiceSuggestionService.suggestInvoiceFromEstimate(
        companyId,
        userId,
        bestEstimate.id
      );
    }

    // If no estimates but project is complete, compute uninvoiced delta
    const uninvoicedAmount = estimateTotal - invoicedTotal;
    if (uninvoicedAmount <= 0) {
      console.log(
        `[invoice-suggestion] Project ${projectId} fully invoiced`
      );
      return null;
    }

    // Build a generic invoice from the uninvoiced delta
    const paymentTerms = settings.default_payment_terms;
    const taxRate = settings.default_tax_rate;
    const taxAmount = uninvoicedAmount * (taxRate / 100);
    const total = uninvoicedAmount + taxAmount;
    const dueDate = computeDueDate(paymentTerms);

    const lineItems: CreateInvoiceActionData["line_items"] = [
      {
        name: `Project completion — ${projectTitle}`,
        description: `Remaining balance for project "${projectTitle}"`,
        quantity: 1,
        unit: "ea",
        unit_price: uninvoicedAmount,
        type: "LABOR",
        task_type_id: null,
        is_taxable: taxRate > 0,
        sort_order: 0,
        category: null,
      },
    ];

    const rails = await applySafetyRails(
      companyId,
      clientId,
      projectId,
      null,
      clientEmail,
      total,
      taxRate,
      paymentTerms,
      lineItems,
      settings
    );

    if (rails.shouldSkip) return null;

    const coverEmail =
      settings.include_cover_email && clientEmail
        ? {
            to: clientEmail,
            subject: `Invoice for ${projectTitle}`,
            draft_text: null as string | null,
            connection_id: null as string | null,
          }
        : null;

    if (coverEmail) {
      coverEmail.connection_id =
        await resolveNewEmailConversationConnectionId({
          supabase,
          companyId,
          actorUserId: userId,
        });
    }

    const actionData: CreateInvoiceActionData = {
      estimate_id: null,
      project_id: projectId,
      client_id: clientId,
      client_name: clientName,
      project_title: projectTitle,
      line_items: lineItems,
      subtotal: uninvoicedAmount,
      discount_type: null,
      discount_value: null,
      discount_amount: 0,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      payment_terms: paymentTerms,
      due_date: dueDate,
      notes: null,
      terms: paymentTerms,
      cover_email: coverEmail,
      warnings: rails.warnings,
    };

    const contextSummary = `Project complete. $${invoicedTotal.toFixed(2)} invoiced of estimated $${estimateTotal.toFixed(2)}. Uninvoiced balance: $${uninvoicedAmount.toFixed(2)}`;

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "create_invoice",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary,
      contextSource: "project_completion",
      sourceId: projectId,
      confidence: 0.6,
      priority: rails.priority,
    });
  },

  /**
   * Scan projects for milestone billing opportunities.
   * Called by cron or integrated into project-health cron from P3.
   */
  async suggestInvoiceFromSchedule(
    companyId: string
  ): Promise<number> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return 0;

    const settings = await getInvoiceSettings(companyId);
    const supabase = requireSupabase();

    // Find active projects with estimates
    const { data: activeProjects } = await supabase
      .from("projects")
      .select("id, title, client_id, status")
      .eq("company_id", companyId)
      .in("status", ["accepted", "in_progress"])
      .is("deleted_at", null)
      .limit(50);

    if (!activeProjects || activeProjects.length === 0) return 0;

    const adminUserId = await getCompanyAdminUserId(companyId);
    if (!adminUserId) return 0;

    let suggestedCount = 0;

    for (const project of activeProjects) {
      const projectId = project.id as string;

      // Get completion percentage
      const { data: tasks } = await supabase
        .from("project_tasks")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .is("deleted_at", null);

      if (!tasks || tasks.length === 0) continue;

      const completed = tasks.filter(
        (t) => t.status === "completed"
      ).length;
      const completionPct = Math.round((completed / tasks.length) * 100);

      // Check milestone thresholds: 25%, 50%, 75%, 100%
      // Use reverse to find the HIGHEST crossed milestone, not the lowest
      const milestones = [25, 50, 75, 100];
      const crossedMilestone = milestones
        .slice()
        .reverse()
        .find((m) => completionPct >= m);

      if (!crossedMilestone) continue;

      // Check existing invoices for this project
      const { data: existingInvoices } = await supabase
        .from("invoices")
        .select("id, total")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .is("deleted_at", null);

      // Get total estimate value
      const { data: estimates } = await supabase
        .from("estimates")
        .select("total")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .in("status", ["approved", "sent", "viewed", "converted"])
        .is("deleted_at", null);

      const estimateTotal = (estimates ?? []).reduce(
        (sum, e) => sum + Number(e.total ?? 0),
        0
      );
      const invoicedTotal = (existingInvoices ?? []).reduce(
        (sum, i) => sum + Number(i.total ?? 0),
        0
      );

      // Expected invoice amount at this milestone
      const expectedInvoiced = estimateTotal * (crossedMilestone / 100);
      const uninvoicedDelta = expectedInvoiced - invoicedTotal;

      // Only suggest if there's a meaningful gap ($100+)
      if (uninvoicedDelta < 100) continue;

      // Check for existing pending suggestions for this milestone
      const milestoneSourceId = `${projectId}:milestone:${crossedMilestone}`;
      const { data: existingAction } = await supabase
        .from("agent_actions")
        .select("id")
        .eq("company_id", companyId)
        .eq("action_type", "create_invoice")
        .eq("source_id", milestoneSourceId)
        .in("status", ["pending", "approved", "executed"])
        .limit(1);

      if (existingAction && existingAction.length > 0) continue;

      const clientId = project.client_id as string;
      if (!clientId) continue;

      const { data: client } = await supabase
        .from("clients")
        .select("name, email")
        .eq("id", clientId)
        .single();

      const clientName = (client?.name as string) ?? "Unknown Client";
      const clientEmail = (client?.email as string) ?? null;
      const projectTitle = (project.title as string) ?? "Untitled Project";

      const paymentTerms = settings.default_payment_terms;
      const taxRate = settings.default_tax_rate;
      const taxAmount = uninvoicedDelta * (taxRate / 100);
      const total = uninvoicedDelta + taxAmount;
      const dueDate = computeDueDate(paymentTerms);

      const lineItems: CreateInvoiceActionData["line_items"] = [
        {
          name: `Progress billing — ${crossedMilestone}% milestone`,
          description: `${crossedMilestone}% milestone billing for "${projectTitle}"`,
          quantity: 1,
          unit: "ea",
          unit_price: uninvoicedDelta,
          type: "LABOR",
          task_type_id: null,
          is_taxable: taxRate > 0,
          sort_order: 0,
          category: null,
        },
      ];

      const rails = await applySafetyRails(
        companyId,
        clientId,
        projectId,
        null,
        clientEmail,
        total,
        taxRate,
        paymentTerms,
        lineItems,
        settings
      );

      if (rails.shouldSkip) continue;

      const coverEmail =
        settings.include_cover_email && clientEmail
          ? {
              to: clientEmail,
              subject: `Progress Invoice — ${projectTitle} (${crossedMilestone}%)`,
              draft_text: null as string | null,
              connection_id: null as string | null,
            }
          : null;

      const actionData: CreateInvoiceActionData = {
        estimate_id: null,
        project_id: projectId,
        client_id: clientId,
        client_name: clientName,
        project_title: projectTitle,
        line_items: lineItems,
        subtotal: uninvoicedDelta,
        discount_type: null,
        discount_value: null,
        discount_amount: 0,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        payment_terms: paymentTerms,
        due_date: dueDate,
        notes: null,
        terms: paymentTerms,
        cover_email: coverEmail,
        warnings: rails.warnings,
      };

      const contextSummary = `${crossedMilestone}% milestone reached on "${projectTitle}". $${invoicedTotal.toFixed(2)} invoiced of $${estimateTotal.toFixed(2)} estimated. Suggest $${uninvoicedDelta.toFixed(2)} progress invoice.`;

      await ApprovalQueueService.proposeAction({
        companyId,
        userId: adminUserId,
        actionType: "create_invoice",
        actionData: actionData as unknown as Record<string, unknown>,
        contextSummary,
        contextSource: "milestone_billing",
        sourceId: milestoneSourceId,
        confidence: 0.5,
        priority: rails.priority,
      });

      suggestedCount++;
    }

    return suggestedCount;
  },

  /** Exported for settings UI */
  getInvoiceSettings,
  DEFAULT_INVOICE_SETTINGS,
};
