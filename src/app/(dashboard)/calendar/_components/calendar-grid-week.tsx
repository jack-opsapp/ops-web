"use client";

import { useRef, useEffect } from "react";
import {
  addDays,
  startOfWeek,
  format,
  isToday,
  getHours,
} from "date-fns";
import { cn } from "@/lib/utils/cn";
import { HOURS, HOUR_HEIGHT, FIRST_HOUR } from "@/lib/utils/calendar-constants";
import {
  type InternalCalendarEvent,
  formatHour,
  getEventsForDay,
} from "@/lib/utils/calendar-utils";
import { TimeGridColumn } from "./time-grid-column";

interface CalendarGridWeekProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  conflictIds?: Set<string>;
  onSelectDate: (date: Date) => void;
  onEventClick?: (event: InternalCalendarEvent) => void;
  onEventContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
  onEventResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
  onEmptySlotClick?: (date: Date, clientX: number, clientY: number) => void;
  onRangeSelect?: (startDate: Date, endDate: Date, clientX: number, clientY: number) => void;
  selectedEventId?: string | null;
  t: (key: string) => string;
}

export function CalendarGridWeek({
  currentDate,
  events,
  conflictIds,
  onSelectDate,
  onEventClick,
  onEventContextMenu,
  onEventResize,
  onEmptySlotClick,
  onRangeSelect,
  selectedEventId,
  t,
}: CalendarGridWeekProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(currentDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

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
      {/* Day headers — sticky */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border shrink-0">
        <div className="border-r border-border-subtle" />
        {weekDays.map((day, i) => {
          const dayIsToday = isToday(day);
          const dayEventCount = getEventsForDay(events, day).length;

          return (
            <div
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "px-[6px] py-[8px] text-center border-r border-border-subtle cursor-pointer transition-all duration-150",
                "hover:bg-background-elevated/30",
                dayIsToday && "bg-ops-accent-muted/20"
              )}
            >
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-[0.12em] block">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "font-mono text-data mt-[3px] inline-flex items-center justify-center",
                  dayIsToday
                    ? "w-[30px] h-[30px] rounded-full bg-ops-accent text-white shadow-glow-accent font-semibold"
                    : "text-text-primary w-[30px] h-[30px]"
                )}
              >
                {format(day, "d")}
              </span>
              {dayEventCount > 0 && (
                <span
                  className={cn(
                    "block font-mono text-[9px] mt-[2px]",
                    dayIsToday ? "text-ops-accent" : "text-text-disabled"
                  )}
                >
                  {(dayEventCount !== 1 ? t("eventCountPlural") : t("eventCount")).replace("{count}", String(dayEventCount))}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          {/* Time gutter */}
          <div className="relative border-r border-border-subtle" style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-start justify-end pr-[6px]"
                style={{ top: `${(hour - FIRST_HOUR) * HOUR_HEIGHT}px` }}
              >
                <span className="font-mono text-[10px] text-text-disabled -mt-[6px] select-none">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day, i) => (
            <div key={i} className="border-r border-border-subtle">
              <TimeGridColumn
                day={day}
                events={events}
                isToday={isToday(day)}
                conflictIds={conflictIds}
                onEventClick={onEventClick}
                onEventContextMenu={onEventContextMenu}
                onEventResize={onEventResize}
                onEmptyClick={(date, x, y) => onEmptySlotClick?.(date, x, y)}
                onRangeSelect={onRangeSelect}
                selectedEventId={selectedEventId}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
