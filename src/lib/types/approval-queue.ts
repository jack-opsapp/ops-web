/**
 * OPS Web — Approval Queue Types
 *
 * Types for agent-proposed actions that require user approval.
 */

// ─── Action Types ─────────────────────────────────────────────────────────────

export type AgentActionType =
  | "create_project"
  | "create_task"
  | "create_invoice"
  | "send_email"
  | "send_status_email"
  | "send_invoice_email"
  | "send_payment_reminder"
  | "reassign_task"
  | "archive_project"
  | "client_health_alert"
  | "financial_insight"
  | "optimize_schedule"
  | "reschedule_tasks"
  | "send_appointment_confirmation"
  | "send_day_before_reminder"
  | "send_appointment_reminder"
  | "send_schedule_changed"
  | "send_subcontractor_coordination"
  | "process_reschedule_request";

export type AgentActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired"
  | "cancelled";

export type AgentActionPriority = "low" | "normal" | "high" | "urgent";

export type AgentActionContextSource =
  | "email_thread"
  | "schedule_gap"
  | "overdue_task"
  | "invoice_due"
  | "project_analysis"
  | "manual"
  | "project_lifecycle"
  | "overdue_detection"
  | "lifecycle_automation"
  | "stage_change"
  | "estimate_conversion"
  | "project_completion"
  | "milestone_billing"
  | "invoice_created"
  | "overdue_invoice"
  | "payment_analysis"
  | "financial_analysis"
  | "schedule_optimization"
  | "task_scheduled"
  | "day_before_reminder_cron"
  | "appointment_reminder_cron"
  | "inbound_email"
  | "subcontractor_coordination";

// ─── Create Project Payload ───────────────────────────────────────────────────

export interface CreateProjectActionData {
  title: string;
  client_id: string | null;
  address: string | null;
  scope: string | null;
  suggested_tasks: Array<{
    task_type_id?: string;
    title: string;
  }>;
  source_thread_id: string | null;
  source_opportunity_id: string | null;
}

// ─── Create Task Payload ─────────────────────────────────────────────────────

export interface CreateTaskActionData {
  project_id: string;
  project_name: string;
  task_type_id: string;
  task_type_name: string;
  custom_title: string;
  task_notes: string | null;
  task_color: string | null;
  suggested_team_member_id: string | null;
  suggested_team_member_name: string | null;
  suggested_start_date: string | null;
  suggested_end_date: string | null;
  suggested_duration: number | null;
  assignment_reason: string | null;
  company_id: string;
}

// ─── Send Status Email Payload ───────────────────────────────────────────

export interface SendStatusEmailActionData {
  project_id: string;
  project_title: string;
  client_id: string;
  client_name: string;
  client_email: string;
  subject: string;
  draft_text: string;
  connection_id: string;
  completion_percent: number;
  tasks_completed_since_last: number;
  upcoming_tasks: number;
  /**
   * ai_draft_history row ID created at proposal time. Threaded through
   * so the executor can call recordDraftOutcome() with the real ID and
   * compute edit distance against the AI's original draft. Null only
   * when the AI draft fallback was used (no history row created).
   */
  draft_history_id: string | null;
}

// ─── Reassign Task Payload ──────────────────────────────────────────────

export interface ReassignTaskActionData {
  task_id: string;
  task_title: string;
  project_id: string;
  project_title: string;
  current_team_member_id: string | null;
  current_team_member_name: string | null;
  suggested_team_member_id: string;
  suggested_team_member_name: string;
  new_start_date: string;
  new_end_date: string;
  overdue_days: number;
  assignment_reason: string;
}

// ─── Archive Project Payload ────────────────────────────────────────────

export interface ArchiveProjectActionData {
  project_id: string;
  project_title: string;
  completed_date: string | null;
  days_since_completion: number;
  total_tasks: number;
  completed_tasks: number;
  total_invoiced: number;
  outstanding_balance: number;
}

// ─── Invoice Warning (structured for i18n) ──────────────────────────────

export interface InvoiceWarning {
  type:
    | "high_value"
    | "duplicate_similar"
    | "price_deviation"
    | "no_client_email"
    | "no_payment_terms"
    | "zero_tax";
  params?: Record<string, string | number>;
}

