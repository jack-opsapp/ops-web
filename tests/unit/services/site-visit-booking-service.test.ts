/**
 * SiteVisitService booking layer — RPC wrappers + guarded booked-visit reads.
 *
 * The three RPCs (book_site_visit / reschedule_site_visit /
 * cancel_site_visit_booking) are the ONLY write path for bookings. The
 * service must:
 *   - pass the exact RPC argument shapes (omitting absent optionals so
 *     server-side defaults/keep-semantics apply),
 *   - map SQLSTATE codes to presentable SiteVisitBookingError codes
 *     (42501 permission / 55000 conflict / 22023+22004 validation /
 *      P0002 not_found),
 *   - filter every booked-visit read on booked_at IS NOT NULL AND
 *     deleted_at IS NULL (never status alone — legacy rows carry junk
 *     scheduled_at values).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
  parseDateRequired: (v: unknown) => new Date(v as string),
}));

import {
  SiteVisitService,
  SiteVisitBookingError,
} from "@/lib/api/services/site-visit-service";

// ─── RPC mock ───────────────────────────────────────────────────────────────

const rpcMock = vi.fn();

interface QueryCall {
  method: string;
  args: unknown[];
}

/**
 * Chainable query-builder recorder. Every method returns the builder; the
 * builder is thenable and resolves with the configured payload, so it can be
 * awaited exactly like the real PostgrestFilterBuilder.
 */
function fakeQueryBuilder(payload: { data: unknown; error: unknown }) {
  const calls: QueryCall[] = [];
  const builder: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const method of [
    "select",
    "eq",
    "not",
    "is",
    "in",
    "gte",
    "lte",
    "order",
    "limit",
  ]) {
    builder[method] = record(method);
  }
  builder.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown
  ) => Promise.resolve(payload).then(resolve);
  return { builder, calls };
}

function supabaseWithRpc() {
  return { rpc: rpcMock };
}

const VISIT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OPP_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const COMPANY_ID = "cccccccc-3333-4333-8333-333333333333";
const USER_A = "dddddddd-4444-4444-8444-444444444444";
const USER_B = "eeeeeeee-5555-4555-8555-555555555555";

const SCHEDULED_AT = new Date("2026-08-20T17:00:00.000Z");

function pgError(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSupabaseMock.mockReturnValue(supabaseWithRpc());
  rpcMock.mockResolvedValue({ data: VISIT_ID, error: null });
});

// ─── bookSiteVisit ──────────────────────────────────────────────────────────

describe("SiteVisitService.bookSiteVisit", () => {
  it("calls book_site_visit with the full arg set and returns the visit id", async () => {
    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
        durationMinutes: 90,
        assigneeIds: [USER_A, USER_B],
        reminderLeadMinutes: 45,
      })
    ).resolves.toBe(VISIT_ID);

    expect(rpcMock).toHaveBeenCalledWith("book_site_visit", {
      p_opportunity_id: OPP_ID,
      p_scheduled_at: SCHEDULED_AT.toISOString(),
      p_duration_minutes: 90,
      p_assignee_ids: [USER_A, USER_B],
      p_reminder_lead_minutes: 45,
    });
  });

  it("omits absent optionals so server defaults apply (duration 60, booker as assignee, user default lead)", async () => {
    await SiteVisitService.bookSiteVisit({
      opportunityId: OPP_ID,
      scheduledAt: SCHEDULED_AT,
    });

    expect(rpcMock).toHaveBeenCalledWith("book_site_visit", {
      p_opportunity_id: OPP_ID,
      p_scheduled_at: SCHEDULED_AT.toISOString(),
    });
  });

  it("maps 42501 to a permission error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("42501", "site_visit_edit_denied"),
    });

    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({
      name: "SiteVisitBookingError",
      code: "permission",
    });
  });

  it("maps 55000 (open booking exists / bad state) to a conflict error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("55000", "site_visit_already_booked"),
    });

    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("maps 22023 and 22004 to validation errors", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("22023", "site_visit_time_in_past"),
    });
    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({ code: "validation" });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("22004", "scheduled_at_required"),
    });
    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("maps P0002 to not_found and anything else to unknown", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("P0002", "opportunity_not_found"),
    });
    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({ code: "not_found" });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("XX000", "boom"),
    });
    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({ code: "unknown" });
  });

  it("keeps the raw server message so callers can log it", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("55000", "site_visit_already_booked"),
    });

    await expect(
      SiteVisitService.bookSiteVisit({
        opportunityId: OPP_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toThrow("site_visit_already_booked");
  });

  it("exposes the error class for instanceof checks", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("42501", "site_visit_edit_denied"),
    });

    const err = await SiteVisitService.bookSiteVisit({
      opportunityId: OPP_ID,
      scheduledAt: SCHEDULED_AT,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteVisitBookingError);
  });
});

