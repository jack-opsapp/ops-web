"use client";

import { useState, useEffect, memo, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  FolderKanban,
  ListTodo,
  Receipt,
  Mail,
  ChevronDown,
  ChevronUp,
  Check,
  CheckCircle2,
  Gauge,
  Clock,
  ExternalLink,
  User,
  CalendarDays,
  MailCheck,
  UserRoundX,
  Archive,
  AlertTriangle,
  ArrowRight,
  FileText,
  Plus,
  Trash2,
  Paperclip,
  BellRing,
  HeartPulse,
  BarChart3,
  Route,
  RefreshCw,
  CloudRain,
  MapPin,
  CalendarCheck,
  BellPlus,
  MessageSquareReply,
  HardHat,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useLocale, useDictionary } from "@/i18n/client";
import type {
  AgentAction,
  CreateTaskActionData,
  SendStatusEmailActionData,
  CreateInvoiceActionData,
  SendInvoiceEmailActionData,
  InvoiceWarning,
  ReassignTaskActionData,
  ArchiveProjectActionData,
  CloseProjectActionData,
  SendPaymentReminderActionData,
  ClientHealthAlertActionData,
  FinancialInsightActionData,
  OptimizeScheduleActionData,
  RescheduleTasksActionData,
  SendAppointmentConfirmationActionData,
  SendDayBeforeReminderActionData,
  SendSubcontractorCoordinationActionData,
  ProcessRescheduleRequestActionData,
  StructuredSummary,
} from "@/lib/types/approval-queue";
import { FinancialInsightCard } from "./financial-insight-card";

// ─── Type Icon Map ────────────────────────────────────────────────────────────

const ACTION_TYPE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  create_project: FolderKanban,
  create_task: ListTodo,
  create_invoice: Receipt,
  send_email: Mail,
  send_status_email: MailCheck,
  send_invoice_email: FileText,
  send_payment_reminder: BellRing,
  reassign_task: UserRoundX,
  archive_project: Archive,
  close_project: CheckCircle2,
  client_health_alert: HeartPulse,
  financial_insight: BarChart3,
  optimize_schedule: Route,
  reschedule_tasks: RefreshCw,
  send_appointment_confirmation: CalendarCheck,
  send_appointment_reminder: BellPlus,
  send_day_before_reminder: BellPlus,
  send_schedule_changed: CalendarCheck,
  process_reschedule_request: MessageSquareReply,
  send_subcontractor_coordination: HardHat,
};

// ─── Priority Left Border Colors ──────────────────────────────────────────────

const PRIORITY_BORDER: Record<string, string> = {
  low: "border-l-[rgba(255,255,255,0.08)]",
  normal: "border-l-[rgba(255,255,255,0.08)]",
  high: "border-l-[#C4A868]",
  urgent: "border-l-[#93321A]",
};

const PRIORITY_TEXT: Record<string, string> = {
  low: "text-text-3",
  normal: "text-text-2",
  high: "text-[#C4A868]",
  urgent: "text-[#93321A]",
};

// ─── Source URL Map ───────────────────────────────────────────────────────────

function getSourceUrl(
  contextSource: string | null,
  sourceId: string | null
): string | null {
  if (!contextSource || !sourceId) return null;
  switch (contextSource) {
    case "email_thread":
      return `/inbox?thread=${sourceId}`;
    case "schedule_gap":
      return "/schedule";
    case "overdue_task":
      return `/projects?task=${sourceId}`;
    case "project_analysis":
    case "stage_change":
    case "project_lifecycle":
    case "lifecycle_automation": {
      const projectId = sourceId.split(":")[0];
      return projectId ? `/projects/${projectId}` : null;
    }
    case "overdue_detection": {
      const taskId = sourceId.split(":")[0];
      return taskId ? `/projects?task=${taskId}` : null;
    }
    case "estimate_conversion":
      return `/pipeline?estimate=${sourceId}`;
    case "project_completion":
    case "milestone_billing": {
      const pid = sourceId.split(":")[0];
      return pid ? `/projects/${pid}` : null;
    }
    case "invoice_created":
      return `/pipeline?invoice=${sourceId}`;
    case "overdue_invoice": {
      const invId = sourceId.split(":")[0];
      return invId ? `/pipeline?invoice=${invId}` : null;
    }
    case "payment_analysis":
      return `/dashboard?openClient=${sourceId.split(":")[0]}`;
    case "schedule_optimization":
      return "/schedule";
    default:
      return null;
  }
}

// ─── Time Ago (i18n) ──────────────────────────────────────────────────────────

function timeAgo(date: Date, t: (key: string) => string): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return t("time.minutes").replace("{{count}}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours").replace("{{count}}", String(hours));
  const days = Math.floor(hours / 24);
  return t("time.days").replace("{{count}}", String(days));
}

// ─── Date Formatting ──────────────────────────────────────────────────────────

/** Fix 19: locale-aware date formatting */
function formatDateRange(
  startIso: string | null,
  endIso: string | null,
  locale: string
): string | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (!endIso) return start.toLocaleDateString(locale, opts);
  const end = new Date(endIso);
  const startStr = start.toLocaleDateString(locale, opts);
  const endStr = end.toLocaleDateString(locale, opts);
  if (startStr === endStr) return startStr;
  if (start.getMonth() === end.getMonth()) {
    return `${startStr}–${end.getDate()}`;
  }
  return `${startStr} – ${endStr}`;
}

/** Fix 22: use local date components instead of UTC .toISOString() split */
function toInputDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ─── Currency Formatter ──────────────────────────────────────────────────────

function fmtCurrency(
  amount: number,
  locale: string,
  currencyCode = "CAD"
): string {
  return amount.toLocaleString(locale, {
    style: "currency",
    currency: currencyCode,
  });
}

// ─── i18n Interpolation Helper ───────────────────────────────────────────────

/** Replace {{key}} placeholders in a translated string with param values. */
function interpolate(
  template: string,
  params: Record<string, string | number> | undefined
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = params[key];
    return v != null ? String(v) : `{{${key}}}`;
  });
}

/** Render a structured summary via a dictionary lookup. */
function renderStructured(
  s: StructuredSummary | null | undefined,
  tFn: (key: string) => string,
  fallback: string
): string {
  if (!s) return fallback;
  const template = tFn(`summary.${s.type}`);
  // If the key is missing, tFn returns the raw key — fall back to the DB string
  if (template === `summary.${s.type}`) return fallback;
  return interpolate(template, s.params);
}

/** Format a date-time string (ISO or date-only) in the current locale. */
function formatDateTime(
  iso: string | null,
  timeStr: string | null,
  locale: string
): string {
  if (!iso) return "";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (!timeStr) return datePart;
  return `${datePart} · ${timeStr}`;
}

// ─── Warning Renderer ────────────────────────────────────────────────────────

function renderWarning(
  warning: InvoiceWarning,
  t: (key: string) => string,
  locale: string
): string {
  const p = warning.params ?? {};
  switch (warning.type) {
    case "high_value": {
      const total = Number(p.total ?? 0).toLocaleString(locale, {
        style: "currency",
        currency: "USD",
      });
      const threshold = Number(p.threshold ?? 0).toLocaleString(locale, {
        style: "currency",
        currency: "USD",
      });
      return `${t("invoice.warning.highValue")} — ${total} > ${threshold}`;
    }
    case "duplicate_similar":
      return t("invoice.warning.duplicateSimilar");
    case "no_client_email":
      return t("invoice.warning.noClientEmail");
    case "no_payment_terms":
      return `${t("invoice.warning.noPaymentTerms")}${p.default_terms ? ` (→ ${p.default_terms})` : ""}`;
    case "zero_tax":
      return t("invoice.warning.zeroTax");
    case "price_deviation": {
      const price = Number(p.item_price ?? 0).toLocaleString(locale, {
        style: "currency",
        currency: "USD",
      });
      const avg = Number(p.avg_price ?? 0).toLocaleString(locale, {
        style: "currency",
        currency: "USD",
      });
      return `${p.item_name}: ${price}/${p.item_unit} — ${p.deviation_pct}% vs avg ${avg}/${p.item_unit}`;
    }
    default:
      return t("invoice.warning.missingData");
  }
}

// ─── Team Member Type ─────────────────────────────────────────────────────────

export interface TeamMemberOption {
  id: string;
  name: string;
  role: string;
  scheduledTaskCount?: number;
  hasConflicts?: boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: AgentAction;
  selected: boolean;
  onSelect: (id: string) => void;
  onApprove: (id: string, editedData?: Record<string, unknown>) => void;
  onReject: (id: string) => void;
  t: (key: string) => string;
  /** Team members for the assignment picker (only needed for create_task actions) */
  teamMembers?: TeamMemberOption[];
}

