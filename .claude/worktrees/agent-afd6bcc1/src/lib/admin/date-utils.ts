/**
 * Date bucketing utility for admin charts.
 * Groups rows into time buckets, filling zeros for continuous timelines.
 */
import {
  eachDayOfInterval,
  eachHourOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  format,
  startOfHour,
  startOfDay,
  startOfWeek,
  startOfMonth,
} from "date-fns";
import type { Granularity, ChartDataPoint } from "./types";

/** Label format per granularity */
const LABEL_FORMATS: Record<Granularity, string> = {
  hourly: "HH:mm",
  daily: "MM-dd",
  weekly: "MM-dd",
  monthly: "yyyy-MM",
};

/** Bucket key format (used for grouping) */
const KEY_FORMATS: Record<Granularity, string> = {
  hourly: "yyyy-MM-dd'T'HH",
  daily: "yyyy-MM-dd",
  weekly: "yyyy-MM-dd",
  monthly: "yyyy-MM",
};

/** Normalize a date to the start of its bucket */
function bucketStart(date: Date, granularity: Granularity): Date {
  switch (granularity) {
    case "hourly":
      return startOfHour(date);
    case "daily":
      return startOfDay(date);
    case "weekly":
      return startOfWeek(date, { weekStartsOn: 0 });
    case "monthly":
      return startOfMonth(date);
  }
}

/** Generate all bucket keys in a range */
function allBuckets(
  from: Date,
  to: Date,
  granularity: Granularity
): Date[] {
  switch (granularity) {
    case "hourly":
      return eachHourOfInterval({ start: from, end: to });
    case "daily":
      return eachDayOfInterval({ start: from, end: to });
    case "weekly":
      return eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 0 });
    case "monthly":
      return eachMonthOfInterval({ start: from, end: to });
  }
}

/**
 * Bucketize rows into a continuous time series.
 *
 * @param rows — array of objects with a date field
 * @param from — start of range (ISO string)
 * @param to — end of range (ISO string)
 * @param granularity — bucket size
 * @param dateField — key to extract date from each row (default: "created_at")
 * @returns ChartDataPoint[] with all buckets including zeros
 */
export function bucketize<T extends Record<string, unknown>>(
  rows: T[],
  from: string,
  to: string,
  granularity: Granularity,
  dateField: keyof T = "created_at" as keyof T
): ChartDataPoint[] {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const keyFmt = KEY_FORMATS[granularity];
  const labelFmt = LABEL_FORMATS[granularity];

  // Count rows per bucket
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const dateVal = row[dateField];
    if (!dateVal) continue;
    const d = new Date(dateVal as string);
    if (d < fromDate || d > toDate) continue;
    const key = format(bucketStart(d, granularity), keyFmt);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  // Generate all buckets with zeros
  const buckets = allBuckets(fromDate, toDate, granularity);
  return buckets.map((bucket) => {
    const key = format(bucket, keyFmt);
    return {
      label: format(bucket, labelFmt),
      value: counts[key] ?? 0,
    };
  });
}

/**
 * Bucketize rows with a custom value aggregation (e.g., sum of amounts).
 */
export function bucketizeAggregate<T extends Record<string, unknown>>(
  rows: T[],
  from: string,
  to: string,
  granularity: Granularity,
  dateField: keyof T,
  valueField: keyof T
): ChartDataPoint[] {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const keyFmt = KEY_FORMATS[granularity];
  const labelFmt = LABEL_FORMATS[granularity];

  const sums: Record<string, number> = {};
  for (const row of rows) {
    const dateVal = row[dateField];
    if (!dateVal) continue;
    const d = new Date(dateVal as string);
    if (d < fromDate || d > toDate) continue;
    const key = format(bucketStart(d, granularity), keyFmt);
    sums[key] = (sums[key] ?? 0) + (Number(row[valueField]) || 0);
  }

  const buckets = allBuckets(fromDate, toDate, granularity);
  return buckets.map((bucket) => {
    const key = format(bucket, keyFmt);
    return {
      label: format(bucket, labelFmt),
      value: sums[key] ?? 0,
    };
  });
}
