"use client";

import { useMemo } from "react";
import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
} from "date-fns";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { WeekDayColumn } from "./week-day-column";

// ─── Props ──────────────────────────────────────────────────────────────────

interface WeekGridProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Week view — 7-column day stack (Mon–Sun).
 *
 * Phase 1 ships the all-day fallback: every column renders a vertical stack
 * of DayTaskCards for events scheduled that day (or spanning that day for
 * multi-day events).
 *
 * Drag-drop is owned by the calendar-wide CalendarDndShell — this grid only
 * hosts droppables (week-day per column) + draggables (week-event per card).
 * Cross-week drag falls out for free because the parent
 * WeekScrollContainer (and the shell above it) sees every panel's targets.
 */
export function WeekGrid({ currentDate, events }: WeekGridProps) {
  // Mon–Sun week
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 7-column grid */}
      <div className="flex flex-1 min-h-0">
        {weekDays.map((day) => (
          <WeekDayColumn
            key={day.toISOString()}
            day={day}
            events={events}
          />
        ))}
      </div>
    </div>
  );
}
