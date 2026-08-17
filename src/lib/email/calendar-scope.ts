/**
 * Google OAuth scope vocabulary shared by the Gmail OAuth pair, the
 * connection descriptor, and the calendar sync drain.
 *
 * The `enqueue_google_calendar_sync` trigger (migration
 * 20260810194251_site_visit_booking) treats a connection as
 * calendar-capable when `granted_scopes` overlaps
 * {calendar.events, calendar}. This module is the TypeScript half of that
 * agreement — change either side only in lockstep.
 */

export const GOOGLE_GMAIL_SCOPE = "https://mail.google.com/";
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_FULL_SCOPE =
  "https://www.googleapis.com/auth/calendar";

/** True when a stored grant can write calendar events. */
export function hasCalendarScope(
  grantedScopes: readonly string[] | null | undefined
): boolean {
  if (!grantedScopes) return false;
  return grantedScopes.some(
    (scope) =>
      scope === GOOGLE_CALENDAR_EVENTS_SCOPE ||
      scope === GOOGLE_CALENDAR_FULL_SCOPE
  );
}

/**
 * Parse the space-delimited `scope` field of an OAuth token response into a
 * deduped list. Null when the provider omitted the field — callers must then
 * leave the stored grant record untouched rather than erasing it.
 */
export function parseOAuthScopeList(
  scope: string | null | undefined
): string[] | null {
  if (typeof scope !== "string") return null;
  const scopes = [
    ...new Set(scope.split(/\s+/).filter((entry) => entry.length > 0)),
  ];
  return scopes.length > 0 ? scopes : null;
}
