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
} from "@/lib/types/approval-queue";
import { DEFAULT_CLIENT_COMMS_SETTINGS } from "@/lib/types/approval-queue";

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
    | Record<string, unknown>
    | undefined;
  const acLegacy = raw.appointment_confirmations as
    | Record<string, unknown>
    | undefined;

  const acLevel =
    typeof acNew?.level === "string"
      ? (acNew.level as ClientCommsSettings["appointment_confirmation"]["level"])
      : acLegacy?.enabled === false
        ? "off"
        : d.appointment_confirmation.level;

  // ── Appointment reminder (new schema, fallback: day_before_reminders)
  const arNew = raw.appointment_reminder as Record<string, unknown> | undefined;
  const arLegacy = raw.day_before_reminders as
    | Record<string, unknown>
    | undefined;

  // ── Reschedule request (new schema, fallback: reschedule_requests)
  const rrNew = raw.reschedule_request as Record<string, unknown> | undefined;
  const rrLegacy = raw.reschedule_requests as
    | Record<string, unknown>
    | undefined;

  const su = raw.status_update as Record<string, unknown> | undefined;
  const pr = raw.payment_reminder as Record<string, unknown> | undefined;
  const ic = raw.invoice_cover as Record<string, unknown> | undefined;
  const sc = raw.subcontractor_coordination as
    | Record<string, unknown>
    | undefined;

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
  const supabase = requireSupabase();

  const { data: userConn } = await supabase
    .from("email_connections")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "connected")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (userConn?.id) return userConn.id as string;

  const { data: anyConn } = await supabase
    .from("email_connections")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "connected")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  return (anyConn?.id as string) ?? null;
}

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hh = match[1].padStart(2, "0");
  return `${hh}:${match[2]}`;
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

  const supabase = requireSupabase();
  const { data: users } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("company_id", companyId)
    .in("id", teamMemberIds)
    .is("deleted_at", null);

  const byId = new Map<string, string>();
  for (const u of users ?? []) {
    const name =
      `${(u.first_name as string) ?? ""} ${(u.last_name as string) ?? ""}`.trim();
    if (name) byId.set(u.id as string, name);
  }
  return teamMemberIds
    .map((id) => byId.get(id))
    .filter((n): n is string => !!n);
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
    options: { autoSendAfterMinutes?: number } = {}
  ): Promise<string | null> {
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
        "id, project_id, custom_title, start_date, end_date, start_time, end_time, duration, team_member_ids, task_types(display)"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.start_date) return null;

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

    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_appointment_confirmation",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary,
      contextSource: "task_scheduled",
      sourceId: `${taskId}:confirmation`,
      confidence: 0.85,
      priority: "normal",
      autoExecuteAt,
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
    priorStartDate: string | null,
    options: { autoSendAfterMinutes?: number } = {}
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
        "id, project_id, custom_title, start_date, end_date, start_time, end_time, duration, team_member_ids, task_types(display)"
      )
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.start_date) return null;

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

    const newStartDate = task.start_date as string;
    const newStartTime = formatTime((task.start_time as string) ?? null);
    const newEndTime = formatTime((task.end_time as string) ?? null);

    const crewIds = Array.isArray(task.team_member_ids)
      ? (task.team_member_ids as string[])
      : [];
    const crewNames = await loadCrewNames(companyId, crewIds);

    const connectionId = await getActiveConnectionId(companyId, userId);
    if (!connectionId) return null;

    const locale = await getCompanyLocale(companyId);
    const bcp = bcp47(locale);
    const displayNewDate = new Date(newStartDate).toLocaleDateString(bcp, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const displayOldDate = priorStartDate
      ? new Date(priorStartDate).toLocaleDateString(bcp, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;
    const crewListText =
      crewNames.length > 0 ? crewNames.join(", ") : "our crew";

    // GPT instruction stays English; we ask it to produce output in locale.
    const instructionParts: string[] = [
      "Write a brief schedule change notification.",
      displayOldDate
        ? `The original date was ${displayOldDate}.`
        : "The original date has changed.",
      `The new date is ${displayNewDate}${newStartTime ? ` at ${newStartTime}` : ""}.`,
      `${crewListText} will be on site to work on ${taskTitle.toLowerCase()}${projectAddress ? ` at ${projectAddress}` : ""}.`,
      "Acknowledge the change, confirm the new date, and apologize for any inconvenience. Keep it short — two or three sentences.",
      "Do not include any signature — the email system adds one automatically.",
      `Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
    ];

    const subject = await renderServerString(
      locale,
      "server-emails",
      "scheduleChanged.subject",
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
    });

    const draftText = draftResult.available
      ? draftResult.draft
      : await renderServerString(
          locale,
          "server-emails",
          "scheduleChanged.fallback",
          {
            clientName: clientName.split(" ")[0] || "",
            taskTitle,
            newDate: displayNewDate,
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
      type: "schedule_changed",
      params: {
        clientName: clientName || "client",
        taskTitle,
        newDate: displayNewDate,
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
      original_date: priorStartDate ?? "",
      original_time: null,
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

    // Dedupe per task per new-date so rapid successive reschedules don't
    // pile up identical drafts.
    const newDateKey = newStartDate.slice(0, 10);
    return ApprovalQueueService.proposeAction({
      companyId,
      userId,
      actionType: "send_schedule_changed",
      actionData: actionData as unknown as Record<string, unknown>,
      contextSummary: await renderSummaryFallback(locale, structured),
      contextSource: "task_scheduled",
      sourceId: `${taskId}:sched_changed:${newDateKey}`,
      confidence: 0.8,
      priority: "normal",
      autoExecuteAt,
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

  async detectRescheduleRequest(
    companyId: string,
    userId: string,
    activityId: string
  ): Promise<string | null> {
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
        "id, company_id, subject, body_text, content, from_email, email_thread_id, opportunity_id, direction"
      )
      .eq("id", activityId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!activity || activity.direction !== "inbound") return null;
    if (!activity.opportunity_id) return null;

    const subject = (activity.subject as string) ?? "";
    const bodyText =
      (activity.body_text as string) || ((activity.content as string) ?? "");
    const fromEmail = ((activity.from_email as string) ?? "").toLowerCase();

    const combined = `${subject} ${bodyText}`;
    if (!matchesRescheduleKeyword(combined)) return null;

    const opportunityId = activity.opportunity_id as string;
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

    if (
      classification.requestedDate &&
      !suggestedAlternatives.some((a) =>
        a.date.startsWith(classification.requestedDate!.split("T")[0])
      )
    ) {
      suggestedAlternatives.unshift({
        date: classification.requestedDate,
        team_member_id: crewIds[0] ?? null,
        team_member_name: null,
        reasoning: {
          type: "client_requested",
          params: {},
        },
      });
    }

    if (suggestedAlternatives.length === 0) {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() + 2);
      suggestedAlternatives.push({
        date: fallback.toISOString(),
        team_member_id: crewIds[0] ?? null,
        team_member_name: null,
        reasoning: { type: "fallback_two_days", params: {} },
      });
    }

    const connectionId = await getActiveConnectionId(companyId, userId);
    if (!connectionId) return null;

    const locale = await getCompanyLocale(companyId);
    const bcp = bcp47(locale);
    const firstAlt = suggestedAlternatives[0];
    const altDateDisplay = new Date(firstAlt.date).toLocaleDateString(bcp, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const instructionParts: string[] = [
      "Write an acknowledgment reply to a client who is asking to reschedule their appointment.",
      `They wrote: "${bodyText.slice(0, 300).replace(/\s+/g, " ")}"`,
      classification.requestedDate
        ? `They mentioned ${new Date(classification.requestedDate).toLocaleDateString(bcp, { weekday: "long", month: "long", day: "numeric" })} as a preferred date.`
        : "They did not specify a new date.",
      `Propose ${altDateDisplay} as an alternative${firstAlt.team_member_name ? ` (${firstAlt.team_member_name} available)` : ""}.`,
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

    const actionData: ProcessRescheduleRequestActionData = {
      activity_id: activityId,
      thread_id: (activity.email_thread_id as string) ?? null,
      opportunity_id: opportunityId,
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
      suggested_alternatives: suggestedAlternatives,
      subject: subjectText,
      reply_draft_text: replyDraft,
      original_reply_draft_text: replyDraft,
      connection_id: connectionId,
      draft_history_id: draftHistoryId,
      classification_confidence: classification.confidence,
      selected_alternative_index: 0,
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
    taskId: string
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
      { autoSendAfterMinutes }
    );

    return { actionTaken: level, actionId };
  },

  /**
   * Called from executeCreateTask fire-and-forget. Only dispatches when the
   * level is full_auto — at that setting, the user doesn't want to wait
   * for an explicit confirm or a grace period.
   */
  async onTaskCreatedMaybeFullAuto(
    companyId: string,
    userId: string,
    taskId: string
  ): Promise<void> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return;

    const settings = await loadClientCommsSettings(companyId);
    if (settings.appointment_confirmation.level !== "full_auto") return;

    // Guard: only stamp the confirmation marker when the task actually has
    // a scheduled date. Unscheduled tasks shouldn't be auto-confirmed —
    // confirming them would pollute the "confirmed" state with meaningless
    // markers. The onTaskCreatedMaybeFullAuto caller already checks
    // startDate before firing, but we double-check at the service boundary
    // so this method is safe to call from any path.
    const supabase = requireSupabase();
    const { data: task } = await supabase
      .from("project_tasks")
      .select("start_date")
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.start_date) return;

    // Mark the task as auto-confirmed so the reschedule behavior can fire
    // correctly if the user later shuffles it.
    await supabase
      .from("project_tasks")
      .update({
        schedule_confirmed_at: new Date().toISOString(),
        schedule_confirmed_by: null,
      })
      .eq("id", taskId)
      .eq("company_id", companyId);

    await this.onTaskScheduleConfirmed(companyId, userId, taskId);
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
    priorStartDate: string | null = null
  ): Promise<void> {
    const phaseCEnabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!phaseCEnabled) return;

    const supabase = requireSupabase();
    const { data: task } = await supabase
      .from("project_tasks")
      .select("id, schedule_confirmed_at")
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!task || !task.schedule_confirmed_at) return;

    const settings = await loadClientCommsSettings(companyId);
    const behavior = settings.appointment_confirmation.reschedule_behavior;

    switch (behavior) {
      case "do_nothing":
        return;
      case "notify":
        try {
          // Resolve the notification strings to the company's locale at
          // write time so the row inserted into `notifications` is fully
          // rendered text — the notification rail doesn't run i18n on
          // stored rows.
          const locale = await getCompanyLocale(companyId);
          const [nTitle, nBody, nAction] = await Promise.all([
            renderServerString(
              locale,
              "common",
              "notification.confirmedTaskRescheduled.title"
            ),
            renderServerString(
              locale,
              "common",
              "notification.confirmedTaskRescheduled.body"
            ),
            renderServerString(
              locale,
              "common",
              "notification.confirmedTaskRescheduled.action"
            ),
          ]);
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
        } catch (err) {
          console.error(
            "[client-scheduling-comms] reschedule notify failed:",
            err
          );
        }
        return;
      case "draft":
        await this.sendScheduleChangedEmail(
          companyId,
          userId,
          taskId,
          priorStartDate
        );
        return;
      case "auto_send":
        await this.sendScheduleChangedEmail(
          companyId,
          userId,
          taskId,
          priorStartDate,
          {
            autoSendAfterMinutes:
              settings.appointment_confirmation.send_delay_minutes,
          }
        );
        return;
    }
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

    const { data } = await supabase
      .from("project_tasks")
      .select("id")
      .eq("company_id", companyId)
      .is("schedule_confirmed_at", null)
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .lt("updated_at", cutoff.toISOString())
      .limit(500);

    return (data ?? []).map((row) => ({ taskId: row.id as string }));
  },
};