// ─── Create Invoice Payload ──────────────────────────────────────────────

export interface CreateInvoiceActionData {
  estimate_id: string | null;
  project_id: string | null;
  client_id: string;
  client_name: string;
  project_title: string;
  line_items: Array<{
    name: string;
    description: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    type: "LABOR" | "MATERIAL";
    task_type_id: string | null;
    is_taxable: boolean;
    sort_order: number;
    category: string | null;
  }>;
  subtotal: number;
  discount_type: string | null;
  discount_value: number | null;
  discount_amount: number;
  tax_rate: number | null;
  tax_amount: number;
  total: number;
  payment_terms: string | null;
  due_date: string;
  notes: string | null;
  terms: string | null;
  cover_email: {
    to: string;
    subject: string;
    draft_text: string | null;
    connection_id: string | null;
  } | null;
  warnings: InvoiceWarning[];
}

// ─── Send Invoice Email Payload ─────────────────────────────────────────

export interface SendInvoiceEmailActionData {
  invoice_id: string;
  invoice_number: string;
  invoice_total: number;
  to_email: string;
  client_name: string;
  project_title: string;
  subject: string;
  draft_text: string;
  connection_id: string;
  attachments: Array<{
    type: string;
    invoice_id: string;
  }>;
  /**
   * ai_draft_history row ID created when the cover email was generated.
   * See SendStatusEmailActionData.draft_history_id for semantics.
   */
  draft_history_id: string | null;
}

// ─── Agent Action ─────────────────────────────────────────────────────────────

export interface AgentAction {
  id: string;
  companyId: string;
  userId: string;
  actionType: AgentActionType;
  actionData: Record<string, unknown>;
  contextSummary: string;
  contextSource: AgentActionContextSource | null;
  sourceId: string | null;
  confidence: number;
  priority: AgentActionPriority;
  status: AgentActionStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  executedAt: Date | null;
  executionResult: Record<string, unknown> | null;
  error: string | null;
  expiresAt: Date | null;
  /** When set, the action will be auto-approved + executed at this time
   *  unless the user rejects or cancels first. */
  autoExecuteAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service Params ───────────────────────────────────────────────────────────

export interface ProposeActionParams {
  companyId: string;
  userId: string;
  actionType: AgentActionType;
  actionData: Record<string, unknown>;
  contextSummary: string;
  contextSource?: AgentActionContextSource;
  sourceId?: string;
  confidence?: number;
  priority?: AgentActionPriority;
  expiresAt?: Date;
  /** If set, the action is auto-approved + executed by a cron at this time
   *  unless the user rejects/cancels first. Used by auto-send autonomy levels. */
  autoExecuteAt?: Date;
}

export interface QueueFilters {
  status?: AgentActionStatus;
  actionType?: AgentActionType;
  priority?: AgentActionPriority;
}

export interface QueueStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  avgResponseTimeMinutes: number | null;
}

// ─── Send Payment Reminder Payload ──────────────────────────────────────

export type ReminderTone = "friendly" | "firm" | "final" | "collections";

export interface SendPaymentReminderActionData {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  client_email: string;
  client_name: string;
  project_title: string;
  balance_due: number;
  days_overdue: number;
  reminder_level: number;
  reminder_tone: ReminderTone;
  subject: string;
  draft_text: string;
  /** Original AI-generated draft, preserved for edit distance calculation */
  original_draft_text: string;
  connection_id: string;
  /** Embedded payment history summary for display in the approval card */
  payment_summary?: {
    on_time_rate: number;
    avg_days_to_pay: number | null;
    total_invoices: number;
    currently_overdue: number;
  };
}

// ─── Client Health Alert Payload ────────────────────────────────────────

export interface ClientHealthAlertActionData {
  client_id: string;
  client_name: string;
  late_rate: number;
  overdue_count: number;
  total_overdue_amount: number;
}

// ─── Financial Alert (structured for i18n) ────────────────────────────────

export interface FinancialAlert {
  type: "low_cash" | "concentration_risk" | "aging_warning";
  params: Record<string, string | number>;
}

// ─── Financial Insight Payload ────────────────────────────────────────────

