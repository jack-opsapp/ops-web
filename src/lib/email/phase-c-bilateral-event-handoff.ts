import { createHash } from "node:crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { cleanMessageBody } from "@/lib/api/services/conversation-state/message-cleaner";
import {
  recordPhaseCLifecycleDecision,
  settlePhaseCLifecycleDecision,
} from "@/lib/email/phase-c-lifecycle-decision";

type EventKind = "site_visit" | "meeting" | "call" | "work";
type MessageDirection = "inbound" | "outbound";

export interface PhaseCEventMessage {
  eventId: string;
  providerMessageId: string;
  direction: MessageDirection;
  occurredAt: string;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails?: string[];
  subject?: string | null;
  body: string;
}

export interface PhaseCEventAttendee {
  email: string;
  role: "operator" | "customer";
}

interface ResolvedEventProposal {
  eventId: string;
  providerMessageId: string;
  direction: MessageDirection;
  eventKind: EventKind;
  startsAt: string | null;
  endsAt: string | null;
  eventTimezone: string;
  location: string | null;
  cleanedBody: string;
}

export type PhaseCBilateralEventEvaluation =
  | { status: "none" }
  | {
      status: "review" | "ready";
      reviewReason: string | null;
      proposalEventId: string;
      proposalMessageId: string;
      acceptanceEventId: string | null;
      acceptanceMessageId: string | null;
      requestedOwnerUserId: string | null;
      eventKind: EventKind;
      eventTitle: string | null;
      startsAt: string | null;
      endsAt: string | null;
      eventTimezone: string;
      location: string | null;
      attendees: PhaseCEventAttendee[];
    };

interface PhaseCHandoffSupabaseLike {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data?: unknown;
    error?: { message?: string | null } | null;
  }>;
}

const EVENT_INTENT_RE =
  /\b(?:site[ -]?visit|walk[ -]?through|consultation|measurement|measure(?:ment)?|meet(?:ing)?|appointment|call|phone call|zoom|teams|come by|come out|stop by|installation|crew|start the work|start the job)\b/i;
const SITE_VISIT_RE =
  /\b(?:site[ -]?visit|walk[ -]?through|consultation|measurement|measure(?:ment)?|come by|come out|stop by|at the (?:property|site))\b/i;
const CALL_RE = /\b(?:call|phone call|zoom|teams|video call)\b/i;
const WORK_RE =
  /\b(?:installation|crew|start(?:ing)? the (?:work|job|project))\b/i;
