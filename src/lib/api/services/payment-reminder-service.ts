/**
 * OPS Web — Payment Reminder Service
 *
 * Sprint I2: Detects overdue invoices and generates graduated reminder emails.
 * Escalation: friendly → firm → final notice → collections warning.
 * All reminders flow through the approval queue — never auto-sent.
 *
 * Gated behind phase_c feature flag.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { ApprovalQueueService } from "./approval-queue-service";
import { ensureApprovalDraftHistory } from "./approval-draft-provenance";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getCompanyManagerUserIds } from "./company-managers";
import { getCompanyLocale, renderServerString } from "@/i18n/server-render";
import type { Locale } from "@/i18n/types";
import type {
  ReminderTone,
  SendPaymentReminderActionData,
  ClientPaymentHistory,
  AgentActionPriority,
} from "@/lib/types/approval-queue";

// ─── Locale-aware helpers ───────────────────────────────────────────────────

/** Format a date in the company's locale (long month, numeric day+year). */
function formatDueDate(dueDate: string, locale: Locale): string {
  const bcp47 = locale === "es" ? "es-ES" : "en-US";
  return new Date(dueDate).toLocaleDateString(bcp47, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a money amount with currency symbol in the company's locale. */
function formatAmount(amount: number, locale: Locale): string {
  const bcp47 = locale === "es" ? "es-ES" : "en-US";
  return new Intl.NumberFormat(bcp47, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Reminder Settings ─────────────────────────────────────────────────────

export interface PaymentReminderSettings {
  enabled: boolean;
  reminder_days: [number, number, number, number];
  max_reminders: number;
  skip_weekends: boolean;
  excluded_client_ids: string[];
  late_payment_threshold: number;
}

const DEFAULT_REMINDER_SETTINGS: PaymentReminderSettings = {
  enabled: true,
  reminder_days: [7, 14, 30, 45],
  max_reminders: 4,
  skip_weekends: false,
  excluded_client_ids: [],
  late_payment_threshold: 50,
};

async function getReminderSettings(
  companyId: string
): Promise<PaymentReminderSettings> {
  const supabase = requireSupabase();

  const { data } = await supabase
    .from("companies")
    .select("invoice_settings")
    .eq("id", companyId)
    .single();

  if (!data?.invoice_settings) return DEFAULT_REMINDER_SETTINGS;

  const settings = data.invoice_settings as Record<string, unknown>;
  const reminder = settings.reminder_settings as
    | Record<string, unknown>
    | undefined;
  if (!reminder) return DEFAULT_REMINDER_SETTINGS;

  return {
    enabled: (reminder.enabled as boolean) ?? DEFAULT_REMINDER_SETTINGS.enabled,
    reminder_days:
      Array.isArray(reminder.reminder_days) &&
      reminder.reminder_days.length === 4
        ? (reminder.reminder_days as [number, number, number, number])
        : DEFAULT_REMINDER_SETTINGS.reminder_days,
    max_reminders: Math.min(
      4,
      Math.max(
        1,
        Number(reminder.max_reminders) ||
          DEFAULT_REMINDER_SETTINGS.max_reminders
      )
    ),
    skip_weekends:
      (reminder.skip_weekends as boolean) ??
      DEFAULT_REMINDER_SETTINGS.skip_weekends,
    excluded_client_ids: Array.isArray(reminder.excluded_client_ids)
      ? (reminder.excluded_client_ids as string[])
      : DEFAULT_REMINDER_SETTINGS.excluded_client_ids,
    late_payment_threshold: Math.min(
      100,
      Math.max(
        0,
        Number(reminder.late_payment_threshold) ||
          DEFAULT_REMINDER_SETTINGS.late_payment_threshold
      )
    ),
  };
}

// ─── Escalation Schedule ───────────────────────────────────────────────────

interface ReminderTier {
  level: number;
  tone: ReminderTone;
  /** i18n key into server-emails.json for the subject line template. */
  subjectKey: string;
  /** i18n key into server-emails.json for the plain-text fallback body. */
  fallbackKey: string;
  /** English-only GPT instruction — model reads English natively. */
  instruction: string;
}

function buildTiers(days: [number, number, number, number]): ReminderTier[] {
  return [
    {
      level: 1,
      tone: "friendly",
      subjectKey: "paymentReminder.friendly.subject",
      fallbackKey: "paymentReminder.friendly.fallback",
      instruction:
        "Write a friendly, casual reminder that payment is due. Don't be pushy.",
    },
    {
      level: 2,
      tone: "firm",
      subjectKey: "paymentReminder.firm.subject",
      fallbackKey: "paymentReminder.firm.fallback",
      // Placeholder {{days}} in the subject is resolved from `days[1]` at
      // render time — keep the tier-day reference here so the reminder
      // matches the actual configured escalation window.
      instruction: `Write a professional payment reminder. Be direct but not aggressive. Mention the specific overdue amount and original due date. Note: customer is now ${days[1]} days overdue.`,
    },
    {
      level: 3,
      tone: "final",
      subjectKey: "paymentReminder.final.subject",
      fallbackKey: "paymentReminder.final.fallback",
      instruction: `Write a final notice for an overdue invoice. Be firm and clear about consequences. Mention this is the final reminder before further action. Customer is ${days[2]} days past due.`,
    },
    {
      level: 4,
      tone: "collections",
      subjectKey: "paymentReminder.collections.subject",
      fallbackKey: "paymentReminder.collections.fallback",
      instruction:
        "Write a formal collections notice. Professional but serious. State the overdue amount, duration, and that the account has been flagged for review.",
    },
  ];
}

function getReminderLevel(
  daysOverdue: number,
  reminderDays: [number, number, number, number],
  maxReminders: number
): number | null {
  // Walk backwards through tiers to find the highest eligible level
  for (let i = Math.min(maxReminders, 4) - 1; i >= 0; i--) {
    if (daysOverdue >= reminderDays[i]) return i + 1;
  }
  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// ─── Service ───────────────────────────────────────────────────────────────

export const PaymentReminderService = {
  /**
   * Detect overdue invoices that need a new reminder at their current tier.
   * Returns only invoices where the tier has advanced since last reminder sent.
   */
  async detectOverdueInvoices(
    companyId: string,
    settings: PaymentReminderSettings
  ): Promise<
    Array<{
      invoiceId: string;
      invoiceNumber: string;
      clientId: string;
      clientName: string;
      clientEmail: string;
      projectId: string | null;
      projectTitle: string;
      balanceDue: number;
      total: number;
      dueDate: string;
      daysOverdue: number;
      reminderLevel: number;
      paymentTerms: string | null;
    }>
  > {
    const supabase = requireSupabase();

    const today = new Date();
    const todayIso = today.toISOString().split("T")[0];

    // Query overdue invoices
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select(
        "id, invoice_number, client_id, project_id, balance_due, total, due_date, status, payment_terms"
      )
      .eq("company_id", companyId)
      .in("status", ["sent", "awaiting_payment", "partially_paid", "past_due"])
      .lt("due_date", todayIso)
      .is("deleted_at", null)
      .order("due_date", { ascending: true });

    if (error) {
      console.error(
        "[payment-reminder] Failed to fetch overdue invoices:",
        error.message
      );
      return [];
    }
    if (!invoices || invoices.length === 0) return [];

    // Filter excluded clients
    const excludedSet = new Set(settings.excluded_client_ids);
    const filtered = invoices.filter(
      (inv) => !excludedSet.has(inv.client_id as string)
    );
    if (filtered.length === 0) return [];

    // Batch fetch client info
    const clientIds = [
      ...new Set(filtered.map((inv) => inv.client_id as string)),
    ];
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, email")
      .in("id", clientIds);

    const clientMap = new Map(
      (clients ?? []).map((c) => [
        c.id as string,
        {
          name: (c.name as string) ?? "Unknown",
          email: (c.email as string) ?? null,
        },
      ])
    );

    // Batch fetch project titles
    const projectIds = [
      ...new Set(
        filtered
          .map((inv) => inv.project_id as string | null)
          .filter((id): id is string => id !== null)
      ),
    ];
    const projectMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, title")
        .in("id", projectIds);

      for (const p of projects ?? []) {
        projectMap.set(
          p.id as string,
          (p.title as string) ?? "Untitled Project"
        );
      }
    }

    // Check existing reminders sent (from agent_actions)
    const invoiceIds = filtered.map((inv) => inv.id as string);
    const { data: existingActions } = await supabase
      .from("agent_actions")
      .select("source_id, status")
      .eq("company_id", companyId)
      .eq("action_type", "send_payment_reminder")
      .in("status", ["pending", "approved", "executed", "rejected", "failed"]);

    // Build a set of "invoiceId:reminder:level" source_ids already sent/pending
    const sentReminders = new Set(
      (existingActions ?? [])
        .map((a) => a.source_id as string)
        .filter((sid) => sid !== null)
    );

    const results: Array<{
      invoiceId: string;
      invoiceNumber: string;
      clientId: string;
      clientName: string;
      clientEmail: string;
      projectId: string | null;
      projectTitle: string;
      balanceDue: number;
      total: number;
      dueDate: string;
      daysOverdue: number;
      reminderLevel: number;
      paymentTerms: string | null;
    }> = [];

    for (const inv of filtered) {
      const invoiceId = inv.id as string;
      const clientId = inv.client_id as string;
      const client = clientMap.get(clientId);
      if (!client?.email) continue; // Can't send reminder without email

      const dueDate = new Date(inv.due_date as string);
      const daysOverdue = Math.floor(
        (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const level = getReminderLevel(
        daysOverdue,
        settings.reminder_days,
        settings.max_reminders
      );
      if (level === null) continue;

      // Check if this level was already sent
      const sourceId = `${invoiceId}:reminder:${level}`;
      if (sentReminders.has(sourceId)) continue;

      const projectId = (inv.project_id as string) ?? null;

      results.push({
        invoiceId,
        invoiceNumber: inv.invoice_number as string,
        clientId,
        clientName: client.name,
        clientEmail: client.email,
        projectId,
        projectTitle: projectId
          ? (projectMap.get(projectId) ?? "Untitled Project")
          : "N/A",
        balanceDue: Number(inv.balance_due ?? 0),
        total: Number(inv.total ?? 0),
        dueDate: inv.due_date as string,
        daysOverdue,
        reminderLevel: level,
        paymentTerms: (inv.payment_terms as string) ?? null,
      });
    }

    return results;
  },

  /**
   * Generate a reminder email draft and propose it via the approval queue.
   */
  async generateReminder(
    companyId: string,
    userId: string,
    invoice: {
      invoiceId: string;
      invoiceNumber: string;
      clientId: string;
      clientEmail: string;
      clientName: string;
      projectId: string | null;
      projectTitle: string;
      balanceDue: number;
      total: number;
      dueDate: string;
      daysOverdue: number;
      reminderLevel: number;
      paymentTerms: string | null;
    },
    settings: PaymentReminderSettings
  ): Promise<string | null> {
    const supabase = requireSupabase();
    const tiers = buildTiers(settings.reminder_days);
    const tier = tiers[invoice.reminderLevel - 1];
    if (!tier) return null;

    const locale = await getCompanyLocale(companyId);

    // Build the draft instruction with full context. The instruction
    // itself is English because it is consumed by GPT, not the client.
    const dueDateStr = formatDueDate(invoice.dueDate, locale);
    const amountStr = formatAmount(invoice.balanceDue, locale);
    const totalStr = formatAmount(invoice.total, locale);
    const contextInstruction = `${tier.instruction}

Key details to include:
- Invoice number: ${invoice.invoiceNumber}
- Original amount: ${totalStr}
- Balance due: ${amountStr}
- Due date: ${dueDateStr} (${invoice.daysOverdue} days overdue)
- Payment terms: ${invoice.paymentTerms ?? "NET-30"}
- Client name: ${invoice.clientName}
- Write the email in ${locale === "es" ? "Spanish" : "English"} so the client can read it in their preferred language.`;

    // Find email connection once (used for both draft generation and action_data)
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1);

    const emailConnectionId = (connRows?.[0]?.id as string) ?? null;

    // Generate the draft via AI
    let draftText: string;
    let draftHistoryId: string | null = null;
    const fallback = await buildFallbackDraft(tier, invoice, locale);
    try {
      const { AIDraftService } = await import("./ai-draft-service");

      if (emailConnectionId) {
        const result = await AIDraftService.generateDraft({
          companyId,
          userId,
          connectionId: emailConnectionId,
          recipientEmail: invoice.clientEmail,
          recipientName: invoice.clientName,
          userInstruction: contextInstruction,
          profileTypeOverride: "client_followup",
        });

        draftText = result.available ? result.draft : fallback;
        draftHistoryId = result.draftHistoryId || null;
      } else {
        draftText = fallback;
      }
    } catch (err) {
      console.error("[payment-reminder] Draft generation failed:", err);
      draftText = fallback;
    }

    // Subject is rendered server-side in the company's locale so the
    // email that actually lands in the client's inbox matches the
    // fallback body language when GPT is unavailable.
    const subject = await renderServerString(
      locale,
      "server-emails",
      tier.subjectKey,
      {
        invoiceNumber: invoice.invoiceNumber,
        days: invoice.daysOverdue,
      }
    );

    if (emailConnectionId) {
      draftHistoryId = await ensureApprovalDraftHistory({
        draftHistoryId,
        companyId,
        userId,
        connectionId: emailConnectionId,
        originalDraft: draftText,
        subject,
        profileType: "client_followup",
        atProposal: true,
      });
    }

    // Fetch payment history summary for the approval card
    let paymentSummary: SendPaymentReminderActionData["payment_summary"];
    try {
      const history = await this.getClientPaymentHistory(
        companyId,
        invoice.clientId
      );
      paymentSummary = {
        on_time_rate: history.onTimeRate,
        avg_days_to_pay: history.avgDaysToPayment,
        total_invoices: history.totalInvoices,
        currently_overdue: history.currentlyOverdue,
      };
    } catch {
      // Non-critical — card will just not show the history section
    }

    const actionData: SendPaymentReminderActionData = {
      invoice_id: invoice.invoiceId,
      invoice_number: invoice.invoiceNumber,
      client_id: invoice.clientId,
      client_email: invoice.clientEmail,
      client_name: invoice.clientName,
      project_title: invoice.projectTitle,
      balance_due: invoice.balanceDue,
      days_overdue: invoice.daysOverdue,
      reminder_level: invoice.reminderLevel,
      reminder_tone: tier.tone,
      subject,
      draft_text: draftText,
      original_draft_text: draftText,
      connection_id: emailConnectionId ?? "",
      draft_history_id: draftHistoryId,
      payment_summary: paymentSummary,
    };

    const priority: AgentActionPriority =
      invoice.daysOverdue > 30 ? "high" : "normal";

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_payment_reminder",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: `Payment reminder #${invoice.reminderLevel} for ${invoice.clientName} — Invoice #${invoice.invoiceNumber}, $${invoice.balanceDue.toFixed(2)} overdue ${invoice.daysOverdue} days`,
      contextSource: "overdue_invoice",
      sourceId: `${invoice.invoiceId}:reminder:${invoice.reminderLevel}`,
      confidence: 0.8,
      priority,
    });
  },

  /**
   * Main scheduler entry point — called by the cron job.
   * Detects overdue invoices and proposes reminders (max 10 per company per run).
   */
  async scheduleReminders(companyId: string): Promise<number> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return 0;

    const settings = await getReminderSettings(companyId);
    if (!settings.enabled) return 0;

    // Skip if today is weekend and settings say so
    if (settings.skip_weekends && isWeekend(new Date())) return 0;

    const adminUserId = await getCompanyAdminUserId(companyId);
    if (!adminUserId) return 0;

    const overdueInvoices = await this.detectOverdueInvoices(
      companyId,
      settings
    );
    if (overdueInvoices.length === 0) return 0;

    // Rate limit: max 10 reminders per company per cron run
    const toProcess = overdueInvoices.slice(0, 10);
    let proposed = 0;

    for (const invoice of toProcess) {
      try {
        const actionId = await this.generateReminder(
          companyId,
          adminUserId,
          invoice,
          settings
        );
        if (actionId) proposed++;
      } catch (err) {
        console.error(
          `[payment-reminder] Failed for invoice ${invoice.invoiceNumber}:`,
          err
        );
      }
    }

    return proposed;
  },

  /**
   * Get comprehensive payment history for a client.
   */
  async getClientPaymentHistory(
    companyId: string,
    clientId: string
  ): Promise<ClientPaymentHistory> {
    const supabase = requireSupabase();

    // Fetch client name (scoped to company)
    const { data: client } = await supabase
      .from("clients")
      .select("name")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .single();

    const clientName = (client?.name as string) ?? "Unknown Client";

    // Fetch all invoices for this client (last 24 months for relevance)
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 24);

    const { data: invoices } = await supabase
      .from("invoices")
      .select(
        "id, invoice_number, total, balance_due, due_date, status, paid_at, issue_date"
      )
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .gte("issue_date", cutoff.toISOString())
      .order("issue_date", { ascending: false });

    if (!invoices || invoices.length === 0) {
      return {
        clientId,
        clientName,
        totalInvoices: 0,
        paidOnTime: 0,
        paidLate: 0,
        currentlyOverdue: 0,
        totalOutstanding: 0,
        avgDaysToPayment: null,
        onTimeRate: 1,
        recentInvoices: [],
      };
    }

    const today = new Date();
    let paidOnTime = 0;
    let paidLate = 0;
    let currentlyOverdue = 0;
    let totalOutstanding = 0;
    const daysToPayments: number[] = [];

    const recentInvoices: ClientPaymentHistory["recentInvoices"] = [];

    for (const inv of invoices) {
      const dueDate = new Date(inv.due_date as string);
      const paidAt = inv.paid_at ? new Date(inv.paid_at as string) : null;
      const status = inv.status as string;
      const balanceDue = Number(inv.balance_due ?? 0);

      let daysLate: number | null = null;

      if (paidAt) {
        const daysToPayment = Math.floor(
          (paidAt.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        daysToPayments.push(
          Math.floor(
            (paidAt.getTime() - new Date(inv.issue_date as string).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        );
        if (daysToPayment > 0) {
          paidLate++;
          daysLate = daysToPayment;
        } else {
          paidOnTime++;
        }
      } else if (
        ["sent", "awaiting_payment", "partially_paid", "past_due"].includes(
          status
        ) &&
        dueDate < today
      ) {
        currentlyOverdue++;
        totalOutstanding += balanceDue;
        daysLate = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      // Collect last 6 for display
      if (recentInvoices.length < 6) {
        recentInvoices.push({
          invoiceNumber: inv.invoice_number as string,
          total: Number(inv.total ?? 0),
          dueDate: inv.due_date as string,
          status,
          paidDate: paidAt ? paidAt.toISOString() : null,
          daysLate,
        });
      }
    }

    const totalPaid = paidOnTime + paidLate;
    const avgDaysToPayment =
      daysToPayments.length > 0
        ? Math.round(
            daysToPayments.reduce((s, d) => s + d, 0) / daysToPayments.length
          )
        : null;

    return {
      clientId,
      clientName,
      totalInvoices: invoices.length,
      paidOnTime,
      paidLate,
      currentlyOverdue,
      totalOutstanding,
      avgDaysToPayment,
      onTimeRate: totalPaid > 0 ? paidOnTime / totalPaid : 1,
      recentInvoices,
    };
  },

  /**
   * Flag clients with repeated late payments.
   * Stores facts in agent_memories and proposes health alerts to the admin.
   */
  async flagRepeatLatePayors(companyId: string): Promise<number> {
    // Gate behind phase_c
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) return 0;

    const settings = await getReminderSettings(companyId);
    const adminUserId = await getCompanyAdminUserId(companyId);
    if (!adminUserId) return 0;

    const supabase = requireSupabase();
    const threshold = settings.late_payment_threshold / 100;

    // Get clients with at least 2 invoices in the last 12 months
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);

    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, client_id, total, balance_due, due_date, status, paid_at")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .gte("issue_date", cutoff.toISOString());

    if (!invoices || invoices.length === 0) return 0;

    // Group by client
    const clientInvoices = new Map<string, typeof invoices>();
    for (const inv of invoices) {
      const clientId = inv.client_id as string;
      if (!clientInvoices.has(clientId)) {
        clientInvoices.set(clientId, []);
      }
      clientInvoices.get(clientId)!.push(inv);
    }

    const today = new Date();
    let flagged = 0;

    for (const [clientId, invs] of clientInvoices) {
      if (invs.length < 2) continue;

      let latePaid = 0;
      let totalPaid = 0;
      let overdueCount = 0;
      let totalOverdueAmount = 0;

      for (const inv of invs) {
        const dueDate = new Date(inv.due_date as string);
        const paidAt = inv.paid_at ? new Date(inv.paid_at as string) : null;
        const status = inv.status as string;

        if (paidAt) {
          totalPaid++;
          if (paidAt > dueDate) latePaid++;
        } else if (
          ["sent", "awaiting_payment", "partially_paid", "past_due"].includes(
            status
          ) &&
          dueDate < today
        ) {
          overdueCount++;
          totalOverdueAmount += Number(inv.balance_due ?? 0);
        }
      }

      const lateRate = totalPaid > 0 ? latePaid / totalPaid : 0;
      const shouldFlag = lateRate > threshold || overdueCount >= 2;

      if (!shouldFlag) continue;

      // Check if already flagged recently (within 7 days)
      const sourceId = `${clientId}:health`;
      const { data: existing } = await supabase
        .from("agent_actions")
        .select("id, created_at")
        .eq("company_id", companyId)
        .eq("action_type", "client_health_alert")
        .eq("source_id", sourceId)
        .in("status", ["pending", "approved", "executed"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const lastCreated = new Date(existing[0].created_at as string);
        const daysSince =
          (today.getTime() - lastCreated.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) continue; // Already flagged recently
      }

      // Get client name
      const { data: client } = await supabase
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .single();

      const clientName = (client?.name as string) ?? "Unknown Client";

      // Store a fact in agent_memories for future draft context.
      // Check for existing memory first to avoid duplicates (no unique constraint on these cols).
      try {
        const factContent = `Client ${clientName} has a late payment rate of ${Math.round(lateRate * 100)}%. ${latePaid} invoices paid late out of ${totalPaid}. Currently ${overdueCount} overdue.`;

        // Check if a similar memory already exists for this client
        const { data: existingMemory } = await supabase
          .from("agent_memories")
          .select("id")
          .eq("company_id", companyId)
          .eq("memory_type", "fact")
          .eq("category", "client_preference")
          .ilike("content", `%Client ${clientName} has a late payment rate%`)
          .limit(1);

        if (existingMemory && existingMemory.length > 0) {
          // Update existing memory with fresh data
          await supabase
            .from("agent_memories")
            .update({
              content: factContent,
              confidence: 1.0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingMemory[0].id as string);
        } else {
          await supabase.from("agent_memories").insert({
            company_id: companyId,
            memory_type: "fact",
            category: "client_preference",
            content: factContent,
            confidence: 1.0,
            source: "database",
          });
        }
      } catch {
        // Non-critical — don't block on memory storage
      }

      // Propose health alert
      await ApprovalQueueService.proposeAction({
        companyId,
        userId: adminUserId,
        actionType: "client_health_alert",
        actionData: {
          client_id: clientId,
          client_name: clientName,
          late_rate: lateRate,
          overdue_count: overdueCount,
          total_overdue_amount: totalOverdueAmount,
        },
        contextSummary: `${clientName} has ${Math.round(lateRate * 100)}% late payment rate — ${overdueCount} currently overdue ($${totalOverdueAmount.toFixed(2)})`,
        contextSource: "payment_analysis",
        sourceId,
        confidence: 1.0,
        priority: overdueCount >= 3 ? "urgent" : "high",
      });

      flagged++;
    }

    return flagged;
  },

  /** Exported for settings UI */
  getReminderSettings,
  DEFAULT_REMINDER_SETTINGS,
};

// ─── Fallback Draft Templates ──────────────────────────────────────────────

async function buildFallbackDraft(
  tier: ReminderTier,
  invoice: {
    invoiceNumber: string;
    clientName: string;
    balanceDue: number;
    total: number;
    dueDate: string;
    daysOverdue: number;
    paymentTerms: string | null;
  },
  locale: Locale
): Promise<string> {
  return renderServerString(locale, "server-emails", tier.fallbackKey, {
    clientName: invoice.clientName,
    invoiceNumber: invoice.invoiceNumber,
    amount: formatAmount(invoice.balanceDue, locale),
    dueDate: formatDueDate(invoice.dueDate, locale),
    daysOverdue: invoice.daysOverdue,
  });
}
