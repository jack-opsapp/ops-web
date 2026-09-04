/**
 * Booking policy contract (PUBLIC API P2-4, design §4.1).
 *
 * One pure module owns the policy shape, its defaults and its rules, so the
 * settings screen refuses exactly what the table's CHECK constraints refuse.
 * The screen and the route share this code — a value the UI accepts can never
 * be one the database rejects.
 */

import { describe, expect, it } from "vitest";

import {
  BOOKING_POLICY_DEFAULTS,
  bookingPolicyFromRow,
  bookingPolicyToRow,
  isBookingMode,
  validateBookingPolicy,
  type BookingPolicy,
} from "@/lib/booking/policy";

const TZ = "America/Vancouver";
const OWNER = "33333333-3333-4333-8333-333333333333";

function policy(overrides: Partial<BookingPolicy> = {}): BookingPolicy {
  return {
    ...BOOKING_POLICY_DEFAULTS,
    timezone: TZ,
    mode: "instant",
    windows: [{ weekday: 1, start: "08:00", end: "16:00" }],
    ...overrides,
  };
}

describe("booking mode", () => {
  it("knows the three sanctioned states and nothing else", () => {
    expect(isBookingMode("off")).toBe(true);
    expect(isBookingMode("request")).toBe(true);
    expect(isBookingMode("instant")).toBe(true);
    expect(isBookingMode("on")).toBe(false);
    expect(isBookingMode(null)).toBe(false);
  });
});

describe("bookingPolicyFromRow", () => {
  it("reads a stored row into the screen's shape", () => {
    const result = bookingPolicyFromRow(
      {
        mode: "request",
        windows: [
          { weekday: 2, start: "07:30", end: "11:30" },
          { weekday: 2, start: "13:00", end: "17:00" },
        ],
        timezone: TZ,
        min_notice_hours: 24,
        horizon_days: 30,
        visit_duration_minutes: 90,
        max_bookings_per_day: 3,
        default_owner_id: OWNER,
      },
      "UTC"
    );

    expect(result).toEqual({
      mode: "request",
      windows: [
        { weekday: 2, start: "07:30", end: "11:30" },
        { weekday: 2, start: "13:00", end: "17:00" },
      ],
      timezone: TZ,
      minNoticeHours: 24,
      horizonDays: 30,
      visitDurationMinutes: 90,
      maxBookingsPerDay: 3,
      defaultOwnerId: OWNER,
    });
  });

  it("treats an absent row as booking off, on the company's own clock", () => {
    // Design §4.1: "Absent row = mode='off'." No company is opted in by default.
    const result = bookingPolicyFromRow(null, TZ);
    expect(result.mode).toBe("off");
    expect(result.windows).toEqual([]);
    expect(result.timezone).toBe(TZ);
    expect(result.maxBookingsPerDay).toBeNull();
    expect(result.defaultOwnerId).toBeNull();
  });

  it("drops window entries that are not the stored shape", () => {
    const result = bookingPolicyFromRow(
      {
        mode: "instant",
        windows: [
          { weekday: 1, start: "08:00", end: "16:00" },
          { weekday: "x", start: "08:00", end: "16:00" },
          "nonsense",
          { weekday: 3, start: "08:00" },
        ],
        timezone: TZ,
      },
      "UTC"
    );
    expect(result.windows).toEqual([{ weekday: 1, start: "08:00", end: "16:00" }]);
  });

  it("falls back to the product defaults when numbers are missing or unusable", () => {
    const result = bookingPolicyFromRow(
      { mode: "instant", timezone: TZ, min_notice_hours: null, horizon_days: "x" },
      "UTC"
    );
    expect(result.minNoticeHours).toBe(BOOKING_POLICY_DEFAULTS.minNoticeHours);
    expect(result.horizonDays).toBe(BOOKING_POLICY_DEFAULTS.horizonDays);
  });
});

describe("bookingPolicyToRow", () => {
  it("writes only the columns this screen owns", () => {
    // Slot spacing is a data-model column with a sane default, never a
    // decision put to the owner — so the writer must not carry it.
    expect(bookingPolicyToRow(policy({ maxBookingsPerDay: null }))).toEqual({
      mode: "instant",
      windows: [{ weekday: 1, start: "08:00", end: "16:00" }],
      timezone: TZ,
      min_notice_hours: BOOKING_POLICY_DEFAULTS.minNoticeHours,
      horizon_days: BOOKING_POLICY_DEFAULTS.horizonDays,
      visit_duration_minutes: BOOKING_POLICY_DEFAULTS.visitDurationMinutes,
      max_bookings_per_day: null,
      default_owner_id: null,
    });
  });

  it("sorts windows so a stored row reads in week order", () => {
    const row = bookingPolicyToRow(
      policy({
        windows: [
          { weekday: 3, start: "08:00", end: "12:00" },
          { weekday: 1, start: "13:00", end: "17:00" },
          { weekday: 1, start: "08:00", end: "12:00" },
        ],
      })
    );
    expect(row.windows).toEqual([
      { weekday: 1, start: "08:00", end: "12:00" },
      { weekday: 1, start: "13:00", end: "17:00" },
      { weekday: 3, start: "08:00", end: "12:00" },
    ]);
  });
});