export interface FinancialInsightActionData {
  digest_type: "weekly_summary";
  revenue: {
    monthly_revenue: Array<{ month: string; amount: number }>;
    avg_monthly: number;
    pipeline_value: number;
    forecast: Array<{ month: string; projected: number }>;
    yoy_change: number | null;
  };
  cashflow: {
    outstanding: number;
    overdue: number;
    received_this_month: number;
    projection: Array<{
      period: string;
      expected: number;
      pipeline: number;
    }>;
    alerts: FinancialAlert[];
  };
  pricing: {
    service_analysis: Array<{
      service: string;
      win_rate: number;
      avg_win_price: number;
      avg_loss_price: number;
      suggestion: { type: "increase" | "decrease" | "neutral"; params: Record<string, number> };
    }>;
  };
  seasonal: {
    monthly_index: Array<{ month: string; index: number }>;
    peak_months: string[];
    slow_months: string[];
    service_patterns: Array<{
      service: string;
      peak_months: string[];
    }>;
  };
  alerts: FinancialAlert[];
  generated_at: string;
}

// ─── Financial Intelligence Settings ──────────────────────────────────────

export interface FinancialIntelligenceSettings {
  enabled: boolean;
  overdue_pct_threshold: number;
  concentration_pct_threshold: number;
  aging_days_threshold: number;
  aging_min_count: number;
  win_rate_increase_threshold: number;
  win_rate_decrease_threshold: number;
  min_estimates_for_analysis: number;
}

export const DEFAULT_FINANCIAL_SETTINGS: FinancialIntelligenceSettings = {
  enabled: true,
  overdue_pct_threshold: 30,
  concentration_pct_threshold: 40,
  aging_days_threshold: 60,
  aging_min_count: 3,
  win_rate_increase_threshold: 80,
  win_rate_decrease_threshold: 40,
  min_estimates_for_analysis: 5,
};

// ─── Client Payment History ─────────────────────────────────────────────

export interface ClientPaymentHistory {
  clientId: string;
  clientName: string;
  totalInvoices: number;
  paidOnTime: number;
  paidLate: number;
  currentlyOverdue: number;
  totalOutstanding: number;
  avgDaysToPayment: number | null;
  onTimeRate: number;
  recentInvoices: Array<{
    invoiceNumber: string;
    total: number;
    dueDate: string;
    status: string;
    paidDate: string | null;
    daysLate: number | null;
  }>;
}

// ─── Optimize Schedule Payload ────────────────────────────────────────────

export interface OptimizeScheduleActionData {
  optimization_type: "route_reorder";
  team_member_id: string;
  team_member_name: string;
  date: string;
  current_order: Array<{
    task_id: string;
    task_title: string;
    project_name: string;
    address: string | null;
  }>;
  suggested_order: Array<{
    task_id: string;
    task_title: string;
    project_name: string;
    address: string | null;
  }>;
  current_distance_km: number;
  suggested_distance_km: number;
  distance_saved_km: number;
}

// ─── Reschedule Tasks Payload ─────────────────────────────────────────────

export type RescheduleResolutionType = "conflict" | "assign" | "cascade";

export interface RescheduleTasksActionData {
  resolution_type: RescheduleResolutionType;
  /** Conflict resolution fields */
  conflicting_task_ids?: string[];
  conflict_details?: Array<{
    task_id: string;
    task_title: string;
    project_name: string;
    start_date: string;
    end_date: string;
  }>;
  /** Suggested resolution for conflict/cascade */
  suggested_resolution?: {
    task_id: string;
    task_title: string;
    new_start_date: string | null;
    new_end_date: string | null;
    new_team_member_id: string | null;
    new_team_member_name: string | null;
    reason: { type: string; params: Record<string, string | number> };
  };
  /** Unassigned task fields */
  task_id?: string;
  task_title?: string;
  project_name?: string;
  suggested_team_member_id?: string;
  suggested_team_member_name?: string;
  assignment_reason?: string;
  /** Weather awareness */
  weather_risk?: {
    risk_level: "low" | "medium" | "high";
    reason: { type: string; params: Record<string, string | number> };
  };
  /** Cascade context */
  cascade_source_task_id?: string;
  cascade_source_task_title?: string;
  cascade_change_type?: string;
  affected_tasks?: Array<{
    task_id: string;
    task_title: string;
    project_name: string;
    current_start_date: string | null;
    current_end_date: string | null;
    proposed_start_date: string | null;
    proposed_end_date: string | null;
  }>;
  team_member_id?: string;
  team_member_name?: string;
  date?: string;
}

