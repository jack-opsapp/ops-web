import { describe, expect, it } from "vitest";
import {
  assignLanes,
  rowHeightForLanes,
  laneVerticalLayout,
} from "@/lib/utils/lane-assignment";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";

// ─── Test fixture helper ────────────────────────────────────────────────────

/**
 * Build a minimal InternalCalendarEvent for lane-assignment testing.
 * The algorithm only inspects id, startDate, and endDate — everything else
 * is filler to satisfy the type.
 */
function event(id: string, startISO: string, endISO: string): InternalCalendarEvent {
  return {
    id,
    startDate: new Date(startISO),
    endDate: new Date(endISO),
    taskTitle: "task",
    projectTitle: null,
    clientName: null,
    address: null,
    teamMemberIds: [],
    typeColors: { bg: "#000", border: "#fff" },
    typeLabel: null,
    statusKey: "scheduled",
    allDay: true,
    recurrenceId: null,
    recurrenceOriginDate: null,
  } as unknown as InternalCalendarEvent;
}

// ─── assignLanes ────────────────────────────────────────────────────────────

describe("assignLanes", () => {
  it("returns empty map and laneCount=1 when given no events", () => {
    const result = assignLanes([]);
    expect(result.lanes.size).toBe(0);
    expect(result.laneCount).toBe(1);
  });

  it("places a single event in lane 0 with laneCount=1", () => {
    const result = assignLanes([event("a", "2026-05-01T00:00:00Z", "2026-05-03T23:59:59Z")]);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.laneCount).toBe(1);
  });

  it("places non-overlapping events in the same lane", () => {
    const result = assignLanes([
      event("a", "2026-05-01T08:00:00Z", "2026-05-01T17:00:00Z"),
      event("b", "2026-05-02T08:00:00Z", "2026-05-02T17:00:00Z"),
    ]);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.lanes.get("b")).toBe(0);
    expect(result.laneCount).toBe(1);
  });

  it("places two overlapping events in separate lanes", () => {
    const result = assignLanes([
      event("a", "2026-05-01T00:00:00Z", "2026-05-03T23:59:59Z"),
      event("b", "2026-05-01T00:00:00Z", "2026-05-03T23:59:59Z"),
    ]);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.lanes.get("b")).toBe(1);
    expect(result.laneCount).toBe(2);
  });

  it("places three overlapping events in three lanes", () => {
    const result = assignLanes([
      event("a", "2026-05-01T00:00:00Z", "2026-05-05T23:59:59Z"),
      event("b", "2026-05-02T00:00:00Z", "2026-05-04T23:59:59Z"),
      event("c", "2026-05-03T00:00:00Z", "2026-05-06T23:59:59Z"),
    ]);
    expect(result.laneCount).toBe(3);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.lanes.get("b")).toBe(1);
    expect(result.lanes.get("c")).toBe(2);
  });

  it("reuses a lane after its event ends, even with later overlaps elsewhere", () => {
    // a (lane 0): May 1 00:00 → May 2 23:59
    // b (lane 1): May 1 08:00 → May 3 23:59 (overlaps with a)
    // c (lane 0): May 3 00:00 → May 4 23:59 (a is done so lane 0 reusable; overlaps with b)
    const result = assignLanes([
      event("a", "2026-05-01T00:00:00Z", "2026-05-02T23:59:00Z"),
      event("b", "2026-05-01T08:00:00Z", "2026-05-03T23:59:00Z"),
      event("c", "2026-05-03T00:00:00Z", "2026-05-04T23:59:00Z"),
    ]);
    expect(result.laneCount).toBe(2);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.lanes.get("b")).toBe(1);
    expect(result.lanes.get("c")).toBe(0);
  });

  it("treats back-to-back events (one ends before another starts) as non-overlapping", () => {
    const result = assignLanes([
      event("a", "2026-05-01T08:00:00Z", "2026-05-01T17:00:00Z"),
      event("b", "2026-05-01T17:00:01Z", "2026-05-01T20:00:00Z"),
    ]);
    expect(result.laneCount).toBe(1);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.lanes.get("b")).toBe(0);
  });

  it("sorts events by start time before assigning, so input order does not matter", () => {
    const result = assignLanes([
      event("c", "2026-05-03T00:00:00Z", "2026-05-06T23:59:59Z"),
      event("a", "2026-05-01T00:00:00Z", "2026-05-05T23:59:59Z"),
      event("b", "2026-05-02T00:00:00Z", "2026-05-04T23:59:59Z"),
    ]);
    expect(result.laneCount).toBe(3);
    expect(result.lanes.get("a")).toBe(0);
    expect(result.lanes.get("b")).toBe(1);
    expect(result.lanes.get("c")).toBe(2);
  });
});

// ─── rowHeightForLanes ──────────────────────────────────────────────────────

describe("rowHeightForLanes", () => {
  const BASE = 72; // matches CREW_ROW_HEIGHT

  it("returns the base height for a single lane (no overlaps)", () => {
    expect(rowHeightForLanes(1, BASE)).toBe(BASE);
  });

  it("returns the base height for two lanes when computed height is below base", () => {
    // 2 lanes: 16 + 2*24 + 1*4 = 68 — still below BASE=72.
    expect(rowHeightForLanes(2, BASE)).toBe(BASE);
  });

  it("grows the row when computed height exceeds base", () => {
    // 3 lanes: 16 + 3*24 + 2*4 = 96 — exceeds BASE=72.
    expect(rowHeightForLanes(3, BASE)).toBe(96);
  });

  it("scales linearly for many lanes", () => {
    // 5 lanes: 16 + 5*24 + 4*4 = 152.
    expect(rowHeightForLanes(5, BASE)).toBe(152);
  });
});

// ─── laneVerticalLayout ─────────────────────────────────────────────────────

describe("laneVerticalLayout", () => {
  it("places a single lane at top=8 with the historical 56px height", () => {
    const layout = laneVerticalLayout(0, 1, 72);
    expect(layout.top).toBe(8);
    expect(layout.height).toBe(56);
  });

  it("splits inner height evenly across two lanes with a 4px gap", () => {
    // BASE=72: inner=56, totalGaps=4, perLane=floor(52/2)=26.
    const lane0 = laneVerticalLayout(0, 2, 72);
    const lane1 = laneVerticalLayout(1, 2, 72);
    expect(lane0).toEqual({ top: 8, height: 26 });
    expect(lane1).toEqual({ top: 8 + 26 + 4, height: 26 });
  });

  it("uses grown row height for many lanes so blocks stay readable", () => {
    // For 4 lanes the grid would size the row at rowHeightForLanes(4, 72)=124.
    // inner=108, totalGaps=12, perLane=floor(96/4)=24.
    const grown = rowHeightForLanes(4, 72);
    expect(grown).toBe(124);
    const lane3 = laneVerticalLayout(3, 4, grown);
    expect(lane3.height).toBe(24);
    expect(lane3.top).toBe(8 + 3 * (24 + 4));
  });

  it("clamps to the minimum 14px lane height when rowHeight is unusually small", () => {
    const layout = laneVerticalLayout(0, 8, 40);
    expect(layout.height).toBe(14);
  });
});
