import { describe, expect, it } from "vitest";

import {
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_FULL_SCOPE,
  GOOGLE_GMAIL_SCOPE,
  hasCalendarScope,
  parseOAuthScopeList,
} from "@/lib/email/calendar-scope";

describe("google calendar scope helper", () => {
  it("exports the exact scope URLs the trigger and OAuth flows agree on", () => {
    expect(GOOGLE_GMAIL_SCOPE).toBe("https://mail.google.com/");
    expect(GOOGLE_CALENDAR_EVENTS_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.events"
    );
    expect(GOOGLE_CALENDAR_FULL_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar"
    );
  });

  it("recognizes a calendar-capable grant through either calendar scope", () => {
    expect(
      hasCalendarScope([GOOGLE_GMAIL_SCOPE, GOOGLE_CALENDAR_EVENTS_SCOPE])
    ).toBe(true);
    expect(hasCalendarScope([GOOGLE_CALENDAR_FULL_SCOPE])).toBe(true);
  });

  it("treats mail-only, empty, and absent grants as calendar-incapable", () => {
    expect(hasCalendarScope([GOOGLE_GMAIL_SCOPE])).toBe(false);
    expect(hasCalendarScope([])).toBe(false);
    expect(hasCalendarScope(null)).toBe(false);
    expect(hasCalendarScope(undefined)).toBe(false);
  });

  it("parses the token response scope string into a deduped list", () => {
    expect(
      parseOAuthScopeList(
        `${GOOGLE_GMAIL_SCOPE}  ${GOOGLE_CALENDAR_EVENTS_SCOPE} ${GOOGLE_GMAIL_SCOPE}`
      )
    ).toEqual([GOOGLE_GMAIL_SCOPE, GOOGLE_CALENDAR_EVENTS_SCOPE]);
  });

  it("returns null when the provider omitted the scope field", () => {
    expect(parseOAuthScopeList(undefined)).toBeNull();
    expect(parseOAuthScopeList(null)).toBeNull();
    expect(parseOAuthScopeList("")).toBeNull();
    expect(parseOAuthScopeList("   ")).toBeNull();
  });
});