// ─── Schedule Settings ────────────────────────────────────────────────────

export interface ScheduleOptimizationSettings {
  enabled: boolean;
  optimization_window_days: number;
  travel_optimization: boolean;
  conflict_detection: boolean;
  weather_awareness: boolean;
  climate_zone: "northern" | "southern" | "auto";
  cascade_detection: boolean;
  outdoor_task_type_ids: string[];
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleOptimizationSettings = {
  enabled: true,
  optimization_window_days: 2,
  travel_optimization: true,
  conflict_detection: true,
  weather_awareness: true,
  climate_zone: "auto",
  cascade_detection: true,
  outdoor_task_type_ids: [],
};

// ─── Structured Summary (for i18n-compliant context_summary / alerts) ────
/**
 * A structured summary used for i18n rendering. The `type` key maps to a
 * translation entry and `params` are interpolated into it.
 *
 * Services must never emit hardcoded English strings directly — instead
 * they emit a StructuredSummary which the UI renders via `t()` calls.
 */
export interface StructuredSummary {
  type: string;
  params: Record<string, string | number>;
}

// ─── Schedule Changed Payload (S2 Amendment) ─────────────────────────────

/**
 * Fired when a previously-confirmed task is rescheduled. Distinct from
 * send_appointment_confirmation — the subject and body explicitly acknowledge
 * the change rather than presenting the new date as the first confirmation.
 */
export interface SendScheduleChangedActionData {
  task_id: string;
  project_id: string;
  project_title: string;
  client_id: string;
  client_name: string;
  client_email: string;
  task_title: string;
  /** Original scheduled date (before the change) */
  original_date: string;
  original_time: string | null;
  /** New scheduled date (after the change) */
  new_date: string;
  new_time: string | null;
  new_end_time: string | null;
  crew_names: string[];
  project_address: string | null;
  subject: string;
  draft_text: string;
  original_draft_text: string;
  connection_id: string;
  context_summary_structured: StructuredSummary;
}

// ─── Appointment Confirmation Payload ────────────────────────────────────

export interface SendAppointmentConfirmationActionData {
  task_id: string;
  project_id: string;
  project_title: string;
  client_id: string;
  client_name: string;
  client_email: string;
  task_title: string;
  scheduled_date: string;
  /** HH:MM start time (null for all-day or unspecified) */
  scheduled_time: string | null;
  /** HH:MM end time (null when unknown) */
  scheduled_end_time: string | null;
  duration_hours: number;
  crew_names: string[];
  project_address: string | null;
  subject: string;
  draft_text: string;
  /** Original AI draft for edit distance computation */
  original_draft_text: string;
  connection_id: string;
  /** Structured i18n form of context_summary */
  context_summary_structured: StructuredSummary;
}

// ─── Appointment Reminder Payload ────────────────────────────────────────
//
// Renamed from SendDayBeforeReminderActionData. The `SendDayBeforeReminderActionData`
// alias below is retained so any existing pending rows with the old
// action_type still deserialize correctly and external callers compile.

export interface SendAppointmentReminderActionData {
  task_id: string;
  project_id: string;
  project_title: string;
  client_id: string;
  client_name: string;
  client_email: string;
  task_title: string;
  scheduled_date: string;
  scheduled_time: string | null;
  scheduled_end_time: string | null;
  crew_names: string[];
  project_address: string | null;
  /** Optional weather risk flagged for the scheduled day */
  weather_risk: {
    risk_level: "low" | "medium" | "high";
    reason: StructuredSummary;
  } | null;
  subject: string;
  draft_text: string;
  original_draft_text: string;
  connection_id: string;
  context_summary_structured: StructuredSummary;
}

/** @deprecated Use SendAppointmentReminderActionData. Retained for legacy
 *  action rows that still carry action_type = "send_day_before_reminder". */
export type SendDayBeforeReminderActionData = SendAppointmentReminderActionData;

// ─── Subcontractor Coordination Payload ──────────────────────────────────

export interface SendSubcontractorCoordinationActionData {
  project_id: string;
  project_title: string;
  project_address: string | null;
  subcontractor_name: string;
  subcontractor_email: string;
  subcontractor_trade: string | null;
  /** What the main crew will be doing on site */
  main_crew_schedule: {
    start_date: string;
    end_date: string | null;
    crew_names: string[];
  } | null;
  /** What the subcontractor is expected to do */
  scope_of_work: string;
  requested_date: string | null;
  subject: string;
  draft_text: string;
  original_draft_text: string;
  connection_id: string;
  context_summary_structured: StructuredSummary;
}

// ─── Reschedule Request Payload ──────────────────────────────────────────

export interface RescheduleAlternative {
  date: string;
  team_member_id: string | null;
  team_member_name: string | null;
  reasoning: StructuredSummary;
}

export interface ProcessRescheduleRequestActionData {
  activity_id: string;
  thread_id: string | null;
  opportunity_id: string | null;
  client_id: string;
  client_email: string;
  client_name: string;
  /** Excerpt from the incoming client email */
  incoming_message_excerpt: string;
  /** The task we think the client is asking about */
  affected_task_id: string;
  project_id: string;
  project_title: string;
  task_title: string;
  original_start_date: string;
  original_end_date: string | null;
  /** The date parsed from the client email — may be null if "flexible" */
  requested_date: string | null;
  /** "flexible" when client didn't specify a concrete date */
  requested_timing: "flexible" | "specific";
  /** Reason given by the client, if any */
  requested_reason: string | null;
  /** Alternative dates we can offer */
  suggested_alternatives: RescheduleAlternative[];
  /** Pre-generated acknowledgment reply */
  subject: string;
  reply_draft_text: string;
  original_reply_draft_text: string;
  connection_id: string;
  /** GPT classification confidence */
  classification_confidence: number;
  /** Which alternative index the user selected (server uses this on approve) */
  selected_alternative_index: number | null;
  context_summary_structured: StructuredSummary;
}

// ─── Client Comms Settings (wizard-driven, S2 amendment) ──────────────────

/**
 * Five-level autonomy ladder for appointment confirmations:
 *
 *   off                 → never propose or send a confirmation
 *   manual              → user clicks "Send Confirmation" — no auto behavior
 *   draft_on_confirm    → when task becomes confirmed, draft to approval queue (recommended)
 *   auto_send_on_confirm → when task becomes confirmed, draft + auto-send after delay
 *   full_auto           → draft + auto-send the moment a task gets a date (gated)
 */
export type AppointmentConfirmationLevel =
  | "off"
  | "manual"
  | "draft_on_confirm"
  | "auto_send_on_confirm"
  | "full_auto";

/** How tasks become "schedule confirmed" */
export type ConfirmMode = "explicit" | "automatic";

/** Behavior when a confirmed task gets rescheduled */
export type RescheduleBehavior = "do_nothing" | "notify" | "draft" | "auto_send";

/** Simple three-level autonomy used by reminders, status updates, etc. */
export type SimpleAutonomy = "off" | "draft_to_queue" | "auto_send";

/** Cadence presets for project status update emails */
export type StatusUpdateCadence =
  | "off"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "on_stage_change";

/** Payment reminder escalation presets */
export type PaymentReminderPreset = "standard" | "gentle" | "aggressive" | "custom";

/** How reschedule request detection responds */
export type RescheduleRequestBehavior = "detect_only" | "detect_and_draft";

/** How subcontractor coordination is triggered */
export type SubcontractorTrigger = "manual" | "auto_suggest";

export interface AppointmentConfirmationSettings {
  level: AppointmentConfirmationLevel;
  confirm_mode: ConfirmMode;
  /** 1-24 hours — grace period before automatic confirmation (confirm_mode="automatic") */
  auto_confirm_after_hours: number;
  /** 0-60 minutes — cancellable delay before auto-send (auto_send_on_confirm | full_auto) */
  send_delay_minutes: number;
  reschedule_behavior: RescheduleBehavior;
}

export interface AppointmentReminderSettings {
  enabled: boolean;
  /** 0-7 days before the scheduled task date */
  lead_days: number;
  /** 6-20 — local hour of day when cron runs */
  send_hour_local: number;
  include_weather: boolean;
  autonomy: SimpleAutonomy;
  send_delay_minutes: number;
}

export interface StatusUpdateSettings {
  cadence: StatusUpdateCadence;
  /** 0-6 (Sun-Sat) — only used when cadence === "weekly" */
  weekly_day: number;
  autonomy: SimpleAutonomy;
  send_delay_minutes: number;
}

export interface PaymentReminderSettings {
  enabled: boolean;
  preset: PaymentReminderPreset;
  /** Four-element array [first, second, third, final] — days after due date */
  custom_days: [number, number, number, number];
  /** 1-4 — maximum reminders sent per invoice */
  max_reminders: number;
  autonomy: SimpleAutonomy;
  send_delay_minutes: number;
}

export interface InvoiceCoverSettings {
  enabled: boolean;
  /** Only propose for invoices >= threshold (0 = always) */
  threshold: number;
  autonomy: SimpleAutonomy;
  send_delay_minutes: number;
}

export interface RescheduleRequestSettings {
  enabled: boolean;
  behavior: RescheduleRequestBehavior;
  /** 0.5-0.9 — minimum GPT classification confidence */
  min_confidence: number;
  autonomy: SimpleAutonomy;
  send_delay_minutes: number;
}

export interface SubcontractorCoordinationSettings {
  enabled: boolean;
  trigger: SubcontractorTrigger;
}

export interface ClientCommsSettings {
  /** ISO timestamp of wizard completion (null if never completed) */
  comms_wizard_completed_at: string | null;
  /** Version of the wizard that was run — bump to force re-run */
  comms_wizard_version: number;

