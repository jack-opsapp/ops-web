import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Onboarding drip service. Calendar-driven plus behavior-triggered
 * sends for trial signups, Day 0 through Day 14. Cleanly hands off
 * to TrialExpiryService at Day 23.
 *
 * See specs/2026-05-27-onboarding-drip-design.md (v3.1) for the
 * canonical design. Every method here is documented against a
 * section of that spec.
 */

export type DaySlot =
  | "day_0"
  | "day_1"
  | "day_3"
  | "day_4"
  | "day_8"
  | "day_14"
  | "lost_you";

export type Branch =
  | "no_project"
  | "has_project"
  | "no_aha"
  | "has_aha"
  | "quiet"
  | "active"
  | null;

/**
 * Returns the wall-clock hour (0-23) in the operator's local timezone.
 * Used by the cron's localHour===9 gate. Falls back to UTC if timezone
 * is unknown.
 */
export function computeOperatorLocalHour(
  utcNow: Date,
  timezone: string | null,
): number {
  if (!timezone) return utcNow.getUTCHours();
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(utcNow);
    const hourPart = parts.find((p) => p.type === "hour");
    const h = hourPart ? parseInt(hourPart.value, 10) : NaN;
    // Intl returns "24" for midnight in some locales; normalize to 0
    return isNaN(h) ? utcNow.getUTCHours() : h % 24;
  } catch {
    return utcNow.getUTCHours();
  }
}

export const OnboardingDripService = {
  // Subsequent tasks add: computeState, claimAndSend, processCompany,
  // processRetries, processLostYouCandidate, processAll
};
