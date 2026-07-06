import { describe, expect, it } from "vitest";
import { startOfWeek, format } from "date-fns";
import { computeWeeklyPlacements } from "@/app/(dashboard)/schedule/_components/month/month-scroll-container";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";

// Bug 07492342 — month view had no way to reach events that overflowed a
// day cell: "+N MORE" jumped to day view. The fix lets a week row expand in
// place so every overflowed badge renders (and can be dragged). These tests
// pin the placement-engine contract that backs that behavior.

const WEEK_OPTS = { weekStartsOn: 1 as const };

/** Single-day event pinned to a specific day (only id/start/end are read). */
function dayEvent(id: string, day: Date): InternalScheduleEvent {
  const start = new Date(day.getTime() + 9 * 3600_000); // 09:00 local
  const end = new Date(day.getTime() + 10 * 3600_000); // 10:00 local
  return {
    id,
    startDate: start,
    endDate: end,
    teamMemberIds: [],
    crewIds: [],
  } as unknown as InternalScheduleEvent;
}

describe("computeWeeklyPlacements — expandable month rows (bug 07492342)", () => {
  const anchor = new Date(2026, 5, 10, 12, 0, 0); // a June 2026 weekday
  const weekStart = startOfWeek(anchor, WEEK_OPTS); // Monday of that week
  const weekKey = format(weekStart, "yyyy-MM-dd");
  // 8 events all stacked on the Monday — far more than a compact cell fits.
  const events = Array.from({ length: 8 }, (_, i) => dayEvent(`e${i}`, weekStart));

  it("overflows the day at a compact cell height (the reported bug state)", () => {
    const [week] = computeWeeklyPlacements([weekStart], events, 80, "compact", null);
    // Monday (day index 0) can't fit all 8 → some overflow is hidden.
    expect(week.overflowByDay[0]).toBeGreaterThan(0);
    expect(week.maxSlotUsed).toBeLessThan(8);
  });

  it("expanding the row reveals every event with zero overflow", () => {
    const [week] = computeWeeklyPlacements([weekStart], events, 80, "compact", weekKey);
    // No badge is hidden once the row is expanded...
    expect(week.overflowByDay.every((n) => n === 0)).toBe(true);
    // ...and the row now stacks all 8 (drives the grown row height).
    expect(week.maxSlotUsed).toBe(8);
  });

  it("only the targeted week expands — other weeks keep the compact cap", () => {
    const [week] = computeWeeklyPlacements(
      [weekStart],
      events,
      80,
      "compact",
      "1999-01-04" // some other week's key
    );
    expect(week.overflowByDay[0]).toBeGreaterThan(0);
  });

  it("never reports overflow when the cell is already tall enough", () => {
    // A single event never overflows regardless of expansion state.
    const [week] = computeWeeklyPlacements(
      [weekStart],
      [dayEvent("solo", weekStart)],
      80,
      "compact",
      null
    );
    expect(week.overflowByDay.every((n) => n === 0)).toBe(true);
    expect(week.maxSlotUsed).toBe(1);
  });
});
