/**
 * OPS Web - Lane Assignment for Overlapping Calendar Events
 *
 * Sweep-line algorithm that places overlapping events into separate vertical
 * lanes within a single swimlane row. Used by the Crew view (and previously
 * the Timeline view, before T12 of the calendar visual rework). See
 * docs/superpowers/specs/2026-04-27-calendar-time-precision-recurrence.md
 * for the broader architecture.
 *
 * Without lane assignment, two events overlapping on the same day for the
 * same crew member render exactly on top of each other — labels merge
 * ("Lan...INSTALLATION") and only the top-stacked event is clickable.
 */

import type { InternalCalendarEvent } from "./calendar-utils";

export interface LaneAssignment {
  /** eventId → lane index (0-based) */
  lanes: Map<string, number>;
  /** Maximum number of overlapping lanes used in this row */
  laneCount: number;
}

/**
 * Place events into the lowest-numbered lane whose previous event has
 * already ended. Two events count as overlapping when their inclusive
 * [start, end] ranges intersect.
 *
 * Strict less-than comparison means an event ending on day N can share
 * a lane with one starting on day N+1 (back-to-back, not overlapping).
 */
export function assignLanes(events: InternalCalendarEvent[]): LaneAssignment {
  if (events.length === 0) return { lanes: new Map(), laneCount: 1 };

  const sorted = [...events].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );
  // laneEndTimes[i] = end timestamp of the latest event currently in lane i
  const laneEndTimes: number[] = [];
  const lanes = new Map<string, number>();

  for (const event of sorted) {
    const startMs = event.startDate.getTime();
    const endMs = event.endDate.getTime();
    let placed = false;

    for (let i = 0; i < laneEndTimes.length; i++) {
      if (laneEndTimes[i] < startMs) {
        lanes.set(event.id, i);
        laneEndTimes[i] = endMs;
        placed = true;
        break;
      }
    }

    if (!placed) {
      lanes.set(event.id, laneEndTimes.length);
      laneEndTimes.push(endMs);
    }
  }

  return { lanes, laneCount: Math.max(laneEndTimes.length, 1) };
}

/**
 * Decide row height given a lane count and a base single-lane row height.
 * Each lane is allotted >= MIN_LANE_HEIGHT so labels stay readable; rows
 * always honor the base height as a floor.
 */
export function rowHeightForLanes(laneCount: number, baseRowHeight: number): number {
  const MIN_LANE_HEIGHT = 24;
  const VERTICAL_PADDING = 16; // 8px top + 8px bottom
  const LANE_GAP = 4;
  const computed =
    VERTICAL_PADDING +
    laneCount * MIN_LANE_HEIGHT +
    Math.max(laneCount - 1, 0) * LANE_GAP;
  return Math.max(baseRowHeight, computed);
}

/**
 * Compute vertical layout for a single block given its lane and the row's
 * total available height. Mirrors the inline math previously duplicated
 * across timeline/crew task blocks.
 */
export function laneVerticalLayout(
  laneIndex: number,
  laneCount: number,
  rowHeight: number
): { top: number; height: number } {
  const VERTICAL_PADDING = 8;
  const LANE_GAP = 4;
  const MIN_BLOCK_HEIGHT = 14;
  const innerHeight = rowHeight - VERTICAL_PADDING * 2;
  const totalLaneGaps = LANE_GAP * Math.max(laneCount - 1, 0);
  const perLaneHeight = Math.max(
    MIN_BLOCK_HEIGHT,
    Math.floor((innerHeight - totalLaneGaps) / Math.max(laneCount, 1))
  );
  return {
    top: VERTICAL_PADDING + laneIndex * (perLaneHeight + LANE_GAP),
    height: perLaneHeight,
  };
}