export const ActionCard = memo(function ActionCard({
  action,
  selected,
  onSelect,
  onApprove,
  onReject,
  t,
  teamMembers,
}: ActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const { locale } = useLocale();
  // Load scheduling dictionary for schedule-specific action types.
  // `tSched` falls back to the key if the translation is missing.
  const { t: tSched } = useDictionary("scheduling");
  // Sprint S2: client comms dictionary for appointment confirmations,
  // day-before reminders, reschedule requests, and subcontractor coordination.
  const { t: tComms } = useDictionary("client-comms");
  const Icon = ACTION_TYPE_ICONS[action.actionType] ?? FolderKanban;
  const isPending = action.status === "pending";
  const sourceUrl = getSourceUrl(action.contextSource, action.sourceId);
  const isTaskAction = action.actionType === "create_task";
  const taskData = isTaskAction
    ? (action.actionData as unknown as CreateTaskActionData)
    : null;

  // ── New action type data extraction ──
  const isStatusEmail = action.actionType === "send_status_email";
  const statusEmailData = isStatusEmail
    ? (action.actionData as unknown as SendStatusEmailActionData)
    : null;

  const isReassign = action.actionType === "reassign_task";
  const reassignData = isReassign
    ? (action.actionData as unknown as ReassignTaskActionData)
    : null;

  const isArchive = action.actionType === "archive_project";
  const archiveData = isArchive
    ? (action.actionData as unknown as ArchiveProjectActionData)
    : null;

  const isClose = action.actionType === "close_project";
  const closeData = isClose
    ? (action.actionData as unknown as CloseProjectActionData)
    : null;

  // Archive (operator pause/cancel) and close (completion success) carry the
  // same lifecycle payload and render the same summary layout — only the type
  // label + icon differ (resolved upstream via t(`type.${actionType}`) + the
  // icon map). Share one data handle so the two detail blocks stay in lockstep.
  const isProjectLifecycle = isArchive || isClose;
  const lifecycleData = archiveData ?? closeData;

  const isCreateInvoice = action.actionType === "create_invoice";
  const invoiceData = isCreateInvoice
    ? (action.actionData as unknown as CreateInvoiceActionData)
    : null;

  const isInvoiceEmail = action.actionType === "send_invoice_email";
  const invoiceEmailData = isInvoiceEmail
    ? (action.actionData as unknown as SendInvoiceEmailActionData)
    : null;

  const isPaymentReminder = action.actionType === "send_payment_reminder";
  const reminderData = isPaymentReminder
    ? (action.actionData as unknown as SendPaymentReminderActionData)
    : null;

  const isHealthAlert = action.actionType === "client_health_alert";
  const healthData = isHealthAlert
    ? (action.actionData as unknown as ClientHealthAlertActionData)
    : null;

  const isFinancialInsight = action.actionType === "financial_insight";
  const financialData = isFinancialInsight
    ? (action.actionData as unknown as FinancialInsightActionData)
    : null;

  const isOptimizeSchedule = action.actionType === "optimize_schedule";
  const optimizeData = isOptimizeSchedule
    ? (action.actionData as unknown as OptimizeScheduleActionData)
    : null;

  const isRescheduleTasks = action.actionType === "reschedule_tasks";
  const rescheduleData = isRescheduleTasks
    ? (action.actionData as unknown as RescheduleTasksActionData)
    : null;

  // ── S2: client scheduling comms action data ──
  const isAppointmentConfirm =
    action.actionType === "send_appointment_confirmation";
  const appointmentData = isAppointmentConfirm
    ? (action.actionData as unknown as SendAppointmentConfirmationActionData)
    : null;

  const isDayBeforeReminder =
    action.actionType === "send_day_before_reminder" ||
    action.actionType === "send_appointment_reminder";
  const dayBeforeData = isDayBeforeReminder
    ? (action.actionData as unknown as SendDayBeforeReminderActionData)
    : null;

  const isSubcontractorCoord =
    action.actionType === "send_subcontractor_coordination";
  const subcontractorData = isSubcontractorCoord
    ? (action.actionData as unknown as SendSubcontractorCoordinationActionData)
    : null;

  const isRescheduleRequest =
    action.actionType === "process_reschedule_request";
  const rescheduleRequestData = isRescheduleRequest
    ? (action.actionData as unknown as ProcessRescheduleRequestActionData)
    : null;

  // ── Editable state for status email ──
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftText, setDraftText] = useState(statusEmailData?.draft_text ?? "");

  // ── Editable state for reassign ──
  const [reassignMemberId, setReassignMemberId] = useState<string | null>(
    reassignData?.suggested_team_member_id ?? null
  );
  const [reassignMemberName, setReassignMemberName] = useState<string | null>(
    reassignData?.suggested_team_member_name ?? null
  );
  const [reassignStartDate, setReassignStartDate] = useState(
    toInputDate(reassignData?.new_start_date ?? null)
  );
  const [reassignEndDate, setReassignEndDate] = useState(
    toInputDate(reassignData?.new_end_date ?? null)
  );

  // ── Editable state for task actions ──
  const [editingAssignment, setEditingAssignment] = useState(false);
  const [editingDates, setEditingDates] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    taskData?.suggested_team_member_id ?? null
  );
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(
    taskData?.suggested_team_member_name ?? null
  );
  const [editStartDate, setEditStartDate] = useState(
    toInputDate(taskData?.suggested_start_date ?? null)
  );
  const [editEndDate, setEditEndDate] = useState(
    toInputDate(taskData?.suggested_end_date ?? null)
  );

  // ── Editable state for invoice ──
  const [editingLineItems, setEditingLineItems] = useState(false);
  const [invoiceLineItems, setInvoiceLineItems] = useState(
    invoiceData?.line_items ?? []
  );
  const [invoicePaymentTerms, setInvoicePaymentTerms] = useState(
    invoiceData?.payment_terms ?? ""
  );
  const [invoiceDueDate, setInvoiceDueDate] = useState(
    toInputDate(invoiceData?.due_date ?? null)
  );

  // ── Editable state for invoice email ──
  const [invoiceEmailDraft, setInvoiceEmailDraft] = useState(
    invoiceEmailData?.draft_text ?? ""
  );
  const [editingInvoiceEmail, setEditingInvoiceEmail] = useState(false);

  // ── Editable state for payment reminder ──
  const [reminderDraft, setReminderDraft] = useState(
    reminderData?.draft_text ?? ""
  );
  const [editingReminderDraft, setEditingReminderDraft] = useState(false);

  // ── Editable state for reschedule ──
  const [rescheduleStartDate, setRescheduleStartDate] = useState(
    toInputDate(rescheduleData?.suggested_resolution?.new_start_date ?? null)
  );
  const [rescheduleMemberId, setRescheduleMemberId] = useState<string | null>(
    rescheduleData?.suggested_team_member_id ??
      rescheduleData?.suggested_resolution?.new_team_member_id ??
      null
  );
  const [rescheduleMemberName, setRescheduleMemberName] = useState<
    string | null
  >(
    rescheduleData?.suggested_team_member_name ??
      rescheduleData?.suggested_resolution?.new_team_member_name ??
      null
  );

  // ── Editable state for S2 client comms action types ──
  const [appointmentDraft, setAppointmentDraft] = useState(
    appointmentData?.draft_text ?? ""
  );
  const [appointmentSubject, setAppointmentSubject] = useState(
    appointmentData?.subject ?? ""
  );
  const [editingAppointmentDraft, setEditingAppointmentDraft] = useState(false);

  const [dayBeforeDraft, setDayBeforeDraft] = useState(
    dayBeforeData?.draft_text ?? ""
  );
  const [dayBeforeSubject, setDayBeforeSubject] = useState(
    dayBeforeData?.subject ?? ""
  );
  const [editingDayBeforeDraft, setEditingDayBeforeDraft] = useState(false);

  const [subcontractorDraft, setSubcontractorDraft] = useState(
    subcontractorData?.draft_text ?? ""
  );
  const [subcontractorSubject, setSubcontractorSubject] = useState(
    subcontractorData?.subject ?? ""
  );
  const [editingSubcontractorDraft, setEditingSubcontractorDraft] =
    useState(false);

  const [rescheduleRequestReply, setRescheduleRequestReply] = useState(
    rescheduleRequestData?.reply_draft_text ?? ""
  );
  const [rescheduleRequestSubject, setRescheduleRequestSubject] = useState(
    rescheduleRequestData?.subject ?? ""
  );
  const [editingRescheduleReply, setEditingRescheduleReply] = useState(false);
  const [selectedAlternativeIndex, setSelectedAlternativeIndex] =
    useState<number>(rescheduleRequestData?.selected_alternative_index ?? 0);

  // Reset editable state when action changes.
  useEffect(() => {
    if (taskData) {
      setSelectedMemberId(taskData.suggested_team_member_id);
      setSelectedMemberName(taskData.suggested_team_member_name);
      setEditStartDate(toInputDate(taskData.suggested_start_date));
      setEditEndDate(toInputDate(taskData.suggested_end_date));
    }
    if (statusEmailData) {
      setDraftText(statusEmailData.draft_text);
      setEditingDraft(false);
    }
    if (reassignData) {
      setReassignMemberId(reassignData.suggested_team_member_id);
      setReassignMemberName(reassignData.suggested_team_member_name);
      setReassignStartDate(toInputDate(reassignData.new_start_date));
      setReassignEndDate(toInputDate(reassignData.new_end_date));
    }
    if (invoiceData) {
      setInvoiceLineItems(invoiceData.line_items);
      setInvoicePaymentTerms(invoiceData.payment_terms ?? "");
      setInvoiceDueDate(toInputDate(invoiceData.due_date));
      setEditingLineItems(false);
    }
    if (invoiceEmailData) {
      setInvoiceEmailDraft(invoiceEmailData.draft_text);
      setEditingInvoiceEmail(false);
    }
    if (reminderData) {
      setReminderDraft(reminderData.draft_text);
      setEditingReminderDraft(false);
    }
    if (rescheduleData) {
      setRescheduleStartDate(
        toInputDate(rescheduleData.suggested_resolution?.new_start_date ?? null)
      );
      setRescheduleMemberId(
        rescheduleData.suggested_team_member_id ??
          rescheduleData.suggested_resolution?.new_team_member_id ??
          null
      );
      setRescheduleMemberName(
        rescheduleData.suggested_team_member_name ??
          rescheduleData.suggested_resolution?.new_team_member_name ??
          null
      );
    }
    if (appointmentData) {
      setAppointmentDraft(appointmentData.draft_text);
      setAppointmentSubject(appointmentData.subject);
      setEditingAppointmentDraft(false);
    }
    if (dayBeforeData) {
      setDayBeforeDraft(dayBeforeData.draft_text);
      setDayBeforeSubject(dayBeforeData.subject);
      setEditingDayBeforeDraft(false);
    }
    if (subcontractorData) {
      setSubcontractorDraft(subcontractorData.draft_text);
      setSubcontractorSubject(subcontractorData.subject);
      setEditingSubcontractorDraft(false);
    }
    if (rescheduleRequestData) {
      setRescheduleRequestReply(rescheduleRequestData.reply_draft_text);
      setRescheduleRequestSubject(rescheduleRequestData.subject);
      setEditingRescheduleReply(false);
      setSelectedAlternativeIndex(
        rescheduleRequestData.selected_alternative_index ?? 0
      );
    }
  }, [action.id]); // eslint-disable-line react-hooks/exhaustive-deps -- data is derived from action, so action.id is sufficient

  // ── Build edited action_data for approval ──
  const handleApproveWithEdits = useCallback(() => {
    // Status email: check if draft was edited
    if (isStatusEmail && statusEmailData) {
      if (draftText !== statusEmailData.draft_text) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        editedData.draft_text = draftText;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Reassign: check if member or dates were changed
    if (isReassign && reassignData) {
      const memberChanged =
        reassignMemberId !== reassignData.suggested_team_member_id;
      const startChanged =
        reassignStartDate !== toInputDate(reassignData.new_start_date);
      const endChanged =
        reassignEndDate !== toInputDate(reassignData.new_end_date);

      if (memberChanged || startChanged || endChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (memberChanged) {
          editedData.suggested_team_member_id = reassignMemberId;
          editedData.suggested_team_member_name = reassignMemberName;
        }
        if (startChanged) {
          editedData.new_start_date = reassignStartDate
            ? new Date(reassignStartDate).toISOString()
            : reassignData.new_start_date;
        }
        if (endChanged) {
          editedData.new_end_date = reassignEndDate
            ? new Date(reassignEndDate).toISOString()
            : reassignData.new_end_date;
        }
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Create invoice: check if line items, terms, or dates were changed
    if (isCreateInvoice && invoiceData) {
      const itemsChanged =
        JSON.stringify(invoiceLineItems) !==
        JSON.stringify(invoiceData.line_items);
      const termsChanged =
        invoicePaymentTerms !== (invoiceData.payment_terms ?? "");
      const dueDateChanged =
        invoiceDueDate !== toInputDate(invoiceData.due_date);

      if (itemsChanged || termsChanged || dueDateChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (itemsChanged) {
          editedData.line_items = invoiceLineItems;
          // Recalculate totals respecting is_taxable per item
          const newSubtotal = invoiceLineItems.reduce(
            (sum, li) => sum + li.quantity * li.unit_price,
            0
          );
          editedData.subtotal = newSubtotal;
          const taxRate = invoiceData.tax_rate ?? 0;
          const taxableSubtotal = invoiceLineItems
            .filter((li) => li.is_taxable)
            .reduce((sum, li) => sum + li.quantity * li.unit_price, 0);
          const discountAmt =
            invoiceData.discount_type === "percentage" &&
            invoiceData.discount_value
              ? newSubtotal * (invoiceData.discount_value / 100)
              : (invoiceData.discount_amount ?? 0);
          const newTaxAmount = taxableSubtotal * (taxRate / 100);
          editedData.tax_amount = newTaxAmount;
          editedData.discount_amount = discountAmt;
          editedData.total = newSubtotal - discountAmt + newTaxAmount;
        }
        if (termsChanged) editedData.payment_terms = invoicePaymentTerms;
        if (dueDateChanged) {
          editedData.due_date = invoiceDueDate
            ? new Date(invoiceDueDate).toISOString()
            : invoiceData.due_date;
        }
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Send invoice email: check if draft was edited
    if (isInvoiceEmail && invoiceEmailData) {
      if (invoiceEmailDraft !== invoiceEmailData.draft_text) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        editedData.draft_text = invoiceEmailDraft;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Payment reminder: check if draft was edited
    if (isPaymentReminder && reminderData) {
      if (reminderDraft !== reminderData.draft_text) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        editedData.draft_text = reminderDraft;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Health alert: no edits needed, just approve
    if (isHealthAlert) {
      onApprove(action.id);
      return;
    }

    // Financial insight: no edits needed, just acknowledge
    if (isFinancialInsight) {
      onApprove(action.id);
      return;
    }

    // Optimize schedule: no edits, approve as-is
    if (isOptimizeSchedule) {
      onApprove(action.id);
      return;
    }

    // Reschedule tasks: check if member or dates were changed
    if (isRescheduleTasks && rescheduleData) {
      const origMemberId =
        rescheduleData.suggested_team_member_id ??
        rescheduleData.suggested_resolution?.new_team_member_id ??
        null;
      const origStartDate = toInputDate(
        rescheduleData.suggested_resolution?.new_start_date ?? null
      );
      const memberChanged = rescheduleMemberId !== origMemberId;
      const startChanged = rescheduleStartDate !== origStartDate;

      if (memberChanged || startChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (rescheduleData.resolution_type === "assign") {
          if (memberChanged) {
            editedData.suggested_team_member_id = rescheduleMemberId;
            editedData.suggested_team_member_name = rescheduleMemberName;
          }
        }
        if (
          rescheduleData.suggested_resolution &&
          (memberChanged || startChanged)
        ) {
          const resolution = { ...rescheduleData.suggested_resolution };
          if (memberChanged) {
            resolution.new_team_member_id = rescheduleMemberId;
            resolution.new_team_member_name = rescheduleMemberName;
          }
          if (startChanged && rescheduleStartDate) {
            resolution.new_start_date = new Date(
              rescheduleStartDate
            ).toISOString();
          }
          editedData.suggested_resolution = resolution;
        }
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Appointment confirmation: check if draft or subject were edited
    if (isAppointmentConfirm && appointmentData) {
      const draftChanged = appointmentDraft !== appointmentData.draft_text;
      const subjectChanged = appointmentSubject !== appointmentData.subject;
      if (draftChanged || subjectChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (draftChanged) editedData.draft_text = appointmentDraft;
        if (subjectChanged) editedData.subject = appointmentSubject;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Day-before reminder: check if draft or subject were edited
    if (isDayBeforeReminder && dayBeforeData) {
      const draftChanged = dayBeforeDraft !== dayBeforeData.draft_text;
      const subjectChanged = dayBeforeSubject !== dayBeforeData.subject;
      if (draftChanged || subjectChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (draftChanged) editedData.draft_text = dayBeforeDraft;
        if (subjectChanged) editedData.subject = dayBeforeSubject;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Subcontractor coordination: check if draft or subject were edited
    if (isSubcontractorCoord && subcontractorData) {
      const draftChanged = subcontractorDraft !== subcontractorData.draft_text;
      const subjectChanged = subcontractorSubject !== subcontractorData.subject;
      if (draftChanged || subjectChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (draftChanged) editedData.draft_text = subcontractorDraft;
        if (subjectChanged) editedData.subject = subcontractorSubject;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Process reschedule request: check if reply draft, subject, or selected
    // alternative was changed. The selected alternative drives which date
    // the task gets updated to on approval.
    if (isRescheduleRequest && rescheduleRequestData) {
      const replyChanged =
        rescheduleRequestReply !== rescheduleRequestData.reply_draft_text;
      const subjectChanged =
        rescheduleRequestSubject !== rescheduleRequestData.subject;
      const altChanged =
        selectedAlternativeIndex !==
        (rescheduleRequestData.selected_alternative_index ?? 0);
      if (replyChanged || subjectChanged || altChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (replyChanged) editedData.reply_draft_text = rescheduleRequestReply;
        if (subjectChanged) editedData.subject = rescheduleRequestSubject;
        if (altChanged)
          editedData.selected_alternative_index = selectedAlternativeIndex;
        onApprove(action.id, editedData);
        return;
      }
      onApprove(action.id);
      return;
    }

    // Create task: check if assignment or dates were changed
    if (isTaskAction && taskData) {
      const memberChanged =
        selectedMemberId !== taskData.suggested_team_member_id;
      const startChanged =
        editStartDate !== toInputDate(taskData.suggested_start_date);
      const endChanged =
        editEndDate !== toInputDate(taskData.suggested_end_date);

      if (memberChanged || startChanged || endChanged) {
        const editedData: Record<string, unknown> = { ...action.actionData };
        if (memberChanged) {
          editedData.suggested_team_member_id = selectedMemberId;
          editedData.suggested_team_member_name = selectedMemberName;
        }
        if (startChanged) {
          editedData.suggested_start_date = editStartDate
            ? new Date(editStartDate).toISOString()
            : null;
        }
        if (endChanged) {
          editedData.suggested_end_date = editEndDate
            ? new Date(editEndDate).toISOString()
            : null;
        }
        onApprove(action.id, editedData);
        return;
      }
    }

    onApprove(action.id);
  }, [
    action.id,
    action.actionData,
    isTaskAction,
    taskData,
    isStatusEmail,
    statusEmailData,
    isReassign,
    reassignData,
    isCreateInvoice,
    invoiceData,
    isInvoiceEmail,
    invoiceEmailData,
    selectedMemberId,
    selectedMemberName,
    editStartDate,
    editEndDate,
    draftText,
    reassignMemberId,
    reassignMemberName,
    reassignStartDate,
    reassignEndDate,
    invoiceLineItems,
    invoicePaymentTerms,
    invoiceDueDate,
    invoiceEmailDraft,
    isPaymentReminder,
    reminderData,
    reminderDraft,
    isHealthAlert,
    isFinancialInsight,
    isOptimizeSchedule,
    isRescheduleTasks,
    rescheduleData,
    rescheduleMemberId,
    rescheduleMemberName,
    rescheduleStartDate,
    isAppointmentConfirm,
    appointmentData,
    appointmentDraft,
    appointmentSubject,
    isDayBeforeReminder,
    dayBeforeData,
    dayBeforeDraft,
    dayBeforeSubject,
    isSubcontractorCoord,
    subcontractorData,
    subcontractorDraft,
    subcontractorSubject,
    isRescheduleRequest,
    rescheduleRequestData,
    rescheduleRequestReply,
    rescheduleRequestSubject,
    selectedAlternativeIndex,
    onApprove,
  ]);

  const motionProps = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        transition: { duration: 0.2, ease: EASE_SMOOTH },
      };

  return (
    <motion.div
      layout={!shouldReduceMotion}
      {...motionProps}
      className={cn(
        "rounded-lg border border-l-[3px] transition-colors duration-150",
        PRIORITY_BORDER[action.priority] ?? PRIORITY_BORDER.normal,
        // Fix 21: selected border uses neutral instead of accent
        selected
          ? "border-[rgba(255,255,255,0.20)] bg-[rgba(255,255,255,0.03)]"
          : "glass-surface border-[rgba(255,255,255,0.08)] bg-glass",
        "saturate-[1.2] backdrop-blur-[20px]"
      )}
    >
      {/* ── Header Row ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4">
        {/* Selection checkbox — 56dp tap area */}
        {isPending && (
          <button
            onClick={() => onSelect(action.id)}
            className="-m-3 mr-0 flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center"
            aria-label="Select"
          >
            <div
              className={cn(
                "h-[20px] w-[20px] rounded-bar border transition-colors",
                // Fix 21: checkbox is the ONE accent element (selection indicator)
                selected
                  ? "border-[rgba(255,255,255,0.30)] bg-text-2"
                  : "border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.24)]"
              )}
            >
              {selected && (
                <Check className="mx-auto mt-[2px] h-[14px] w-[14px] text-background" />
              )}
            </div>
          </button>
        )}

        {/* Type icon */}
        <div className="mt-3 flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-chip bg-[rgba(255,255,255,0.04)]">
          <Icon className="h-[16px] w-[16px] text-text-2" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 pt-2">
          <div className="flex items-center gap-2">
            <span className="truncate font-mohave text-body-sm uppercase text-text">
              {t(`type.${action.actionType}`)}
            </span>
            <span
              className={cn(
                "font-mono text-[11px]",
                PRIORITY_TEXT[action.priority]
              )}
            >
              [{t(`priority.${action.priority}`)}]
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 font-mono text-[13px] text-text-2">
            {(() => {
              // Sprint S2: prefer structured summary from action_data for the
              // new client-comms types. Falls back to raw contextSummary when
              // either the type doesn't use structured summaries or the
              // dictionary key is missing.
              const structured =
                appointmentData?.context_summary_structured ??
                dayBeforeData?.context_summary_structured ??
                subcontractorData?.context_summary_structured ??
                rescheduleRequestData?.context_summary_structured ??
                null;
              return renderStructured(
                structured,
                tComms,
                action.contextSummary
              );
            })()}
          </p>

          {/* ── Task-specific inline details ── */}
          {isTaskAction && taskData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {taskData.project_name && (
                <div className="flex items-center gap-1">
                  <FolderKanban className="h-[12px] w-[12px] text-text-3" />
                  <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                    {taskData.project_name}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text-2">
                  {selectedMemberName ?? t("task.unassigned")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text-2">
                  {formatDateRange(
                    editStartDate
                      ? new Date(editStartDate).toISOString()
                      : null,
                    editEndDate ? new Date(editEndDate).toISOString() : null,
                    locale
                  ) ?? t("task.unscheduled")}
                </span>
              </div>
            </div>
          )}

          {/* ── Status email inline details ── */}
          {isStatusEmail && statusEmailData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {statusEmailData.client_name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <FolderKanban className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {statusEmailData.project_title}
                </span>
              </div>
              <span className="font-mono text-[11px] text-text-3">
                {statusEmailData.completion_percent}%
              </span>
            </div>
          )}

          {/* ── Reassign task inline details ── */}
          {isReassign && reassignData && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-[12px] w-[12px] text-[#C4A868]" />
                <span className="font-mono text-[11px] text-[#C4A868]">
                  {reassignData.overdue_days}d {t("lifecycle.overdue")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text-2">
                  {reassignData.current_team_member_name ??
                    t("task.unassigned")}
                </span>
                <ArrowRight className="h-[10px] w-[10px] text-text-3" />
                <span className="font-mono text-[11px] text-text-2">
                  {reassignMemberName ??
                    reassignData.suggested_team_member_name}
                </span>
              </div>
            </div>
          )}

          {/* ── Project lifecycle (archive / close) inline details ── */}
          {isProjectLifecycle && lifecycleData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <FolderKanban className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[160px] truncate font-mono text-[11px] text-text-2">
                  {lifecycleData.project_title}
                </span>
              </div>
              <span className="font-mono text-[11px] text-text-3">
                {lifecycleData.days_since_completion}d{" "}
                {t("lifecycle.sinceCompletion")}
              </span>
              <span className="font-mono text-[11px] text-text-3">
                {lifecycleData.completed_tasks}/{lifecycleData.total_tasks}{" "}
                {t("task.tasks")}
              </span>
            </div>
          )}

          {/* ── Create invoice inline details ── */}
          {isCreateInvoice && invoiceData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {invoiceData.client_name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <FolderKanban className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {invoiceData.project_title}
                </span>
              </div>
              <span className="font-mono text-[13px] font-medium text-text">
                {invoiceData.total.toLocaleString(locale, {
                  style: "currency",
                  currency: "USD",
                })}
              </span>
              {invoiceData.warnings.length > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="h-[12px] w-[12px] text-[#C4A868]" />
                  <span className="font-mono text-[11px] text-[#C4A868]">
                    {invoiceData.warnings.length}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Invoice email inline details ── */}
          {isInvoiceEmail && invoiceEmailData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <Mail className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[180px] truncate font-mono text-[11px] text-text-2">
                  {invoiceEmailData.to_email}
                </span>
              </div>
              <span className="font-mono text-[11px] text-text-3">
                #{invoiceEmailData.invoice_number}
              </span>
              <span className="font-mono text-[11px] text-text-2">
                {invoiceEmailData.invoice_total.toLocaleString(locale, {
                  style: "currency",
                  currency: "USD",
                })}
              </span>
              {invoiceEmailData.attachments.length > 0 && (
                <div className="flex items-center gap-1">
                  <Paperclip className="h-[12px] w-[12px] text-text-3" />
                </div>
              )}
            </div>
          )}

          {/* ── Payment reminder inline details ── */}
          {isPaymentReminder && reminderData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {reminderData.client_name}
                </span>
              </div>
              <span className="font-mono text-[11px] text-text-3">
                #{reminderData.invoice_number}
              </span>
              <span className="font-mono text-[13px] font-medium text-text">
                {fmtCurrency(
                  reminderData.balance_due,
                  locale,
                  reminderData.currency_code
                )}
              </span>
              <div className="flex items-center gap-1">
                <Clock
                  className="h-[12px] w-[12px]"
                  style={{
                    color:
                      reminderData.reminder_level >= 4
                        ? "#93321A"
                        : reminderData.reminder_level >= 3
                          ? "#C4A868"
                          : reminderData.reminder_level >= 2
                            ? "#C4A868"
                            : "rgba(255,255,255,0.4)",
                  }}
                />
                <span
                  className="font-mono text-[11px]"
                  style={{
                    color:
                      reminderData.reminder_level >= 4
                        ? "#93321A"
                        : reminderData.reminder_level >= 3
                          ? "#C4A868"
                          : reminderData.reminder_level >= 2
                            ? "#C4A868"
                            : "rgba(255,255,255,0.5)",
                  }}
                >
                  {t("reminder.daysOverdue").replace(
                    "{{count}}",
                    String(reminderData.days_overdue)
                  )}
                </span>
              </div>
              <span className="font-mono text-[11px] text-text-3">
                [{t(`reminder.tone.${reminderData.reminder_tone}`)}]
              </span>
            </div>
          )}

          {/* ── Client health alert inline details ── */}
          {isHealthAlert && healthData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {healthData.client_name}
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#93321A]">
                {Math.round(healthData.late_rate * 100)}%{" "}
                {t("health.lateRate").toLowerCase()}
              </span>
              <span className="font-mono text-[11px] text-[#C4A868]">
                {healthData.overdue_count}{" "}
                {t("health.overdueCount").toLowerCase()}
              </span>
              <span className="font-mono text-[11px] text-text-2">
                {fmtCurrency(healthData.total_overdue_amount, locale)}
              </span>
            </div>
          )}

          {/* ── Financial insight inline details ── */}
          {isFinancialInsight && financialData && (
            <FinancialInsightCard data={financialData} t={t} inline />
          )}

          {/* ── Optimize schedule inline details ── */}
          {isOptimizeSchedule && optimizeData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {optimizeData.team_member_name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text-2">
                  {optimizeData.date}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Route className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-[#6F94B0]">
                  -{optimizeData.distance_saved_km} km
                </span>
              </div>
            </div>
          )}

          {/* ── Reschedule tasks inline details ── */}
          {isRescheduleTasks && rescheduleData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {rescheduleData.resolution_type === "conflict" &&
                rescheduleData.conflict_details && (
                  <>
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="h-[12px] w-[12px] text-[#C4A868]" />
                      <span className="font-mono text-[11px] text-[#C4A868]">
                        {t("type.reschedule_tasks")}
                      </span>
                    </div>
                    <span className="max-w-[200px] truncate font-mono text-[11px] text-text-2">
                      {rescheduleData.team_member_name}
                    </span>
                  </>
                )}
              {rescheduleData.resolution_type === "assign" && (
                <>
                  <div className="flex items-center gap-1">
                    <MapPin className="h-[12px] w-[12px] text-text-3" />
                    <span className="max-w-[160px] truncate font-mono text-[11px] text-text-2">
                      {rescheduleData.task_title}
                    </span>
                  </div>
                  {(rescheduleMemberName ??
                    rescheduleData.suggested_team_member_name) && (
                    <div className="flex items-center gap-1">
                      <ArrowRight className="h-[10px] w-[10px] text-text-3" />
                      <User className="h-[12px] w-[12px] text-text-3" />
                      <span className="font-mono text-[11px] text-text-2">
                        {rescheduleMemberName ??
                          rescheduleData.suggested_team_member_name}
                      </span>
                    </div>
                  )}
                </>
              )}
              {rescheduleData.resolution_type === "cascade" && (
                <>
                  <div className="flex items-center gap-1">
                    <RefreshCw className="h-[12px] w-[12px] text-[#C4A868]" />
                    <span className="font-mono text-[11px] text-[#C4A868]">
                      {t("type.reschedule_tasks")}
                    </span>
                  </div>
                  <span className="max-w-[200px] truncate font-mono text-[11px] text-text-2">
                    {tSched("cascade.taskCount")
                      .replace(
                        "{{count}}",
                        String(rescheduleData.affected_tasks?.length ?? 0)
                      )
                      .replace(
                        "{{plural}}",
                        (rescheduleData.affected_tasks?.length ?? 0) === 1
                          ? ""
                          : "s"
                      )}
                  </span>
                </>
              )}
              {rescheduleData.weather_risk && (
                <div className="flex items-center gap-1">
                  <CloudRain className="h-[12px] w-[12px] text-[#C4A868]" />
                  <span className="font-mono text-[11px] text-[#C4A868]">
                    {tSched(
                      `weather.${rescheduleData.weather_risk.risk_level}`
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Appointment confirmation inline details ── */}
          {isAppointmentConfirm && appointmentData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {appointmentData.client_name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text">
                  {formatDateTime(
                    appointmentData.scheduled_date,
                    appointmentData.scheduled_time,
                    locale
                  )}
                </span>
              </div>
              {appointmentData.crew_names.length > 0 && (
                <div className="flex items-center gap-1">
                  <Users className="h-[12px] w-[12px] text-text-3" />
                  <span className="max-w-[160px] truncate font-mono text-[11px] text-text-2">
                    {appointmentData.crew_names.join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Day-before reminder inline details ── */}
          {isDayBeforeReminder && dayBeforeData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {dayBeforeData.client_name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <BellPlus className="h-[12px] w-[12px] text-[#6F94B0]" />
                <span className="font-mono text-[11px] uppercase text-[#6F94B0]">
                  {tComms("label.tomorrow")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text">
                  {formatDateTime(
                    dayBeforeData.scheduled_date,
                    dayBeforeData.scheduled_time,
                    locale
                  )}
                </span>
              </div>
              {dayBeforeData.weather_risk &&
                dayBeforeData.weather_risk.risk_level !== "low" && (
                  <div className="flex items-center gap-1">
                    <CloudRain className="h-[12px] w-[12px] text-[#C4A868]" />
                    <span className="font-mono text-[11px] text-[#C4A868]">
                      {tComms(
                        `weather.${dayBeforeData.weather_risk.risk_level}`
                      )}
                    </span>
                  </div>
                )}
            </div>
          )}

          {/* ── Process reschedule request inline details ── */}
          {isRescheduleRequest && rescheduleRequestData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <User className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {rescheduleRequestData.client_name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {rescheduleRequestData.task_title}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                <span className="font-mono text-[11px] text-text-3 line-through">
                  {formatDateTime(
                    rescheduleRequestData.original_start_date,
                    null,
                    locale
                  )}
                </span>
                <ArrowRight className="h-[10px] w-[10px] text-text-3" />
                <span className="font-mono text-[11px] text-[#6F94B0]">
                  {rescheduleRequestData.requested_date
                    ? formatDateTime(
                        rescheduleRequestData.requested_date,
                        null,
                        locale
                      )
                    : tComms("label.flexible")}
                </span>
              </div>
            </div>
          )}

          {/* ── Subcontractor coordination inline details ── */}
          {isSubcontractorCoord && subcontractorData && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1">
                <HardHat className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[160px] truncate font-mono text-[11px] text-text-2">
                  {subcontractorData.subcontractor_name}
                </span>
              </div>
              {subcontractorData.subcontractor_trade && (
                <span className="font-mono text-[11px] uppercase text-text-3">
                  [{subcontractorData.subcontractor_trade}]
                </span>
              )}
              <div className="flex items-center gap-1">
                <FolderKanban className="h-[12px] w-[12px] text-text-3" />
                <span className="max-w-[140px] truncate font-mono text-[11px] text-text-2">
                  {subcontractorData.project_title}
                </span>
              </div>
            </div>
          )}

          {/* Meta row: confidence, age, source link */}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div
              className="flex items-center gap-1"
              title={`${t("card.confidence")}: ${Math.round(action.confidence * 100)}%`}
            >
              <Gauge className="h-[14px] w-[14px] text-text-3" />
              <span className="font-mono text-[11px] text-text-3">
                {Math.round(action.confidence * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-[14px] w-[14px] text-text-3" />
              <span className="font-mono text-[11px] text-text-3">
                {timeAgo(action.createdAt, t)}
              </span>
            </div>
            {/* Fix 8: source link wrapped in 56dp touch target */}
            {sourceUrl && (
              <a
                href={sourceUrl}
                className="-my-4 flex min-h-[56px] items-center gap-1 px-1 font-mono text-[11px] text-text-3 transition-colors hover:text-text-2"
              >
                <ExternalLink className="h-[12px] w-[12px]" />
                {t("card.viewSource")}
              </a>
            )}
          </div>
        </div>

        {/* Right side: expand + action buttons */}
        <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
          {/* Expand toggle — 56dp tap area */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="-m-3 flex min-h-[56px] min-w-[56px] items-center justify-center"
            title={expanded ? t("action.collapse") : t("action.expand")}
          >
            {expanded ? (
              <ChevronUp className="h-[16px] w-[16px] text-text-3" />
            ) : (
              <ChevronDown className="h-[16px] w-[16px] text-text-3" />
            )}
          </button>

          {/* Approve / Reject — 56dp touch targets */}
          {/* Fix 21: Approve button is the ONE accent element per card */}
          {isPending && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleApproveWithEdits}
                className="bg-[rgba(111, 148, 176,0.15)] hover:bg-[rgba(111, 148, 176,0.25)] min-h-[36px] rounded px-4 font-mohave text-body-sm uppercase text-[#6F94B0] transition-colors"
              >
                {isFinancialInsight
                  ? t("financial.action.acknowledge")
                  : t("action.approve")}
              </button>
              <button
                onClick={() => onReject(action.id)}
                className="min-h-[36px] rounded bg-[rgba(147,50,26,0.10)] px-4 font-mohave text-body-sm uppercase text-[#93321A] transition-colors hover:bg-[rgba(147,50,26,0.20)]"
              >
                {isFinancialInsight
                  ? t("financial.action.dismiss")
                  : t("action.reject")}
              </button>
            </div>
          )}

          {/* Status badge for non-pending */}
          {!isPending && (
            <span
              className={cn(
                "rounded-bar px-2 py-0.5 font-mono text-[11px]",
                action.status === "executed" &&
                  "bg-[rgba(165,179,104,0.15)] text-[#A5B368]",
                action.status === "rejected" &&
                  "bg-[rgba(147,50,26,0.10)] text-[#93321A]",
                action.status === "failed" &&
                  "bg-[rgba(147,50,26,0.10)] text-[#93321A]",
                action.status === "expired" &&
                  "bg-[rgba(255,255,255,0.04)] text-text-3",
                action.status === "cancelled" &&
                  "bg-[rgba(255,255,255,0.04)] text-text-3",
                action.status === "approved" &&
                  "bg-[rgba(111, 148, 176,0.15)] text-[#6F94B0]"
              )}
            >
              [{t(`filter.${action.status}`)}]
            </span>
          )}
        </div>
      </div>

      {/* ── Expanded Details ── */}
      {/* Fix 20: opacity + translateY instead of scaleY to avoid content squish */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
            animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={
              shouldReduceMotion
                ? undefined
                : { duration: 0.15, ease: EASE_SMOOTH }
            }
          >
            <div className="border-t border-[rgba(255,255,255,0.06)] px-4 pb-4">
              <div className="space-y-3 pt-3">
                {/* ── Task-specific editable details ── */}
                {isTaskAction && taskData && isPending && (
                  <div className="space-y-3">
                    {/* Assignment editor */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("task.assignedTo")}]
                        </span>
                        {/* Fix 5: 56dp touch target on Change button */}
                        {!editingAssignment &&
                          teamMembers &&
                          teamMembers.length > 0 && (
                            <button
                              onClick={() => setEditingAssignment(true)}
                              className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                            >
                              {t("task.changeAssignment")}
                            </button>
                          )}
                      </div>
                      {editingAssignment && teamMembers ? (
                        /* Fix 6 + Fix 33: 56dp items, rounded-chip */
                        <div className="scrollbar-hide max-h-[200px] space-y-1 overflow-y-auto rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-1">
                          {teamMembers.map((member) => (
                            <button
                              key={member.id}
                              onClick={() => {
                                setSelectedMemberId(member.id);
                                setSelectedMemberName(member.name);
                                setEditingAssignment(false);
                              }}
                              className={cn(
                                "flex min-h-[36px] w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left transition-colors",
                                member.id === selectedMemberId
                                  ? "bg-[rgba(255,255,255,0.06)] text-text"
                                  : "text-text hover:bg-[rgba(255,255,255,0.03)]"
                              )}
                            >
                              <div className="min-w-0">
                                <span className="block truncate font-mohave text-body-sm">
                                  {member.name}
                                </span>
                                <span className="block font-mono text-micro text-text-3">
                                  {member.scheduledTaskCount != null
                                    ? `${member.scheduledTaskCount} ${t("task.tasks")}`
                                    : member.role}
                                </span>
                              </div>
                              {member.id === selectedMemberId && (
                                <Check className="h-[14px] w-[14px] shrink-0 text-[#6F94B0]" />
                              )}
                              {member.hasConflicts &&
                                member.id !== selectedMemberId && (
                                  <span className="shrink-0 font-mono text-micro text-[#C4A868]">
                                    {t("task.busy")}
                                  </span>
                                )}
                            </button>
                          ))}
                          {teamMembers.length === 0 && (
                            <p className="px-2.5 py-2 font-mono text-[11px] text-text-mute">
                              {t("task.noMembers")}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)]">
                            <User className="h-[12px] w-[12px] text-text-3" />
                          </div>
                          <span className="font-mohave text-body-sm text-text">
                            {selectedMemberName ?? t("task.unassigned")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Assignment reason */}
                    {taskData.assignment_reason && (
                      <div>
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("task.reason")}]
                        </span>
                        <p className="mt-0.5 font-mono text-[12px] text-text-2">
                          {taskData.assignment_reason}
                        </p>
                      </div>
                    )}

                    {/* Date editor */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("task.schedule")}]
                        </span>
                        {/* Fix 5: 56dp touch target on Change Dates button */}
                        {!editingDates && (
                          <button
                            onClick={() => setEditingDates(true)}
                            className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                          >
                            {t("task.changeDates")}
                          </button>
                        )}
                      </div>
                      {editingDates ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <div>
                            <label className="mb-0.5 block font-mono text-micro text-text-3">
                              {t("task.startDate")}
                            </label>
                            {/* Fix 7 + Fix 21: 56dp date input, neutral focus */}
                            <input
                              type="date"
                              value={editStartDate}
                              onChange={(e) => setEditStartDate(e.target.value)}
                              className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mohave text-body-sm text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block font-mono text-micro text-text-3">
                              {t("task.endDate")}
                            </label>
                            <input
                              type="date"
                              value={editEndDate}
                              onChange={(e) => setEditEndDate(e.target.value)}
                              className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mohave text-body-sm text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                            />
                          </div>
                          {/* Fix 5: 56dp Done button */}
                          <button
                            onClick={() => setEditingDates(false)}
                            className="mt-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                          >
                            {t("action.collapse")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-[14px] w-[14px] text-text-3" />
                          <span className="font-mohave text-body-sm text-text">
                            {formatDateRange(
                              editStartDate
                                ? new Date(editStartDate).toISOString()
                                : null,
                              editEndDate
                                ? new Date(editEndDate).toISOString()
                                : null,
                              locale
                            ) ?? t("task.unscheduled")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Status email expanded details ── */}
                {isStatusEmail && statusEmailData && isPending && (
                  <div className="space-y-3">
                    <div>
                      <span className="font-mono text-[11px] uppercase text-text-3">
                        [{t("lifecycle.recipient")}]
                      </span>
                      <p className="mt-0.5 font-mono text-[12px] text-text-2">
                        {statusEmailData.client_name} &lt;
                        {statusEmailData.client_email}&gt;
                      </p>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("lifecycle.emailPreview")}]
                        </span>
                        <button
                          onClick={() => setEditingDraft(!editingDraft)}
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingDraft
                            ? t("action.collapse")
                            : t("lifecycle.editDraft")}
                        </button>
                      </div>
                      {editingDraft ? (
                        <textarea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {draftText.slice(0, 200)}
                          {draftText.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Reassign expanded details ── */}
                {isReassign && reassignData && isPending && (
                  <div className="space-y-3">
                    <div>
                      <span className="font-mono text-[11px] uppercase text-text-3">
                        [{t("task.project")}]
                      </span>
                      <p className="mt-0.5 font-mono text-[12px] text-text-2">
                        {reassignData.project_title}
                      </p>
                    </div>
                    <div>
                      <span className="font-mono text-[11px] uppercase text-text-3">
                        [{t("lifecycle.overdueBy")}]
                      </span>
                      <p className="mt-0.5 font-mono text-[12px] text-[#C4A868]">
                        {reassignData.overdue_days} {t("lifecycle.days")}
                      </p>
                    </div>
                    {/* New assignee picker — reuse team member list */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("lifecycle.reassignTo")}]
                        </span>
                        {teamMembers && teamMembers.length > 0 && (
                          <button
                            onClick={() =>
                              setEditingAssignment(!editingAssignment)
                            }
                            className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                          >
                            {t("task.changeAssignment")}
                          </button>
                        )}
                      </div>
                      {editingAssignment && teamMembers ? (
                        <div className="scrollbar-hide max-h-[200px] space-y-1 overflow-y-auto rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-1">
                          {teamMembers.map((member) => (
                            <button
                              key={member.id}
                              onClick={() => {
                                setReassignMemberId(member.id);
                                setReassignMemberName(member.name);
                                setEditingAssignment(false);
                              }}
                              className={cn(
                                "flex min-h-[36px] w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left transition-colors",
                                member.id === reassignMemberId
                                  ? "bg-[rgba(255,255,255,0.06)] text-text"
                                  : "text-text hover:bg-[rgba(255,255,255,0.03)]"
                              )}
                            >
                              <div className="min-w-0">
                                <span className="block truncate font-mohave text-body-sm">
                                  {member.name}
                                </span>
                                <span className="block font-mono text-micro text-text-3">
                                  {member.scheduledTaskCount != null
                                    ? `${member.scheduledTaskCount} ${t("task.tasks")}`
                                    : member.role}
                                </span>
                              </div>
                              {member.id === reassignMemberId && (
                                <Check className="h-[14px] w-[14px] shrink-0 text-[#6F94B0]" />
                              )}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)]">
                            <User className="h-[12px] w-[12px] text-text-3" />
                          </div>
                          <span className="font-mohave text-body-sm text-text">
                            {reassignMemberName ??
                              reassignData.suggested_team_member_name}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Reason */}
                    {reassignData.assignment_reason && (
                      <div>
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("task.reason")}]
                        </span>
                        <p className="mt-0.5 font-mono text-[12px] text-text-2">
                          {reassignData.assignment_reason}
                        </p>
                      </div>
                    )}
                    {/* Reschedule dates */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("lifecycle.newSchedule")}]
                        </span>
                        <button
                          onClick={() => setEditingDates(!editingDates)}
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {t("task.changeDates")}
                        </button>
                      </div>
                      {editingDates ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <div>
                            <label className="mb-0.5 block font-mono text-micro text-text-3">
                              {t("task.startDate")}
                            </label>
                            <input
                              type="date"
                              value={reassignStartDate}
                              onChange={(e) =>
                                setReassignStartDate(e.target.value)
                              }
                              className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mohave text-body-sm text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block font-mono text-micro text-text-3">
                              {t("task.endDate")}
                            </label>
                            <input
                              type="date"
                              value={reassignEndDate}
                              onChange={(e) =>
                                setReassignEndDate(e.target.value)
                              }
                              className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mohave text-body-sm text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                            />
                          </div>
                          <button
                            onClick={() => setEditingDates(false)}
                            className="mt-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                          >
                            {t("action.collapse")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-[14px] w-[14px] text-text-3" />
                          <span className="font-mohave text-body-sm text-text">
                            {formatDateRange(
                              reassignStartDate
                                ? new Date(reassignStartDate).toISOString()
                                : null,
                              reassignEndDate
                                ? new Date(reassignEndDate).toISOString()
                                : null,
                              locale
                            ) ?? t("task.unscheduled")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Project lifecycle (archive / close) expanded details ── */}
                {isProjectLifecycle && lifecycleData && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-4">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("lifecycle.completedDate")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {lifecycleData.completed_date
                            ? new Date(
                                lifecycleData.completed_date
                              ).toLocaleDateString(locale, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("lifecycle.taskSummary")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {lifecycleData.completed_tasks}/
                          {lifecycleData.total_tasks}{" "}
                          {t("lifecycle.tasksComplete")}
                        </span>
                      </div>
                      {lifecycleData.total_invoiced > 0 && (
                        <div>
                          <span className="block font-mono text-[11px] uppercase text-text-3">
                            [{t("lifecycle.invoiced")}]
                          </span>
                          <span className="font-mono text-[12px] text-text-2">
                            {lifecycleData.total_invoiced.toLocaleString(
                              locale,
                              { style: "currency", currency: "USD" }
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Create invoice expanded details ── */}
                {isCreateInvoice && invoiceData && isPending && (
                  <div className="space-y-3">
                    {/* Warnings */}
                    {invoiceData.warnings.length > 0 && (
                      <div className="space-y-1.5">
                        {invoiceData.warnings.map((warning, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-2 rounded-chip border-l-[3px] border-l-[#C4A868] bg-[rgba(196,168,104,0.06)] px-3 py-2"
                          >
                            <AlertTriangle className="mt-0.5 h-[14px] w-[14px] shrink-0 text-[#C4A868]" />
                            <span className="font-mono text-[12px] text-[#C4A868]">
                              {renderWarning(warning, t, locale)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Client + project */}
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("invoice.client")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {invoiceData.client_name}
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("invoice.project")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {invoiceData.project_title}
                        </span>
                      </div>
                      {invoiceData.estimate_id && (
                        <div>
                          <span className="block font-mono text-[11px] uppercase text-text-3">
                            [{t("invoice.estimate")}]
                          </span>
                          <span className="font-mono text-[12px] text-text-2">
                            {invoiceData.estimate_id.slice(0, 8)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Line items table */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("invoice.lineItems")}]
                        </span>
                        <button
                          onClick={() => setEditingLineItems(!editingLineItems)}
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingLineItems
                            ? t("action.collapse")
                            : t("invoice.editLineItems")}
                        </button>
                      </div>

                      <div className="overflow-hidden rounded-chip border border-[rgba(255,255,255,0.06)]">
                        {/* Header */}
                        <div className="grid grid-cols-[1fr_60px_80px_80px] gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-1.5">
                          <span className="font-mono text-micro uppercase text-text-3">
                            {t("invoice.item")}
                          </span>
                          <span className="text-right font-mono text-micro uppercase text-text-3">
                            {t("invoice.qty")}
                          </span>
                          <span className="text-right font-mono text-micro uppercase text-text-3">
                            {t("invoice.unitPrice")}
                          </span>
                          <span className="text-right font-mono text-micro uppercase text-text-3">
                            {t("invoice.lineTotal")}
                          </span>
                        </div>

                        {/* Rows */}
                        <div className="scrollbar-hide max-h-[240px] overflow-y-auto">
                          {invoiceLineItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-[1fr_60px_80px_80px] items-center gap-2 border-b border-[rgba(255,255,255,0.04)] px-3 py-2 last:border-b-0"
                            >
                              {editingLineItems ? (
                                <>
                                  <input
                                    type="text"
                                    value={item.name}
                                    onChange={(e) => {
                                      const updated = [...invoiceLineItems];
                                      updated[idx] = {
                                        ...updated[idx],
                                        name: e.target.value,
                                      };
                                      setInvoiceLineItems(updated);
                                    }}
                                    className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2 py-1 font-mono text-[12px] text-text outline-none focus:border-[rgba(255,255,255,0.20)]"
                                  />
                                  <input
                                    type="number"
                                    value={item.quantity}
                                    onChange={(e) => {
                                      const updated = [...invoiceLineItems];
                                      updated[idx] = {
                                        ...updated[idx],
                                        quantity: Number(e.target.value) || 0,
                                      };
                                      setInvoiceLineItems(updated);
                                    }}
                                    className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-right font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                                    min={0}
                                    step="any"
                                  />
                                  <input
                                    type="number"
                                    value={item.unit_price}
                                    onChange={(e) => {
                                      const updated = [...invoiceLineItems];
                                      updated[idx] = {
                                        ...updated[idx],
                                        unit_price: Number(e.target.value) || 0,
                                      };
                                      setInvoiceLineItems(updated);
                                    }}
                                    className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-right font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                                    min={0}
                                    step="0.01"
                                  />
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="font-mono text-[12px] text-text-2">
                                      {fmtCurrency(
                                        item.quantity * item.unit_price,
                                        locale
                                      )}
                                    </span>
                                    <button
                                      onClick={() => {
                                        const updated = invoiceLineItems.filter(
                                          (_, i) => i !== idx
                                        );
                                        setInvoiceLineItems(updated);
                                      }}
                                      className="flex min-h-[36px] min-w-[36px] items-center justify-center text-text-3 transition-colors hover:text-[#93321A]"
                                    >
                                      <Trash2 className="h-[12px] w-[12px]" />
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <span className="truncate font-mono text-[12px] text-text">
                                    {item.name}
                                  </span>
                                  <span className="text-right font-mono text-[12px] text-text-2">
                                    {item.quantity}
                                  </span>
                                  <span className="text-right font-mono text-[12px] text-text-2">
                                    {fmtCurrency(item.unit_price, locale)}
                                  </span>
                                  <span className="text-right font-mono text-[12px] text-text">
                                    {fmtCurrency(
                                      item.quantity * item.unit_price,
                                      locale
                                    )}
                                  </span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Add line item button (edit mode only) */}
                        {editingLineItems && (
                          <button
                            onClick={() => {
                              setInvoiceLineItems([
                                ...invoiceLineItems,
                                {
                                  name: "",
                                  description: null,
                                  quantity: 1,
                                  unit: "ea",
                                  unit_price: 0,
                                  type: "LABOR" as const,
                                  task_type_id: null,
                                  is_taxable: true,
                                  sort_order: invoiceLineItems.length,
                                  category: null,
                                },
                              ]);
                            }}
                            className="flex min-h-[36px] w-full items-center justify-center gap-1 border-t border-[rgba(255,255,255,0.06)] px-3 py-2 text-text-3 transition-colors hover:text-text-2"
                          >
                            <Plus className="h-[12px] w-[12px]" />
                            <span className="font-mono text-[11px]">
                              {t("invoice.addLine")}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Totals summary */}
                    {(() => {
                      const subtotal = invoiceLineItems.reduce(
                        (s, li) => s + li.quantity * li.unit_price,
                        0
                      );
                      const discountAmt =
                        invoiceData.discount_type === "percentage" &&
                        invoiceData.discount_value
                          ? subtotal * (invoiceData.discount_value / 100)
                          : (invoiceData.discount_amount ?? 0);
                      const taxableSubtotal = invoiceLineItems
                        .filter((li) => li.is_taxable)
                        .reduce((s, li) => s + li.quantity * li.unit_price, 0);
                      const taxAmt =
                        taxableSubtotal * ((invoiceData.tax_rate ?? 0) / 100);
                      const total = subtotal - discountAmt + taxAmt;

                      return (
                        <div className="flex justify-end">
                          <div className="w-[240px] space-y-1">
                            <div className="flex justify-between">
                              <span className="font-mono text-[11px] text-text-3">
                                {t("invoice.subtotal")}
                              </span>
                              <span className="font-mono text-[12px] text-text-2">
                                {fmtCurrency(subtotal, locale)}
                              </span>
                            </div>
                            {discountAmt > 0 && (
                              <div className="flex justify-between">
                                <span className="font-mono text-[11px] text-text-3">
                                  {t("invoice.discount")}
                                </span>
                                <span className="font-mono text-[12px] text-text-2">
                                  -{fmtCurrency(discountAmt, locale)}
                                </span>
                              </div>
                            )}
                            {(invoiceData.tax_rate ?? 0) > 0 && (
                              <div className="flex justify-between">
                                <span className="font-mono text-[11px] text-text-3">
                                  {t("invoice.tax")} ({invoiceData.tax_rate}%)
                                </span>
                                <span className="font-mono text-[12px] text-text-2">
                                  {fmtCurrency(taxAmt, locale)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between border-t border-[rgba(255,255,255,0.08)] pt-1">
                              <span className="font-mohave text-body-sm uppercase text-text">
                                {t("invoice.total")}
                              </span>
                              <span className="font-mono text-[14px] font-medium text-text">
                                {fmtCurrency(total, locale)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Payment terms & due date */}
                    <div className="flex flex-wrap items-start gap-6">
                      <div>
                        <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                          [{t("invoice.paymentTerms")}]
                        </span>
                        {editingLineItems ? (
                          <select
                            value={invoicePaymentTerms}
                            onChange={(e) =>
                              setInvoicePaymentTerms(e.target.value)
                            }
                            className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mohave text-body-sm text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                          >
                            <option value="NET-15">NET-15</option>
                            <option value="NET-30">NET-30</option>
                            <option value="NET-45">NET-45</option>
                            <option value="NET-60">NET-60</option>
                          </select>
                        ) : (
                          <span className="font-mohave text-body-sm text-text">
                            {invoicePaymentTerms || "—"}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                          [{t("invoice.dueDate")}]
                        </span>
                        {editingLineItems ? (
                          <input
                            type="date"
                            value={invoiceDueDate}
                            onChange={(e) => setInvoiceDueDate(e.target.value)}
                            className="min-h-[36px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 font-mohave text-body-sm text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                          />
                        ) : (
                          <span className="font-mohave text-body-sm text-text">
                            {invoiceDueDate
                              ? new Date(invoiceDueDate).toLocaleDateString(
                                  locale,
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  }
                                )
                              : "—"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Cover email indicator */}
                    {invoiceData.cover_email && invoiceData.cover_email.to && (
                      <div className="flex items-center gap-2 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                        <Mail className="h-[14px] w-[14px] text-text-3" />
                        <span className="font-mono text-[12px] text-text-2">
                          {t("invoice.coverEmail")}:{" "}
                          {invoiceData.cover_email.to}
                        </span>
                      </div>
                    )}
                    {!invoiceData.cover_email?.to && (
                      <div className="flex items-center gap-2 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                        <AlertTriangle className="h-[14px] w-[14px] text-text-3" />
                        <span className="font-mono text-[12px] text-text-3">
                          {t("invoice.noEmail")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Invoice email expanded details ── */}
                {isInvoiceEmail && invoiceEmailData && isPending && (
                  <div className="space-y-3">
                    {/* Recipient + invoice context */}
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("invoiceEmail.recipient")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {invoiceEmailData.client_name} &lt;
                          {invoiceEmailData.to_email}&gt;
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("invoiceEmail.invoice")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          #{invoiceEmailData.invoice_number} —{" "}
                          {invoiceEmailData.invoice_total.toLocaleString(
                            locale,
                            { style: "currency", currency: "USD" }
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Subject */}
                    <div>
                      <span className="block font-mono text-[11px] uppercase text-text-3">
                        [{t("invoiceEmail.subject")}]
                      </span>
                      <span className="mt-0.5 block font-mono text-[12px] text-text-2">
                        {invoiceEmailData.subject}
                      </span>
                    </div>

                    {/* Email draft */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("invoiceEmail.preview")}]
                        </span>
                        <button
                          onClick={() =>
                            setEditingInvoiceEmail(!editingInvoiceEmail)
                          }
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingInvoiceEmail
                            ? t("action.collapse")
                            : t("invoiceEmail.edit")}
                        </button>
                      </div>
                      {editingInvoiceEmail ? (
                        <textarea
                          value={invoiceEmailDraft}
                          onChange={(e) => setInvoiceEmailDraft(e.target.value)}
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {invoiceEmailDraft.slice(0, 200)}
                          {invoiceEmailDraft.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>

                    {/* Attachment indicator */}
                    {invoiceEmailData.attachments.length > 0 && (
                      <div className="flex items-center gap-2 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                        <Paperclip className="h-[14px] w-[14px] text-text-3" />
                        <span className="font-mono text-[12px] text-text-2">
                          {t("invoiceEmail.attachment")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Payment reminder expanded details ── */}
                {isPaymentReminder && reminderData && isPending && (
                  <div className="space-y-3">
                    {/* Client + Invoice context */}
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("reminder.client")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {reminderData.client_name} &lt;
                          {reminderData.client_email}&gt;
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("reminder.invoiceNumber")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          #{reminderData.invoice_number}
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("reminder.balanceDue")}]
                        </span>
                        <span className="font-mono text-[14px] font-medium text-text">
                          {fmtCurrency(
                            reminderData.balance_due,
                            locale,
                            reminderData.currency_code
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Escalation level bar */}
                    <div>
                      <span className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
                        [{t("reminder.level")}]
                      </span>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4].map((level) => (
                          <div
                            key={level}
                            className="h-[6px] flex-1 rounded-bar transition-colors"
                            style={{
                              backgroundColor:
                                level <= reminderData.reminder_level
                                  ? level >= 4
                                    ? "#93321A"
                                    : level >= 3
                                      ? "#C4A868"
                                      : level >= 2
                                        ? "#C4A868"
                                        : "rgba(255,255,255,0.2)"
                                  : "rgba(255,255,255,0.06)",
                            }}
                          />
                        ))}
                      </div>
                      <span
                        className="mt-1 block font-mono text-[11px]"
                        style={{
                          color:
                            reminderData.reminder_level >= 4
                              ? "#93321A"
                              : reminderData.reminder_level >= 3
                                ? "#C4A868"
                                : reminderData.reminder_level >= 2
                                  ? "#C4A868"
                                  : "rgba(255,255,255,0.5)",
                        }}
                      >
                        {t(`reminder.tone.${reminderData.reminder_tone}`)}
                      </span>
                    </div>

                    {/* No connection warning */}
                    {!reminderData.connection_id && (
                      <div className="flex items-start gap-2 rounded-chip border-l-[3px] border-l-[#C4A868] bg-[rgba(196,168,104,0.06)] px-3 py-2">
                        <AlertTriangle className="mt-0.5 h-[14px] w-[14px] shrink-0 text-[#C4A868]" />
                        <span className="font-mono text-[12px] text-[#C4A868]">
                          {t("reminder.noConnection")}
                        </span>
                      </div>
                    )}

                    {/* Email draft — editable */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{t("reminder.emailPreview")}]
                        </span>
                        <button
                          onClick={() =>
                            setEditingReminderDraft(!editingReminderDraft)
                          }
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingReminderDraft
                            ? t("action.collapse")
                            : t("reminder.editDraft")}
                        </button>
                      </div>
                      {editingReminderDraft ? (
                        <textarea
                          value={reminderDraft}
                          onChange={(e) => setReminderDraft(e.target.value)}
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {reminderDraft.slice(0, 200)}
                          {reminderDraft.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>

                    {/* Client payment history summary */}
                    {reminderData.payment_summary && (
                      <div>
                        <span className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
                          [{t("reminder.paymentHistory")}]
                        </span>
                        <div className="flex flex-wrap items-center gap-6 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
                          <div>
                            <span className="block font-mono text-micro text-text-3">
                              {t("reminder.onTimeRate")}
                            </span>
                            <span className="font-mono text-[13px] text-text">
                              {Math.round(
                                reminderData.payment_summary.on_time_rate * 100
                              )}
                              %
                            </span>
                          </div>
                          {reminderData.payment_summary.avg_days_to_pay !=
                            null && (
                            <div>
                              <span className="block font-mono text-micro text-text-3">
                                {t("reminder.avgDays")}
                              </span>
                              <span className="font-mono text-[13px] text-text">
                                {reminderData.payment_summary.avg_days_to_pay}d
                              </span>
                            </div>
                          )}
                          <div>
                            <span className="block font-mono text-micro text-text-3">
                              {t("health.overdueCount")}
                            </span>
                            <span className="font-mono text-[13px] text-[#C4A868]">
                              {reminderData.payment_summary.currently_overdue}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Client health alert expanded details ── */}
                {isHealthAlert && healthData && (
                  <div className="space-y-3">
                    {/* Metrics row */}
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("health.lateRate")}]
                        </span>
                        <span className="font-mono text-[14px] font-medium text-[#93321A]">
                          {Math.round(healthData.late_rate * 100)}%
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("health.overdueCount")}]
                        </span>
                        <span className="font-mono text-[14px] font-medium text-[#C4A868]">
                          {healthData.overdue_count}
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{t("health.totalOverdue")}]
                        </span>
                        <span className="font-mono text-[14px] font-medium text-text">
                          {fmtCurrency(healthData.total_overdue_amount, locale)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Financial insight expanded details (full dashboard) ── */}
                {isFinancialInsight && financialData && (
                  <FinancialInsightCard data={financialData} t={t} />
                )}

                {/* ── Optimize schedule expanded details ── */}
                {/*
                  Accent usage: The card already has one accent element (Approve button).
                  Inside this expanded section we keep the route visualization neutral
                  and only use text-primary/text-secondary to distinguish current vs.
                  suggested. The "distance saved" value stays text-secondary as well.
                */}
                {isOptimizeSchedule && optimizeData && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {/* Current route */}
                      <div>
                        <span className="mb-2 block font-mono text-[11px] text-text-3">
                          [{tSched("route.currentRoute")}]
                        </span>
                        <div className="space-y-1">
                          {optimizeData.current_order.map((stop, idx) => (
                            <div
                              key={stop.task_id}
                              className="flex items-start gap-2"
                            >
                              <div className="flex flex-col items-center">
                                <div className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.12)]">
                                  <span className="font-mono text-micro text-text-3">
                                    {idx + 1}
                                  </span>
                                </div>
                                {idx <
                                  optimizeData.current_order.length - 1 && (
                                  <div className="h-[16px] w-[1px] bg-[rgba(255,255,255,0.08)]" />
                                )}
                              </div>
                              <div className="min-w-0 pt-[2px]">
                                <span className="block truncate font-mohave text-[12px] text-text-2">
                                  {stop.task_title}
                                </span>
                                {stop.address && (
                                  <span className="block truncate font-mono text-micro text-text-3">
                                    {stop.address}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <span className="mt-2 block font-mono text-micro text-text-3">
                          {optimizeData.current_distance_km} km
                        </span>
                      </div>

                      {/* Suggested route */}
                      <div>
                        <span className="mb-2 block font-mono text-[11px] text-text-3">
                          [{tSched("route.suggestedRoute")}]
                        </span>
                        <div className="space-y-1">
                          {optimizeData.suggested_order.map((stop, idx) => (
                            <div
                              key={stop.task_id}
                              className="flex items-start gap-2"
                            >
                              <div className="flex flex-col items-center">
                                <div className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.24)]">
                                  <span className="font-mono text-micro text-text">
                                    {idx + 1}
                                  </span>
                                </div>
                                {idx <
                                  optimizeData.suggested_order.length - 1 && (
                                  <div className="h-[16px] w-[1px] bg-[rgba(255,255,255,0.16)]" />
                                )}
                              </div>
                              <div className="min-w-0 pt-[2px]">
                                <span className="block truncate font-mohave text-[12px] text-text">
                                  {stop.task_title}
                                </span>
                                {stop.address && (
                                  <span className="block truncate font-mono text-micro text-text-3">
                                    {stop.address}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <span className="mt-2 block font-mono text-micro text-text-2">
                          {optimizeData.suggested_distance_km} km (−
                          {optimizeData.distance_saved_km} km)
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Reschedule tasks expanded details ── */}
                {/* Shown for both pending and non-pending states (read-only view when not pending). */}
                {isRescheduleTasks && rescheduleData && (
                  <div className="space-y-3">
                    {/* Conflict visualization */}
                    {rescheduleData.resolution_type === "conflict" &&
                      rescheduleData.conflict_details && (
                        <div className="space-y-2">
                          <span className="font-mono text-[11px] text-text-3">
                            [{tSched("conflict.overlap")}]
                          </span>
                          <div className="space-y-1">
                            {rescheduleData.conflict_details.map((task) => (
                              <div
                                key={task.task_id}
                                className="flex items-center gap-2 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2 py-1.5"
                              >
                                <div
                                  className="h-[28px] w-[3px] rounded-full"
                                  style={{
                                    backgroundColor:
                                      task.task_id ===
                                      rescheduleData.conflicting_task_ids?.[0]
                                        ? "#C4A868"
                                        : "#93321A",
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate font-mohave text-[12px] text-text">
                                    {task.task_title}
                                  </span>
                                  <span className="font-mono text-micro text-text-3">
                                    {task.project_name} ·{" "}
                                    {formatDateRange(
                                      task.start_date,
                                      task.end_date,
                                      locale
                                    )}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {rescheduleData.suggested_resolution && (
                            <div className="mt-2 rounded-chip border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-2 py-2">
                              <span className="mb-1 block font-mono text-micro text-text-3">
                                [{tSched("conflict.resolution")}]
                              </span>
                              <span className="font-mono text-[12px] text-text-2">
                                {tSched("conflict.reschedule")}: &quot;
                                {rescheduleData.suggested_resolution.task_title}
                                &quot; →{" "}
                                {rescheduleStartDate
                                  ? formatDateRange(
                                      new Date(
                                        rescheduleStartDate
                                      ).toISOString(),
                                      null,
                                      locale
                                    )
                                  : (formatDateRange(
                                      rescheduleData.suggested_resolution
                                        .new_start_date,
                                      rescheduleData.suggested_resolution
                                        .new_end_date,
                                      locale
                                    ) ?? t("task.unscheduled"))}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                    {/* Unassigned task assignment */}
                    {rescheduleData.resolution_type === "assign" && (
                      <div className="space-y-2">
                        <div>
                          <span className="font-mono text-[11px] text-text-3">
                            [{tSched("unassigned.task")}]
                          </span>
                          <p className="mt-0.5 font-mohave text-[13px] text-text">
                            {rescheduleData.task_title}
                          </p>
                          {rescheduleData.project_name && (
                            <p className="font-mono text-[11px] text-text-3">
                              {rescheduleData.project_name}
                            </p>
                          )}
                        </div>
                        {/* Assignee with change option */}
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="font-mono text-[11px] text-text-3">
                              [{tSched("unassigned.suggestedAssignee")}]
                            </span>
                            {isPending &&
                              teamMembers &&
                              teamMembers.length > 0 && (
                                <button
                                  onClick={() =>
                                    setEditingAssignment(!editingAssignment)
                                  }
                                  className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                                >
                                  {t("task.changeAssignment")}
                                </button>
                              )}
                          </div>
                          {editingAssignment && teamMembers ? (
                            <div className="scrollbar-hide max-h-[200px] space-y-1 overflow-y-auto rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-1">
                              {teamMembers.map((member) => (
                                <button
                                  key={member.id}
                                  onClick={() => {
                                    setRescheduleMemberId(member.id);
                                    setRescheduleMemberName(member.name);
                                    setEditingAssignment(false);
                                  }}
                                  className={cn(
                                    "flex min-h-[36px] w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left transition-colors",
                                    member.id === rescheduleMemberId
                                      ? "bg-[rgba(255,255,255,0.06)] text-text"
                                      : "text-text hover:bg-[rgba(255,255,255,0.03)]"
                                  )}
                                >
                                  <div className="min-w-0">
                                    <span className="block truncate font-mohave text-body-sm">
                                      {member.name}
                                    </span>
                                    <span className="block font-mono text-micro text-text-3">
                                      {member.scheduledTaskCount != null
                                        ? `${member.scheduledTaskCount} ${t("task.tasks")}`
                                        : member.role}
                                    </span>
                                  </div>
                                  {member.id === rescheduleMemberId && (
                                    <Check className="h-[14px] w-[14px] shrink-0 text-[#6F94B0]" />
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)]">
                                <User className="h-[12px] w-[12px] text-text-3" />
                              </div>
                              <span className="font-mohave text-body-sm text-text">
                                {rescheduleMemberName ?? t("task.unassigned")}
                              </span>
                            </div>
                          )}
                        </div>
                        {rescheduleData.assignment_reason && (
                          <div>
                            <span className="font-mono text-[11px] text-text-3">
                              [{tSched("unassigned.reason")}]
                            </span>
                            <p className="mt-0.5 font-mono text-[12px] text-text-2">
                              {rescheduleData.assignment_reason}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Cascade chain */}
                    {rescheduleData.resolution_type === "cascade" && (
                      <div className="space-y-2">
                        <div>
                          <span className="font-mono text-[11px] text-text-3">
                            [{tSched("cascade.trigger")}]
                          </span>
                          <p className="mt-0.5 font-mono text-[12px] text-text-2">
                            {rescheduleData.cascade_change_type} → &quot;
                            {rescheduleData.cascade_source_task_title}&quot;
                          </p>
                        </div>
                        {rescheduleData.affected_tasks &&
                          rescheduleData.affected_tasks.length > 0 && (
                            <div>
                              <span className="font-mono text-[11px] text-text-3">
                                [{tSched("cascade.affectedTasks")}]
                              </span>
                              <div className="mt-1 space-y-1">
                                {rescheduleData.affected_tasks.map((task) => (
                                  <div
                                    key={task.task_id}
                                    className="flex items-center justify-between rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2 py-1.5"
                                  >
                                    <div className="min-w-0">
                                      <span className="block truncate font-mohave text-[12px] text-text">
                                        {task.task_title}
                                      </span>
                                      <span className="font-mono text-micro text-text-3">
                                        {task.project_name}
                                      </span>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      {task.current_start_date && (
                                        <span className="block font-mono text-micro text-text-3">
                                          {formatDateRange(
                                            task.current_start_date,
                                            task.current_end_date,
                                            locale
                                          )}
                                        </span>
                                      )}
                                      {task.proposed_start_date && (
                                        <span className="block font-mono text-micro text-text-2">
                                          →{" "}
                                          {formatDateRange(
                                            task.proposed_start_date,
                                            task.proposed_end_date,
                                            locale
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {/* Weather warning */}
                    {rescheduleData.weather_risk && (
                      <div className="rounded-chip border border-[rgba(196,168,104,0.2)] bg-[rgba(196,168,104,0.05)] px-2 py-2">
                        <div className="flex items-center gap-2">
                          <CloudRain className="h-[14px] w-[14px] shrink-0 text-[#C4A868]" />
                          <span className="font-mono text-[11px] text-[#C4A868]">
                            [
                            {tSched(
                              `weather.${rescheduleData.weather_risk.risk_level}`
                            )}{" "}
                            {tSched("weather.riskLevel").toLowerCase()}]
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Appointment confirmation expanded details ── */}
                {isAppointmentConfirm && appointmentData && isPending && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.client")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {appointmentData.client_name} &lt;
                          {appointmentData.client_email}&gt;
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.project")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {appointmentData.project_title}
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.scheduled")}]
                        </span>
                        <span className="font-mono text-[13px] text-text">
                          {formatDateTime(
                            appointmentData.scheduled_date,
                            appointmentData.scheduled_time,
                            locale
                          )}
                        </span>
                      </div>
                    </div>

                    {appointmentData.crew_names.length > 0 && (
                      <div>
                        <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.crew")}]
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {appointmentData.crew_names.map((name) => (
                            <div
                              key={name}
                              className="flex items-center gap-1 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-2 py-1"
                            >
                              <User className="h-[12px] w-[12px] text-text-3" />
                              <span className="font-mohave text-[12px] text-text">
                                {name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {appointmentData.project_address && (
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.address")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {appointmentData.project_address}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.duration")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {appointmentData.duration_hours}h
                        </span>
                      </div>
                    </div>

                    {/* Editable subject */}
                    <div>
                      <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.subject")}]
                      </span>
                      <input
                        type="text"
                        value={appointmentSubject}
                        onChange={(e) => setAppointmentSubject(e.target.value)}
                        className="min-h-[36px] w-full rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 font-mohave text-body-sm text-text outline-none focus:border-[rgba(255,255,255,0.20)]"
                      />
                    </div>

                    {/* Editable draft */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.emailPreview")}]
                        </span>
                        <button
                          onClick={() =>
                            setEditingAppointmentDraft(!editingAppointmentDraft)
                          }
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingAppointmentDraft
                            ? tComms("action.collapse")
                            : tComms("action.editDraft")}
                        </button>
                      </div>
                      {editingAppointmentDraft ? (
                        <textarea
                          value={appointmentDraft}
                          onChange={(e) => setAppointmentDraft(e.target.value)}
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {appointmentDraft.slice(0, 200)}
                          {appointmentDraft.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Day-before reminder expanded details ── */}
                {isDayBeforeReminder && dayBeforeData && isPending && (
                  <div
                    className={cn(
                      "space-y-3",
                      dayBeforeData.weather_risk &&
                        dayBeforeData.weather_risk.risk_level !== "low" &&
                        "rounded-chip border border-[rgba(196,168,104,0.25)] bg-[rgba(196,168,104,0.04)] px-3 py-3"
                    )}
                  >
                    {/* TOMORROW badge */}
                    <div className="flex items-center gap-2">
                      <BellPlus className="h-[14px] w-[14px] text-[#6F94B0]" />
                      <span className="font-mohave text-[14px] uppercase tracking-wider text-[#6F94B0]">
                        {tComms("label.tomorrow")} —{" "}
                        {formatDateTime(
                          dayBeforeData.scheduled_date,
                          dayBeforeData.scheduled_time,
                          locale
                        )}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.client")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {dayBeforeData.client_name} &lt;
                          {dayBeforeData.client_email}&gt;
                        </span>
                      </div>
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.project")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {dayBeforeData.project_title}
                        </span>
                      </div>
                    </div>

                    {dayBeforeData.crew_names.length > 0 && (
                      <div>
                        <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.crewArriving")}]
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {dayBeforeData.crew_names.map((name) => (
                            <div
                              key={name}
                              className="flex items-center gap-1 rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-2 py-1"
                            >
                              <User className="h-[12px] w-[12px] text-text-3" />
                              <span className="font-mohave text-[12px] text-text">
                                {name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {dayBeforeData.weather_risk &&
                      dayBeforeData.weather_risk.risk_level !== "low" && (
                        <div className="flex items-start gap-2 rounded-chip border border-[rgba(196,168,104,0.20)] bg-[rgba(196,168,104,0.06)] px-3 py-2">
                          <CloudRain className="mt-0.5 h-[14px] w-[14px] shrink-0 text-[#C4A868]" />
                          <div>
                            <span className="block font-mono text-[11px] uppercase text-[#C4A868]">
                              [{tComms("weather.warning")}]
                            </span>
                            <span className="font-mono text-[12px] text-[#C4A868]">
                              {tComms(
                                `weather.${dayBeforeData.weather_risk.risk_level}`
                              )}
                              {" — "}
                              {interpolate(
                                tComms(
                                  `weather.reason.${dayBeforeData.weather_risk.reason.type}`
                                ),
                                dayBeforeData.weather_risk.reason.params
                              )}
                            </span>
                          </div>
                        </div>
                      )}

                    {/* Editable subject */}
                    <div>
                      <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.subject")}]
                      </span>
                      <input
                        type="text"
                        value={dayBeforeSubject}
                        onChange={(e) => setDayBeforeSubject(e.target.value)}
                        className="min-h-[36px] w-full rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 font-mohave text-body-sm text-text outline-none focus:border-[rgba(255,255,255,0.20)]"
                      />
                    </div>

                    {/* Editable draft */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.emailPreview")}]
                        </span>
                        <button
                          onClick={() =>
                            setEditingDayBeforeDraft(!editingDayBeforeDraft)
                          }
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingDayBeforeDraft
                            ? tComms("action.collapse")
                            : tComms("action.editDraft")}
                        </button>
                      </div>
                      {editingDayBeforeDraft ? (
                        <textarea
                          value={dayBeforeDraft}
                          onChange={(e) => setDayBeforeDraft(e.target.value)}
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {dayBeforeDraft.slice(0, 200)}
                          {dayBeforeDraft.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Process reschedule request expanded details ── */}
                {isRescheduleRequest && rescheduleRequestData && isPending && (
                  <div className="space-y-3">
                    {/* Incoming client email excerpt */}
                    <div>
                      <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.incomingMessage")}]
                      </span>
                      <blockquote className="line-clamp-6 whitespace-pre-wrap border-l-[2px] border-l-[rgba(255,255,255,0.12)] pl-3 font-mono text-[12px] italic text-text-2">
                        &quot;{rescheduleRequestData.incoming_message_excerpt}
                        &quot;
                      </blockquote>
                    </div>

                    {/* Detected task + date change */}
                    <div>
                      <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.detectedTask")}]
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mohave text-[13px] text-text">
                          {rescheduleRequestData.task_title}
                        </span>
                        <span className="font-mono text-[11px] text-text-3 line-through">
                          {formatDateTime(
                            rescheduleRequestData.original_start_date,
                            null,
                            locale
                          )}
                        </span>
                        <ArrowRight className="h-[12px] w-[12px] text-text-3" />
                        <span className="font-mono text-[11px] text-[#6F94B0]">
                          {rescheduleRequestData.requested_date
                            ? formatDateTime(
                                rescheduleRequestData.requested_date,
                                null,
                                locale
                              )
                            : tComms("label.flexible")}
                        </span>
                      </div>
                      {rescheduleRequestData.requested_reason && (
                        <p className="mt-1 font-mono text-[11px] text-text-3">
                          {tComms("card.reasonGiven")}:{" "}
                          {rescheduleRequestData.requested_reason}
                        </p>
                      )}
                    </div>

                    {/* Alternative selection — radio buttons */}
                    <div>
                      <span className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.chooseAlternative")}]
                      </span>
                      <div className="space-y-1">
                        {rescheduleRequestData.suggested_alternatives.map(
                          (alt, idx) => {
                            const isSelected = idx === selectedAlternativeIndex;
                            return (
                              <button
                                key={idx}
                                onClick={() => setSelectedAlternativeIndex(idx)}
                                className={cn(
                                  "flex min-h-[36px] w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors",
                                  isSelected
                                    ? "bg-[rgba(111, 148, 176,0.12)] border-[rgba(111, 148, 176,0.5)] border"
                                    : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
                                )}
                              >
                                {/* Radio button */}
                                <div
                                  className={cn(
                                    "flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-2",
                                    isSelected
                                      ? "border-[#6F94B0]"
                                      : "border-[rgba(255,255,255,0.2)]"
                                  )}
                                >
                                  {isSelected && (
                                    <div className="h-[8px] w-[8px] rounded-full bg-text-2" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                                    <span className="font-mono text-[13px] text-text">
                                      {formatDateTime(alt.date, null, locale)}
                                    </span>
                                  </div>
                                  {alt.team_member_name && (
                                    <span className="mt-0.5 block font-mono text-[11px] text-text-3">
                                      {alt.team_member_name}
                                    </span>
                                  )}
                                  <span className="mt-0.5 block font-mono text-micro text-text-3">
                                    {interpolate(
                                      tComms(`reasoning.${alt.reasoning.type}`),
                                      alt.reasoning.params
                                    )}
                                  </span>
                                </div>
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>

                    {/* Editable reply subject */}
                    <div>
                      <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.subject")}]
                      </span>
                      <input
                        type="text"
                        value={rescheduleRequestSubject}
                        onChange={(e) =>
                          setRescheduleRequestSubject(e.target.value)
                        }
                        className="min-h-[36px] w-full rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 font-mohave text-body-sm text-text outline-none focus:border-[rgba(255,255,255,0.20)]"
                      />
                    </div>

                    {/* Editable reply draft */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.replyPreview")}]
                        </span>
                        <button
                          onClick={() =>
                            setEditingRescheduleReply(!editingRescheduleReply)
                          }
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingRescheduleReply
                            ? tComms("action.collapse")
                            : tComms("action.editDraft")}
                        </button>
                      </div>
                      {editingRescheduleReply ? (
                        <textarea
                          value={rescheduleRequestReply}
                          onChange={(e) =>
                            setRescheduleRequestReply(e.target.value)
                          }
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {rescheduleRequestReply.slice(0, 200)}
                          {rescheduleRequestReply.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>

                    {/* Classification confidence */}
                    <div className="flex items-center gap-1">
                      <Gauge className="h-[12px] w-[12px] text-text-3" />
                      <span className="font-mono text-[11px] text-text-3">
                        {tComms("card.classificationConfidence")}:{" "}
                        {Math.round(
                          rescheduleRequestData.classification_confidence * 100
                        )}
                        %
                      </span>
                    </div>
                  </div>
                )}

                {/* ── Subcontractor coordination expanded details ── */}
                {isSubcontractorCoord && subcontractorData && isPending && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.subcontractor")}]
                        </span>
                        <span className="font-mono text-[12px] text-text-2">
                          {subcontractorData.subcontractor_name} &lt;
                          {subcontractorData.subcontractor_email}&gt;
                        </span>
                      </div>
                      {subcontractorData.subcontractor_trade && (
                        <div>
                          <span className="block font-mono text-[11px] uppercase text-text-3">
                            [{tComms("card.trade")}]
                          </span>
                          <span className="font-mono text-[12px] text-text-2">
                            {subcontractorData.subcontractor_trade}
                          </span>
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.project")}]
                      </span>
                      <span className="font-mono text-[12px] text-text-2">
                        {subcontractorData.project_title}
                      </span>
                      {subcontractorData.project_address && (
                        <span className="mt-0.5 block font-mono text-[11px] text-text-3">
                          {subcontractorData.project_address}
                        </span>
                      )}
                    </div>

                    {subcontractorData.main_crew_schedule && (
                      <div>
                        <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.mainCrewSchedule")}]
                        </span>
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-[12px] w-[12px] text-text-3" />
                          <span className="font-mono text-[12px] text-text-2">
                            {formatDateRange(
                              subcontractorData.main_crew_schedule.start_date,
                              subcontractorData.main_crew_schedule.end_date,
                              locale
                            )}
                          </span>
                          {subcontractorData.main_crew_schedule.crew_names
                            .length > 0 && (
                            <span className="font-mono text-[11px] text-text-3">
                              —{" "}
                              {subcontractorData.main_crew_schedule.crew_names.join(
                                ", "
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div>
                      <span className="block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.scopeOfWork")}]
                      </span>
                      <p className="mt-0.5 font-mono text-[12px] text-text-2">
                        {subcontractorData.scope_of_work}
                      </p>
                    </div>

                    {/* Editable subject */}
                    <div>
                      <span className="mb-1 block font-mono text-[11px] uppercase text-text-3">
                        [{tComms("card.subject")}]
                      </span>
                      <input
                        type="text"
                        value={subcontractorSubject}
                        onChange={(e) =>
                          setSubcontractorSubject(e.target.value)
                        }
                        className="min-h-[36px] w-full rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2 font-mohave text-body-sm text-text outline-none focus:border-[rgba(255,255,255,0.20)]"
                      />
                    </div>

                    {/* Editable draft */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase text-text-3">
                          [{tComms("card.emailPreview")}]
                        </span>
                        <button
                          onClick={() =>
                            setEditingSubcontractorDraft(
                              !editingSubcontractorDraft
                            )
                          }
                          className="-my-4 flex min-h-[56px] min-w-[56px] items-center justify-center font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                        >
                          {editingSubcontractorDraft
                            ? tComms("action.collapse")
                            : tComms("action.editDraft")}
                        </button>
                      </div>
                      {editingSubcontractorDraft ? (
                        <textarea
                          value={subcontractorDraft}
                          onChange={(e) =>
                            setSubcontractorDraft(e.target.value)
                          }
                          rows={8}
                          className="min-h-[120px] w-full resize-y rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5 font-mono text-[12px] text-text outline-none [color-scheme:dark] focus:border-[rgba(255,255,255,0.20)]"
                        />
                      ) : (
                        <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap font-mono text-[12px] text-text-2">
                          {subcontractorDraft.slice(0, 200)}
                          {subcontractorDraft.length > 200 ? "..." : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Generic details (all action types) ── */}
                {/* Fix 26: localized source name via i18n key */}
                {action.contextSource && (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] uppercase text-text-3">
                      [{t("card.source")}]
                    </span>
                    <span className="font-mono text-[13px] text-text-2">
                      {t(`source.${action.contextSource}`)}
                    </span>
                  </div>
                )}

                {/* Raw details — only for simple action types or non-pending actions */}
                {!isTaskAction &&
                  !isStatusEmail &&
                  !isReassign &&
                  !isArchive &&
                  !isClose &&
                  !isCreateInvoice &&
                  !isInvoiceEmail &&
                  !isPaymentReminder &&
                  !isHealthAlert &&
                  !isFinancialInsight &&
                  !isOptimizeSchedule &&
                  !isRescheduleTasks &&
                  !isAppointmentConfirm &&
                  !isDayBeforeReminder &&
                  !isRescheduleRequest &&
                  !isSubcontractorCoord &&
                  !isPending && (
                    <div>
                      <span className="font-mono text-[11px] uppercase text-text-3">
                        [{t("card.details")}]
                      </span>
                      <pre className="scrollbar-hide mt-1 max-h-[200px] overflow-x-auto overflow-y-auto rounded-chip border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-2 font-mono text-[12px] text-text-2">
                        {JSON.stringify(action.actionData, null, 2)}
                      </pre>
                    </div>
                  )}

                {action.reviewNotes && (
                  <div>
                    <span className="font-mono text-[11px] uppercase text-text-3">
                      [{t("card.reviewNotes")}]
                    </span>
                    <p className="mt-0.5 font-mono text-[13px] text-text-2">
                      {action.reviewNotes}
                    </p>
                  </div>
                )}

                {/* Fix 11: [Error] via i18n, not hardcoded */}
                {action.error && (
                  <div>
                    <span className="font-mono text-[11px] uppercase text-[#93321A]">
                      [{t("card.error")}]
                    </span>
                    <p className="mt-0.5 font-mono text-[13px] text-[#93321A]">
                      {action.error}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
