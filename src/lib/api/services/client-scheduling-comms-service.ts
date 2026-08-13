/**
 * OPS Web — Client Scheduling Communications Service
 *
 * Sprint S2: Handles all outbound client-scheduling communications.
 *
 *   1. sendAppointmentConfirmation — fired when a task is scheduled
 *   2. sendDayBeforeReminder — fired by cron the day before a scheduled task
 *   3. detectRescheduleRequest — inbound email → reschedule detection via GPT
 *   4. coordinateWithSubcontractor — manually triggered to loop in a subcontractor
 *
 * Every proposal goes through ApprovalQueueService — no auto-send for
 * client-facing communications. Phase C gated.
 */

import "server-only";

import { createHash } from "node:crypto";

import { requireSupabase } from "@/lib/supabase/helpers";
import { ApprovalQueueService } from "./approval-queue-service";
import { ensureApprovalDraftHistory } from "./approval-draft-provenance";
import { AIDraftService } from "./ai-draft-service";
import { BusinessContextService } from "./business-context-service";
import { ScheduleOptimizationService } from "./schedule-optimization-service";
import { AssignmentService } from "./assignment-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getDraftingOpenAI } from "./openai-clients";
import { getCompanyLocale, renderServerString } from "@/i18n/server-render";
import { isReplyLikeSubject } from "@/lib/email/email-subject-policy";
import { resolveSyncEngineEmailActor } from "@/lib/email/sync-engine-email-actor";
import { resolveNewEmailConversationConnectionId } from "@/lib/email/email-connection-selection";
import type { Locale } from "@/i18n/types";
import type {
  SendAppointmentConfirmationActionData,
  SendAppointmentReminderActionData,
  SendScheduleChangedActionData,
  SendSubcontractorCoordinationActionData,
  ProcessRescheduleRequestActionData,
  RescheduleAlternative,
  StructuredSummary,
  ClientCommsSettings,
  TaskAutomationPersistenceGuard,
  ScheduleConfirmationPersistenceGuard,
} from "@/lib/types/approval-queue";
import { DEFAULT_CLIENT_COMMS_SETTINGS } from "@/lib/types/approval-queue";
import { TaskAutomationPersistenceService } from "./task-automation-persistence-service";
import { parseScheduleConfirmationReceipt } from "./schedule-confirmation-receipt";
import { mintScheduleConfirmationPersistenceGuard } from "./schedule-confirmation-persistence-guard";
import {
  isCurrentScheduleUnconfirmationPersistenceGuard,
  type ScheduleUnconfirmationPersistenceGuard,
} from "./schedule-unconfirmation-persistence-guard";
import {
  mintScheduleDispatchDraftGuard,
  type ScheduleDispatchDraftGuard,
} from "./schedule-dispatch-draft-guard";

type GuardedUnconfirmationReceipt = Readonly<{
  previousConfirmedAt: string;
  scheduleVersion: number;
}>;
const GUARDED_UNCONFIRMATION_RECEIPTS = new WeakSet<object>();

function mintGuardedUnconfirmationReceipt(input: {
  previousConfirmedAt: string;
  scheduleVersion: number;
}): GuardedUnconfirmationReceipt {
  const receipt = Object.freeze({ ...input });
  GUARDED_UNCONFIRMATION_RECEIPTS.add(receipt);
  return receipt;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** BCP-47 tag for Intl APIs given our supported locales. */
function bcp47(locale: Locale): string {
  return locale === "es" ? "es-ES" : "en-US";
}

/**
 * Resolve a structured summary to a plain-text label in the company's
 * locale. The approval queue UI prefers the structured object stored in
 * action_data (so it can render with live client state), but the
 * contextSummary column is still a plain string — we fill it in-locale
 * here so ES customers see Spanish approval cards even on older
 * dashboards that don't know about the structured field.
 */
async function renderSummaryFallback(
  locale: Locale,
  s: StructuredSummary
): Promise<string> {
  const p = s.params;
  switch (s.type) {
    case "appointment_confirmation":
      return renderServerString(
        locale,
        "server-emails",
        "summary.appointmentConfirmation",
        { clientName: p.clientName ?? "", date: p.date ?? "" }
      );
    case "day_before_reminder":
    case "appointment_reminder":
      return renderServerString(
        locale,
        "server-emails",
        "summary.dayBeforeReminder",
        { clientName: p.clientName ?? "" }
      );
    case "schedule_changed":
      return renderServerString(
        locale,
        "server-emails",
        "summary.scheduleChanged",
        {
          clientName: p.clientName ?? "",
          taskTitle: p.taskTitle ?? "",
          newDate: p.newDate ?? "",
        }
      );
    case "schedule_unscheduled":
      return renderServerString(
        locale,
        "server-emails",
        "summary.scheduleUnscheduled",
        {
          clientName: p.clientName ?? "",
          taskTitle: p.taskTitle ?? "",
        }
      );
    case "reschedule_request":
      return renderServerString(
        locale,
        "server-emails",
        "summary.rescheduleRequest",
        { clientName: p.clientName ?? "", taskTitle: p.taskTitle ?? "" }
      );
    case "subcontractor_coordination":
      return renderServerString(
        locale,
        "server-emails",
        "summary.subcontractorCoordination",
        {
          subcontractorName: p.subcontractorName ?? "",
          projectTitle: p.projectTitle ?? "",
        }
      );
    default:
      return s.type;
  }
}

/**
 * Load client comms settings with legacy-key fallback.
 *
 * Reads the new wizard-driven schema (appointment_confirmation singular,
 * appointment_reminder, etc.) with a fallback to the legacy S2 base keys so
 * companies that haven't yet run the configuration wizard continue to work.
 * Any missing keys are filled with DEFAULT_CLIENT_COMMS_SETTINGS.
 */
async function loadClientCommsSettings(
  companyId: string
): Promise<ClientCommsSettings> {
  const supabase = requireSupabase();
  const { data } = await supabase
    .from("companies")
    .select("client_comms_settings")
    .eq("id", companyId)
    .single();

  const raw = (data?.client_comms_settings as Record<string, unknown>) ?? {};
  const d = DEFAULT_CLIENT_COMMS_SETTINGS;

  // ── Appointment confirmation (new schema, fallback: always enabled → draft_on_confirm)
  const acNew = raw.appointment_confirmation as
    Record<string, unknown> | undefined;
  const acLegacy = raw.appointment_confirmations as
    Record<string, unknown> | undefined;

  const acLevel =
    typeof acNew?.level === "string"
      ? (acNew.level as ClientCommsSettings["appointment_confirmation"]["level"])
      : acLegacy?.enabled === false
        ? "off"
        : d.appointment_confirmation.level;

  // ── Appointment reminder (new schema, fallback: day_before_reminders)
  const arNew = raw.appointment_reminder as Record<string, unknown> | undefined;
  const arLegacy = raw.day_before_reminders as
    Record<string, unknown> | undefined;

  // ── Reschedule request (new schema, fallback: reschedule_requests)
  const rrNew = raw.reschedule_request as Record<string, unknown> | undefined;
  const rrLegacy = raw.reschedule_requests as
    Record<string, unknown> | undefined;

  const su = raw.status_update as Record<string, unknown> | undefined;
  const pr = raw.payment_reminder as Record<string, unknown> | undefined;
  const ic = raw.invoice_cover as Record<string, unknown> | undefined;
  const sc = raw.subcontractor_coordination as
    Record<string, unknown> | undefined;

  return {
    comms_wizard_completed_at:
      typeof raw.comms_wizard_completed_at === "string"
        ? (raw.comms_wizard_completed_at as string)
        : null,
    comms_wizard_version:
      typeof raw.comms_wizard_version === "number"
        ? (raw.comms_wizard_version as number)
        : 0,
    appointment_confirmation: {
      level: acLevel,
      confirm_mode:
        acNew?.confirm_mode === "automatic"
          ? "automatic"
          : d.appointment_confirmation.confirm_mode,
      auto_confirm_after_hours:
        typeof acNew?.auto_confirm_after_hours === "number"
          ? Math.max(1, Math.min(24, acNew.auto_confirm_after_hours))
          : d.appointment_confirmation.auto_confirm_after_hours,
      send_delay_minutes:
        typeof acNew?.send_delay_minutes === "number"
          ? Math.max(0, Math.min(60, acNew.send_delay_minutes))
          : d.appointment_confirmation.send_delay_minutes,
      reschedule_behavior:
        typeof acNew?.reschedule_behavior === "string"
          ? (acNew.reschedule_behavior as ClientCommsSettings["appointment_confirmation"]["reschedule_behavior"])
          : d.appointment_confirmation.reschedule_behavior,
    },
    appointment_reminder: {
      enabled:
        typeof arNew?.enabled === "boolean"
          ? arNew.enabled
          : typeof arLegacy?.enabled === "boolean"
            ? arLegacy.enabled
            : d.appointment_reminder.enabled,
      lead_days:
        typeof arNew?.lead_days === "number"
          ? Math.max(0, Math.min(7, arNew.lead_days))
          : d.appointment_reminder.lead_days,
      send_hour_local:
        typeof arNew?.send_hour_local === "number"
          ? Math.max(6, Math.min(20, arNew.send_hour_local))
          : typeof arLegacy?.send_hour_utc === "number"
            ? Math.max(6, Math.min(20, arLegacy.send_hour_utc as number))
            : d.appointment_reminder.send_hour_local,
      include_weather:
        typeof arNew?.include_weather === "boolean"
          ? arNew.include_weather
          : typeof arLegacy?.include_weather === "boolean"
            ? arLegacy.include_weather
            : d.appointment_reminder.include_weather,
      autonomy:
        typeof arNew?.autonomy === "string"
          ? (arNew.autonomy as ClientCommsSettings["appointment_reminder"]["autonomy"])
          : d.appointment_reminder.autonomy,
      send_delay_minutes:
        typeof arNew?.send_delay_minutes === "number"
          ? Math.max(0, Math.min(60, arNew.send_delay_minutes))
          : d.appointment_reminder.send_delay_minutes,
    },
    status_update: {
      cadence:
        typeof su?.cadence === "string"
          ? (su.cadence as ClientCommsSettings["status_update"]["cadence"])
          : d.status_update.cadence,
      weekly_day:
        typeof su?.weekly_day === "number"
          ? Math.max(0, Math.min(6, su.weekly_day))
          : d.status_update.weekly_day,
      autonomy:
        typeof su?.autonomy === "string"
          ? (su.autonomy as ClientCommsSettings["status_update"]["autonomy"])
          : d.status_update.autonomy,
      send_delay_minutes:
        typeof su?.send_delay_minutes === "number"
          ? Math.max(0, Math.min(60, su.send_delay_minutes))
          : d.status_update.send_delay_minutes,
    },
    payment_reminder: {
      enabled:
        typeof pr?.enabled === "boolean"
          ? pr.enabled
          : d.payment_reminder.enabled,
      preset:
        typeof pr?.preset === "string"
          ? (pr.preset as ClientCommsSettings["payment_reminder"]["preset"])
          : d.payment_reminder.preset,
      custom_days:
        Array.isArray(pr?.custom_days) && pr.custom_days.length === 4
          ? ([...(pr.custom_days as number[])] as [
              number,
              number,
              number,
              number,
            ])
          : [...d.payment_reminder.custom_days],
      max_reminders:
        typeof pr?.max_reminders === "number"
          ? Math.max(1, Math.min(4, pr.max_reminders))
          : d.payment_reminder.max_reminders,
      autonomy:
        typeof pr?.autonomy === "string"
          ? (pr.autonomy as ClientCommsSettings["payment_reminder"]["autonomy"])
          : d.payment_reminder.autonomy,
      send_delay_minutes:
        typeof pr?.send_delay_minutes === "number"
          ? Math.max(0, Math.min(60, pr.send_delay_minutes))
          : d.payment_reminder.send_delay_minutes,
    },
    invoice_cover: {
      enabled:
        typeof ic?.enabled === "boolean" ? ic.enabled : d.invoice_cover.enabled,
      threshold:
        typeof ic?.threshold === "number"
          ? Math.max(0, ic.threshold)
          : d.invoice_cover.threshold,
      autonomy:
        typeof ic?.autonomy === "string"
          ? (ic.autonomy as ClientCommsSettings["invoice_cover"]["autonomy"])
          : d.invoice_cover.autonomy,
      send_delay_minutes:
        typeof ic?.send_delay_minutes === "number"
          ? Math.max(0, Math.min(60, ic.send_delay_minutes))
          : d.invoice_cover.send_delay_minutes,
    },
    reschedule_request: {
      enabled:
        typeof rrNew?.enabled === "boolean"
          ? rrNew.enabled
          : typeof rrLegacy?.enabled === "boolean"
            ? rrLegacy.enabled
            : d.reschedule_request.enabled,
      behavior:
        typeof rrNew?.behavior === "string"
          ? (rrNew.behavior as ClientCommsSettings["reschedule_request"]["behavior"])
          : d.reschedule_request.behavior,
      min_confidence:
        typeof rrNew?.min_confidence === "number"
          ? Math.max(0, Math.min(1, rrNew.min_confidence))
          : typeof rrLegacy?.min_confidence === "number"
            ? Math.max(0, Math.min(1, rrLegacy.min_confidence as number))
            : d.reschedule_request.min_confidence,
      autonomy:
        typeof rrNew?.autonomy === "string"
          ? (rrNew.autonomy as ClientCommsSettings["reschedule_request"]["autonomy"])
          : d.reschedule_request.autonomy,
      send_delay_minutes:
        typeof rrNew?.send_delay_minutes === "number"
          ? Math.max(0, Math.min(60, rrNew.send_delay_minutes))
          : d.reschedule_request.send_delay_minutes,
    },
    subcontractor_coordination: {
      enabled:
        typeof sc?.enabled === "boolean"
          ? sc.enabled
          : d.subcontractor_coordination.enabled,
      trigger:
        typeof sc?.trigger === "string"
          ? (sc.trigger as ClientCommsSettings["subcontractor_coordination"]["trigger"])
          : d.subcontractor_coordination.trigger,
    },
  };
}

async function getActiveConnectionId(
  companyId: string,
  userId: string
): Promise<string | null> {
  return resolveNewEmailConversationConnectionId({
    supabase: requireSupabase(),
    companyId,
    actorUserId: userId,
  });
}

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const match =
    /^(?:([01]\d|2[0-3])):([0-5]\d)(?::[0-5]\d(?:\.\d{1,6})?)?$/.exec(time);
  if (!match) {
    throw new Error("Schedule source contains an invalid wall time");
  }
  return `${match[1]}:${match[2]}`;
}

