/**
 * OPS Web — Inbox Velocity Helpers
 *
 * Pure functions that transform raw daily-count rows from the database
 * into the fixed-length array + delta shape the /api/inbox/velocity
 * endpoint returns. Split into a helper file so vitest can unit-test
 * them without importing the Supabase/Firebase glue.
 */

export interface VelocityDayRow {
  day: Date;   // midnight UTC of the day
  count: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Turn a sparse list of (day, count) rows into a fixed-length array of
 * daily counts, oldest → newest. Missing days are zero-filled. Rows
 * outside the window [now - `days`, now) are dropped.
 *
 * Index 0 of the result = `days` days before `now`.
 * Index `days - 1` of the result = yesterday (the day before `now`).
 *
 * Uses UTC for bucketing so the window is stable across user timezones.
 */
export function padVelocityDays(
  rows: VelocityDayRow[],
  days: number,
  now: Date
): number[] {
  const result = new Array<number>(days).fill(0);
  const nowUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );

  for (const row of rows) {
    const rowUtcMidnight = Date.UTC(
      row.day.getUTCFullYear(),
      row.day.getUTCMonth(),
      row.day.getUTCDate()
    );
    const dayDelta = Math.floor((nowUtcMidnight - rowUtcMidnight) / MS_PER_DAY);
    // day 1 (yesterday) → index days-1; day `days` → index 0; out-of-window drop
    if (dayDelta < 1 || dayDelta > days) continue;
    const index = days - dayDelta;
    result[index] += row.count;
  }

  return result;
}

export interface WeekDeltaResult {
  weekTotal: number;
  priorWeekTotal: number;
  /**
   * (weekTotal - priorWeekTotal) / priorWeekTotal, clamped to 0 when the
   * prior week was zero so we never render ∞ or NaN. Positive = climbing,
   * negative = falling.
   */
  weekDelta: number;
}

/**
 * Split a 14-day daily-count array into prior-week (indices 0-6) and
 * this-week (indices 7-13) totals and compute the percentage delta.
 * Requires exactly 14 entries — enforce at the call site.
 */
export function computeWeekDelta(daily: number[]): WeekDeltaResult {
  if (daily.length !== 14) {
    throw new Error(
      `computeWeekDelta expects exactly 14 entries, got ${daily.length}`
    );
  }
  const priorWeekTotal = daily.slice(0, 7).reduce((a, b) => a + b, 0);
  const weekTotal = daily.slice(7, 14).reduce((a, b) => a + b, 0);
  const weekDelta =
    priorWeekTotal === 0 ? 0 : (weekTotal - priorWeekTotal) / priorWeekTotal;
  return { weekTotal, priorWeekTotal, weekDelta };
}
