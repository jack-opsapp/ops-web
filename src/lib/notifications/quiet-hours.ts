/**
 * Quiet-hours evaluation for server-side push delivery.
 *
 * Ported verbatim in behavior from iOS
 * `NotificationManager.shouldSendNotification` so one rule governs both
 * surfaces:
 *
 *   start > end  → window spans midnight → quiet when now >= start OR now < end
 *   start < end  → same-day window       → quiet when now >= start AND now < end
 *   start == end → NOT quiet hours (the settings screen says as much)
 *   either NULL  → NOT quiet hours
 *
 * Values come from `notification_preferences.quiet_hours_start` /
 * `.quiet_hours_end` (Postgres `time without time zone`, nullable). The
 * comparison happens in the company's IANA timezone (`companies.timezone`) —
 * OPS stores no per-user timezone.
 *
 * Pure module by design: no logging, no I/O. The caller owns both, so the
 * warning it emits can carry the company id.
 */

/** Used when a company's timezone is missing or not a resolvable IANA zone. */
export const QUIET_HOURS_FALLBACK_TIME_ZONE = "UTC";

const SECONDS_PER_DAY = 86_400;

/** `HH:MM`, `HH:MM:SS`, or `HH:MM:SS.ffffff` as PostgREST may return it. */
const TIME_OF_DAY_PATTERN = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

/**
 * Seconds since local midnight for a Postgres `time` value.
 * Returns null for NULL, malformed, or out-of-range input — all of which mean
 * "no quiet hours" rather than "silence everything".
 */
export function parseTimeOfDaySeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_OF_DAY_PATTERN.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  // Postgres admits `24:00:00` as the end-of-day boundary; nothing past it.
  if (hours > 24) return null;
  if (hours === 24 && (minutes > 0 || seconds > 0)) return null;

  return hours * 3_600 + minutes * 60 + seconds;
}

/**
 * Validate a `companies.timezone` value. Unknown zones fall back to UTC with
 * `fallback: true` so the caller can warn instead of throwing — a bad timezone
 * string must never take down a dispatch.
 */
export function resolveQuietHoursTimeZone(value: unknown): {
  timeZone: string;
  fallback: boolean;
} {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    return { timeZone: QUIET_HOURS_FALLBACK_TIME_ZONE, fallback: true };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return { timeZone: candidate, fallback: false };
  } catch {
    return { timeZone: QUIET_HOURS_FALLBACK_TIME_ZONE, fallback: true };
  }
}

/** Seconds since local midnight for `at`, read in a resolvable IANA zone. */
export function secondsOfDayInTimeZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  // `hourCycle: "h23"` already pins midnight to 0; the modulo is belt-and-braces
  // against Intl implementations that still report hour 24.
  const seconds =
    (value("hour") % 24) * 3_600 + value("minute") * 60 + value("second");
  return ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

/** True when `nowSeconds` falls inside the recipient's quiet-hours window. */
export function isWithinQuietHours(params: {
  startSeconds: number | null;
  endSeconds: number | null;
  nowSeconds: number;
}): boolean {
  const { startSeconds, endSeconds, nowSeconds } = params;
  if (startSeconds === null || endSeconds === null) return false;
  if (startSeconds === endSeconds) return false;
  return startSeconds > endSeconds
    ? nowSeconds >= startSeconds || nowSeconds < endSeconds
    : nowSeconds >= startSeconds && nowSeconds < endSeconds;
}

/** A window can only silence anything when both bounds parse and differ. */
export function hasEffectiveQuietHoursWindow(params: {
  startSeconds: number | null;
  endSeconds: number | null;
}): boolean {
  return (
    params.startSeconds !== null &&
    params.endSeconds !== null &&
    params.startSeconds !== params.endSeconds
  );
}