const ACCEPTANCE_RE =
  /\b(?:yes|confirmed|agreed|perfect|sounds good|that works|works for (?:me|us)|see you then|see you there|book it|let(?:'|’)s do it|we(?:'|’)ll be there|i(?:'|’)ll be there)\b/i;
const REJECTION_RE =
  /\b(?:not confirmed|doesn(?:'|’)t work|does not work|can(?:'|’)t make|cannot make|need to reschedule|cancel)\b/i;
const COUNTERPROPOSAL_RE =
  /\b(?:instead|how about|could we|can we|would (?:you|it)|rather|prefer|what about|does .{0,30} work)\b/i;
const AMBIGUOUS_TIME_RANGE_RE =
  /\b(?:between|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s+(?:and|to|[-–—])\s+\d{1,2}(?::\d{2})?/i;
const ADDRESS_RE =
  /(?<![:\d])\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .'-]{1,70}\s(?:avenue|ave|boulevard|blvd|circle|court|ct|crescent|drive|dr|highway|hwy|lane|ln|place|pl|road|rd|street|st|terrace|trail|way)\b(?:[^\n,;]{0,50})?/i;

const MONTHS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

const WEEKDAYS = new Map<string, number>([
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
  ["sunday", 7],
]);

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.includes("@") ? normalized : null;
}

function normalizedEmailSet(values: string[]): Set<string> {
  return new Set(
    values
      .map((value) => normalizeEmail(value))
      .filter((value): value is string => value !== null)
  );
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolvedTimeZone(body: string, fallback: string): string | null {
  const explicit = body.match(
    /\b(?:America\/[A-Za-z_]+|Canada\/[A-Za-z_]+|PST|PDT|MST|MDT|CST|CDT|EST|EDT)\b/i
  )?.[0];
  const abbreviation = explicit?.toUpperCase();
  const mapped =
    abbreviation === "PST" || abbreviation === "PDT"
      ? "America/Vancouver"
      : abbreviation === "MST" || abbreviation === "MDT"
        ? "America/Edmonton"
        : abbreviation === "CST" || abbreviation === "CDT"
          ? "America/Winnipeg"
          : abbreviation === "EST" || abbreviation === "EDT"
            ? "America/Toronto"
            : explicit;
  const timeZone = mapped ?? fallback;
  return validTimeZone(timeZone) ? timeZone : null;
}

function dateParts(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function calendarDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const { year, month, day } = dateParts(dateKey);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return calendarDateKey(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate()
  );
}

function extractDateKey(
  body: string,
  occurredAt: string,
  timeZone: string
): string | null {
  const anchor = formatInTimeZone(occurredAt, timeZone, "yyyy-MM-dd");
  const anchorParts = dateParts(anchor);

  const iso = body.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso)
    return calendarDateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  if (/\btomorrow\b/i.test(body)) return addCalendarDays(anchor, 1);
  if (/\btoday\b/i.test(body)) return anchor;

  const monthDay = body.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i
  );
  if (monthDay) {
    const month = MONTHS.get(monthDay[1].toLowerCase());
    if (!month) return null;
    let year = monthDay[3] ? Number(monthDay[3]) : anchorParts.year;
    let key = calendarDateKey(year, month, Number(monthDay[2]));
    if (!monthDay[3] && key < anchor) {
      year += 1;
      key = calendarDateKey(year, month, Number(monthDay[2]));
    }
    return key;
  }

  const weekdayMatch = body.match(
    /\b(?:this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  if (weekdayMatch) {
    const target = WEEKDAYS.get(weekdayMatch[1].toLowerCase());
    const anchorWeekday = Number(formatInTimeZone(occurredAt, timeZone, "i"));
    if (!target || !anchorWeekday) return null;
    let delta = (target - anchorWeekday + 7) % 7;
    if (delta === 0 || /^next\s+/i.test(weekdayMatch[0])) delta += 7;
    return addCalendarDays(anchor, delta);
  }

  return null;
}

function extractTimeParts(
  body: string
): { hour: number; minute: number } | null {
  if (AMBIGUOUS_TIME_RANGE_RE.test(body)) return null;
  const normalized = body.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm");
  if (/\bnoon\b/i.test(normalized)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/i.test(normalized)) return { hour: 0, minute: 0 };

  const meridiem = normalized.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    if (hour < 1 || hour > 12) return null;
    if (meridiem[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (meridiem[3].toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute: Number(meridiem[2] ?? 0) };
  }

  const twentyFourHour = normalized.match(
    /\b(?:at|for)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i
  );
  if (twentyFourHour) {
    return {
      hour: Number(twentyFourHour[1]),
      minute: Number(twentyFourHour[2]),
    };
  }
  return null;
}

function wallTimeToInstant(input: {
  dateKey: string;
  hour: number;
  minute: number;
  timeZone: string;
}): string | null {
  const local = `${input.dateKey}T${String(input.hour).padStart(2, "0")}:${String(input.minute).padStart(2, "0")}:00`;
  const instant = fromZonedTime(local, input.timeZone);
  if (!Number.isFinite(instant.getTime())) return null;
  const roundTrip = formatInTimeZone(
    instant,
    input.timeZone,
    "yyyy-MM-dd'T'HH:mm:ss"
  );
  if (roundTrip !== local) return null;
  // A fall-back fold maps two instants to the same wall time. Booking either
  // without operator confirmation would be arbitrary, so hold it for review.
  const sameWallTimeOneHourEarlier =
    formatInTimeZone(
      new Date(instant.getTime() - 3_600_000),
      input.timeZone,
      "yyyy-MM-dd'T'HH:mm:ss"
    ) === local;
  const sameWallTimeOneHourLater =
    formatInTimeZone(
      new Date(instant.getTime() + 3_600_000),
      input.timeZone,
      "yyyy-MM-dd'T'HH:mm:ss"
    ) === local;
  return sameWallTimeOneHourEarlier || sameWallTimeOneHourLater
    ? null
    : instant.toISOString();
}

function eventKind(body: string, inherited?: EventKind): EventKind {
  if (SITE_VISIT_RE.test(body)) return "site_visit";
  if (CALL_RE.test(body)) return "call";
  if (WORK_RE.test(body)) return "work";
  if (/\b(?:meet|meeting|appointment)\b/i.test(body)) return "meeting";
  return inherited ?? "meeting";
}

function eventLocation(
  body: string,
  kind: EventKind,
  leadAddress?: string | null
) {
  const explicitAddress =
    body
      .match(ADDRESS_RE)?.[0]
      ?.trim()
      .replace(/[?.!,]+$/, "") ?? null;
  if (explicitAddress) return explicitAddress;
  const named = body.match(
    /\bat\s+(the\s+(?:property|site)|your\s+(?:office|shop)|our\s+(?:office|shop))\b/i
  )?.[1];
  if (named) return named.replace(/\s+/g, " ").trim();
  return kind === "site_visit" ? leadAddress?.trim() || null : null;
}

function eventDurationMinutes(kind: EventKind): number {
  return kind === "call" ? 30 : 60;
}

function titleForEvent(kind: EventKind, leadTitle: string): string {
  const label =
    kind === "site_visit"
      ? "Site visit"
      : kind === "call"
        ? "Call"
        : kind === "work"
          ? "Work"
          : "Meeting";
  return `${label} — ${leadTitle.trim()}`;
}

function parseProposal(input: {
  message: PhaseCEventMessage;
  cleanedBody: string;
  timeZone: string;
  inheritedKind?: EventKind;
  leadAddress?: string | null;
}): ResolvedEventProposal {
  const kind = eventKind(input.cleanedBody, input.inheritedKind);
  const dateKey = extractDateKey(
    input.cleanedBody,
    input.message.occurredAt,
    input.timeZone
  );
  const time = extractTimeParts(input.cleanedBody);
  const startsAt =
    dateKey && time
      ? wallTimeToInstant({
          dateKey,
          hour: time.hour,
          minute: time.minute,
          timeZone: input.timeZone,
        })
      : null;
  const endsAt = startsAt
    ? new Date(
        Date.parse(startsAt) + eventDurationMinutes(kind) * 60_000
      ).toISOString()
    : null;
  return {
    eventId: input.message.eventId,
    providerMessageId: input.message.providerMessageId,
    direction: input.message.direction,
    eventKind: kind,
    startsAt,
    endsAt,
    eventTimezone: input.timeZone,
    location: eventLocation(input.cleanedBody, kind, input.leadAddress),
    cleanedBody: input.cleanedBody,
  };
}

function isAuthorizedAuthor(input: {
  message: PhaseCEventMessage;
  operatorEmails: Set<string>;
  customerEmails: Set<string>;
}): boolean {
  const sender = normalizeEmail(input.message.fromEmail);
  if (!sender) return false;
  return input.message.direction === "outbound"
    ? input.operatorEmails.has(sender)
    : input.customerEmails.has(sender);
}

function attendees(input: {
  operatorEmails: Set<string>;
  customerEmails: Set<string>;
}): PhaseCEventAttendee[] {
  return [
    ...[...input.operatorEmails].map((email) => ({
      email,
      role: "operator" as const,
    })),
    ...[...input.customerEmails].map((email) => ({
      email,
      role: "customer" as const,
    })),
  ].sort((left, right) =>
    left.role === right.role
      ? left.email.localeCompare(right.email)
      : left.role.localeCompare(right.role)
  );
}

/**
 * Interpret a complete opportunity-scoped message history. This function only
 * produces a durable OPS handoff; it never creates a site visit, calendar row,
 * or provider event. P1-17 owns conflict, permission, canonical creation, and
 * connected-provider synchronization.
 */
export function evaluatePhaseCBilateralEvent(input: {
  messages: PhaseCEventMessage[];
  defaultTimeZone: string;
  requestedOwnerUserId: string | null;
  leadTitle: string;
  leadAddress?: string | null;
  operatorEmails: string[];
  customerEmails: string[];
}): PhaseCBilateralEventEvaluation {
  if (!validTimeZone(input.defaultTimeZone)) return { status: "none" };
  const operatorEmails = normalizedEmailSet(input.operatorEmails);
  const customerEmails = normalizedEmailSet(input.customerEmails);
  const sorted = [...input.messages].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.eventId.localeCompare(right.eventId)
  );
  const priorBodies: string[] = [];
  let proposal: ResolvedEventProposal | null = null;
  let acceptance: PhaseCEventMessage | null = null;
  let authorityUnresolved = false;

  for (const message of sorted) {
    if (!Number.isFinite(Date.parse(message.occurredAt))) continue;
    const cleanedBody = cleanMessageBody(message.body, {
      subject: message.subject ?? "",
      priorBodies,
      providerCleanBody: null,
    }).trim();
    if (!cleanedBody) continue;
    priorBodies.push(cleanedBody);

    const authorized = isAuthorizedAuthor({
      message,
      operatorEmails,
      customerEmails,
    });
    const containsIntent = EVENT_INTENT_RE.test(cleanedBody);
    const timeZone = resolvedTimeZone(cleanedBody, input.defaultTimeZone);
    if (!timeZone) continue;
    const parsed = parseProposal({
      message,
      cleanedBody,
      timeZone,
      inheritedKind: proposal?.eventKind,
      leadAddress: input.leadAddress,
    });
    const hasTemporalProposal = Boolean(parsed.startsAt && parsed.endsAt);
    const hasAcceptance =
      ACCEPTANCE_RE.test(cleanedBody) &&
      !REJECTION_RE.test(cleanedBody) &&
      !/\?/.test(cleanedBody);

    if (
      !authorized &&
      (containsIntent || hasTemporalProposal || hasAcceptance)
    ) {
      authorityUnresolved = true;
      if (!proposal && containsIntent) proposal = parsed;
      continue;
    }

    if (!proposal) {
      if (containsIntent) {
        proposal = parsed;
        acceptance = null;
      }
      continue;
    }

    if (hasTemporalProposal) {
      const sameResolvedTime = parsed.startsAt === proposal.startsAt;
      const oppositeParty = parsed.direction !== proposal.direction;
      if (oppositeParty && sameResolvedTime && hasAcceptance) {
        acceptance = message;
        continue;
      }
      if (
        parsed.startsAt !== proposal.startsAt ||
        COUNTERPROPOSAL_RE.test(cleanedBody)
      ) {
        proposal = parsed;
        acceptance = null;
        continue;
      }
    }

    if (
      message.direction !== proposal.direction &&
      hasAcceptance &&
      proposal.startsAt &&
      proposal.endsAt
    ) {
      acceptance = message;
    }
  }

  if (!proposal) return { status: "none" };
  const resolvedAttendees = attendees({ operatorEmails, customerEmails });
  const hasBothAttendeeRoles =
    resolvedAttendees.some((attendee) => attendee.role === "operator") &&
    resolvedAttendees.some((attendee) => attendee.role === "customer");
  const ready = Boolean(
    acceptance &&
    acceptance.eventId !== proposal.eventId &&
    proposal.startsAt &&
    proposal.endsAt &&
    input.requestedOwnerUserId &&
    hasBothAttendeeRoles &&
    !authorityUnresolved
  );
  const reviewReason = ready
    ? null
    : authorityUnresolved
      ? "event_participant_authority_unresolved"
      : !proposal.startsAt || !proposal.endsAt
        ? "event_date_or_time_unresolved"
        : !acceptance
          ? "bilateral_confirmation_missing"
          : !input.requestedOwnerUserId
            ? "event_owner_unresolved"
            : !hasBothAttendeeRoles
              ? "event_attendees_unresolved"
              : "event_confirmation_ambiguous";

  return {
    status: ready ? "ready" : "review",
    reviewReason,
    proposalEventId: proposal.eventId,
    proposalMessageId: proposal.providerMessageId,
    acceptanceEventId: ready ? acceptance!.eventId : null,
    acceptanceMessageId: ready ? acceptance!.providerMessageId : null,
    requestedOwnerUserId: input.requestedOwnerUserId,
    eventKind: proposal.eventKind,
    eventTitle: proposal.startsAt
      ? titleForEvent(proposal.eventKind, input.leadTitle)
      : null,
    startsAt: proposal.startsAt,
    endsAt: proposal.endsAt,
    eventTimezone: proposal.eventTimezone,
    location: proposal.location,
    attendees: resolvedAttendees,
  };
}

function handoffIdempotencyKey(input: {
  companyId: string;
  opportunityId: string;
  evaluation: Exclude<PhaseCBilateralEventEvaluation, { status: "none" }>;
}): string {
  const value = [
    "phase-c-event-v1",
    input.companyId,
    input.opportunityId,
    input.evaluation.proposalEventId,
    input.evaluation.acceptanceEventId ?? "review",
    input.evaluation.eventKind,
    input.evaluation.startsAt ?? "unresolved",
    input.evaluation.reviewReason ?? "ready",
  ].join("\u0000");
  return createHash("sha256").update(value).digest("hex");
}

export async function persistPhaseCBilateralEventHandoff(input: {
  supabase: PhaseCHandoffSupabaseLike;
  companyId: string;
  opportunityId: string;
  evaluation: Exclude<PhaseCBilateralEventEvaluation, { status: "none" }>;
}): Promise<{ id: string; idempotencyKey: string; status: string }> {
  const evaluation = input.evaluation;
  const evidenceEventIds = [
    evaluation.proposalEventId,
    ...(evaluation.acceptanceEventId ? [evaluation.acceptanceEventId] : []),
  ];
  const evidenceMessageIds = [
    evaluation.proposalMessageId,
    ...(evaluation.acceptanceMessageId ? [evaluation.acceptanceMessageId] : []),
  ];
  const sourceEventId =
    evaluation.acceptanceEventId ?? evaluation.proposalEventId;
  const decision = await recordPhaseCLifecycleDecision({
    supabase: input.supabase,
    companyId: input.companyId,
    opportunityId: input.opportunityId,
    sourceEventId,
    decisionKind: "event_handoff",
    decisionKey:
      evaluation.status === "ready"
        ? "bilateral_event"
        : "bilateral_event_review",
    proposedOutcome: evaluation.status,
    confidence: evaluation.status === "ready" ? 1 : 0.5,
    evidenceEventIds,
    evidenceMessageIds,
    reason:
      evaluation.status === "ready"
        ? "bilateral_confirmation_resolved"
        : evaluation.reviewReason!,
    status: evaluation.status === "ready" ? "proposed" : "review",
    reviewReason:
      evaluation.status === "review" ? evaluation.reviewReason : null,
  });

  const idempotencyKey = handoffIdempotencyKey(input);
  const response = await input.supabase.rpc(
    "record_phase_c_bilateral_event_handoff",
    {
      p_idempotency_key: idempotencyKey,
      p_company_id: input.companyId,
      p_opportunity_id: input.opportunityId,
      p_decision_id: decision.id,
      p_proposal_event_id: evaluation.proposalEventId,
      p_acceptance_event_id: evaluation.acceptanceEventId,
      p_requested_owner_user_id: evaluation.requestedOwnerUserId,
      p_event_kind: evaluation.eventKind,
      p_event_title: evaluation.eventTitle,
      p_starts_at: evaluation.startsAt,
      p_ends_at: evaluation.endsAt,
      p_event_timezone: evaluation.eventTimezone,
      p_location: evaluation.location,
      p_attendees: evaluation.attendees,
      p_status: evaluation.status,
      p_review_reason: evaluation.reviewReason,
    }
  );
  if (response.error) {
    throw new Error(
      `Phase C bilateral event handoff persistence failed: ${response.error.message ?? "unknown error"}`
    );
  }
  const handoff = (
    Array.isArray(response.data) ? response.data[0] : response.data
  ) as
    | { id?: unknown; idempotency_key?: unknown; status?: unknown }
    | null
    | undefined;
  if (
    !handoff ||
    typeof handoff.id !== "string" ||
    handoff.idempotency_key !== idempotencyKey ||
    handoff.status !== evaluation.status
  ) {
    throw new Error("Phase C bilateral event handoff returned no result");
  }

  if (evaluation.status === "ready") {
    await settlePhaseCLifecycleDecision({
      supabase: input.supabase,
      companyId: input.companyId,
      opportunityId: input.opportunityId,
      decisionId: decision.id,
      status: "applied",
    });
  }

  return {
    id: handoff.id,
    idempotencyKey,
    status: evaluation.status,
  };
}
