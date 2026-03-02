"use client";

import { useRef, useEffect } from "react";
import { format, isToday, getHours } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { HOURS, HOUR_HEIGHT, FIRST_HOUR } from "@/lib/utils/calendar-constants";
import {
  type InternalCalendarEvent,
  formatHour,
  getEventsForDay,
} from "@/lib/utils/calendar-utils";
import { TimeGridColumn } from "./time-grid-column";

interface CalendarGridDayProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  conflictIds?: Set<string>;
  onEventClick?: (event: InternalCalendarEvent) => void;
  onEventContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
  onEventResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
  onEmptySlotClick?: (date: Date, clientX: number, clientY: number) => void;
  onRangeSelect?: (startDate: Date, endDate: Date, clientX: number, clientY: number) => void;
  selectedEventId?: string | null;
  t: (key: string) => string;
}

export function CalendarGridDay({
  currentDate,
  events,
  conflictIds,
  onEventClick,
  onEventContextMenu,
  onEventResize,
  onEmptySlotClick,
  onRangeSelect,
  selectedEventId,
  t,
}: CalendarGridDayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayEvents = getEventsForDay(events, currentDate);
  const dayIsToday = isToday(currentDate);

  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const hour = getHours(now);
      const scrollTo = Math.max(0, (hour - 7) * HOUR_HEIGHT);
      scrollRef.current.scrollTop = scrollTo;
    }
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Day header */}
      <div
        className={cn(
          "px-2 py-1.5 border-b border-border shrink-0 flex items-center justify-between",
          dayIsToday && "bg-ops-accent-muted/15"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "font-mohave text-heading text-text-primary",
              dayIsToday && "text-ops-accent"
            )}
          >
            {format(currentDate, "EEEE")}
          </span>
          <span className="font-mono text-data text-text-secondary">
            {format(currentDate, "MMMM d, yyyy")}
          </span>
          {dayIsToday && (
            <span className="font-kosugi text-[10px] text-ops-accent bg-ops-accent-muted px-[8px] py-[2px] rounded-sm uppercase tracking-widest ml-[4px]">
              {t("today")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-data-sm text-text-tertiary">
            {(dayEvents.length !== 1 ? t("eventCountPlural") : t("eventCount")).replace("{count}", String(dayEvents.length))}
          </span>
        </div>
      </div>

      {/* Scrollable time grid — always show grid so users can click to create */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-[56px_1fr]">
          {/* Time gutter */}
          <div className="relative border-r border-border-subtle" style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-start justify-end pr-[6px]"
                style={{ top: `${(hour - FIRST_HOUR) * HOUR_HEIGHT}px` }}
              >
                <span className="font-mono text-[11px] text-text-disabled -mt-[6px] select-none">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Single day column */}
          <div>
            <TimeGridColumn
              day={currentDate}
              events={events}
              isToday={dayIsToday}
              showFullDetail
              conflictIds={conflictIds}
              onEventClick={onEventClick}
              onEventContextMenu={onEventContextMenu}
              onEventResize={onEventResize}
              onEmptyClick={(date, x, y) => onEmptySlotClick?.(date, x, y)}
              onRangeSelect={onRangeSelect}
              selectedEventId={selectedEventId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