  appointment_confirmation: AppointmentConfirmationSettings;
  appointment_reminder: AppointmentReminderSettings;
  status_update: StatusUpdateSettings;
  payment_reminder: PaymentReminderSettings;
  invoice_cover: InvoiceCoverSettings;
  reschedule_request: RescheduleRequestSettings;
  subcontractor_coordination: SubcontractorCoordinationSettings;

  /** Legacy keys — retained for backwards compatibility with S2 base. */
  appointment_confirmations?: {
    enabled: boolean;
    delay_hours: number;
  };
  day_before_reminders?: {
    enabled: boolean;
    send_hour_utc: number;
    include_weather: boolean;
  };
  reschedule_requests?: {
    enabled: boolean;
    min_confidence: number;
  };
}

export const CURRENT_COMMS_WIZARD_VERSION = 1;

export const DEFAULT_CLIENT_COMMS_SETTINGS: ClientCommsSettings = {
  comms_wizard_completed_at: null,
  comms_wizard_version: 0,
  appointment_confirmation: {
    level: "draft_on_confirm",
    confirm_mode: "explicit",
    auto_confirm_after_hours: 4,
    send_delay_minutes: 15,
    reschedule_behavior: "draft",
  },
  appointment_reminder: {
    enabled: true,
    lead_days: 1,
    send_hour_local: 14,
    include_weather: true,
    autonomy: "draft_to_queue",
    send_delay_minutes: 15,
  },
  status_update: {
    cadence: "off",
    weekly_day: 1,
    autonomy: "draft_to_queue",
    send_delay_minutes: 15,
  },
  payment_reminder: {
    enabled: true,
    preset: "standard",
    custom_days: [7, 14, 30, 45],
    max_reminders: 4,
    autonomy: "draft_to_queue",
    send_delay_minutes: 15,
  },
  invoice_cover: {
    enabled: true,
    threshold: 0,
    autonomy: "draft_to_queue",
    send_delay_minutes: 15,
  },
  reschedule_request: {
    enabled: true,
    behavior: "detect_and_draft",
    min_confidence: 0.6,
    autonomy: "draft_to_queue",
    send_delay_minutes: 15,
  },
  subcontractor_coordination: {
    enabled: false,
    trigger: "manual",
  },
};