// ─── rescheduleSiteVisit ────────────────────────────────────────────────────

describe("SiteVisitService.rescheduleSiteVisit", () => {
  it("always sends the (possibly unchanged) time and omits keep-fields", async () => {
    await expect(
      SiteVisitService.rescheduleSiteVisit({
        siteVisitId: VISIT_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).resolves.toBe(VISIT_ID);

    expect(rpcMock).toHaveBeenCalledWith("reschedule_site_visit", {
      p_site_visit_id: VISIT_ID,
      p_scheduled_at: SCHEDULED_AT.toISOString(),
    });
  });

  it("passes -1 through to clear the reminder override back to the user default", async () => {
    await SiteVisitService.rescheduleSiteVisit({
      siteVisitId: VISIT_ID,
      scheduledAt: SCHEDULED_AT,
      durationMinutes: 120,
      assigneeIds: [USER_B],
      reminderLeadMinutes: -1,
    });

    expect(rpcMock).toHaveBeenCalledWith("reschedule_site_visit", {
      p_site_visit_id: VISIT_ID,
      p_scheduled_at: SCHEDULED_AT.toISOString(),
      p_duration_minutes: 120,
      p_assignee_ids: [USER_B],
      p_reminder_lead_minutes: -1,
    });
  });

  it("maps 55000 (started / cancelled / not a booking) to conflict", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("55000", "site_visit_not_reschedulable"),
    });

    await expect(
      SiteVisitService.rescheduleSiteVisit({
        siteVisitId: VISIT_ID,
        scheduledAt: SCHEDULED_AT,
      })
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

// ─── cancelSiteVisitBooking ─────────────────────────────────────────────────

describe("SiteVisitService.cancelSiteVisitBooking", () => {
  it("calls cancel_site_visit_booking and returns the visit id (idempotent server-side)", async () => {
    await expect(
      SiteVisitService.cancelSiteVisitBooking(VISIT_ID)
    ).resolves.toBe(VISIT_ID);

    expect(rpcMock).toHaveBeenCalledWith("cancel_site_visit_booking", {
      p_site_visit_id: VISIT_ID,
    });
  });

  it("maps a completed-visit cancel to conflict", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: pgError("55000", "cannot_cancel_completed_site_visit"),
    });

    await expect(
      SiteVisitService.cancelSiteVisitBooking(VISIT_ID)
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

// ─── getBookedVisitsInRange ─────────────────────────────────────────────────

describe("SiteVisitService.getBookedVisitsInRange", () => {
  const RANGE_START = new Date("2026-08-01T00:00:00.000Z");
  const RANGE_END = new Date("2026-09-15T00:00:00.000Z");

  function bookedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: VISIT_ID,
      company_id: COMPANY_ID,
      opportunity_id: OPP_ID,
      project_id: null,
      client_id: null,
      scheduled_at: "2026-08-20T17:00:00.000Z",
      duration_minutes: 90,
      assignee_ids: [USER_A],
      status: "scheduled",
      completed_at: null,
      notes: null,
      internal_notes: null,
      measurements: null,
      photos: [],
      activity_id: null,
      calendar_event_id: null,
      created_by: USER_A,
      created_at: "2026-08-11T10:00:00.000Z",
      updated_at: "2026-08-11T10:00:00.000Z",
      deleted_at: null,
      booked_at: "2026-08-11T10:00:00.000Z",
      reminder_lead_minutes: 45,
      ...overrides,
    };
  }

  it("applies the booked-visit guard: booked_at NOT NULL, deleted_at NULL, active statuses, company + range", async () => {
    const { builder, calls } = fakeQueryBuilder({
      data: [bookedRow()],
      error: null,
    });
    requireSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue(builder),
      rpc: rpcMock,
    });

    const visits = await SiteVisitService.getBookedVisitsInRange(
      COMPANY_ID,
      RANGE_START,
      RANGE_END
    );

    expect(calls).toContainEqual({
      method: "not",
      args: ["booked_at", "is", null],
    });
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(calls).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_ID],
    });
    expect(calls).toContainEqual({
      method: "in",
      args: [["status", ["scheduled", "in_progress"]]].flat(),
    });
    expect(calls).toContainEqual({
      method: "gte",
      args: ["scheduled_at", RANGE_START.toISOString()],
    });
    expect(calls).toContainEqual({
      method: "lte",
      args: ["scheduled_at", RANGE_END.toISOString()],
    });

    expect(visits).toHaveLength(1);
    expect(visits[0].id).toBe(VISIT_ID);
    expect(visits[0].bookedAt).toEqual(new Date("2026-08-11T10:00:00.000Z"));
    expect(visits[0].reminderLeadMinutes).toBe(45);
  });

  it("maps rows without booking fields to null (legacy shape safety)", async () => {
    const { builder } = fakeQueryBuilder({
      data: [bookedRow({ booked_at: null, reminder_lead_minutes: null })],
      error: null,
    });
    requireSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue(builder),
      rpc: rpcMock,
    });

    const visits = await SiteVisitService.getBookedVisitsInRange(
      COMPANY_ID,
      RANGE_START,
      RANGE_END
    );
    expect(visits[0].bookedAt).toBeNull();
    expect(visits[0].reminderLeadMinutes).toBeNull();
  });
});

