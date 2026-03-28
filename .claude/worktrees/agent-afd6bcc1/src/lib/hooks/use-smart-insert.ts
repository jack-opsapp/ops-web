/**
 * OPS Web — Smart Insert Hook
 *
 * Detects "insert between" scenarios when dragging a task on the timeline.
 * When a task is dropped between two existing tasks in the same team member row,
 * calculates how surrounding events need to shift to make room.
 */

import { useCallback } from "react";
import { addDays, differenceInCalendarDays, isBefore, isAfter, isEqual } from "date-fns";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InsertPoint {
  /** The event immediately before the insert position (null if inserting at the start) */
  before: InternalCalendarEvent | null;
  /** The event immediately after the insert position (null if inserting at the end) */
  after: InternalCalendarEvent | null;
}

export interface PushOffset {
  eventId: string;
  newStart: Date;
  newEnd: Date;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSmartInsert() {
  /**
   * Detects if a dragged task is being dropped between two existing tasks
   * in the same team member row.
   *
   * Returns { before, after } describing the two surrounding events,
   * or null if the target date doesn't fall between any two events.
   */
  const detectInsertPoint = useCallback(
    (
      draggedTaskId: string,
      targetTeamMemberId: string,
      targetDate: Date,
      allEvents: InternalCalendarEvent[],
      startDate: Date,
      daysShown: number
    ): InsertPoint | null => {
      // Visible date range for sanity — don't detect outside the viewport
      const viewEnd = addDays(startDate, daysShown);
      if (isBefore(targetDate, startDate) || isAfter(targetDate, viewEnd)) {
        return null;
      }

      // Filter events for this team member, excluding the dragged task itself,
      // sorted by start date ascending
      const rowEvents = allEvents
        .filter(
          (e) =>
            e.id !== draggedTaskId &&
            e.teamMemberIds.includes(targetTeamMemberId)
        )
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      if (rowEvents.length === 0) return null;

      // Check if the target date falls before the first event
      if (isBefore(targetDate, rowEvents[0].startDate)) {
        return { before: null, after: rowEvents[0] };
      }

      // Check if the target date falls after the last event
      const lastEvent = rowEvents[rowEvents.length - 1];
      if (
        isAfter(targetDate, lastEvent.endDate) ||
        isEqual(targetDate, lastEvent.endDate)
      ) {
        return { before: lastEvent, after: null };
      }

      // Check between each pair of consecutive events
      for (let i = 0; i < rowEvents.length - 1; i++) {
        const current = rowEvents[i];
        const next = rowEvents[i + 1];

        // Target date falls between current's end and next's start
        if (
          (isAfter(targetDate, current.endDate) ||
            isEqual(targetDate, current.endDate)) &&
          isBefore(targetDate, next.startDate)
        ) {
          return { before: current, after: next };
        }
      }

      // Target date overlaps with an existing event — not a clean insert point
      return null;
    },
    []
  );

  /**
   * Calculate how surrounding events need to shift to make room
   * for an inserted task of the given duration.
   *
   * Events at or after the insert point push forward by the inserted duration.
   * Only events in the same team member row are affected.
   */
  const calculatePushOffsets = useCallback(
    (
      insertedDuration: number,
      before: InternalCalendarEvent | null,
      after: InternalCalendarEvent | null,
      allEvents: InternalCalendarEvent[],
      targetTeamMemberId: string
    ): PushOffset[] => {
      if (!after) {
        // Inserting at the end — nothing needs to move
        return [];
      }

      const pushDays = insertedDuration;

      // Determine the cut-off: events starting at or after the "after" event
      // in the same team member row need to be pushed forward
      const cutoffDate = after.startDate;

      const rowEvents = allEvents
        .filter(
          (e) =>
            e.teamMemberIds.includes(targetTeamMemberId) &&
            (isAfter(e.startDate, cutoffDate) ||
              isEqual(e.startDate, cutoffDate))
        )
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      return rowEvents.map((e) => {
        const duration = differenceInCalendarDays(e.endDate, e.startDate);
        const newStart = addDays(e.startDate, pushDays);
        const newEnd = addDays(newStart, duration);
        return {
          eventId: e.id,
          newStart,
          newEnd,
        };
      });
    },
    []
  );

  return { detectInsertPoint, calculatePushOffsets };
}
