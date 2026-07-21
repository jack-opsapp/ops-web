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
import { renderServerString } from "@/i18n/server-render";
import { resolveCompanyEmailConversationConnectionId } from "@/lib/email/email-connection-selection";
import type { Locale } from "@/i18n/types";
import type {
  ReminderTone,
  SendPaymentReminderActionData,
  ClientPaymentHistory,
  AgentActionPriority,
  PaymentReminderPreset,
} from "@/lib/types/approval-queue";
import { DEFAULT_CLIENT_COMMS_SETTINGS } from "@/lib/types/approval-queue";

// ─── Locale-aware helpers ───────────────────────────────────────────────────

/** Format a date in the company's locale (long month, numeric day+year). */
function formatDueDate(dueDate: string, locale: Locale): string {
  const bcp47 = locale === "es" ? "es-ES" : "en-US";
  return new Date(dueDate).toLocaleDateString(bcp47, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function localDateISO(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateOnlyDistance(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toTime - fromTime) / (1000 * 60 * 60 * 24));
}

function normalizeTimeZone(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    throw new Error("Missing company timezone for payment reminders");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    throw new Error("Invalid company timezone for payment reminders");
  }
}

function normalizeClientEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Format a money amount with currency symbol in the company's locale. */
function formatAmount(
  amount: number,
  locale: Locale,
  currencyCode: string
): string {
  const bcp47 = locale === "es" ? "es-ES" : "en-US";
  return new Intl.NumberFormat(bcp47, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─── Reminder Settings ─────────────────────────────────────────────────────

export interface PaymentReminderSettings {
  enabled: boolean;
  reminder_days: [number, number, number, number];
  max_reminders: number;
  currency_code: string;
  locale: Locale;
  timezone: string;
  /** Exact persisted reminder object fenced again before provider delivery. */
  source_snapshot?: Record<string, unknown>;
}

const DEFAULT_REMINDER_SETTINGS: PaymentReminderSettings = {
  enabled: DEFAULT_CLIENT_COMMS_SETTINGS.payment_reminder.enabled,
  reminder_days: [
    ...DEFAULT_CLIENT_COMMS_SETTINGS.payment_reminder.custom_days,
  ],
  max_reminders: DEFAULT_CLIENT_COMMS_SETTINGS.payment_reminder.max_reminders,
  currency_code: "CAD",
  locale: "en",
  timezone: "America/Vancouver",
};

const REMINDER_PRESET_DAYS: Record<
  Exclude<PaymentReminderPreset, "custom">,
  [number, number, number, number]
> = {
  standard: [7, 14, 30, 45],
  gentle: [14, 30, 45, 60],
  aggressive: [3, 7, 14, 30],
};

const REPEAT_LATE_PAYMENT_THRESHOLD = 0.5;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentReminderBlockedReason =
  | "feature_disabled"
  | "reminders_disabled"
  | "mailbox_required"
  | "client_email_required";

export interface QueueProjectReminderResult {
  eligibleCount: number;
  queuedCount: number;
  alreadyQueuedCount: number;
  failedCount: number;
  clientEmailBlockedCount?: number;
  blockedReason?: PaymentReminderBlockedReason;
}

export class PaymentReminderMailboxRequiredError extends Error {
  constructor() {
    super("A company mailbox must be connected before reminders can be queued");
    this.name = "PaymentReminderMailboxRequiredError";
  }
}

export class PaymentReminderGenerationInProgressError extends Error {
  constructor() {
    super("Payment reminder generation is already in progress");
    this.name = "PaymentReminderGenerationInProgressError";
  }
}

async function getReminderSettings(
  companyId: string,
  _options: { throwOnError?: boolean } = {}
): Promise<PaymentReminderSettings> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("companies")
    .select("client_comms_settings,currency_code,locale,timezone")
    .eq("id", companyId)
    .single();
  if (error) {
    throw new Error("Failed to load reminder settings: " + error.message);
  }
  if (!data) {
    throw new Error("Failed to load reminder settings: company not found");
  }

  const settings =
    (data?.client_comms_settings as Record<string, unknown>) ?? {};
  const rawReminder = settings.payment_reminder;
  if (
    rawReminder != null &&
    (typeof rawReminder !== "object" || Array.isArray(rawReminder))
  ) {
    throw new Error("Invalid company payment reminder settings");
  }
  const reminder = rawReminder as Record<string, unknown> | undefined;
  const rawCurrency = String(data?.currency_code ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(rawCurrency)) {
    throw new Error("Invalid company currency for payment reminders");
  }
  const currencyCode = rawCurrency;
  if (!reminder) {
    return {
      ...DEFAULT_REMINDER_SETTINGS,
      currency_code: currencyCode,
      locale: data?.locale === "es" ? "es" : "en",
      timezone: normalizeTimeZone(data?.timezone),
      source_snapshot: {},
    };
  }

  const preset: PaymentReminderPreset = [
    "standard",
    "gentle",
    "aggressive",
    "custom",
  ].includes(String(reminder.preset))
    ? (reminder.preset as PaymentReminderPreset)
    : DEFAULT_CLIENT_COMMS_SETTINGS.payment_reminder.preset;
  const rawCustomDays =
    Array.isArray(reminder.custom_days) &&
    reminder.custom_days.every(
      (day) =>
        typeof day === "number" && Number.isFinite(day) && Number.isInteger(day)
    )
      ? reminder.custom_days
          .map((day) => Math.min(180, Math.max(1, day as number)))
          .sort((a, b) => a - b)
      : [];
  const customDays: [number, number, number, number] =
    rawCustomDays.length === 4 &&
    rawCustomDays.every(
      (day, index) => index === 0 || day > rawCustomDays[index - 1]
    )
      ? (rawCustomDays as [number, number, number, number])
      : [...DEFAULT_CLIENT_COMMS_SETTINGS.payment_reminder.custom_days];
  const reminderDays =
    preset === "custom" ? customDays : REMINDER_PRESET_DAYS[preset];

  return {
    enabled:
      typeof reminder.enabled === "boolean"
        ? reminder.enabled
        : DEFAULT_REMINDER_SETTINGS.enabled,
    reminder_days: [...reminderDays],
    max_reminders: Math.trunc(
      Math.min(
        4,
        Math.max(
          1,
          Number(reminder.max_reminders) ||
            DEFAULT_REMINDER_SETTINGS.max_reminders
        )
      )
    ),
    currency_code: currencyCode,
    locale: data?.locale === "es" ? "es" : "en",
    timezone: normalizeTimeZone(data?.timezone),
    source_snapshot: { ...reminder },
  };
}

async function resolveCompanyReminderConnectionId(
  companyId: string
): Promise<string | null> {
  return resolveCompanyEmailConversationConnectionId({
    supabase: requireSupabase(),
    companyId,
  });
}

async function claimReminderGeneration(
  companyId: string,
  sourceId: string
): Promise<{
  acquired: boolean;
  token: string | null;
  reason: "existing_action" | "generation_in_progress" | null;
}> {
  const { data, error } = await requireSupabase().rpc(
    "claim_payment_reminder_generation",
    {
      p_company_id: companyId,
      p_source_id: sourceId,
    }
  );
  if (error) {
    throw new Error(`Failed to claim reminder generation: ${error.message}`);
  }
  const result = data as Record<string, unknown> | null;
  return {
    acquired: result?.acquired === true,
    token: typeof result?.claim_token === "string" ? result.claim_token : null,
    reason:
      result?.reason === "existing_action" ||
      result?.reason === "generation_in_progress"
        ? result.reason
        : null,
  };
}

async function releaseReminderGeneration(
  companyId: string,
  sourceId: string,
  claimToken: string
): Promise<void> {
  const { error } = await requireSupabase().rpc(
    "release_payment_reminder_generation",
    {
      p_company_id: companyId,
      p_source_id: sourceId,
      p_claim_token: claimToken,
    }
  );
  if (error) {
    console.error(
      "[payment-reminder] Failed to release generation claim:",
      error.message
    );
  }
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

// ─── Service ───────────────────────────────────────────────────────────────

export const PaymentReminderService = {
  /**
   * Detect overdue invoices that need a new reminder at their current tier.
   * Returns only invoices where the tier has advanced since last reminder sent.
   */
  async detectOverdueInvoices(
    companyId: string,
    settings: PaymentReminderSettings,
    options: {
      includeAlreadyQueued?: boolean;
      throwOnError?: boolean;
      projectId?: string;
      includeBlocked?: boolean;
      forceFirstTierForOverdue?: boolean;
    } = {}
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
      updatedAt: string;
      daysOverdue: number;
      reminderLevel: number;
      paymentTerms: string | null;
      existingActionStatus?: "queued" | null;
      blockedReason?: "client_email_required";
    }>
  > {
    const supabase = requireSupabase();

    const todayIso = localDateISO(new Date(), settings.timezone);

    // Query overdue invoices
    let invoiceQuery = supabase
      .from("invoices")
      .select(
        "id, invoice_number, client_id, project_id, project_ref, balance_due, total, due_date, status, payment_terms, updated_at"
      )
      .eq("company_id", companyId)
      .in("status", ["sent", "awaiting_payment", "partially_paid", "past_due"])
      .gt("balance_due", 0)
      .lt("due_date", todayIso)
      .is("deleted_at", null);
    if (options.projectId) {
      if (!UUID_PATTERN.test(options.projectId)) {
        throw new Error("Invalid project ID for payment reminder detection");
      }
      invoiceQuery = invoiceQuery.or(
        `project_ref.eq.${options.projectId},and(project_ref.is.null,project_id.eq.${options.projectId})`
      );
    }
    const { data: invoices, error } = await invoiceQuery.order("due_date", {
      ascending: true,
    });

    if (error) {
      if (options.throwOnError) {
        throw new Error("Failed to fetch overdue invoices: " + error.message);
      }
      console.error(
        "[payment-reminder] Failed to fetch overdue invoices:",
        error.message
      );
      return [];
    }
    if (!invoices || invoices.length === 0) return [];

    const filtered = invoices;

    // Batch fetch client info
    const clientIds = [
      ...new Set(filtered.map((inv) => inv.client_id as string)),
    ];
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, email")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .is("merged_into_client_id", null)
      .in("id", clientIds);
    if (clientsError && options.throwOnError) {
      throw new Error(
        "Failed to fetch reminder clients: " + clientsError.message
      );
    }

    const clientMap = new Map(
      (clients ?? []).map((c) => [
        c.id as string,
        {
          name: (c.name as string) ?? "Unknown",
          email: normalizeClientEmail(c.email),
        },
      ])
    );

    // Batch fetch project titles
    const projectIds = [
      ...new Set(
        filtered
          .map(
            (inv) =>
              (inv.project_ref as string | null) ??
              (inv.project_id as string | null)
          )
          .filter((id): id is string => id !== null)
      ),
    ];
    const projectMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("id, title")
        .eq("company_id", companyId)
        .in("id", projectIds);
      if (projectsError && options.throwOnError) {
        throw new Error(
          "Failed to fetch reminder projects: " + projectsError.message
        );
      }

      for (const p of projects ?? []) {
        projectMap.set(
          p.id as string,
          (p.title as string) ?? "Untitled Project"
        );
      }
    }

    // Check existing reminders sent (from agent_actions)
    const { data: existingActions, error: existingActionsError } =
      await supabase
        .from("agent_actions")
        .select("source_id, status")
        .eq("company_id", companyId)
        .eq("action_type", "send_payment_reminder")
        .in("status", ["pending", "approved", "executed", "rejected"]);
    if (existingActionsError && options.throwOnError) {
      throw new Error(
        "Failed to fetch existing reminders: " + existingActionsError.message
      );
    }

    // A pending/approved proposal is still useful to the manual review flow:
    // it must report "already queued" rather than falsely claiming that no
    // reminder is due. Executed/rejected actions remain handled for the current
    // tier. Failed delivery can be proposed again after its failure is repaired.
    const queuedReminderSourceIds = new Set<string>();
    const handledReminderSourceIds = new Set<string>();
    for (const action of existingActions ?? []) {
      const sourceId = action.source_id as string | null;
      if (!sourceId) continue;
      const status = action.status as string;
      if (status === "pending" || status === "approved") {
        queuedReminderSourceIds.add(sourceId);
      } else {
        handledReminderSourceIds.add(sourceId);
      }
    }

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
      updatedAt: string;
      daysOverdue: number;
      reminderLevel: number;
      paymentTerms: string | null;
      existingActionStatus?: "queued" | null;
      blockedReason?: "client_email_required";
    }> = [];

    for (const inv of filtered) {
      const invoiceId = inv.id as string;
      const clientId = inv.client_id as string;
      const client = clientMap.get(clientId);

      const daysOverdue = dateOnlyDistance(inv.due_date as string, todayIso);

      let level = getReminderLevel(
        daysOverdue,
        settings.reminder_days,
        settings.max_reminders
      );
      if (
        level === null &&
        options.forceFirstTierForOverdue &&
        daysOverdue > 0
      ) {
        // A deliberate operator swipe is not an automated schedule. Once an
        // invoice is actually overdue, queue the first reviewable reminder
        // instead of exposing an iOS action that can only return "not due."
        level = 1;
      }
      if (level === null) continue;
      if (!client?.email && !options.includeBlocked) continue;

      // Check whether this tier is already in flight or has been handled.
      const sourceId = `${invoiceId}:reminder:${level}`;
      const isQueued = queuedReminderSourceIds.has(sourceId);
      if (handledReminderSourceIds.has(sourceId) && !isQueued) continue;
      if (isQueued && !options.includeAlreadyQueued) continue;

      const projectId =
        (inv.project_ref as string | null) ??
        (inv.project_id as string | null) ??
        null;

      results.push({
        invoiceId,
        invoiceNumber: inv.invoice_number as string,
        clientId,
        clientName: client?.name ?? "Unknown",
        clientEmail: client?.email ?? "",
        projectId,
        projectTitle: projectId
          ? (projectMap.get(projectId) ?? "Untitled Project")
          : "N/A",
        balanceDue: Number(inv.balance_due ?? 0),
        total: Number(inv.total ?? 0),
        dueDate: inv.due_date as string,
        updatedAt: inv.updated_at as string,
        daysOverdue,
        reminderLevel: level,
        paymentTerms: (inv.payment_terms as string) ?? null,
        existingActionStatus: isQueued ? "queued" : null,
        blockedReason: client?.email ? undefined : "client_email_required",
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
      updatedAt: string;
      daysOverdue: number;
      reminderLevel: number;
      paymentTerms: string | null;
    },
    settings: PaymentReminderSettings,
    providedConnectionId?: string
  ): Promise<string | null> {
    const supabase = requireSupabase();
    const tiers = buildTiers(settings.reminder_days);
    const tier = tiers[invoice.reminderLevel - 1];
    if (!tier) return null;

    const emailConnectionId =
      providedConnectionId ??
      (await resolveCompanyReminderConnectionId(companyId));
    if (!emailConnectionId) {
      throw new PaymentReminderMailboxRequiredError();
    }

    const sourceId = `${invoice.invoiceId}:reminder:${invoice.reminderLevel}`;
    const claim = await claimReminderGeneration(companyId, sourceId);
    if (!claim.acquired) {
      if (claim.reason === "existing_action") return null;
      throw new PaymentReminderGenerationInProgressError();
    }
    if (!claim.token) {
      throw new Error("Payment reminder claim returned no token");
    }

    try {
      const locale = settings.locale;

      // Build the draft instruction with full context. The instruction
      // itself is English because it is consumed by GPT, not the client.
      const dueDateStr = formatDueDate(invoice.dueDate, locale);
      const amountStr = formatAmount(
        invoice.balanceDue,
        locale,
        settings.currency_code
      );
      const totalStr = formatAmount(
        invoice.total,
        locale,
        settings.currency_code
      );
      const contextInstruction = `${tier.instruction}

Key details to include:
- Invoice number: ${invoice.invoiceNumber}
- Original amount: ${totalStr}
- Balance due: ${amountStr}
- Due date: ${dueDateStr} (${invoice.daysOverdue} days overdue)
- Payment terms: ${invoice.paymentTerms ?? "NET-30"}
- Client name: ${invoice.clientName}
- Write the email in ${locale === "es" ? "Spanish" : "English"} so the client can read it in their preferred language.`;

      // Generate the draft via AI
      let draftText: string;
      let draftHistoryId: string | null = null;
      const fallback = await buildFallbackDraft(
        tier,
        invoice,
        locale,
        settings.currency_code
      );
      try {
        const { AIDraftService } = await import("./ai-draft-service");

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
        currency_code: settings.currency_code,
        company_locale: settings.locale,
        company_timezone: settings.timezone,
        payment_reminder_settings_snapshot: settings.source_snapshot ?? {},
        due_date: invoice.dueDate,
        invoice_updated_at: invoice.updatedAt,
        days_overdue: invoice.daysOverdue,
        reminder_level: invoice.reminderLevel,
        reminder_tone: tier.tone,
        subject,
        draft_text: draftText,
        original_draft_text: draftText,
        connection_id: emailConnectionId,
        draft_history_id: draftHistoryId,
        payment_summary: paymentSummary,
      };

      const priority: AgentActionPriority =
        invoice.daysOverdue > 30 ? "high" : "normal";

      return await ApprovalQueueService.proposeAction({
        companyId,
        userId,
        actionType: "send_payment_reminder",
        actionData: actionData as unknown as Record<string, unknown>,
        contextSummary: `Payment reminder #${invoice.reminderLevel} for ${invoice.clientName} — Invoice #${invoice.invoiceNumber}, ${formatAmount(invoice.balanceDue, locale, settings.currency_code)} overdue ${invoice.daysOverdue} days`,
        contextSource: "overdue_invoice",
        sourceId,
        confidence: 0.8,
        priority,
      });
    } finally {
      await releaseReminderGeneration(companyId, sourceId, claim.token);
    }
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

    const adminUserId = await getCompanyAdminUserId(companyId);
    if (!adminUserId) return 0;

    const overdueInvoices = await this.detectOverdueInvoices(
      companyId,
      settings
    );
    if (overdueInvoices.length === 0) return 0;

    const emailConnectionId =
      await resolveCompanyReminderConnectionId(companyId);
    if (!emailConnectionId) {
      console.error(
        `[payment-reminder] Company ${companyId} has no active company mailbox`
      );
      return 0;
    }

    // Rate limit: max 10 reminders per company per cron run
    const toProcess = overdueInvoices.slice(0, 10);
    let proposed = 0;

    for (const invoice of toProcess) {
      try {
        const actionId = await this.generateReminder(
          companyId,
          adminUserId,
          invoice,
          settings,
          emailConnectionId
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
   * Queue the reminder drafts currently due for one project.
   *
   * This is the manual Payment Review entry point. It deliberately reuses the
   * detector, escalation tiers, localized draft generator, dedupe key, and
   * approval queue used by the scheduled sweep. A deliberate swipe can start
   * tier one as soon as debt is overdue; later tiers still follow company
   * settings. It creates a reviewable draft and never claims delivery.
   */
  async queueProjectReminders(
    companyId: string,
    userId: string,
    projectId: string
  ): Promise<QueueProjectReminderResult> {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) {
      return {
        eligibleCount: 0,
        queuedCount: 0,
        alreadyQueuedCount: 0,
        failedCount: 0,
        clientEmailBlockedCount: 0,
        blockedReason: "feature_disabled",
      };
    }

    const settings = await getReminderSettings(companyId, {
      throwOnError: true,
    });
    if (!settings.enabled) {
      return {
        eligibleCount: 0,
        queuedCount: 0,
        alreadyQueuedCount: 0,
        failedCount: 0,
        clientEmailBlockedCount: 0,
        blockedReason: "reminders_disabled",
      };
    }

    const eligible = (
      await this.detectOverdueInvoices(companyId, settings, {
        includeAlreadyQueued: true,
        throwOnError: true,
        projectId,
        includeBlocked: true,
        forceFirstTierForOverdue: true,
      })
    ).filter((invoice) => invoice.projectId === projectId);

    let queuedCount = 0;
    let alreadyQueuedCount = 0;
    let failedCount = 0;
    const clientEmailBlockedCount = eligible.filter(
      (invoice) => invoice.blockedReason === "client_email_required"
    ).length;
    const needsGeneration = eligible.some(
      (invoice) =>
        invoice.existingActionStatus !== "queued" && !invoice.blockedReason
    );
    const emailConnectionId = needsGeneration
      ? await resolveCompanyReminderConnectionId(companyId)
      : null;
    if (needsGeneration && !emailConnectionId) {
      return {
        eligibleCount: eligible.length,
        queuedCount: 0,
        alreadyQueuedCount: eligible.filter(
          (invoice) => invoice.existingActionStatus === "queued"
        ).length,
        failedCount: 0,
        clientEmailBlockedCount,
        blockedReason: "mailbox_required",
      };
    }

    for (const invoice of eligible) {
      if (invoice.existingActionStatus === "queued") {
        alreadyQueuedCount += 1;
      }
      if (
        invoice.existingActionStatus === "queued" ||
        invoice.blockedReason === "client_email_required"
      ) {
        continue;
      }
      try {
        const actionId = await this.generateReminder(
          companyId,
          userId,
          invoice,
          settings,
          emailConnectionId ?? undefined
        );
        if (actionId) {
          queuedCount += 1;
        } else {
          // A concurrent request may have claimed or inserted this proposal
          // after detection. The durable source identity remains single-use.
          alreadyQueuedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        console.error(
          `[payment-reminder] Failed for invoice ${invoice.invoiceNumber}:`,
          error
        );
      }
    }

    return {
      eligibleCount: eligible.length,
      queuedCount,
      alreadyQueuedCount,
      failedCount,
      clientEmailBlockedCount,
      blockedReason:
        clientEmailBlockedCount === eligible.length &&
        queuedCount === 0 &&
        alreadyQueuedCount === 0
          ? "client_email_required"
          : undefined,
    };
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
    const threshold = REPEAT_LATE_PAYMENT_THRESHOLD;

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
  locale: Locale,
  currencyCode: string
): Promise<string> {
  return renderServerString(locale, "server-emails", tier.fallbackKey, {
    clientName: invoice.clientName,
    invoiceNumber: invoice.invoiceNumber,
    amount: formatAmount(invoice.balanceDue, locale, currencyCode),
    dueDate: formatDueDate(invoice.dueDate, locale),
    daysOverdue: invoice.daysOverdue,
  });
}