export type TaskScheduleState = {
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  duration: number;
  teamMemberIds: string[];
};

export type ConfirmedScheduleChange = {
  before: TaskScheduleState;
  after: TaskScheduleState;
  scheduleVersion: number | null;
};

type ExactScheduleConfirmation = Readonly<{
  scheduleVersion: number;
  confirmedAt: string;
  confirmedBy: string | null;
  confirmationOrigin: "manual" | "automatic_grace" | "full_auto";
}>;

type ScheduleDispatchTerminalDisposition =
  "no_action" | "phase_disabled" | "access_lost" | "superseded";

type PreparedScheduleDispatch = Readonly<{
  disposition: "ready";
  kind: "schedule_confirmation_dispatch" | "schedule_unconfirmation_dispatch";
  eventId: string;
  leaseToken: string;
  companyId: string;
  actorUserId: string;
  taskId: string;
  scheduleVersion: number;
  confirmationOrigin: "manual" | "automatic_grace" | "full_auto" | null;
  scheduleUnconfirmationOrigin: "explicit_admin" | "schedule_edit" | null;
  changeKind: "rescheduled" | "unscheduled" | null;
  scheduleConfirmedAt: string | null;
  scheduleConfirmedBy: string | null;
  previousScheduleConfirmedAt: string | null;
  confirmationLevel:
    | "off"
    | "manual"
    | "draft_on_confirm"
    | "auto_send_on_confirm"
    | "full_auto";
  rescheduleBehavior: "do_nothing" | "notify" | "draft" | "auto_send";
  sendDelayMinutes: number;
  locale: Locale;
  connectionId: string | null;
  projectId: string;
  projectTitle: string;
  projectAddress: string | null;
  clientId: string;
  clientName: string;
  clientEmail: string;
  taskTitle: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  scheduledEndTime: string | null;
  allDay: boolean;
  durationHours: number;
  crewNames: string[];
}>;

type ScheduleDispatchPreparation =
  | PreparedScheduleDispatch
  | Readonly<{
      disposition: ScheduleDispatchTerminalDisposition;
      reason: string;
    }>;

export type ConfirmedRescheduleOutcome = {
  actionTaken:
    | "phase_c_disabled"
    | "stale_or_unconfirmed"
    | "do_nothing"
    | "notify"
    | "notify_failed"
    | "draft"
    | "auto_send";
  actionId: string | null;
};

function sameDateTime(left: string | null, right: string | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return (
    !Number.isNaN(leftTime) &&
    !Number.isNaN(rightTime) &&
    leftTime === rightTime
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    [...new Set(left)].sort().join("\u0000") ===
    [...new Set(right)].sort().join("\u0000")
  );
}

function displayScheduleDate(value: string | null, locale: string): string {
  if (!value) return "not specified";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function displayScheduleTime(value: string | null, locale: string): string {
  if (!value) return "not specified";
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const parsed = new Date(
    Date.UTC(2026, 0, 1, Number(match[1]), Number(match[2]))
  );
  return parsed.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function displayTimeWindow(state: TaskScheduleState, locale: string): string {
  if (state.allDay) return "all day";
  const start = displayScheduleTime(state.startTime, locale);
  return state.endTime
    ? `${start} to ${displayScheduleTime(state.endTime, locale)}`
    : start;
}

/** Build only the facts that actually changed; never imply a date move for a time/crew edit. */
export function buildScheduleChangeDetails(
  change: ConfirmedScheduleChange,
  beforeCrewNames: string[],
  afterCrewNames: string[],
  locale: string
): string[] {
  const details: string[] = [];
  const wasUnscheduled = !!change.before.startDate && !change.after.startDate;
  if (
    !sameDateTime(change.before.startDate, change.after.startDate) ||
    !sameDateTime(change.before.endDate, change.after.endDate)
  ) {
    if (wasUnscheduled) {
      details.push(
        `The visit previously scheduled for ${displayScheduleDate(change.before.startDate, locale)} is no longer scheduled.`
      );
    } else {
      details.push(
        `The original date was ${displayScheduleDate(change.before.startDate, locale)}.`,
        `The new date is ${displayScheduleDate(change.after.startDate, locale)}.`
      );
    }
  }
  if (wasUnscheduled) return details;
  if (
    change.before.startTime !== change.after.startTime ||
    change.before.endTime !== change.after.endTime ||
    change.before.allDay !== change.after.allDay
  ) {
    details.push(
      `The original time was ${displayTimeWindow(change.before, locale)}.`,
      `The new time is ${displayTimeWindow(change.after, locale)}.`
    );
  }
  if (change.before.duration !== change.after.duration) {
    details.push(
      `The duration changed from ${change.before.duration} day${change.before.duration === 1 ? "" : "s"} to ${change.after.duration} day${change.after.duration === 1 ? "" : "s"}.`
    );
  }
  if (!sameStringSet(change.before.teamMemberIds, change.after.teamMemberIds)) {
    const beforeCrew =
      beforeCrewNames.length > 0
        ? beforeCrewNames.join(", ")
        : "the prior crew";
    const afterCrew =
      afterCrewNames.length > 0 ? afterCrewNames.join(", ") : "the new crew";
    details.push(`The crew changed from ${beforeCrew} to ${afterCrew}.`);
  }
  return details;
}

function canonicalScheduleState(state: TaskScheduleState) {
  return {
    ...state,
    teamMemberIds: [...new Set(state.teamMemberIds)].sort(),
  };
}

/** Stable proposal key for the exact successful mutation, including time and crew. */
export function scheduleChangeFingerprint(
  change: ConfirmedScheduleChange
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        before: canonicalScheduleState(change.before),
        after: canonicalScheduleState(change.after),
        scheduleVersion: change.scheduleVersion,
      })
    )
    .digest("hex")
    .slice(0, 24);
}

function taskScheduleState(task: Record<string, unknown>): TaskScheduleState {
  return {
    startDate: typeof task.start_date === "string" ? task.start_date : null,
    endDate: typeof task.end_date === "string" ? task.end_date : null,
    startTime: typeof task.start_time === "string" ? task.start_time : null,
    endTime: typeof task.end_time === "string" ? task.end_time : null,
    allDay: task.all_day !== false,
    duration:
      typeof task.duration === "number" && Number.isFinite(task.duration)
        ? task.duration
        : 1,
    teamMemberIds: Array.isArray(task.team_member_ids)
      ? task.team_member_ids.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
  };
}

export function taskMatchesScheduleChange(
  task: Record<string, unknown>,
  change: ConfirmedScheduleChange
): boolean {
  const current = taskScheduleState(task);
  return (
    (change.scheduleVersion === null ||
      task.schedule_version === change.scheduleVersion) &&
    sameDateTime(current.startDate, change.after.startDate) &&
    sameDateTime(current.endDate, change.after.endDate) &&
    current.startTime === change.after.startTime &&
    current.endTime === change.after.endTime &&
    current.allDay === change.after.allDay &&
    current.duration === change.after.duration &&
    sameStringSet(current.teamMemberIds, change.after.teamMemberIds)
  );
}

/**
 * Customer wording may express a preference, but it cannot create schedule
 * availability. It may only prioritize a date that the authoritative schedule
 * search already returned.
 */
export function prioritizeVerifiedRescheduleAlternatives(
  alternatives: readonly RescheduleAlternative[],
  requestedDate: string | null
): RescheduleAlternative[] {
  const ordered = [...alternatives];
  if (!requestedDate) return ordered;

  const requestedDay = requestedDate.split("T")[0];
  const verifiedRequestedIndex = ordered.findIndex((item) =>
    item.date.startsWith(requestedDay)
  );
  if (verifiedRequestedIndex <= 0) return ordered;

  const [verifiedRequestedAlternative] = ordered.splice(
    verifiedRequestedIndex,
    1
  );
  if (verifiedRequestedAlternative) {
    ordered.unshift(verifiedRequestedAlternative);
  }
  return ordered;
}

function taskMatchesScheduleState(
  task: Record<string, unknown>,
  expected: TaskScheduleState
): boolean {
  const current = taskScheduleState(task);
  return (
    sameDateTime(current.startDate, expected.startDate) &&
    sameDateTime(current.endDate, expected.endDate) &&
    current.startTime === expected.startTime &&
    current.endTime === expected.endTime &&
    current.allDay === expected.allDay &&
    current.duration === expected.duration &&
    sameStringSet(current.teamMemberIds, expected.teamMemberIds)
  );
}

function taskMatchesExactScheduleConfirmation(
  task: Record<string, unknown>,
  expected: ExactScheduleConfirmation
): boolean {
  const confirmedAt =
    typeof task.schedule_confirmed_at === "string" &&
    Number.isFinite(Date.parse(task.schedule_confirmed_at))
      ? new Date(task.schedule_confirmed_at).toISOString()
      : null;
  return (
    task.schedule_version === expected.scheduleVersion &&
    task.confirmed_schedule_version === expected.scheduleVersion &&
    confirmedAt === expected.confirmedAt &&
    task.schedule_confirmed_by === expected.confirmedBy
  );
}

function scheduleConfirmationSourceId(
  taskId: string,
  confirmation: ExactScheduleConfirmation
): string {
  return `schedule-confirmation:${taskId}:v${confirmation.scheduleVersion}:${confirmation.confirmedAt}`;
}

/** Normalize a Supabase embedded-join value that may be either an object or
 *  an array (PostgREST returns arrays for to-many and objects for to-one,
 *  but the generated types sometimes type it as an array even when to-one). */