// ─── fetchOpenBooking ───────────────────────────────────────────────────────

describe("SiteVisitService.fetchOpenBooking", () => {
  it("returns the soonest open booked visit for the lead (guarded read)", async () => {
    const { builder, calls } = fakeQueryBuilder({
      data: [
        {
          id: VISIT_ID,
          company_id: COMPANY_ID,
          opportunity_id: OPP_ID,
          project_id: null,
          client_id: null,
          scheduled_at: "2026-08-20T17:00:00.000Z",
          duration_minutes: 60,
          assignee_ids: [USER_A],
          status: "scheduled",
          completed_at: null,
          notes: null,
          internal_notes: null,
          measurements: null,
          photos: [],
          activity_id: null,
          calendar_event_id: null,
          created_by: USER_A,
          created_at: "2026-08-11T10:00:00.000Z",
          updated_at: "2026-08-11T10:00:00.000Z",
          deleted_at: null,
          booked_at: "2026-08-11T10:00:00.000Z",
          reminder_lead_minutes: null,
        },
      ],
      error: null,
    });
    requireSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue(builder),
      rpc: rpcMock,
    });

    const visit = await SiteVisitService.fetchOpenBooking(OPP_ID);

    expect(calls).toContainEqual({
      method: "eq",
      args: ["opportunity_id", OPP_ID],
    });
    expect(calls).toContainEqual({
      method: "not",
      args: ["booked_at", "is", null],
    });
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(calls).toContainEqual({
      method: "eq",
      args: ["status", "scheduled"],
    });
    expect(calls).toContainEqual({ method: "limit", args: [1] });

    expect(visit?.id).toBe(VISIT_ID);
  });

  it("returns null when the lead has no open booking", async () => {
    const { builder } = fakeQueryBuilder({ data: [], error: null });
    requireSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue(builder),
      rpc: rpcMock,
    });

    await expect(SiteVisitService.fetchOpenBooking(OPP_ID)).resolves.toBeNull();
  });
});
