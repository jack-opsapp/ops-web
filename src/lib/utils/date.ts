/**
 * Date utilities for OPS Web
 * Handles multiple date formats: ISO8601 strings AND UNIX timestamps
 */

import {
  format,
  formatDistanceToNow,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  eachDayOfInterval,
  parseISO,
  isValid,
} from "date-fns";

/**
 * Parse a date from an API response.
 * Handles multiple formats:
 * 1. ISO8601 string (e.g., "2025-11-18T09:00:00.000Z")
 * 2. UNIX timestamp in milliseconds (e.g., 1700000000000)
 * 3. UNIX timestamp in seconds (e.g., 1700000000)
 * 4. null/undefined -> null
 */
export function parseFlexibleDate(
  value: string | number | null | undefined
): Date | null {
  if (value == null) return null;

  // String: try ISO8601 parsing
  if (typeof value === "string") {
    if (value.trim() === "") return null;

    // Try ISO8601
    const parsed = parseISO(value);
    if (isValid(parsed)) return parsed;

    // Try as numeric string
    const num = Number(value);
    if (!isNaN(num)) {
      return parseTimestamp(num);
    }

    return null;
  }

  // Number: UNIX timestamp
  if (typeof value === "number") {
    return parseTimestamp(value);
  }

  return null;
}

/**
 * Parse a numeric timestamp, auto-detecting seconds vs milliseconds.
 * Stripe and other APIs can send either format.
 */
function parseTimestamp(value: number): Date | null {
  if (value === 0) return null;

  // If value > 1e12, it's milliseconds (after year 2001 in ms)
  // If value < 1e12, it's seconds
  const ms = value > 1e12 ? value : value * 1000;
  const date = new Date(ms);

  if (!isValid(date)) return null;

  // Sanity check: date should be between 2000 and 2100
  const year = date.getFullYear();
  if (year < 2000 || year > 2100) return null;

  return date;
}

/**
 * Format a date to ISO8601 for API requests.
 */
export function toISODate(date: Date): string {
  return date.toISOString();
}

/**
 * Format a date for display.
 */
export function formatDate(
  date: Date | string | null | undefined,
  formatStr: string = "MMM d, yyyy"
): string {
  if (!date) return "";
  const d = typeof date === "string" ? parseFlexibleDate(date) : date;
  if (!d || !isValid(d)) return "";
  return format(d, formatStr);
}

/**
 * Format a date as relative time (e.g., "2 hours ago").
 */
export function formatRelativeTime(
  date: Date | string | null | undefined
): string {
  if (!date) return "";
  const d = typeof date === "string" ? parseFlexibleDate(date) : date;
  if (!d || !isValid(d)) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Format a date range for display.
 */
export function formatDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): string {
  const startDate =
    typeof start === "string" ? parseFlexibleDate(start) : start;
  const endDate = typeof end === "string" ? parseFlexibleDate(end) : end;

  if (!startDate) return "";
  if (!endDate) return formatDate(startDate);

  if (isSameDay(startDate, endDate)) {
    return formatDate(startDate);
  }

  return `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`;
}

/**
 * Check if a date is overdue (past the end date).
 */
export function isOverdue(
  endDate: Date | string | null | undefined
): boolean {
  if (!endDate) return false;
  const d = typeof endDate === "string" ? parseFlexibleDate(endDate) : endDate;
  if (!d) return false;
  return isBefore(d, new Date());
}

/**
 * Get all dates spanned by a date range (for multi-day calendar events).
 */
export function getSpannedDates(start: Date, end: Date): Date[] {
  if (isSameDay(start, end)) return [startOfDay(start)];
  return eachDayOfInterval({ start: startOfDay(start), end: startOfDay(end) });
}

/**
 * Check if a date falls within a range.
 */
export function isDateInRange(date: Date, start: Date, end: Date): boolean {
  return (
    (isAfter(date, start) || isSameDay(date, start)) &&
    (isBefore(date, end) || isSameDay(date, end))
  );
}

/**
 * Get the duration in days between two dates.
 */
export function getDurationDays(
  start: Date | null,
  end: Date | null
): number {
  if (!start || !end) return 0;
  return Math.max(1, differenceInDays(end, start) + 1);
}

// Re-export commonly used date-fns functions
export {
  format,
  formatDistanceToNow,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  eachDayOfInterval,
  parseISO,
  isValid,
};