function normalizeJoinedRow(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return (raw[0] as Record<string, unknown>) ?? null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

async function loadCrewNames(
  companyId: string,
  teamMemberIds: string[]
): Promise<string[]> {
  if (teamMemberIds.length === 0) return [];
  if (teamMemberIds.length > 100) {
    throw new Error("Schedule crew source exceeds its query bound");
  }
  if (teamMemberIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error("Schedule crew source contains an invalid identity");
  }
  const uniqueIds = [...new Set(teamMemberIds)];
  if (uniqueIds.length > 50) {
    throw new Error("Schedule crew projection exceeds its query bound");
  }

  const supabase = requireSupabase();
  const { data: users } = await supabase
    .from("users")
    .select("id, first_name, last_name, is_active")
    .eq("company_id", companyId)
    .in("id", uniqueIds)
    .is("deleted_at", null)
    .eq("is_active", true);

  const byId = new Map<string, string>();
  for (const u of users ?? []) {
    const name =
      `${(u.first_name as string) ?? ""} ${(u.last_name as string) ?? ""}`.trim();
    if (name.length >= 1 && name.length <= 256) {
      byId.set(u.id as string, name);
    }
  }
  const names = uniqueIds.map((id) => byId.get(id));
  if (names.some((name) => !name)) {
    throw new Error("Schedule crew source contains an unavailable identity");
  }
  return names as string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function formatCivilDate(value: string, locale: Locale): string {
  if (!CANONICAL_CIVIL_DATE_PATTERN.test(value)) {
    throw new Error("Schedule dispatch has invalid civil date");
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Schedule dispatch has invalid civil date");
  }
  return parsed.toLocaleDateString(bcp47(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function civilDateFromDateCarrier(value: string | null): string | null {
  if (!value) return null;
  if (CANONICAL_CIVIL_DATE_PATTERN.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function preparedString(
  row: Record<string, unknown>,
  key: string,
  max: number,
  nullable = false
): string | null {
  const value = row[key];
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < (nullable ? 0 : 1) ||
    value.length > max
  ) {
    throw new Error(`Schedule dispatch preparation has invalid ${key}`);
  }
  return value;
}

function preparedUuid(
  row: Record<string, unknown>,
  key: string,
  nullable = false
): string | null {
  const value = preparedString(row, key, 36, nullable);
  if (value !== null && !UUID_PATTERN.test(value)) {
    throw new Error(`Schedule dispatch preparation has invalid ${key}`);
  }
  return value;
}

function parseScheduleDispatchPreparation(
  input: unknown,
  expected: Readonly<{
    eventId: string;
    leaseToken: string;
    companyId: string;
    actorUserId: string;
    taskId: string;
    scheduleVersion: number;
    kind: "schedule_confirmation_dispatch" | "schedule_unconfirmation_dispatch";
  }>
): ScheduleDispatchPreparation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Schedule dispatch preparation returned invalid proof");
  }
  const row = input as Record<string, unknown>;
  if (
    row.disposition === "no_action" ||
    row.disposition === "phase_disabled" ||
    row.disposition === "access_lost" ||
    row.disposition === "superseded"
  ) {
    if (typeof row.reason !== "string" || row.reason.length > 256) {
      throw new Error("Schedule dispatch preparation returned invalid proof");
    }
    return { disposition: row.disposition, reason: row.reason };
  }
  if (row.disposition !== "ready") {
    throw new Error("Schedule dispatch preparation returned invalid proof");
  }
  const kind = row.kind;
  const eventId = preparedUuid(row, "event_id")!;
  const leaseToken = preparedUuid(row, "lease_token")!;
  const companyId = preparedUuid(row, "company_id")!;
  const actorUserId = preparedUuid(row, "actor_user_id")!;
  const taskId = preparedUuid(row, "task_id")!;
  const scheduleVersion = row.schedule_version;
  if (
    kind !== expected.kind ||
    eventId !== expected.eventId ||
    leaseToken !== expected.leaseToken ||
    companyId !== expected.companyId ||
    actorUserId !== expected.actorUserId ||
    taskId !== expected.taskId ||
    scheduleVersion !== expected.scheduleVersion ||
    !Number.isSafeInteger(scheduleVersion) ||
    (scheduleVersion as number) < 0
  ) {
    throw new Error("Schedule dispatch preparation returned unbound proof");
  }
  const confirmationOrigin = row.confirmation_origin;
  if (
    confirmationOrigin !== null &&
    confirmationOrigin !== "manual" &&
    confirmationOrigin !== "automatic_grace" &&
    confirmationOrigin !== "full_auto"
  ) {
    throw new Error("Schedule dispatch preparation has invalid origin");
  }
  const scheduleUnconfirmationOrigin = row.schedule_unconfirmation_origin;
  if (
    scheduleUnconfirmationOrigin !== null &&
    scheduleUnconfirmationOrigin !== "explicit_admin" &&
    scheduleUnconfirmationOrigin !== "schedule_edit"
  ) {
    throw new Error(
      "Schedule dispatch preparation has invalid unconfirmation origin"
    );
  }
  if (
    (expected.kind === "schedule_confirmation_dispatch" &&
      scheduleUnconfirmationOrigin !== null) ||
    (expected.kind === "schedule_unconfirmation_dispatch" &&
      (confirmationOrigin !== null || scheduleUnconfirmationOrigin === null))
  ) {
    throw new Error("Schedule dispatch preparation has incoherent origin");
  }
  const changeKind = row.change_kind;
  if (
    (expected.kind === "schedule_confirmation_dispatch" &&
      changeKind !== null) ||
    (expected.kind === "schedule_unconfirmation_dispatch" &&
      changeKind !== "rescheduled" &&
      changeKind !== "unscheduled") ||
    (changeKind === "unscheduled" &&
      scheduleUnconfirmationOrigin !== "schedule_edit")
  ) {
    throw new Error("Schedule dispatch preparation has invalid change kind");
  }
  const scheduleConfirmedAt = preparedString(
    row,
    "schedule_confirmed_at",
    24,
    true
  );
  const previousScheduleConfirmedAt = preparedString(
    row,
    "previous_schedule_confirmed_at",
    24,
    true
  );
  if (
    (scheduleConfirmedAt !== null &&
      (!CANONICAL_UTC_PATTERN.test(scheduleConfirmedAt) ||
        !Number.isFinite(Date.parse(scheduleConfirmedAt)))) ||
    (previousScheduleConfirmedAt !== null &&
      (!CANONICAL_UTC_PATTERN.test(previousScheduleConfirmedAt) ||
        !Number.isFinite(Date.parse(previousScheduleConfirmedAt))))
  ) {
    throw new Error("Schedule dispatch preparation has invalid timestamp");
  }
  const scheduleConfirmedBy = preparedUuid(row, "schedule_confirmed_by", true);
  const confirmationLevel = row.confirmation_level;
  const rescheduleBehavior = row.reschedule_behavior;
  const sendDelayMinutes = row.send_delay_minutes;
  const locale = row.locale;
  const scheduledTime = preparedString(row, "scheduled_time", 5, true);
  const scheduledEndTime = preparedString(row, "scheduled_end_time", 5, true);
  const scheduledDate = preparedString(row, "scheduled_date", 10, true);
  if (
    (confirmationLevel !== "off" &&
      confirmationLevel !== "manual" &&
      confirmationLevel !== "draft_on_confirm" &&
      confirmationLevel !== "auto_send_on_confirm" &&
      confirmationLevel !== "full_auto") ||
    (rescheduleBehavior !== "do_nothing" &&
      rescheduleBehavior !== "notify" &&
      rescheduleBehavior !== "draft" &&
      rescheduleBehavior !== "auto_send") ||
    !Number.isSafeInteger(sendDelayMinutes) ||
    (sendDelayMinutes as number) < 0 ||
    (sendDelayMinutes as number) > 60 ||
    (locale !== "en" && locale !== "es") ||
    (scheduledDate !== null &&
      (!CANONICAL_CIVIL_DATE_PATTERN.test(scheduledDate) ||
        civilDateFromDateCarrier(`${scheduledDate}T00:00:00.000Z`) !==
          scheduledDate)) ||
    (changeKind === "unscheduled" &&
      (scheduledDate !== null ||
        scheduledTime !== null ||
        scheduledEndTime !== null)) ||
    (changeKind !== "unscheduled" && scheduledDate === null) ||
    (scheduledTime !== null && !CANONICAL_TIME_PATTERN.test(scheduledTime)) ||
    (scheduledEndTime !== null &&
      !CANONICAL_TIME_PATTERN.test(scheduledEndTime)) ||
    typeof row.all_day !== "boolean" ||
    !Number.isSafeInteger(row.duration_hours) ||
    (row.duration_hours as number) < 8 ||
    (row.duration_hours as number) > 2920 ||
    !Array.isArray(row.crew_names) ||
    row.crew_names.length > 50 ||
    !row.crew_names.every(
      (name) =>
        typeof name === "string" && name.length >= 1 && name.length <= 256
    )
  ) {
    throw new Error("Schedule dispatch preparation has invalid projection");
  }
  return {
    disposition: "ready",
    kind: expected.kind,
    eventId,
    leaseToken,
    companyId,
    actorUserId,
    taskId,
    scheduleVersion: scheduleVersion as number,
    confirmationOrigin,
    scheduleUnconfirmationOrigin,
    changeKind: changeKind as "rescheduled" | "unscheduled" | null,
    scheduleConfirmedAt,
    scheduleConfirmedBy,
    previousScheduleConfirmedAt,
    confirmationLevel,
    rescheduleBehavior,
    sendDelayMinutes: sendDelayMinutes as number,
    locale,
    connectionId: preparedUuid(row, "connection_id", true),
    projectId: preparedUuid(row, "project_id")!,
    projectTitle: preparedString(row, "project_title", 1000)!,
    projectAddress: preparedString(row, "project_address", 2000, true),
    clientId: preparedUuid(row, "client_id")!,
    clientName: preparedString(row, "client_name", 1000, true) ?? "",
    clientEmail: preparedString(row, "client_email", 320)!,
    taskTitle: preparedString(row, "task_title", 1000)!,
    scheduledDate,
    scheduledTime,
    scheduledEndTime,
    allDay: row.all_day,
    durationHours: row.duration_hours as number,
    crewNames: [...row.crew_names] as string[],
  };
}

async function prepareScheduleDispatch(
  guard: TaskAutomationPersistenceGuard,
  expected: Omit<
    Parameters<typeof parseScheduleDispatchPreparation>[1],
    "eventId" | "leaseToken"
  >
): Promise<ScheduleDispatchPreparation> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc(
    "prepare_schedule_dispatch_as_system",
    {
      p_event_id: guard.eventId,
      p_lease_token: guard.leaseToken,
    }
  );
  if (error) {
    throw new Error(`Schedule dispatch preparation failed: ${error.message}`);
  }
  return parseScheduleDispatchPreparation(data, {
    eventId: guard.eventId,
    leaseToken: guard.leaseToken,
    ...expected,
  });
}

async function proposePreparedScheduleConfirmation(
  prepared: PreparedScheduleDispatch,
  confirmationGuard: ScheduleConfirmationPersistenceGuard
): Promise<string | null> {
  if (
    prepared.kind !== "schedule_confirmation_dispatch" ||
    !prepared.connectionId ||
    !prepared.confirmationOrigin ||
    !prepared.scheduleConfirmedAt
  ) {
    throw new Error("Prepared schedule confirmation is incomplete");
  }
  const displayDate = formatCivilDate(prepared.scheduledDate!, prepared.locale);
  const crewListText =
    prepared.crewNames.length > 0 ? prepared.crewNames.join(", ") : "our crew";
  const instruction = [
    "Write an appointment confirmation email. Professional and warm.",
    `The appointment is confirmed for ${displayDate}${prepared.scheduledTime ? ` at ${prepared.scheduledTime}` : ""}.`,
    `${crewListText} will be arriving to work on ${prepared.taskTitle.toLowerCase()} at the property${prepared.projectAddress ? ` at ${prepared.projectAddress}` : ""}.`,
    `Approximate duration is ${prepared.durationHours / 8} day${prepared.durationHours === 8 ? "" : "s"}.`,
    "Include reasonable access-preparation notes only. Keep it brief. Do not include a signature.",
  ].join(" ");
  const subject = await renderServerString(
    prepared.locale,
    "server-emails",
    "appointmentConfirmation.subject",
    { date: displayDate }
  );
  const draftGuard: ScheduleDispatchDraftGuard = mintScheduleDispatchDraftGuard(
    {
      eventId: prepared.eventId,
      leaseToken: prepared.leaseToken,
      companyId: prepared.companyId,
      actorUserId: prepared.actorUserId,
      connectionId: prepared.connectionId,
      recipientEmail: prepared.clientEmail,
    }
  );
  const draftResult = await AIDraftService.generateDraft({
    companyId: prepared.companyId,
    userId: prepared.actorUserId,
    connectionId: prepared.connectionId,
    recipientEmail: prepared.clientEmail,
    recipientName: prepared.clientName,
    userInstruction: `${instruction} Write the email in ${prepared.locale === "es" ? "Spanish" : "English"}.`,
    profileTypeOverride: "client_active_project",
    draftPurpose: {
      kind: "operational_outbound",
      verifiedContext: { schedule: true },
    },
    signatureWillBeAppended: true,
    scheduleDispatchDraftGuard: draftGuard,
  });
  const draftText = draftResult.available
    ? draftResult.draft
    : await renderServerString(
        prepared.locale,
        "server-emails",
        "appointmentConfirmation.fallback",
        {
          clientName: prepared.clientName.split(" ")[0] || "",
          taskTitle: prepared.taskTitle,
          date: displayDate,
        }
      );
  const draftHistoryId = await ensureApprovalDraftHistory({
    draftHistoryId: draftResult.draftHistoryId || null,
    companyId: prepared.companyId,
    userId: prepared.actorUserId,
    connectionId: prepared.connectionId,
    originalDraft: draftText,
    subject,
    profileType: "client_active_project",
    atProposal: true,
  });
  const structured: StructuredSummary = {
    type: "appointment_confirmation",
    params: {
      clientName: prepared.clientName || "client",
      date: displayDate,
      time: prepared.scheduledTime ?? "",
      crew: crewListText,
    },
  };
  const actionData: SendAppointmentConfirmationActionData = {
    task_id: prepared.taskId,
    schedule_version: prepared.scheduleVersion,
    confirmed_schedule_version: prepared.scheduleVersion,
    schedule_confirmed_at: prepared.scheduleConfirmedAt,
    schedule_confirmed_by: prepared.scheduleConfirmedBy,
    confirmation_origin: prepared.confirmationOrigin,
    project_id: prepared.projectId,
    project_title: prepared.projectTitle,
    client_id: prepared.clientId,
    client_name: prepared.clientName,
    client_email: prepared.clientEmail,
    task_title: prepared.taskTitle,
    scheduled_date: prepared.scheduledDate!,
    scheduled_time: prepared.scheduledTime,
    scheduled_end_time: prepared.scheduledEndTime,
    duration_hours: prepared.durationHours,
    crew_names: prepared.crewNames,
    project_address: prepared.projectAddress,
    subject,
    draft_text: draftText,
    original_draft_text: draftText,
    connection_id: prepared.connectionId,
    draft_history_id: draftHistoryId,
    context_summary_structured: structured,
  };
  return ApprovalQueueService.proposeAction({
    companyId: prepared.companyId,
    userId: prepared.actorUserId,
    actionType: "send_appointment_confirmation",
    actionData: actionData as unknown as Record<string, unknown>,
    contextSummary: await renderSummaryFallback(prepared.locale, structured),
    contextSource: "task_scheduled",
    sourceId: scheduleConfirmationSourceId(prepared.taskId, {
      scheduleVersion: prepared.scheduleVersion,
      confirmedAt: prepared.scheduleConfirmedAt,
      confirmedBy: prepared.scheduleConfirmedBy,
      confirmationOrigin: prepared.confirmationOrigin,
    }),
    confidence: 0.85,
    priority: "normal",
    scheduleConfirmationGuard: confirmationGuard,
  });
}

async function proposePreparedScheduleChange(
  prepared: PreparedScheduleDispatch,
  guard: ScheduleUnconfirmationPersistenceGuard,
  _receipt: GuardedUnconfirmationReceipt
): Promise<string | null> {
  if (
    prepared.kind !== "schedule_unconfirmation_dispatch" ||
    !prepared.connectionId ||
    !prepared.previousScheduleConfirmedAt ||
    (prepared.rescheduleBehavior !== "draft" &&
      prepared.rescheduleBehavior !== "auto_send")
  ) {
    throw new Error("Prepared schedule unconfirmation is incomplete");
  }
  if (!prepared.changeKind) {
    throw new Error("Prepared schedule unconfirmation has no change kind");
  }
  const isUnscheduled = prepared.changeKind === "unscheduled";
  const displayNewDate = prepared.scheduledDate
    ? formatCivilDate(prepared.scheduledDate, prepared.locale)
    : null;
  const instruction = (
    isUnscheduled
      ? [
          "Write a brief notice that a previously confirmed visit is no longer scheduled.",
          `The affected work is ${prepared.taskTitle.toLowerCase()}${prepared.projectAddress ? ` at ${prepared.projectAddress}` : ""}.`,
          "Do not invent or promise a replacement date. Ask the client to reply with any questions. Do not include a signature.",
        ]
      : [
          "Write a brief schedule change notification.",
          `The previously confirmed visit changed. The current scheduled date is ${displayNewDate}${prepared.scheduledTime ? ` at ${prepared.scheduledTime}` : ""}.`,
          `The affected work is ${prepared.taskTitle.toLowerCase()}${prepared.projectAddress ? ` at ${prepared.projectAddress}` : ""}.`,
          "Confirm only these prepared facts, apologize briefly, and do not include a signature.",
        ]
  )
    .concat(
      `Write the email in ${prepared.locale === "es" ? "Spanish" : "English"}.`
    )
    .join(" ");
  const subject = await renderServerString(
    prepared.locale,
    "server-emails",
    isUnscheduled ? "scheduleUnscheduled.subject" : "scheduleChanged.subject",
    { projectTitle: prepared.projectTitle }
  );
  const draftGuard = mintScheduleDispatchDraftGuard({
    eventId: prepared.eventId,
    leaseToken: prepared.leaseToken,
    companyId: prepared.companyId,
    actorUserId: prepared.actorUserId,
    connectionId: prepared.connectionId,
    recipientEmail: prepared.clientEmail,
  });
  const draftResult = await AIDraftService.generateDraft({
    companyId: prepared.companyId,
    userId: prepared.actorUserId,
    connectionId: prepared.connectionId,
    recipientEmail: prepared.clientEmail,
    recipientName: prepared.clientName,
    userInstruction: instruction,
    profileTypeOverride: "client_active_project",
    draftPurpose: {
      kind: "operational_outbound",
      verifiedContext: { schedule: true },
    },
    signatureWillBeAppended: true,
    scheduleDispatchDraftGuard: draftGuard,
  });
  const draftText = draftResult.available
    ? draftResult.draft
    : await renderServerString(
        prepared.locale,
        "server-emails",
        isUnscheduled
          ? "scheduleUnscheduled.fallback"
          : "scheduleChanged.fallback",
        {
          clientName: prepared.clientName.split(" ")[0] || "",
          taskTitle: prepared.taskTitle,
          newDate: displayNewDate ?? "",
        }
      );
  const draftHistoryId = await ensureApprovalDraftHistory({
    draftHistoryId: draftResult.draftHistoryId || null,
    companyId: prepared.companyId,
    userId: prepared.actorUserId,
    connectionId: prepared.connectionId,
    originalDraft: draftText,
    subject,
    profileType: "client_active_project",
    atProposal: true,
  });
  const structured: StructuredSummary = {
    type: isUnscheduled ? "schedule_unscheduled" : "schedule_changed",
    params: {
      clientName: prepared.clientName || "client",
      taskTitle: prepared.taskTitle,
      newDate: displayNewDate ?? "",
      oldDate: "",
    },
  };
  const actionData: SendScheduleChangedActionData = {
    task_id: prepared.taskId,
    schedule_version: prepared.scheduleVersion,
    previous_schedule_confirmed_at: prepared.previousScheduleConfirmedAt,
    schedule_unconfirmation_origin:
      prepared.scheduleUnconfirmationOrigin ?? undefined,
    project_id: prepared.projectId,
    project_title: prepared.projectTitle,
    client_id: prepared.clientId,
    client_name: prepared.clientName,
    client_email: prepared.clientEmail,
    task_title: prepared.taskTitle,
    original_date: "",
    original_time: null,
    change_kind: prepared.changeKind,
    new_date: prepared.scheduledDate,
    new_time: prepared.scheduledTime,
    new_end_time: prepared.scheduledEndTime,
    crew_names: prepared.crewNames,
    project_address: prepared.projectAddress,
    subject,
    draft_text: draftText,
    original_draft_text: draftText,
    connection_id: prepared.connectionId,
    draft_history_id: draftHistoryId,
    context_summary_structured: structured,
  };
  return ApprovalQueueService.proposeAction({
    companyId: prepared.companyId,
    userId: prepared.actorUserId,
    actionType: "send_schedule_changed",
    actionData: actionData as unknown as Record<string, unknown>,
    contextSummary: await renderSummaryFallback(prepared.locale, structured),
    contextSource: "task_scheduled",
    sourceId: `task-automation:${guard.eventId}:schedule-unconfirmation`,
    confidence: 0.8,
    priority: "normal",
    taskAutomationGuard: guard,
  });
}

// ─── Reschedule Detection Helpers ────────────────────────────────────────

const RESCHEDULE_KEYWORDS = [
  "reschedule",
  "re-schedule",
  "reschedul",
  "move the",
  "move my",
  "move our",
  "change date",
  "change the date",
  "different day",
  "different date",
  "not available",
  "unavailable",
  "push back",
  "push it back",
  "push out",
  "postpone",
  "earlier",
  "later",
  "cant make",
  "can't make",
  "can not make",
  "need to switch",
  "need to change",
  "wont work",
  "won't work",
  "does not work",
  "doesn't work",
];

function matchesRescheduleKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return RESCHEDULE_KEYWORDS.some((kw) => lower.includes(kw));
}

interface RescheduleClassification {
  isReschedule: boolean;
  taskDescription: string | null;
  requestedDate: string | null;
  requestedTiming: "flexible" | "specific";
  reason: string | null;
  confidence: number;
}

async function classifyRescheduleWithGPT(
  emailSubject: string,
  emailBody: string,
  projectContextText: string
): Promise<RescheduleClassification | null> {
  try {
    const openai = getDraftingOpenAI();
    const today = new Date().toISOString().split("T")[0];

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        {
          role: "system",
          content: `You analyze emails from clients of a trades business (roofing, decks, landscaping, etc.) and determine whether the client is asking to reschedule a previously-scheduled appointment or crew visit.

Today's date is ${today}. Parse any date references relative to today.

Return JSON with these exact fields:
{
  "isReschedule": boolean,
  "taskDescription": string | null,
  "requestedDate": string | null,
  "requestedTiming": "flexible" | "specific",
  "reason": string | null,
  "confidence": number
}

Examples:
- "Can we move it to next Friday?" → isReschedule=true, requestedDate=<next Friday>, requestedTiming="specific", confidence high
- "We won't be home Thursday, sorry!" → isReschedule=true, requestedDate=null, requestedTiming="flexible", reason="client not home", confidence high
- "Any flexibility on the schedule?" → isReschedule=true, requestedTiming="flexible", confidence medium
- "Thanks for the update!" → isReschedule=false, confidence high

Be strict — if the email is just social or unrelated, set isReschedule to false.`,
        },
        {
          role: "user",
          content: `PROJECT CONTEXT:
${projectContextText}

INCOMING EMAIL:
Subject: ${emailSubject}
Body: ${emailBody.slice(0, 1500)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as Partial<RescheduleClassification>;
    return {
      isReschedule: Boolean(parsed.isReschedule),
      taskDescription:
        typeof parsed.taskDescription === "string"
          ? parsed.taskDescription
          : null,
      requestedDate:
        typeof parsed.requestedDate === "string" ? parsed.requestedDate : null,
      requestedTiming:
        parsed.requestedTiming === "specific" ? "specific" : "flexible",
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5,
    };
  } catch (err) {
    console.error("[client-scheduling-comms] GPT classification failed:", err);
    return null;
  }
}

// ─── Service ─────────────────────────────────────────────────────────────

export const ClientSchedulingCommsService = {
  async sendAppointmentConfirmation(
    companyId: string,
    userId: string,
    taskId: string,
    options: {
      autoSendAfterMinutes?: number;
      sourceId?: string;
      expectedSchedule?: TaskScheduleState;
      expectedConfirmation?: ExactScheduleConfirmation;
      prePersistGuard?: () => Promise<boolean>;
      taskAutomationGuard?: TaskAutomationPersistenceGuard;
      scheduleConfirmationGuard?: ScheduleConfirmationPersistenceGuard;
    } = {}
  ): Promise<string | null> {
    if (options.scheduleConfirmationGuard || options.taskAutomationGuard) {
      throw new Error(
        "Purpose-bound schedule confirmation must use its prepared dispatch path"
      );
    }
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return null;

    const settings = await loadClientCommsSettings(companyId);
    // Level "off" and "manual" never auto-propose — the dispatcher handles
    // gating. This method can still be called directly (e.g. Manual Only
    // button press) so we only refuse on "off".
    if (settings.appointment_confirmation.level === "off") return null;

    const supabase = requireSupabase();

    const { data: task } = await supabase
      .from("project_tasks")
      .select(
        "id, project_id, custom_title, start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version, schedule_confirmed_at, schedule_confirmed_by, confirmed_schedule_version, task_types(display)"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.start_date) return null;
    if (
      options.expectedSchedule &&
      !taskMatchesScheduleState(
        task as Record<string, unknown>,
        options.expectedSchedule
      )
    ) {
      return null;
    }
    if (
      options.expectedConfirmation &&
      !taskMatchesExactScheduleConfirmation(
        task as Record<string, unknown>,
        options.expectedConfirmation
      )
    ) {
      return null;
    }

    const projectId = task.project_id as string;
    const { data: project } = await supabase
      .from("projects")
      .select("id, title, address, client_id")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!project || !project.client_id) return null;

    const clientId = project.client_id as string;
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .is("merged_into_client_id", null)
      .maybeSingle();

    if (!client || !client.email) return null;

    const clientEmail = client.email as string;
    const clientName = (client.name as string) ?? "";
    const projectTitle = (project.title as string) ?? "";
    const projectAddress = (project.address as string) ?? null;
    const taskTitle =
      (task.custom_title as string) ||
      (normalizeJoinedRow(task.task_types)?.display as string) ||
      projectTitle;

    const startDate = task.start_date as string;
    const endDate = (task.end_date as string) ?? null;
    const startTime = formatTime((task.start_time as string) ?? null);
    const endTime = formatTime((task.end_time as string) ?? null);
    const duration = (task.duration as number) ?? 1;

    const crewIds = Array.isArray(task.team_member_ids)
      ? (task.team_member_ids as string[])
      : [];
    const crewNames = await loadCrewNames(companyId, crewIds);

    const connectionId = await getActiveConnectionId(companyId, userId);
    if (!connectionId) return null;

    const displayDate = new Date(startDate).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const crewListText =
      crewNames.length > 0 ? crewNames.join(", ") : "our crew";

    const instructionParts: string[] = [
      "Write an appointment confirmation email. Professional and warm.",
      `The appointment is confirmed for ${displayDate}${startTime ? ` at ${startTime}` : ""}.`,
      `${crewListText} will be arriving to work on ${taskTitle.toLowerCase()} at the property${projectAddress ? ` at ${projectAddress}` : ""}.`,
      `Approximate duration is ${duration} day${duration === 1 ? "" : "s"}.`,
      "Include any reasonable prep notes the client should know (e.g. clear access to the work area, ensure gates are unlocked).",
      "Keep it brief — a few sentences at most. Do not include any signature — the email system adds one automatically.",
    ];

    const locale = await getCompanyLocale(companyId);
    const subject = await renderServerString(
      locale,
      "server-emails",
      "appointmentConfirmation.subject",
      { date: displayDate }
    );

    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      recipientEmail: clientEmail,
      recipientName: clientName,
      userInstruction: `${instructionParts.join(" ")} Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
      profileTypeOverride: "client_active_project",
      draftPurpose: {
        kind: "operational_outbound",
        verifiedContext: { schedule: true },
      },
      signatureWillBeAppended: true,
    });

    const draftText = draftResult.available
      ? draftResult.draft
      : await renderServerString(
          locale,
          "server-emails",
          "appointmentConfirmation.fallback",
          {
            clientName: clientName.split(" ")[0] || "",
            taskTitle,
            date: displayDate,
          }
        );
    const draftHistoryId = await ensureApprovalDraftHistory({
      draftHistoryId: draftResult.draftHistoryId || null,
      companyId,
      userId,
      connectionId,
      originalDraft: draftText,
      subject,
      profileType: "client_active_project",
      atProposal: true,
    });

    const structured: StructuredSummary = {
      type: "appointment_confirmation",
      params: {
        clientName: clientName || "client",
        date: displayDate,
        time: startTime ?? "",
        crew: crewListText,
      },
    };

    const actionData: SendAppointmentConfirmationActionData = {
      task_id: taskId,
      schedule_version:
        options.expectedConfirmation?.scheduleVersion ??
        (task.schedule_version as number),
      confirmed_schedule_version:
        options.expectedConfirmation?.scheduleVersion ??
        (task.confirmed_schedule_version as number),
      schedule_confirmed_at:
        options.expectedConfirmation?.confirmedAt ??
        (task.schedule_confirmed_at as string | null) ??
        "",
      schedule_confirmed_by:
        options.expectedConfirmation?.confirmedBy ??
        (task.schedule_confirmed_by as string | null) ??
        null,
      confirmation_origin:
        options.expectedConfirmation?.confirmationOrigin ??
        ((task.schedule_confirmed_by as string | null)
          ? "manual"
          : "automatic_grace"),
      project_id: projectId,
      project_title: projectTitle,
      client_id: clientId,
      client_name: clientName,
      client_email: clientEmail,
      task_title: taskTitle,
      scheduled_date: startDate,
      scheduled_time: startTime,
      scheduled_end_time: endTime,
      duration_hours: duration * 8,
      crew_names: crewNames,
      project_address: projectAddress,
      subject,
      draft_text: draftText,
      original_draft_text: draftText,
      connection_id: connectionId,
      draft_history_id: draftHistoryId,
      context_summary_structured: structured,
    };

    const contextSummary = await renderSummaryFallback(locale, structured);

    const autoExecuteAt =
      options.autoSendAfterMinutes && options.autoSendAfterMinutes > 0
        ? new Date(Date.now() + options.autoSendAfterMinutes * 60 * 1000)
        : undefined;

    if (options.expectedSchedule) {
      const { data: current } = await supabase
        .from("project_tasks")
        .select(
          "start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version, schedule_confirmed_at, schedule_confirmed_by, confirmed_schedule_version"
        )
        .eq("id", taskId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (
        !current ||
        !taskMatchesScheduleState(
          current as Record<string, unknown>,
          options.expectedSchedule
        ) ||
        (options.expectedConfirmation !== undefined &&
          !taskMatchesExactScheduleConfirmation(
            current as Record<string, unknown>,
            options.expectedConfirmation
          ))
      ) {
        return null;
      }
    }
    if (options.prePersistGuard && !(await options.prePersistGuard())) {
      return null;
    }

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_appointment_confirmation",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary,
      contextSource: "task_scheduled",
      sourceId: options.sourceId ?? `${taskId}:confirmation`,
      confidence: 0.85,
      priority: "normal",
      autoExecuteAt,
      taskAutomationGuard: options.taskAutomationGuard,
      scheduleConfirmationGuard: options.scheduleConfirmationGuard,
    });
  },

  /**
   * Propose a schedule-changed notification email for a previously-confirmed
   * task whose date has moved. Distinct from sendAppointmentConfirmation —
   * the subject and body explicitly acknowledge the change rather than
   * treating the new date as a first confirmation.
   *
   * Phase C gated. Dedupes per-task per-(originalDate → newDate) via source_id.
   * Accepts the same autoSendAfterMinutes option as the confirmation path.
   */
  async sendScheduleChangedEmail(
    companyId: string,
    userId: string,
    taskId: string,
    priorSchedule: string | null | ConfirmedScheduleChange,
    options: {
      autoSendAfterMinutes?: number;
      sourceId?: string;
      prePersistGuard?: () => Promise<boolean>;
      taskAutomationGuard?: TaskAutomationPersistenceGuard;
    } = {}
  ): Promise<string | null> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return null;

    const settings = await loadClientCommsSettings(companyId);
    if (settings.appointment_confirmation.level === "off") return null;

    const supabase = requireSupabase();

    const { data: task } = await supabase
      .from("project_tasks")
      .select(
        "id, project_id, custom_title, start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version, task_types(display)"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task) return null;

    const currentSchedule = taskScheduleState(task as Record<string, unknown>);
    const change: ConfirmedScheduleChange =
      priorSchedule && typeof priorSchedule === "object"
        ? priorSchedule
        : {
            before: {
              ...currentSchedule,
              startDate: priorSchedule,
            },
            after: currentSchedule,
            scheduleVersion:
              typeof task.schedule_version === "number"
                ? task.schedule_version
                : null,
          };
    if (
      priorSchedule &&
      typeof priorSchedule === "object" &&
      !taskMatchesScheduleChange(task as Record<string, unknown>, change)
    ) {
      return null;
    }

    const projectId = task.project_id as string;
    const { data: project } = await supabase
      .from("projects")
      .select("id, title, address, client_id")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!project || !project.client_id) return null;

    const clientId = project.client_id as string;
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .is("merged_into_client_id", null)
      .maybeSingle();

    if (!client || !client.email) return null;

    const clientEmail = client.email as string;
    const clientName = (client.name as string) ?? "";
    const projectTitle = (project.title as string) ?? "";
    const projectAddress = (project.address as string) ?? null;
    const taskTitle =
      (task.custom_title as string) ||
      (normalizeJoinedRow(task.task_types)?.display as string) ||
      projectTitle;

    const isUnscheduled = !change.after.startDate;
    const newStartDate = change.after.startDate;
    const newStartTime = formatTime(change.after.startTime);
    const newEndTime = formatTime(change.after.endTime);

    const crewIds = Array.isArray(task.team_member_ids)
      ? (task.team_member_ids as string[])
      : [];
    const crewNames = await loadCrewNames(companyId, crewIds);
    const priorCrewNames = sameStringSet(
      change.before.teamMemberIds,
      change.after.teamMemberIds
    )
      ? crewNames
      : await loadCrewNames(companyId, change.before.teamMemberIds);

    const connectionId = await getActiveConnectionId(companyId, userId);
    if (!connectionId) return null;

    const locale = await getCompanyLocale(companyId);
    const bcp = bcp47(locale);
    const displayNewDate = newStartDate
      ? new Date(newStartDate).toLocaleDateString(bcp, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;
    const displayOldDate = change.before.startDate
      ? new Date(change.before.startDate).toLocaleDateString(bcp, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;
    const crewListText =
      crewNames.length > 0 ? crewNames.join(", ") : "our crew";

    const changeDetails = buildScheduleChangeDetails(
      change,
      priorCrewNames,
      crewNames,
      bcp
    );
    if (changeDetails.length === 0) return null;

    // GPT instruction stays English; we ask it to produce output in locale.
    const instructionParts: string[] = isUnscheduled
      ? [
          "Write a brief notice that a previously confirmed visit is no longer scheduled.",
          ...changeDetails,
          `The affected work is ${taskTitle.toLowerCase()}${projectAddress ? ` at ${projectAddress}` : ""}.`,
          "Do not invent or promise a replacement date. Ask the client to reply with any questions. Keep it short — two or three sentences.",
          "Do not include any signature — the email system adds one automatically.",
          `Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
        ]
      : [
          "Write a brief schedule change notification.",
          ...changeDetails,
          `${crewListText} will be on site to work on ${taskTitle.toLowerCase()}${projectAddress ? ` at ${projectAddress}` : ""}.`,
          "Acknowledge the change, confirm only the updated details above, and apologize for any inconvenience. Keep it short — two or three sentences.",
          "Do not include any signature — the email system adds one automatically.",
          `Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
        ];

    const subject = await renderServerString(
      locale,
      "server-emails",
      isUnscheduled ? "scheduleUnscheduled.subject" : "scheduleChanged.subject",
      { projectTitle }
    );

    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      recipientEmail: clientEmail,
      recipientName: clientName,
      userInstruction: instructionParts.join(" "),
      profileTypeOverride: "client_active_project",
      draftPurpose: {
        kind: "operational_outbound",
        verifiedContext: { schedule: true },
      },
      signatureWillBeAppended: true,
    });

    const draftText = draftResult.available
      ? draftResult.draft
      : await renderServerString(
          locale,
          "server-emails",
          isUnscheduled
            ? "scheduleUnscheduled.fallback"
            : "scheduleChanged.fallback",
          {
            clientName: clientName.split(" ")[0] || "",
            taskTitle,
            newDate: displayNewDate ?? "",
          }
        );
    const draftHistoryId = await ensureApprovalDraftHistory({
      draftHistoryId: draftResult.draftHistoryId || null,
      companyId,
      userId,
      connectionId,
      originalDraft: draftText,
      subject,
      profileType: "client_active_project",
      atProposal: true,
    });

    const structured: StructuredSummary = {
      type: isUnscheduled ? "schedule_unscheduled" : "schedule_changed",
      params: {
        clientName: clientName || "client",
        taskTitle,
        newDate: displayNewDate ?? "",
        oldDate: displayOldDate ?? "",
      },
    };

    const actionData: SendScheduleChangedActionData = {
      task_id: taskId,
      project_id: projectId,
      project_title: projectTitle,
      client_id: clientId,
      client_name: clientName,
      client_email: clientEmail,
      task_title: taskTitle,
      original_date: change.before.startDate ?? "",
      original_time: formatTime(change.before.startTime),
      change_kind: isUnscheduled ? "unscheduled" : "rescheduled",
      new_date: newStartDate,
      new_time: newStartTime,
      new_end_time: newEndTime,
      crew_names: crewNames,
      project_address: projectAddress,
      subject,
      draft_text: draftText,
      original_draft_text: draftText,
      connection_id: connectionId,
      draft_history_id: draftHistoryId,
      context_summary_structured: structured,
    };

    const autoExecuteAt =
      options.autoSendAfterMinutes && options.autoSendAfterMinutes > 0
        ? new Date(Date.now() + options.autoSendAfterMinutes * 60 * 1000)
        : undefined;

    if (priorSchedule && typeof priorSchedule === "object") {
      const { data: current } = await supabase
        .from("project_tasks")
        .select(
          "start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version"
        )
        .eq("id", taskId)
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (
        !current ||
        !taskMatchesScheduleChange(
          current as Record<string, unknown>,
          priorSchedule
        )
      ) {
        return null;
      }
    }
    if (options.prePersistGuard && !(await options.prePersistGuard())) {
      return null;
    }

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_schedule_changed",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: await renderSummaryFallback(locale, structured),
      contextSource: "task_scheduled",
      sourceId:
        options.sourceId ??
        `${taskId}:sched_changed:${scheduleChangeFingerprint(change)}`,
      confidence: 0.8,
      priority: "normal",
      autoExecuteAt,
      taskAutomationGuard: options.taskAutomationGuard,
    });
  },

  /**
   * Propose an appointment reminder for the given task. The lead time and
   * autonomy level come from client_comms_settings.appointment_reminder.
   *
   * Historical alias: `sendDayBeforeReminder`. The name now reflects that
   * reminders can fire N days before the scheduled date (N configurable).
   */
  async sendAppointmentReminder(
    companyId: string,
    taskId: string,
    userId: string
  ): Promise<string | null> {
    return this.sendDayBeforeReminder(companyId, taskId, userId);
  },

  async sendDayBeforeReminder(
    companyId: string,
    taskId: string,
    userId: string
  ): Promise<string | null> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return null;

    const settings = await loadClientCommsSettings(companyId);
    if (!settings.appointment_reminder.enabled) return null;

    const supabase = requireSupabase();

    const { data: task } = await supabase
      .from("project_tasks")
      .select(
        "id, project_id, custom_title, start_date, end_date, start_time, end_time, duration, team_member_ids, task_type_id, task_types(display)"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.start_date) return null;

    const projectId = task.project_id as string;
    const { data: project } = await supabase
      .from("projects")
      .select("id, title, address, client_id, latitude, longitude")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!project || !project.client_id) return null;

    const clientId = project.client_id as string;
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!client || !client.email) return null;

    const clientEmail = client.email as string;
    const clientName = (client.name as string) ?? "";
    const projectTitle = (project.title as string) ?? "";
    const projectAddress = (project.address as string) ?? null;
    const taskTitle =
      (task.custom_title as string) ||
      (normalizeJoinedRow(task.task_types)?.display as string) ||
      projectTitle;

    const startDate = task.start_date as string;
    const startTime = formatTime((task.start_time as string) ?? null);
    const endTime = formatTime((task.end_time as string) ?? null);

    const crewIds = Array.isArray(task.team_member_ids)
      ? (task.team_member_ids as string[])
      : [];
    const crewNames = await loadCrewNames(companyId, crewIds);

    let weatherBlock: SendAppointmentReminderActionData["weather_risk"] = null;
    if (
      settings.appointment_reminder.include_weather &&
      project.latitude != null &&
      project.longitude != null
    ) {
      try {
        const weather = await ScheduleOptimizationService.getWeatherAwareness(
          companyId,
          new Date(startDate),
          project.latitude as number,
          project.longitude as number
        );
        if (weather.weatherRisk) {
          weatherBlock = {
            risk_level: weather.riskLevel,
            reason: weather.reason,
          };
        }
      } catch {
        // Non-fatal
      }
    }

    const connectionId = await getActiveConnectionId(companyId, userId);
    if (!connectionId) return null;

    const locale = await getCompanyLocale(companyId);
    const bcp = bcp47(locale);
    const displayDate = new Date(startDate).toLocaleDateString(bcp, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const crewListText =
      crewNames.length > 0 ? crewNames.join(", ") : "our crew";

    // ── Lead-time-aware phrasing ─────────────────────────────────────────
    // The reminder can fire 0–7 days before the scheduled date, so the
    // email wording must adapt. Compute calendar-day delta (not millisecond
    // delta) so times of day don't shift the phrasing off by one.
    const startDay = new Date(startDate);
    const today = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntil = Math.max(
      0,
      Math.round(
        (Date.UTC(
          startDay.getUTCFullYear(),
          startDay.getUTCMonth(),
          startDay.getUTCDate()
        ) -
          Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate()
          )) /
          msPerDay
      )
    );
    const whenPhrase =
      daysUntil === 0
        ? "today"
        : daysUntil === 1
          ? "tomorrow"
          : `in ${daysUntil} days`;

    const instructionParts: string[] = [
      `Write a friendly reminder email for a visit ${whenPhrase}.`,
      `The crew is arriving ${whenPhrase === "today" ? "today" : `on ${displayDate}`}${startTime ? ` around ${startTime}` : ""}.`,
      `${crewListText} will be on site to work on ${taskTitle.toLowerCase()}.`,
      weatherBlock && weatherBlock.risk_level !== "low"
        ? `Mention that weather conditions are a consideration this time of year — the crew will call to adjust if things look bad on the morning of the visit.`
        : "",
      "Remind them to clear access, keep pets inside if applicable, and to reach out if anything has changed on their end.",
      "Keep it short and helpful. No signature — the email system adds one.",
    ].filter(Boolean);

    // Subject line is rendered in locale. The subjectPhrase variant is
    // no longer used — the locale template encodes the "tomorrow"
    // phrasing itself.
    const subject = await renderServerString(
      locale,
      "server-emails",
      "dayBeforeReminder.subject"
    );

    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      recipientEmail: clientEmail,
      recipientName: clientName,
      userInstruction: `${instructionParts.join(" ")} Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
      profileTypeOverride: "client_active_project",
      draftPurpose: {
        kind: "operational_outbound",
        verifiedContext: { schedule: true },
      },
      signatureWillBeAppended: true,
    });

    const draftText = draftResult.available
      ? draftResult.draft
      : await renderServerString(
          locale,
          "server-emails",
          "dayBeforeReminder.fallback",
          {
            clientName: clientName.split(" ")[0] || "",
            taskTitle,
            date: displayDate,
          }
        );
    const draftHistoryId = await ensureApprovalDraftHistory({
      draftHistoryId: draftResult.draftHistoryId || null,
      companyId,
      userId,
      connectionId,
      originalDraft: draftText,
      subject,
      profileType: "client_active_project",
      atProposal: true,
    });

    const structured: StructuredSummary = {
      type: "appointment_reminder",
      params: {
        clientName: clientName || "client",
        date: displayDate,
        time: startTime ?? "",
        crew: crewListText,
        leadDays: daysUntil,
        weatherRisk: weatherBlock?.risk_level ?? "none",
      },
    };

    const actionData: SendAppointmentReminderActionData = {
      task_id: taskId,
      project_id: projectId,
      project_title: projectTitle,
      client_id: clientId,
      client_name: clientName,
      client_email: clientEmail,
      task_title: taskTitle,
      scheduled_date: startDate,
      scheduled_time: startTime,
      scheduled_end_time: endTime,
      crew_names: crewNames,
      project_address: projectAddress,
      weather_risk: weatherBlock,
      subject,
      draft_text: draftText,
      original_draft_text: draftText,
      connection_id: connectionId,
      draft_history_id: draftHistoryId,
      context_summary_structured: structured,
    };

    const reminderAutoExecuteAt =
      settings.appointment_reminder.autonomy === "auto_send"
        ? new Date(
            Date.now() +
              settings.appointment_reminder.send_delay_minutes * 60 * 1000
          )
        : undefined;

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_appointment_reminder",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: await renderSummaryFallback(locale, structured),
      contextSource: "appointment_reminder_cron",
      sourceId: `${taskId}:reminder`,
      confidence: 0.9,
      priority: "normal",
      autoExecuteAt: reminderAutoExecuteAt,
    });
  },

  async detectRescheduleRequest(input: {
    companyId: string;
    connectionId: string;
    providerThreadId: string;
    opportunityId: string;
    activityId: string;
  }): Promise<string | null> {
    const {
      companyId,
      connectionId: requestedConnectionId,
      providerThreadId,
      opportunityId: requestedOpportunityId,
      activityId,
    } = input;
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return null;

    const settings = await loadClientCommsSettings(companyId);
    if (!settings.reschedule_request.enabled) return null;
    if (settings.reschedule_request.behavior === "detect_only") {
      // Fire a notification instead of drafting a reply. The user handles it.
      return null;
    }

    const supabase = requireSupabase();

    const { data: activity } = await supabase
      .from("activities")
      .select(
        "id, company_id, subject, body_text, content, from_email, email_thread_id, email_connection_id, opportunity_id, direction"
      )
      .eq("id", activityId)
      .eq("company_id", companyId)
      .eq("email_connection_id", input.connectionId)
      .eq("email_thread_id", input.providerThreadId)
      .eq("opportunity_id", input.opportunityId)
      .maybeSingle();

    if (!activity || activity.direction !== "inbound") return null;
    if (
      activity.email_connection_id !== requestedConnectionId ||
      activity.email_thread_id !== providerThreadId ||
      activity.opportunity_id !== requestedOpportunityId
    ) {
      return null;
    }

    const actor = await resolveSyncEngineEmailActor({
      companyId,
      connectionId: requestedConnectionId,
      opportunityId: requestedOpportunityId,
      providerThreadId,
      operation: "send",
      supabase,
    });
    if (actor.kind !== "resolved") return null;
    const userId = actor.context.actorUserId;

    const subject = (activity.subject as string) ?? "";
    const bodyText =
      (activity.body_text as string) || ((activity.content as string) ?? "");
    const fromEmail = ((activity.from_email as string) ?? "").toLowerCase();

    const combined = `${subject} ${bodyText}`;
    if (!matchesRescheduleKeyword(combined)) return null;

    const opportunityId = requestedOpportunityId;
    const { data: opportunity } = await supabase
      .from("opportunities")
      .select("id, client_id, project_id")
      .eq("id", opportunityId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!opportunity) return null;

    let projectId = (opportunity.project_id as string) ?? null;
    if (!projectId) {
      const { data: linkedProject } = await supabase
        .from("projects")
        .select("id")
        .eq("company_id", companyId)
        .eq("opportunity_id", opportunityId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      projectId = (linkedProject?.id as string) ?? null;
    }

    if (!projectId) return null;

    const now = new Date();
    const nowIso = now.toISOString();
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 30);

    const { data: candidateTasks } = await supabase
      .from("project_tasks")
      .select(
        "id, custom_title, start_date, end_date, team_member_ids, duration, task_types(display)"
      )
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .gte("start_date", nowIso)
      .lte("start_date", windowEnd.toISOString())
      .order("start_date", { ascending: true })
      .limit(3);

    if (!candidateTasks || candidateTasks.length === 0) return null;

    const affectedTask = candidateTasks[0];
    const affectedTaskId = affectedTask.id as string;

    const projectCtx = await BusinessContextService.getProjectContext(
      companyId,
      projectId
    );
    const projectContextText = projectCtx.found
      ? projectCtx.summary
      : `Project ${projectId}`;

    const classification = await classifyRescheduleWithGPT(
      subject,
      bodyText,
      projectContextText
    );
    if (!classification) return null;
    if (!classification.isReschedule) return null;
    if (
      classification.confidence < settings.reschedule_request.min_confidence
    ) {
      return null;
    }

    const clientId = opportunity.client_id as string;
    const { data: client } = await supabase
      .from("clients")
      .select("id, name, email")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .maybeSingle();

    const clientEmail = (client?.email as string) ?? fromEmail;
    const clientName = (client?.name as string) ?? "";

    const suggestedAlternatives: RescheduleAlternative[] = [];
    const crewIds = Array.isArray(affectedTask.team_member_ids)
      ? (affectedTask.team_member_ids as string[])
      : [];

    const durationDays = (affectedTask.duration as number) ?? 1;
    const startAfter = classification.requestedDate
      ? new Date(classification.requestedDate)
      : new Date();

    for (const memberId of crewIds.slice(0, 2)) {
      try {
        const gap = await AssignmentService.findScheduleGap(
          companyId,
          memberId,
          durationDays,
          startAfter
        );
        const { data: member } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", memberId)
          .maybeSingle();

        const memberName = member
          ? `${(member.first_name as string) ?? ""} ${(member.last_name as string) ?? ""}`.trim()
          : null;

        suggestedAlternatives.push({
          date: gap.startDate.toISOString(),
          team_member_id: memberId,
          team_member_name: memberName,
          reasoning: {
            type: "assigned_crew_next_gap",
            params: {
              memberName: memberName ?? "crew",
            },
          },
        });
      } catch (err) {
        console.error("[client-scheduling-comms] findScheduleGap error:", err);
      }
    }

    const orderedSuggestedAlternatives =
      prioritizeVerifiedRescheduleAlternatives(
        suggestedAlternatives,
        classification.requestedDate
      );

    // Reschedule replies stay on the exact inbound connection. Never select a
    // different personal mailbox or arbitrary company fallback.
    const connectionId = input.connectionId;

    const locale = await getCompanyLocale(companyId);
    const bcp = bcp47(locale);
    const firstAlt = orderedSuggestedAlternatives[0] ?? null;
    const verifiedAlternativeInstruction = firstAlt
      ? `Propose ${new Date(firstAlt.date).toLocaleDateString(bcp, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })} as an alternative${firstAlt.team_member_name ? ` (${firstAlt.team_member_name} available)` : ""}.`
      : "Do not propose a date or imply availability. Say the team will check the schedule and confirm an option shortly.";

    const instructionParts: string[] = [
      "Write an acknowledgment reply to a client who is asking to reschedule their appointment.",
      verifiedAlternativeInstruction,
      "Be warm and flexible — no pushback on the change. Confirm once they reply.",
      "Keep it concise. No signature.",
      `Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
    ];

    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      recipientEmail: clientEmail,
      recipientName: clientName,
      userInstruction: instructionParts.join(" "),
      profileTypeOverride: "client_active_project",
      draftPurpose: {
        kind: "operational_outbound",
        ...(firstAlt ? { verifiedContext: { schedule: true } } : {}),
      },
      untrustedMessageContext: {
        subject,
        body: bodyText,
      },
      signatureWillBeAppended: true,
    });

    const taskTitleForFallback =
      (affectedTask.custom_title as string) ||
      (normalizeJoinedRow(affectedTask.task_types)?.display as string) ||
      "";

    const replyDraft = draftResult.available
      ? draftResult.draft
      : await renderServerString(
          locale,
          "server-emails",
          "rescheduleRequest.fallback",
          {
            clientName: clientName.split(" ")[0] || "",
            taskTitle: taskTitleForFallback,
          }
        );

    const taskTitle =
      (affectedTask.custom_title as string) ||
      (normalizeJoinedRow(affectedTask.task_types)?.display as string) ||
      "the scheduled visit";

    const structured: StructuredSummary = {
      type: "reschedule_request",
      params: {
        clientName: clientName || "client",
        taskTitle,
        requestedDate: classification.requestedDate ?? "flexible",
      },
    };

    // Reply subject: if the inbound subject already has a Re: prefix,
    // preserve it; otherwise build a localized "Re: rescheduling X" so
    // the client sees a coherent thread subject in Spanish when that's
    // their locale.
    const localizedRescheduleSubject = await renderServerString(
      locale,
      "server-emails",
      "rescheduleRequest.subject",
      { taskTitle: taskTitle || (projectCtx.title as string) || "" }
    );
    const subjectText = isReplyLikeSubject(subject)
      ? subject
      : localizedRescheduleSubject;
    const draftHistoryId = await ensureApprovalDraftHistory({
      draftHistoryId: draftResult.draftHistoryId || null,
      companyId,
      userId,
      connectionId,
      originalDraft: replyDraft,
      subject: subjectText,
      profileType: "client_active_project",
      atProposal: true,
    });

    const currentActor = await resolveSyncEngineEmailActor({
      companyId,
      connectionId,
      opportunityId,
      providerThreadId,
      expectedAssignmentVersion: actor.context.assignmentVersion,
      operation: "send",
      supabase,
    });
    if (
      currentActor.kind !== "resolved" ||
      currentActor.context.actorUserId !== userId
    ) {
      return null;
    }

    const actionData: ProcessRescheduleRequestActionData = {
      activity_id: activityId,
      thread_id: (activity.email_thread_id as string) ?? null,
      opportunity_id: opportunityId,
      source_assignment_version: actor.context.assignmentVersion,
      client_id: clientId,
      client_email: clientEmail,
      client_name: clientName,
      incoming_message_excerpt: bodyText.slice(0, 400),
      affected_task_id: affectedTaskId,
      project_id: projectId,
      project_title: (projectCtx.title as string) ?? "",
      task_title: taskTitle,
      original_start_date: affectedTask.start_date as string,
      original_end_date: (affectedTask.end_date as string) ?? null,
      requested_date: classification.requestedDate,
      requested_timing: classification.requestedTiming,
      requested_reason: classification.reason,
      suggested_alternatives: orderedSuggestedAlternatives,
      subject: subjectText,
      reply_draft_text: replyDraft,
      original_reply_draft_text: replyDraft,
      connection_id: connectionId,
      draft_history_id: draftHistoryId,
      classification_confidence: classification.confidence,
      selected_alternative_index: firstAlt ? 0 : null,
      context_summary_structured: structured,
    };

    try {
      await supabase.from("agent_memories").insert({
        company_id: companyId,
        memory_type: "fact",
        category: "client_preference",
        content: `Client ${clientName || clientEmail} asked to reschedule "${taskTitle}"${classification.reason ? ` — reason: ${classification.reason}` : ""}${classification.requestedDate ? ` — preferred ${classification.requestedDate}` : ""}.`,
        confidence: classification.confidence,
        source: "reschedule_detection",
      });
    } catch {
      // Non-fatal
    }

    const rrAutoExecuteAt =
      settings.reschedule_request.autonomy === "auto_send"
        ? new Date(
            Date.now() +
              settings.reschedule_request.send_delay_minutes * 60 * 1000
          )
        : undefined;

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "process_reschedule_request",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: await renderSummaryFallback(locale, structured),
      contextSource: "inbound_email",
      sourceId: `${activityId}:reschedule`,
      confidence: classification.confidence,
      priority: "high",
      autoExecuteAt: rrAutoExecuteAt,
    });
  },

  async coordinateWithSubcontractor(
    companyId: string,
    userId: string,
    projectId: string,
    subcontractorInfo: {
      name: string;
      email: string;
      trade: string | null;
      scopeOfWork: string;
      requestedDate: string | null;
    }
  ): Promise<string | null> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return null;

    const settings = await loadClientCommsSettings(companyId);
    if (!settings.subcontractor_coordination.enabled) return null;

    const supabase = requireSupabase();

    const projectCtx = await BusinessContextService.getProjectContext(
      companyId,
      projectId
    );
    if (!projectCtx.found) return null;

    const projectTitle = projectCtx.title ?? "";
    const projectAddress = projectCtx.address ?? null;

    const { data: upcomingTasks } = await supabase
      .from("project_tasks")
      .select("start_date, end_date, team_member_ids")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .order("start_date", { ascending: true })
      .limit(1);

    let mainCrewBlock: SendSubcontractorCoordinationActionData["main_crew_schedule"] =
      null;
    if (upcomingTasks && upcomingTasks[0]) {
      const first = upcomingTasks[0];
      const crewIds = Array.isArray(first.team_member_ids)
        ? (first.team_member_ids as string[])
        : [];
      const crewNames = await loadCrewNames(companyId, crewIds);
      mainCrewBlock = {
        start_date: first.start_date as string,
        end_date: (first.end_date as string) ?? null,
        crew_names: crewNames,
      };
    }

    const connectionId = await getActiveConnectionId(companyId, userId);
    if (!connectionId) return null;

    const locale = await getCompanyLocale(companyId);
    const bcp = bcp47(locale);

    const instructionParts: string[] = [
      `Write a coordination message to a subcontractor (${subcontractorInfo.trade ?? "sub"}: ${subcontractorInfo.name}).`,
      `Project: ${projectTitle}${projectAddress ? `, address: ${projectAddress}` : ""}.`,
      `What we need them to do: ${subcontractorInfo.scopeOfWork}`,
      subcontractorInfo.requestedDate
        ? `Requested timing: around ${new Date(subcontractorInfo.requestedDate).toLocaleDateString(bcp, { weekday: "long", month: "long", day: "numeric" })}.`
        : "",
      mainCrewBlock
        ? `Our main crew (${mainCrewBlock.crew_names.join(", ") || "crew"}) will be on site starting ${new Date(mainCrewBlock.start_date).toLocaleDateString(bcp, { month: "long", day: "numeric" })}.`
        : "",
      "Include access details, contact info request, and ask them to confirm timing. Professional and direct.",
      "No signature.",
      `Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
    ].filter(Boolean);

    const subject = await renderServerString(
      locale,
      "server-emails",
      "subcontractorCoordination.subject",
      { projectTitle }
    );

    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      recipientEmail: subcontractorInfo.email,
      recipientName: subcontractorInfo.name,
      userInstruction: instructionParts.join(" "),
      profileTypeOverride: "subtrade_coordination",
      draftPurpose: {
        kind: "operational_outbound",
        verifiedContext: { schedule: true },
      },
      signatureWillBeAppended: true,
    });

    const draftText = draftResult.available
      ? draftResult.draft
      : await renderServerString(
          locale,
          "server-emails",
          "subcontractorCoordination.fallback",
          {
            subcontractorName: subcontractorInfo.name.split(" ")[0] || "",
            projectTitle,
            address: projectAddress ?? projectTitle,
          }
        );
    const draftHistoryId = await ensureApprovalDraftHistory({
      draftHistoryId: draftResult.draftHistoryId || null,
      companyId,
      userId,
      connectionId,
      originalDraft: draftText,
      subject,
      profileType: "subtrade_coordination",
      atProposal: true,
    });

    const structured: StructuredSummary = {
      type: "subcontractor_coordination",
      params: {
        subcontractorName: subcontractorInfo.name,
        projectTitle,
        trade: subcontractorInfo.trade ?? "",
      },
    };

    const actionData: SendSubcontractorCoordinationActionData = {
      project_id: projectId,
      project_title: projectTitle,
      project_address: projectAddress,
      subcontractor_name: subcontractorInfo.name,
      subcontractor_email: subcontractorInfo.email,
      subcontractor_trade: subcontractorInfo.trade,
      main_crew_schedule: mainCrewBlock,
      scope_of_work: subcontractorInfo.scopeOfWork,
      requested_date: subcontractorInfo.requestedDate,
      subject,
      draft_text: draftText,
      original_draft_text: draftText,
      connection_id: connectionId,
      draft_history_id: draftHistoryId,
      context_summary_structured: structured,
    };

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_subcontractor_coordination",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: await renderSummaryFallback(locale, structured),
      contextSource: "subcontractor_coordination",
      sourceId: `${projectId}:${subcontractorInfo.email}:sub_coord`,
      confidence: 0.75,
      priority: "normal",
    });
  },

  /**
   * Return tasks scheduled for a target date (today + leadDays).
   * Replaces `listTasksScheduledForTomorrow` which hardcoded leadDays=1.
   */
  async listTasksScheduledForLeadDays(
    companyId: string,
    leadDays: number
  ): Promise<Array<{ taskId: string }>> {
    const supabase = requireSupabase();

    const now = new Date();
    const targetStart = new Date(now);
    targetStart.setUTCDate(
      targetStart.getUTCDate() + Math.max(0, Math.min(7, leadDays))
    );
    targetStart.setUTCHours(0, 0, 0, 0);

    const targetEnd = new Date(targetStart);
    targetEnd.setUTCDate(targetEnd.getUTCDate() + 1);

    const { data } = await supabase
      .from("project_tasks")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .is("deleted_at", null)
      .gte("start_date", targetStart.toISOString())
      .lt("start_date", targetEnd.toISOString())
      .limit(500);

    return (data ?? []).map((row) => ({ taskId: row.id as string }));
  },

  /** Legacy alias — reads lead_days from settings and defers to
   *  listTasksScheduledForLeadDays. */
  async listTasksScheduledForTomorrow(
    companyId: string
  ): Promise<Array<{ taskId: string }>> {
    const settings = await loadClientCommsSettings(companyId);
    return this.listTasksScheduledForLeadDays(
      companyId,
      settings.appointment_reminder.lead_days
    );
  },

  /**
   * Expose the loader so cron jobs and API routes can read the effective
   * client comms settings without duplicating the fallback logic.
   */
  async getSettings(companyId: string): Promise<ClientCommsSettings> {
    return loadClientCommsSettings(companyId);
  },

  /**
   * Purpose-bound confirmation bridge. It owns the guarded stamp, validates
   * the exact receipt, binds dispatch to that schedule/proof, and recovers the
   * same durable action on retry after a route or worker interruption.
   */
  async confirmTaskScheduleAndDispatch(
    companyId: string,
    userId: string,
    taskId: string,
    expectedScheduleVersion: number,
    confirmationKind: "manual" | "automatic"
  ): Promise<{
    confirmed: true;
    alreadyConfirmed: boolean;
    actionTaken: string;
    actionId: string | null;
  }> {
    if (
      !Number.isSafeInteger(expectedScheduleVersion) ||
      expectedScheduleVersion < 0
    ) {
      throw new Error("Invalid schedule version");
    }
    const supabase = requireSupabase();
    const rpcArguments = {
      p_actor_user_id: userId,
      p_company_id: companyId,
      p_task_id: taskId,
      p_expected_schedule_version: expectedScheduleVersion,
    };
    const { data, error } =
      confirmationKind === "manual"
        ? await supabase.rpc(
            "confirm_project_task_schedule_as_system",
            rpcArguments
          )
        : await supabase.rpc(
            "confirm_automatic_project_task_schedule_as_system",
            rpcArguments
          );
    if (error) {
      throw new Error(`Schedule confirmation conflict: ${error.message}`);
    }
    const receipt = parseScheduleConfirmationReceipt(data, {
      taskId,
      scheduleVersion: expectedScheduleVersion,
      confirmationKind,
      actorUserId: userId,
    });
    return {
      confirmed: true,
      alreadyConfirmed: !receipt.newly_confirmed,
      actionTaken: "queued",
      actionId: null,
    };
  },

  async confirmFullAutoScheduleFromLease(
    eventId: string,
    leaseToken: string,
    taskId: string,
    scheduleVersion: number
  ): Promise<{
    disposition:
      | "processed"
      | "no_action"
      | "phase_disabled"
      | "access_lost"
      | "superseded";
    reason: string | null;
  }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(
      "confirm_full_auto_project_task_schedule_as_system",
      {
        p_event_id: eventId,
        p_lease_token: leaseToken,
        p_task_id: taskId,
        p_expected_schedule_version: scheduleVersion,
      }
    );
    if (error) {
      throw new Error(
        `Full-auto schedule confirmation failed: ${error.message}`
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Full-auto schedule confirmation returned invalid proof");
    }
    const row = data as Record<string, unknown>;
    if (
      row.disposition !== "processed" &&
      row.disposition !== "no_action" &&
      row.disposition !== "phase_disabled" &&
      row.disposition !== "access_lost" &&
      row.disposition !== "superseded"
    ) {
      throw new Error("Full-auto schedule confirmation returned invalid proof");
    }
    if (
      row.task_id !== taskId ||
      row.schedule_version !== scheduleVersion ||
      (row.disposition === "processed" &&
        (row.confirmation_origin !== "full_auto" ||
          typeof row.schedule_confirmed_at !== "string" ||
          !Number.isFinite(Date.parse(row.schedule_confirmed_at)) ||
          row.schedule_confirmed_by !== null ||
          row.confirmed_schedule_version !== scheduleVersion))
    ) {
      throw new Error("Full-auto schedule confirmation returned invalid proof");
    }
    return {
      disposition: row.disposition,
      reason: typeof row.reason === "string" ? row.reason : null,
    };
  },

  /** Worker-only effect for a DB-authored, leased confirmation proof. */
  async dispatchConfirmedScheduleProof(
    companyId: string,
    userId: string,
    taskId: string,
    confirmation: ExactScheduleConfirmation,
    expectedSchedule: TaskScheduleState,
    confirmationOrigin: "manual" | "automatic_grace" | "full_auto",
    taskAutomationGuard: TaskAutomationPersistenceGuard
  ): Promise<{ actionTaken: string; actionId: string | null }> {
    if (confirmation.confirmationOrigin !== confirmationOrigin) {
      throw new Error("Schedule confirmation origin is inconsistent");
    }
    const prepared = await prepareScheduleDispatch(taskAutomationGuard, {
      companyId,
      actorUserId: userId,
      taskId,
      scheduleVersion: confirmation.scheduleVersion,
      kind: "schedule_confirmation_dispatch",
    });
    if (prepared.disposition !== "ready") {
      return {
        actionTaken: prepared.disposition,
        actionId: null,
      };
    }
    if (
      prepared.confirmationOrigin !== confirmationOrigin ||
      prepared.scheduleConfirmedAt !== confirmation.confirmedAt ||
      prepared.scheduleConfirmedBy !== confirmation.confirmedBy ||
      prepared.scheduledDate !==
        civilDateFromDateCarrier(expectedSchedule.startDate) ||
      prepared.scheduledTime !== expectedSchedule.startTime ||
      prepared.scheduledEndTime !== expectedSchedule.endTime ||
      prepared.allDay !== expectedSchedule.allDay ||
      prepared.durationHours / 8 !== expectedSchedule.duration
    ) {
      throw new Error(
        "Prepared schedule confirmation does not match its event"
      );
    }
    const scheduleConfirmationGuard = mintScheduleConfirmationPersistenceGuard({
      eventId: taskAutomationGuard.eventId,
      leaseToken: taskAutomationGuard.leaseToken,
      taskId,
      scheduleVersion: confirmation.scheduleVersion,
      confirmedAt: confirmation.confirmedAt,
      confirmedBy: confirmation.confirmedBy,
      confirmationOrigin: confirmation.confirmationOrigin,
    });
    const actionId = await proposePreparedScheduleConfirmation(
      prepared,
      scheduleConfirmationGuard
    );
    return {
      actionTaken: actionId
        ? prepared.confirmationLevel
        : "dispatch_unavailable",
      actionId,
    };
  },

  // ─── Schedule confirmation dispatcher (S2 amendment) ─────────────────────

  /**
   * Called when a task becomes "schedule confirmed" — either via explicit
   * user click, via the auto-confirm grace period cron, or via the full_auto
   * immediate hook on task creation.
   *
   * Dispatches the configured action per settings.appointment_confirmation.level:
   *   off                  → no-op
   *   manual               → no-op (the button sends directly via sendAppointmentConfirmation)
   *   draft_on_confirm     → sendAppointmentConfirmation (no auto-send)
   *   auto_send_on_confirm → sendAppointmentConfirmation with send_delay_minutes
   *   full_auto            → sendAppointmentConfirmation with send_delay_minutes
   *
   * Returns a short tag describing what was done (for logging + API
   * responses). Phase C gated.
   */
  async onTaskScheduleConfirmed(
    companyId: string,
    userId: string,
    taskId: string,
    options: {
      sourceId?: string;
      expectedSchedule?: TaskScheduleState;
      expectedConfirmation?: ExactScheduleConfirmation;
      prePersistGuard?: () => Promise<boolean>;
      taskAutomationGuard?: TaskAutomationPersistenceGuard;
      scheduleConfirmationGuard?: ScheduleConfirmationPersistenceGuard;
    } = {}
  ): Promise<{ actionTaken: string; actionId: string | null }> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) {
      return { actionTaken: "phase_c_disabled", actionId: null };
    }

    const settings = await loadClientCommsSettings(companyId);
    const level = settings.appointment_confirmation.level;

    if (level === "off" || level === "manual") {
      return { actionTaken: level, actionId: null };
    }

    const autoSendLevels = new Set(["auto_send_on_confirm", "full_auto"]);
    const autoSendAfterMinutes = autoSendLevels.has(level)
      ? settings.appointment_confirmation.send_delay_minutes
      : undefined;

    const actionId = await this.sendAppointmentConfirmation(
      companyId,
      userId,
      taskId,
      { autoSendAfterMinutes, ...options }
    );

    return {
      actionTaken: actionId ? level : "dispatch_unavailable",
      actionId,
    };
  },

  /**
   * Durable-worker entry point for immediate full-auto confirmation. The
   * guarded action RPC persists the proposal and stamps schedule_confirmed_at
   * in one transaction after rechecking the live task version and lease.
   */
  async onTaskCreatedMaybeFullAuto(
    companyId: string,
    userId: string,
    taskId: string,
    options: {
      sourceId?: string;
      expectedSchedule?: ConfirmedScheduleChange;
      prePersistGuard?: () => Promise<boolean>;
      taskAutomationGuard?: TaskAutomationPersistenceGuard;
    } = {}
  ): Promise<{ actionTaken: string; actionId: string | null }> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) {
      return { actionTaken: "phase_c_disabled", actionId: null };
    }

    const settings = await loadClientCommsSettings(companyId);
    if (settings.appointment_confirmation.level !== "full_auto") {
      return { actionTaken: "not_full_auto", actionId: null };
    }
    if (!options.taskAutomationGuard) {
      throw new Error("Full-auto confirmation requires a durable task lease");
    }

    // Guard: only stamp the confirmation marker when the task actually has
    // a scheduled date. Unscheduled tasks shouldn't be auto-confirmed —
    // confirming them would pollute the "confirmed" state with meaningless
    // markers. The onTaskCreatedMaybeFullAuto caller already checks
    // startDate before firing, but we double-check at the service boundary
    // so this method is safe to call from any path.
    const supabase = requireSupabase();
    const { data: task } = await supabase
      .from("project_tasks")
      .select(
        "start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.start_date) {
      return { actionTaken: "stale", actionId: null };
    }
    if (
      options.expectedSchedule &&
      !taskMatchesScheduleChange(
        task as Record<string, unknown>,
        options.expectedSchedule
      )
    ) {
      return { actionTaken: "stale", actionId: null };
    }
    return this.onTaskScheduleConfirmed(companyId, userId, taskId, {
      sourceId: options.sourceId,
      expectedSchedule: options.expectedSchedule?.after,
      prePersistGuard: options.prePersistGuard,
      taskAutomationGuard: options.taskAutomationGuard,
    });
  },

  /**
   * Called when a task that was already schedule-confirmed gets rescheduled
   * (new date, new crew, cascade resolution, etc.). Fires the configured
   * reschedule_behavior: do_nothing | notify | draft | auto_send.
   *
   * No-op if the task was never confirmed — nothing to "reschedule from".
   */
  /**
   * Called when a task that was already schedule-confirmed gets rescheduled.
   * Fires the configured reschedule_behavior (do_nothing | notify | draft |
   * auto_send). Takes an optional priorStartDate — when known, it's passed
   * through to the schedule-changed email so the body can reference the
   * original date explicitly. If callers don't have the prior date handy,
   * the email uses a less-specific wording.
   */
  async onConfirmedTaskRescheduled(
    companyId: string,
    userId: string,
    taskId: string,
    priorSchedule: string | null | ConfirmedScheduleChange = null,
    options: {
      sourceId?: string;
      prePersistGuard?: () => Promise<boolean>;
      throwOnError?: boolean;
      taskAutomationGuard?: TaskAutomationPersistenceGuard;
      guardedUnconfirmationReceipt?: GuardedUnconfirmationReceipt;
    } = {}
  ): Promise<ConfirmedRescheduleOutcome> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) {
      return { actionTaken: "phase_c_disabled", actionId: null };
    }

    const supabase = requireSupabase();
    const { data: task } = await supabase
      .from("project_tasks")
      .select(
        "id, start_date, end_date, start_time, end_time, all_day, duration, team_member_ids, schedule_version, schedule_confirmed_at"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    const guardedClear = options.guardedUnconfirmationReceipt;
    const guardedClearIsCurrent =
      guardedClear !== undefined &&
      GUARDED_UNCONFIRMATION_RECEIPTS.has(guardedClear) &&
      task?.schedule_confirmed_at === null &&
      task.schedule_version === guardedClear.scheduleVersion &&
      guardedClear.previousConfirmedAt.length > 0;
    const ordinaryConfirmedReschedule =
      guardedClear === undefined && task?.schedule_confirmed_at !== null;
    if (!task || (!guardedClearIsCurrent && !ordinaryConfirmedReschedule)) {
      return { actionTaken: "stale_or_unconfirmed", actionId: null };
    }
    if (
      priorSchedule &&
      typeof priorSchedule === "object" &&
      !taskMatchesScheduleChange(task as Record<string, unknown>, priorSchedule)
    ) {
      return { actionTaken: "stale_or_unconfirmed", actionId: null };
    }

    const settings = await loadClientCommsSettings(companyId);
    const behavior = settings.appointment_confirmation.reschedule_behavior;

    switch (behavior) {
      case "do_nothing":
        return { actionTaken: "do_nothing", actionId: null };
      case "notify":
        try {
          // Resolve the notification strings to the company's locale at
          // write time so the row inserted into `notifications` is fully
          // rendered text — the notification rail doesn't run i18n on
          // stored rows.
          const locale = await getCompanyLocale(companyId);
          const notificationKey = task.start_date
            ? "notification.confirmedTaskRescheduled"
            : "notification.confirmedTaskUnscheduled";
          const [nTitle, nBody, nAction] = await Promise.all([
            renderServerString(locale, "common", `${notificationKey}.title`),
            renderServerString(locale, "common", `${notificationKey}.body`),
            renderServerString(locale, "common", `${notificationKey}.action`),
          ]);
          if (options.prePersistGuard && !(await options.prePersistGuard())) {
            return { actionTaken: "stale_or_unconfirmed", actionId: null };
          }
          if (options.taskAutomationGuard) {
            await TaskAutomationPersistenceService.persistNotification(
              options.taskAutomationGuard,
              {
                title: nTitle,
                body: nBody,
                actionUrl: "/schedule",
                actionLabel: nAction,
              }
            );
          } else {
            const { NotificationService } =
              await import("./notification-service");
            await NotificationService.create({
              userId,
              companyId,
              type: "mention",
              title: nTitle,
              body: nBody,
              persistent: false,
              actionUrl: "/schedule",
              actionLabel: nAction,
            });
          }
          return { actionTaken: "notify", actionId: null };
        } catch (err) {
          if (options.throwOnError) throw err;
          console.error(
            "[client-scheduling-comms] reschedule notify failed:",
            err
          );
          return { actionTaken: "notify_failed", actionId: null };
        }
      case "draft": {
        const actionId = await this.sendScheduleChangedEmail(
          companyId,
          userId,
          taskId,
          priorSchedule,
          options
        );
        return { actionTaken: "draft", actionId };
      }
      case "auto_send": {
        const actionId = await this.sendScheduleChangedEmail(
          companyId,
          userId,
          taskId,
          priorSchedule,
          {
            autoSendAfterMinutes:
              settings.appointment_confirmation.send_delay_minutes,
            ...options,
          }
        );
        return { actionTaken: "auto_send", actionId };
      }
    }
  },

  async unconfirmTaskSchedule(
    companyId: string,
    userId: string,
    taskId: string,
    expectedScheduleVersion: number
  ): Promise<{
    unconfirmed: true;
    alreadyUnconfirmed: boolean;
    rescheduleAction: string | null;
    rescheduleActionId: string | null;
    rescheduleOutcome:
      ConfirmedRescheduleOutcome["actionTaken"] | "queued" | null;
  }> {
    if (
      !Number.isSafeInteger(expectedScheduleVersion) ||
      expectedScheduleVersion < 0
    ) {
      throw new Error("Invalid schedule version");
    }
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(
      "unconfirm_project_task_schedule_as_system",
      {
        p_actor_user_id: userId,
        p_company_id: companyId,
        p_task_id: taskId,
        p_expected_schedule_version: expectedScheduleVersion,
      }
    );
    if (error) {
      throw new Error(`Schedule unconfirmation conflict: ${error.message}`);
    }
    const raw = data as Record<string, unknown> | null;
    if (
      !raw ||
      raw.task_id !== taskId ||
      raw.schedule_version !== expectedScheduleVersion ||
      typeof raw.newly_unconfirmed !== "boolean" ||
      (raw.previous_schedule_confirmed_at !== null &&
        typeof raw.previous_schedule_confirmed_at !== "string")
    ) {
      throw new Error("Invalid schedule unconfirmation receipt");
    }
    const previousConfirmedAt = raw.previous_schedule_confirmed_at;
    if (
      raw.newly_unconfirmed &&
      (typeof previousConfirmedAt !== "string" ||
        !Number.isFinite(Date.parse(previousConfirmedAt)))
    ) {
      throw new Error("Invalid schedule unconfirmation receipt");
    }
    return {
      unconfirmed: true,
      alreadyUnconfirmed: !raw.newly_unconfirmed,
      rescheduleAction: raw.newly_unconfirmed ? "queued" : null,
      rescheduleActionId: null,
      rescheduleOutcome: raw.newly_unconfirmed ? "queued" : null,
    };
  },

  /** Worker-only effect for a DB-authored, leased unconfirmation proof. */
  async dispatchUnconfirmedScheduleProof(
    companyId: string,
    userId: string,
    taskId: string,
    scheduleVersion: number,
    previousConfirmedAt: string,
    taskAutomationGuard: ScheduleUnconfirmationPersistenceGuard
  ): Promise<ConfirmedRescheduleOutcome> {
    if (
      !isCurrentScheduleUnconfirmationPersistenceGuard(taskAutomationGuard) ||
      taskAutomationGuard.taskId !== taskId ||
      taskAutomationGuard.scheduleVersion !== scheduleVersion ||
      taskAutomationGuard.companyId !== companyId ||
      taskAutomationGuard.actorUserId !== userId ||
      taskAutomationGuard.previousConfirmedAt !== previousConfirmedAt ||
      (taskAutomationGuard.unconfirmationOrigin !== "explicit_admin" &&
        taskAutomationGuard.unconfirmationOrigin !== "schedule_edit")
    ) {
      throw new Error("Schedule unconfirmation dispatch guard is invalid");
    }
    const prepared = await prepareScheduleDispatch(taskAutomationGuard, {
      companyId,
      actorUserId: userId,
      taskId,
      scheduleVersion,
      kind: "schedule_unconfirmation_dispatch",
    });
    if (prepared.disposition !== "ready") {
      return {
        actionTaken:
          prepared.disposition === "phase_disabled"
            ? "phase_c_disabled"
            : "stale_or_unconfirmed",
        actionId: null,
      };
    }
    if (
      prepared.previousScheduleConfirmedAt !== previousConfirmedAt ||
      prepared.kind !== "schedule_unconfirmation_dispatch" ||
      prepared.scheduleUnconfirmationOrigin !==
        taskAutomationGuard.unconfirmationOrigin
    ) {
      throw new Error("Prepared schedule unconfirmation is inconsistent");
    }
    if (prepared.rescheduleBehavior === "do_nothing") {
      return { actionTaken: "do_nothing", actionId: null };
    }
    const receipt = mintGuardedUnconfirmationReceipt({
      previousConfirmedAt,
      scheduleVersion,
    });
    // The legacy dispatcher remains the copy/action builder for now, but its
    // privileged source pre-read is not allowed on a purpose lease. The
    // prepared projection is the exclusive source; a dedicated builder below
    // consumes it without querying business tables.
    if (prepared.rescheduleBehavior === "notify") {
      const [title, body, actionLabel] = await Promise.all([
        renderServerString(
          prepared.locale,
          "common",
          `notification.${prepared.scheduledDate ? "confirmedTaskRescheduled" : "confirmedTaskUnscheduled"}.title`
        ),
        renderServerString(
          prepared.locale,
          "common",
          `notification.${prepared.scheduledDate ? "confirmedTaskRescheduled" : "confirmedTaskUnscheduled"}.body`
        ),
        renderServerString(
          prepared.locale,
          "common",
          `notification.${prepared.scheduledDate ? "confirmedTaskRescheduled" : "confirmedTaskUnscheduled"}.action`
        ),
      ]);
      await TaskAutomationPersistenceService.persistNotification(
        taskAutomationGuard,
        { title, body, actionUrl: "/schedule", actionLabel }
      );
      return { actionTaken: "notify", actionId: null };
    }
    // Draft/auto-send uses the prepared safe projection only. The dedicated
    // persistence seam is added below; never fall back to service-role reads.
    const actionId = await proposePreparedScheduleChange(
      prepared,
      taskAutomationGuard,
      receipt
    );
    return {
      actionTaken: prepared.rescheduleBehavior,
      actionId,
    };
  },

  // ─── Auto-confirm grace-period candidates ────────────────────────────────

  /**
   * Return tasks eligible for automatic schedule confirmation. Called by the
   * /api/cron/auto-confirm-schedules cron. Filters:
   *   - company is phase_c enabled
   *   - appointment_confirmation.level in (draft_on_confirm, auto_send_on_confirm, full_auto)
   *   - appointment_confirmation.confirm_mode === "automatic"
   *   - task has start_date set
   *   - task not already schedule-confirmed
   *   - task.updated_at < (now - auto_confirm_after_hours)
   *   - task not deleted
   */
  async listAutoConfirmCandidates(
    companyId: string
  ): Promise<Array<{ taskId: string }>> {
    const settings = await loadClientCommsSettings(companyId);
    const ac = settings.appointment_confirmation;

    // Guard: auto-confirm only applies when confirm_mode is automatic AND
    // the level is one of the non-manual/non-off levels. manual level users
    // expect explicit button clicks — the cron should NEVER stamp them.
    if (ac.confirm_mode !== "automatic") return [];
    const autoLevels: ClientCommsSettings["appointment_confirmation"]["level"][] =
      ["draft_on_confirm", "auto_send_on_confirm", "full_auto"];
    if (!autoLevels.includes(ac.level)) return [];

    const supabase = requireSupabase();
    const cutoff = new Date(
      Date.now() - ac.auto_confirm_after_hours * 60 * 60 * 1000
    );

    const { data: unconfirmed, error: unconfirmedError } = await supabase
      .from("project_tasks")
      .select("id, schedule_version")
      .eq("company_id", companyId)
      .is("schedule_confirmed_at", null)
      .is("deleted_at", null)
      .eq("status", "active")
      .not("start_date", "is", null)
      .lt("updated_at", cutoff.toISOString())
      .limit(500);
    if (unconfirmedError) {
      throw new Error(
        `Failed to list automatic confirmations: ${unconfirmedError.message}`
      );
    }

    // A stamp and its dispatch outbox row commit together. Include exact
    // current automatic proofs as a bounded recovery scan so a pre-deploy
    // legacy stamp or a previously failed purpose row can be re-enqueued by
    // the idempotent authority RPC.
    const remaining = Math.max(0, 500 - (unconfirmed?.length ?? 0));
    const { data: confirmed, error: confirmedError } = remaining
      ? await supabase
          .from("project_tasks")
          .select("id, schedule_version, confirmed_schedule_version")
          .eq("company_id", companyId)
          .is("schedule_confirmed_by", null)
          .not("schedule_confirmed_at", "is", null)
          .is("deleted_at", null)
          .eq("status", "active")
          .not("start_date", "is", null)
          .limit(remaining)
      : { data: [], error: null };
    if (confirmedError) {
      throw new Error(
        `Failed to recover automatic confirmations: ${confirmedError.message}`
      );
    }

    return [
      ...(unconfirmed ?? []),
      ...(confirmed ?? []).filter(
        (row) => row.confirmed_schedule_version === row.schedule_version
      ),
    ].map((row) => ({ taskId: row.id as string }));
  },
};
