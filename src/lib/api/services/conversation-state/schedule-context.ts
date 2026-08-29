// src/lib/api/services/conversation-state/schedule-context.ts
//
// The SERVER-VERIFIED SCHEDULE block. A scheduling question ("when can you fit
// us in?") used to be held for a human forever, because the drafter had no
// trustworthy calendar facts and the system prompt bans invented dates. This
// module renders the facts a loader already read from the database into one
// deterministic English block the drafter may state verbatim.
//
// PURE: no DB, no network, no model. Everything here is rendering. The loader
// that reads the facts lives in `draft-schedule-context-service.ts`; the block
// this produces is injected into the TRUSTED zone of the draft user prompt
// (never inside the untrusted-email envelope) — these are server facts, not
// customer-supplied text.
//
// The RULES sentence is load-bearing: existing bookings may be stated exactly,
// but a NEW time may only ever be offered as a tentative option. Nothing this
// module renders may be presented to a customer as a confirmed new booking.

export interface ScheduleTaskFact {
  /** `project_tasks.custom_title`, or "Scheduled work" when unnamed. */
  title: string;
  /** ISO date (`YYYY-MM-DD`) or full ISO timestamp. */
  startDate: string;
  endDate: string | null;
  /** Clock time as stored (`"09:00"` / `"09:00:00"`); null when unset. */
  startTime: string | null;
  allDay: boolean;
  /** `project_tasks.schedule_confirmed_at != null`. */
  confirmed: boolean;
}

export interface ScheduleVisitFact {
  /** `site_visits.appointment_title`, or "Site visit" when unnamed. */
  title: string;
  /** Full ISO timestamp. */
  scheduledAt: string;
  durationMinutes: number | null;
  status: "scheduled" | "in_progress";
}

export interface CompanyBusyDay {
  /** `YYYY-MM-DD` already resolved in the company timezone. */
  date: string;
  bookedCount: number;
}

export interface ScheduleContextFacts {
  timezone: string;
  /** ISO timestamp of the read that produced these facts. */
  generatedAt: string;
  /** Bookings linked to THIS lead's project(s). */
  customerTasks: ScheduleTaskFact[];
  customerVisits: ScheduleVisitFact[];
  /** Next 14 days, only days carrying at least one booking. */
  companyBusyDays: CompanyBusyDay[];
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const CLOCK_RE = /^(\d{1,2}):(\d{2})/;

/**
 * ICU emits U+202F (narrow no-break space) before AM/PM on newer Node builds
 * and U+00A0 in some locales. The block must be byte-stable, so collapse both
 * to a plain space.
 */
function normalizeSpaces(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, " ");
}

/**
 * Render a calendar day as `Wed, Sep 3`.
 *
 * A DATE-ONLY value (`project_tasks.start_date`, a busy-day key) carries no
 * instant — reading it through a timezone would shift it a day. Those are
 * formatted from their own Y/M/D in UTC; only true timestamps are converted
 * into the company timezone.
 */
export function formatScheduleDate(value: string, timezone: string): string {
  const dateOnly = DATE_ONLY_RE.exec(value);
  const isBareDate = dateOnly !== null && !value.includes("T");
  const instant = isBareDate
    ? new Date(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3])
        )
      )
    : new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  try {
    return normalizeSpaces(
      new Intl.DateTimeFormat("en-US", {
        timeZone: isBareDate ? "UTC" : timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(instant)
    );
  } catch {
    return value;
  }
}

/** Render the time-of-day of a true timestamp as `2:00 PM`. */
export function formatScheduleTime(value: string, timezone: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  try {
    return normalizeSpaces(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(instant)
    );
  } catch {
    return value;
  }
}

/**
 * Render a stored clock string (`"09:00"` / `"09:00:00"`) as `9:00 AM`.
 * A wall-clock time has no instant, so it is never timezone-converted.
 */
export function formatScheduleClock(value: string): string | null {
  const parts = CLOCK_RE.exec(value.trim());
  if (!parts) return null;
  const hour24 = Number(parts[1]);
  const minute = Number(parts[2]);
  if (
    !Number.isInteger(hour24) ||
    !Number.isInteger(minute) ||
    hour24 < 0 ||
    hour24 > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const meridiem = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function taskLine(task: ScheduleTaskFact, timezone: string): string {
  const start = formatScheduleDate(task.startDate, timezone);
  const clock =
    !task.allDay && task.startTime ? formatScheduleClock(task.startTime) : null;
  const sameDay =
    task.endDate !== null &&
    task.endDate.slice(0, 10) === task.startDate.slice(0, 10);
  const through =
    task.endDate && !sameDay
      ? ` through ${formatScheduleDate(task.endDate, timezone)}`
      : "";
  const state = task.confirmed ? "confirmed" : "tentative";
  return `- ${task.title} — ${start}${clock ? ` at ${clock}` : ""}${through} — ${state}`;
}

function visitLine(visit: ScheduleVisitFact, timezone: string): string {
  const date = formatScheduleDate(visit.scheduledAt, timezone);
  const time = formatScheduleTime(visit.scheduledAt, timezone);
  const duration =
    typeof visit.durationMinutes === "number" && visit.durationMinutes > 0
      ? ` (${visit.durationMinutes} min)`
      : "";
  const status = visit.status === "in_progress" ? "in progress" : "scheduled";
  return `- ${visit.title} — ${date} at ${time}${duration} — ${status}`;
}

function busyDayLine(day: CompanyBusyDay, timezone: string): string {
  const label = formatScheduleDate(day.date, timezone);
  const noun = day.bookedCount === 1 ? "booking" : "bookings";
  return `- ${label}: ${day.bookedCount} ${noun}`;
}

export const SCHEDULE_CONTEXT_RULES =
  'RULES: State the customer\'s existing bookings exactly as written above. You may suggest windows that avoid the booked days, but ONLY as tentative options that still need confirmation ("we could likely look at…", "I\'ll confirm and get back to you"). NEVER present a new date or time as confirmed. Days absent from the booked list are not guaranteed free.';

/**
 * Render the trusted schedule block. Deterministic: same facts in, same string
 * out. An EMPTY calendar is itself a verified fact and is stated explicitly —
 * "nothing booked" is information the drafter is allowed to rely on.
 */
export function buildScheduleContextBlock(facts: ScheduleContextFacts): string {
  const timezone = facts.timezone;
  const lines: string[] = [];

  lines.push(
    `SERVER-VERIFIED SCHEDULE (generated ${formatScheduleDate(
      facts.generatedAt,
      timezone
    )} · timezone ${timezone}):`
  );

  lines.push("THIS CUSTOMER'S BOOKINGS:");
  if (facts.customerTasks.length === 0 && facts.customerVisits.length === 0) {
    lines.push("- none on the calendar");
  } else {
    for (const task of facts.customerTasks) lines.push(taskLine(task, timezone));
    for (const visit of facts.customerVisits) {
      lines.push(visitLine(visit, timezone));
    }
  }

  lines.push("COMPANY CALENDAR — DAYS WITH EXISTING BOOKINGS (next 14 days):");
  if (facts.companyBusyDays.length === 0) {
    lines.push("- no bookings in the next 14 days");
  } else {
    for (const day of facts.companyBusyDays) {
      lines.push(busyDayLine(day, timezone));
    }
  }

  lines.push(SCHEDULE_CONTEXT_RULES);

  return lines.join("\n");
}