describe("validateBookingPolicy", () => {
  it("accepts a policy that is off with nothing else set", () => {
    expect(validateBookingPolicy(policy({ mode: "off", windows: [] }))).toEqual([]);
  });

  it("requires at least one window once bookings are live", () => {
    expect(validateBookingPolicy(policy({ windows: [] }))).toEqual(["windows_required"]);
    expect(
      validateBookingPolicy(policy({ mode: "request", windows: [] }))
    ).toEqual(["windows_required"]);
  });

  it("ignores unreachable windows while booking is off", () => {
    // Turning booking off must never be blocked by hours the owner left behind.
    expect(
      validateBookingPolicy(
        policy({ mode: "off", windows: [{ weekday: 1, start: "16:00", end: "08:00" }] })
      )
    ).toEqual([]);
  });

  it("refuses more than fourteen windows", () => {
    const windows = Array.from({ length: 15 }, (_, index) => ({
      weekday: index % 7,
      start: index % 2 === 0 ? "08:00" : "13:00",
      end: index % 2 === 0 ? "12:00" : "17:00",
    }));
    expect(validateBookingPolicy(policy({ windows }))).toContain("windows_too_many");
  });

  it("refuses a window that ends before it starts, or at the same minute", () => {
    expect(
      validateBookingPolicy(policy({ windows: [{ weekday: 1, start: "16:00", end: "08:00" }] }))
    ).toContain("window_end_before_start");
    expect(
      validateBookingPolicy(policy({ windows: [{ weekday: 1, start: "08:00", end: "08:00" }] }))
    ).toContain("window_end_before_start");
  });

  it("refuses two windows that overlap on the same day", () => {
    expect(
      validateBookingPolicy(
        policy({
          windows: [
            { weekday: 1, start: "08:00", end: "12:00" },
            { weekday: 1, start: "11:00", end: "17:00" },
          ],
        })
      )
    ).toContain("window_overlap");
  });

  it("allows two windows on one day when they do not overlap", () => {
    expect(
      validateBookingPolicy(
        policy({
          windows: [
            { weekday: 1, start: "08:00", end: "12:00" },
            { weekday: 1, start: "12:00", end: "17:00" },
          ],
        })
      )
    ).toEqual([]);
  });

  it("allows the same hours on different days", () => {
    expect(
      validateBookingPolicy(
        policy({
          windows: [
            { weekday: 1, start: "08:00", end: "16:00" },
            { weekday: 2, start: "08:00", end: "16:00" },
          ],
        })
      )
    ).toEqual([]);
  });

  it("refuses a malformed weekday or clock time", () => {
    expect(
      validateBookingPolicy(policy({ windows: [{ weekday: 7, start: "08:00", end: "16:00" }] }))
    ).toContain("window_invalid");
    expect(
      validateBookingPolicy(policy({ windows: [{ weekday: 1, start: "8:00", end: "16:00" }] }))
    ).toContain("window_invalid");
    expect(
      validateBookingPolicy(policy({ windows: [{ weekday: 1, start: "08:00", end: "24:00" }] }))
    ).toContain("window_invalid");
  });

  it("holds every number inside the range the table accepts", () => {
    expect(validateBookingPolicy(policy({ minNoticeHours: -1 }))).toContain("notice_out_of_range");
    expect(validateBookingPolicy(policy({ minNoticeHours: 721 }))).toContain("notice_out_of_range");
    expect(validateBookingPolicy(policy({ minNoticeHours: 0 }))).toEqual([]);
    expect(validateBookingPolicy(policy({ minNoticeHours: 720 }))).toEqual([]);

    expect(validateBookingPolicy(policy({ horizonDays: 0 }))).toContain("horizon_out_of_range");
    expect(validateBookingPolicy(policy({ horizonDays: 121 }))).toContain("horizon_out_of_range");

    expect(validateBookingPolicy(policy({ visitDurationMinutes: 14 }))).toContain(
      "duration_out_of_range"
    );
    expect(validateBookingPolicy(policy({ visitDurationMinutes: 481 }))).toContain(
      "duration_out_of_range"
    );

    expect(validateBookingPolicy(policy({ maxBookingsPerDay: 0 }))).toContain("cap_out_of_range");
    expect(validateBookingPolicy(policy({ maxBookingsPerDay: null }))).toEqual([]);
  });

  it("refuses a visit longer than the window it has to fit in", () => {
    // A 4-hour visit inside a 2-hour window yields zero bookable slots — the
    // owner would publish availability that can never be booked.
    expect(
      validateBookingPolicy(
        policy({
          visitDurationMinutes: 240,
          windows: [{ weekday: 1, start: "08:00", end: "10:00" }],
        })
      )
    ).toContain("duration_exceeds_windows");
  });

  it("accepts a visit that fits the longest window", () => {
    expect(
      validateBookingPolicy(
        policy({
          visitDurationMinutes: 120,
          windows: [
            { weekday: 1, start: "08:00", end: "09:00" },
            { weekday: 2, start: "08:00", end: "12:00" },
          ],
        })
      )
    ).toEqual([]);
  });

  it("refuses a whole number it cannot store", () => {
    expect(validateBookingPolicy(policy({ minNoticeHours: 1.5 }))).toContain(
      "notice_out_of_range"
    );
    expect(validateBookingPolicy(policy({ maxBookingsPerDay: 2.5 }))).toContain(
      "cap_out_of_range"
    );
  });
});
