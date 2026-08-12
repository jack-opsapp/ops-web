/**
 * Pure pieces of the Google Calendar sync drain: event construction from a
 * booked visit + its lead, retry backoff, and revoked-grant classification.
 */

import { describe, expect, it } from "vitest";

import {
  GOOGLE_CALENDAR_SYNC_MAX_ATTEMPTS,
  buildSiteVisitCalendarEvent,
  isGrantRevokedStatus,
  retryDelayMinutes,
} from "@/lib/site-visits/google-calendar";
import { GmailTokenRefreshError } from "@/lib/api/services/gmail-token";

const VISIT = {
  id: "visit-1",
  scheduledAt: "2026-08-13T21:00:00.000Z",
  durationMinutes: 90,
};

const LEAD = {
  id: "opp-1",
  title: "Faye Keys",
  address: "630 Agnes St",
};

describe("buildSiteVisitCalendarEvent", () => {
  it("builds the full event from the visit window and lead identity", () => {
    const event = buildSiteVisitCalendarEvent(
      VISIT,
      LEAD,
      "https://app.test"
    );

    expect(event).toEqual({
      summary: "Site visit — Faye Keys",
      location: "630 Agnes St",
      description: "Open in OPS: https://app.test/pipeline?opportunityId=opp-1",
      start: { dateTime: "2026-08-13T21:00:00.000Z" },
      end: { dateTime: "2026-08-13T22:30:00.000Z" },
    });
  });

  it("defaults a missing duration to the 60-minute booking default", () => {
    const event = buildSiteVisitCalendarEvent(
      { ...VISIT, durationMinutes: null },
      LEAD,
      "https://app.test"
    );
    expect(event.end).toEqual({ dateTime: "2026-08-13T22:00:00.000Z" });
  });

  it("omits location when the lead has no address", () => {
    const event = buildSiteVisitCalendarEvent(
      VISIT,
      { ...LEAD, address: null },
      "https://app.test"
    );
    expect(event).not.toHaveProperty("location");
  });

  it("trims whitespace-only addresses to absent", () => {
    const event = buildSiteVisitCalendarEvent(
      VISIT,
      { ...LEAD, address: "   " },
      "https://app.test"
    );
    expect(event).not.toHaveProperty("location");
  });
});

describe("retryDelayMinutes", () => {
  it("doubles from five minutes per prior attempt", () => {
    expect(retryDelayMinutes(1)).toBe(5);
    expect(retryDelayMinutes(2)).toBe(10);
    expect(retryDelayMinutes(3)).toBe(20);
    expect(retryDelayMinutes(4)).toBe(40);
  });

  it("caps the drain at five attempts", () => {
    expect(GOOGLE_CALENDAR_SYNC_MAX_ATTEMPTS).toBe(5);
  });
});

describe("grant revocation classification", () => {
  it("recognizes an invalid_grant refresh failure as revoked", () => {
    const error = new GmailTokenRefreshError(
      400,
      JSON.stringify({ error: "invalid_grant" })
    );
    expect(error.oauthErrorCode).toBe("invalid_grant");
    expect(error.isGrantRevoked).toBe(true);
  });

  it("treats other refresh failures as transient", () => {
    const serverError = new GmailTokenRefreshError(500, "upstream boom");
    expect(serverError.isGrantRevoked).toBe(false);
    const configError = new GmailTokenRefreshError(
      401,
      JSON.stringify({ error: "invalid_client" })
    );
    expect(configError.isGrantRevoked).toBe(false);
  });

  it("keeps the historical refresh-failure message shape", () => {
    const error = new GmailTokenRefreshError(400, "raw body");
    expect(error.message).toBe("Gmail token refresh failed (400): raw body");
  });

  it("classifies provider statuses that mean the grant died", () => {
    expect(isGrantRevokedStatus(401)).toBe(true);
    expect(isGrantRevokedStatus(403)).toBe(false);
    expect(isGrantRevokedStatus(500)).toBe(false);
  });
});
