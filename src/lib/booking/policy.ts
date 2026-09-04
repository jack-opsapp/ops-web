/**
 * Public booking policy — the shape, the defaults, and the rules
 * (PUBLIC API P2-4, design §4.1 `public.site_visit_booking_policies`).
 *
 * Pure and isomorphic on purpose: the settings screen and the settings route
 * both import it, so a value the screen accepts is never one the table's CHECK
 * constraints reject. Nothing here reaches the network or the database.
 *
 * What this module deliberately does NOT model: `slot_granularity_minutes`.
 * It is a column with a sane default, not a decision put to a business owner —
 * the screen never asks, and the writer never sends it, so the column keeps
 * whatever the table says.
 */

/** D9 — whether customers may book at all, and how firmly. One control, three states. */
export const BOOKING_MODES = ["off", "request", "instant"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export function isBookingMode(value: unknown): value is BookingMode {
  return (
    typeof value === "string" && (BOOKING_MODES as readonly string[]).includes(value)
  );
}

/** One bookable stretch of a weekday, in the policy's own timezone. */
export interface BookingWindow {
  /** 0 = Sunday … 6 = Saturday, matching Postgres `extract(dow …)`. */
  readonly weekday: number;
  /** `HH:MM`, 24-hour, zero padded. */
  readonly start: string;
  readonly end: string;
}

export interface BookingPolicy {
  readonly mode: BookingMode;
  readonly windows: readonly BookingWindow[];
  readonly timezone: string;
  readonly minNoticeHours: number;
  readonly horizonDays: number;
  readonly visitDurationMinutes: number;
  /** NULL = uncapped. */
  readonly maxBookingsPerDay: number | null;
  /** NULL or ineligible = the unassigned queue (design §4.1, I11). */
  readonly defaultOwnerId: string | null;
}

/** Column defaults, mirrored so an absent row and a fresh screen agree. */
export const BOOKING_POLICY_DEFAULTS: BookingPolicy = Object.freeze({
  mode: "off",
  windows: [],
  timezone: "UTC",
  minNoticeHours: 48,
  horizonDays: 21,
  visitDurationMinutes: 60,
  maxBookingsPerDay: null,
  defaultOwnerId: null,
});

/** The table's CHECK ranges, in one place. */
export const BOOKING_LIMITS = Object.freeze({
  maxWindows: 14,
  notice: { min: 0, max: 720 },
  horizon: { min: 1, max: 120 },
  duration: { min: 15, max: 480 },
  capMin: 1,
});

export type BookingPolicyProblem =
  | "windows_required"
  | "windows_too_many"
  | "window_invalid"
  | "window_end_before_start"
  | "window_overlap"
  | "notice_out_of_range"
  | "horizon_out_of_range"
  | "duration_out_of_range"
  | "duration_exceeds_windows"
  | "cap_out_of_range";

const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** `"08:30"` → 510. Assumes the value already matched `CLOCK`. */
export function minutesOfDay(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function windowFromUnknown(value: unknown): BookingWindow | null {
  if (!isRecord(value)) return null;
  const { weekday, start, end } = value;
  if (typeof weekday !== "number" || !Number.isInteger(weekday)) return null;
  if (typeof start !== "string" || typeof end !== "string") return null;
  return { weekday, start, end };
}

function wholeNumber(value: unknown, fallback: number): number {
  // `Number(null)` and `Number("")` are 0 — a stored NULL must fall back to the
  // product default, never silently become "no notice at all".
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Week order, then time of day — how a person reads their own week. */
export function sortWindows(
  windows: readonly BookingWindow[]
): readonly BookingWindow[] {
  return [...windows].sort(
    (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)
  );
}

/**
 * A stored row (or its absence) as the screen's shape. `companyTimezone`
 * seeds a policy that does not exist yet — the row owns its timezone once
 * written (design §4.1).
 */
export function bookingPolicyFromRow(
  row: Record<string, unknown> | null | undefined,
  companyTimezone: string
): BookingPolicy {
  const fallbackTimezone = companyTimezone.trim() || BOOKING_POLICY_DEFAULTS.timezone;
  if (!row) return { ...BOOKING_POLICY_DEFAULTS, timezone: fallbackTimezone };

  const rawWindows = Array.isArray(row.windows) ? row.windows : [];
  const windows = rawWindows
    .map(windowFromUnknown)
    .filter((entry): entry is BookingWindow => entry !== null);

  const storedTimezone =
    typeof row.timezone === "string" && row.timezone.trim().length > 0
      ? row.timezone
      : fallbackTimezone;

  const cap = row.max_bookings_per_day;

  return {
    mode: isBookingMode(row.mode) ? row.mode : BOOKING_POLICY_DEFAULTS.mode,
    windows,
    timezone: storedTimezone,
    minNoticeHours: wholeNumber(
      row.min_notice_hours,
      BOOKING_POLICY_DEFAULTS.minNoticeHours
    ),
    horizonDays: wholeNumber(row.horizon_days, BOOKING_POLICY_DEFAULTS.horizonDays),
    visitDurationMinutes: wholeNumber(
      row.visit_duration_minutes,
      BOOKING_POLICY_DEFAULTS.visitDurationMinutes
    ),
    maxBookingsPerDay:
      cap === null || cap === undefined ? null : wholeNumber(cap, 0) || null,
    defaultOwnerId:
      typeof row.default_owner_id === "string" && row.default_owner_id.length > 0
        ? row.default_owner_id
        : null,
  };
}

/** The columns this screen owns, in storage shape. */
export function bookingPolicyToRow(policy: BookingPolicy): {
  mode: BookingMode;
  windows: BookingWindow[];
  timezone: string;
  min_notice_hours: number;
  horizon_days: number;
  visit_duration_minutes: number;
  max_bookings_per_day: number | null;
  default_owner_id: string | null;
} {
  return {
    mode: policy.mode,
    windows: [...sortWindows(policy.windows)],
    timezone: policy.timezone,
    min_notice_hours: policy.minNoticeHours,
    horizon_days: policy.horizonDays,
    visit_duration_minutes: policy.visitDurationMinutes,
    max_bookings_per_day: policy.maxBookingsPerDay,
    default_owner_id: policy.defaultOwnerId,
  };
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Every reason this policy could not be stored, in the order a person would
 * meet them. An empty array means the table would accept it.
 *
 * While `mode` is `off` nothing below the control is reachable, so leftover
 * hours never block the one action that matters — switching it off.
 */
export function validateBookingPolicy(
  policy: BookingPolicy
): BookingPolicyProblem[] {
  const problems: BookingPolicyProblem[] = [];

  if (!inRange(policy.minNoticeHours, BOOKING_LIMITS.notice.min, BOOKING_LIMITS.notice.max)) {
    problems.push("notice_out_of_range");
  }
  if (!inRange(policy.horizonDays, BOOKING_LIMITS.horizon.min, BOOKING_LIMITS.horizon.max)) {
    problems.push("horizon_out_of_range");
  }
  if (
    !inRange(
      policy.visitDurationMinutes,
      BOOKING_LIMITS.duration.min,
      BOOKING_LIMITS.duration.max
    )
  ) {
    problems.push("duration_out_of_range");
  }
  if (
    policy.maxBookingsPerDay !== null &&
    !(Number.isInteger(policy.maxBookingsPerDay) && policy.maxBookingsPerDay >= BOOKING_LIMITS.capMin)
  ) {
    problems.push("cap_out_of_range");
  }

  if (policy.mode === "off") return problems;

  if (policy.windows.length === 0) problems.push("windows_required");
  if (policy.windows.length > BOOKING_LIMITS.maxWindows) problems.push("windows_too_many");

  let malformed = false;
  for (const window of policy.windows) {
    if (
      !Number.isInteger(window.weekday) ||
      window.weekday < 0 ||
      window.weekday > 6 ||
      !CLOCK.test(window.start) ||
      !CLOCK.test(window.end)
    ) {
      malformed = true;
      continue;
    }
    if (minutesOfDay(window.end) <= minutesOfDay(window.start)) {
      if (!problems.includes("window_end_before_start")) {
        problems.push("window_end_before_start");
      }
    }
  }
  if (malformed) problems.push("window_invalid");

  const sound = policy.windows.filter(
    (window) =>
      Number.isInteger(window.weekday) &&
      window.weekday >= 0 &&
      window.weekday <= 6 &&
      CLOCK.test(window.start) &&
      CLOCK.test(window.end) &&
      minutesOfDay(window.end) > minutesOfDay(window.start)
  );

  const byDay = sortWindows(sound);
  for (let index = 1; index < byDay.length; index += 1) {
    const previous = byDay[index - 1];
    const current = byDay[index];
    if (
      previous.weekday === current.weekday &&
      minutesOfDay(current.start) < minutesOfDay(previous.end)
    ) {
      problems.push("window_overlap");
      break;
    }
  }

  // A visit that cannot fit the longest window publishes hours nothing can be
  // booked into — availability the customer sees and can never use.
  if (sound.length > 0) {
    const longest = Math.max(
      ...sound.map((window) => minutesOfDay(window.end) - minutesOfDay(window.start))
    );
    if (policy.visitDurationMinutes > longest) problems.push("duration_exceeds_windows");
  }

  return problems;
}
