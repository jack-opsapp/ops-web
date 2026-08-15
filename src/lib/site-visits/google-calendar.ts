import "server-only";

/**
 * Google Calendar transport for the site-visit sync drain.
 *
 * Booked visits flow one-way outward: OPS is the source of truth, events
 * land on the company mailbox's `primary` calendar, and reschedules/cancels
 * propagate as patches/deletes. The queue (`google_calendar_sync_queue`,
 * fed by the `enqueue_google_calendar_sync` trigger) carries the intent;
 * this module carries the event shape and the HTTP calls.
 *
 * Every call is a single deadline-bounded request with no automatic retry —
 * the queue's attempt counter owns retrying.
 */

import { fetchGmailOnceWithinDeadline } from "@/lib/api/services/providers/gmail-read";

const GOOGLE_CALENDAR_API_BASE =
  "https://www.googleapis.com/calendar/v3/calendars";

/** Fifth failed attempt settles the row as permanently failed. */
export const GOOGLE_CALENDAR_SYNC_MAX_ATTEMPTS = 5;

/** Booking sheet default when a visit row predates duration capture. */
const DEFAULT_DURATION_MINUTES = 60;

export interface CalendarEventVisit {
  id: string;
  scheduledAt: string;
  durationMinutes: number | null;
}

export interface CalendarEventLead {
  id: string;
  title: string;
  address: string | null;
}

export interface GoogleCalendarEventPayload {
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

/**
 * Build the outward event: the lead names the appointment, its address is
 * the destination, and the description deep-links back to the lead in OPS.
 */
export function buildSiteVisitCalendarEvent(
  visit: CalendarEventVisit,
  lead: CalendarEventLead,
  appUrl: string
): GoogleCalendarEventPayload {
  const startMs = Date.parse(visit.scheduledAt);
  const durationMinutes = visit.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const endMs = startMs + durationMinutes * 60_000;
  const address = lead.address?.trim() ?? "";

  const event: GoogleCalendarEventPayload = {
    summary: `Site visit — ${lead.title}`,
    description: `Open in OPS: ${appUrl}/pipeline?opportunityId=${lead.id}`,
    start: { dateTime: new Date(startMs).toISOString() },
    end: { dateTime: new Date(endMs).toISOString() },
  };
  if (address) event.location = address;
  return event;
}

/**
 * Exponential backoff for the drain: 5 → 10 → 20 → 40 minutes after each
 * failed attempt (`attempts` is the count AFTER the failure being recorded).
 */
export function retryDelayMinutes(attempts: number): number {
  return 5 * 2 ** (Math.max(1, attempts) - 1);
}

/**
 * Provider statuses that mean the credential itself is dead, not the
 * request. 403 is quota/permission noise and stays retryable.
 */
export function isGrantRevokedStatus(status: number): boolean {
  return status === 401;
}

export interface GoogleCalendarRequestOptions {
  accessToken: string;
  calendarId: string;
  deadlineAt?: number;
}

function calendarUrl(calendarId: string, eventId?: string): string {
  const base = `${GOOGLE_CALENDAR_API_BASE}/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

export async function insertCalendarEvent(
  options: GoogleCalendarRequestOptions,
  event: GoogleCalendarEventPayload
): Promise<Response> {
  return fetchGmailOnceWithinDeadline(
    calendarUrl(options.calendarId),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
    {
      deadlineAt: options.deadlineAt,
      context: "Google Calendar event insert",
    }
  );
}

export async function patchCalendarEvent(
  options: GoogleCalendarRequestOptions,
  eventId: string,
  event: GoogleCalendarEventPayload
): Promise<Response> {
  return fetchGmailOnceWithinDeadline(
    calendarUrl(options.calendarId, eventId),
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
    {
      deadlineAt: options.deadlineAt,
      context: "Google Calendar event patch",
    }
  );
}

export async function deleteCalendarEvent(
  options: GoogleCalendarRequestOptions,
  eventId: string
): Promise<Response> {
  return fetchGmailOnceWithinDeadline(
    calendarUrl(options.calendarId, eventId),
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${options.accessToken}` },
    },
    {
      deadlineAt: options.deadlineAt,
      context: "Google Calendar event delete",
    }
  );
}
