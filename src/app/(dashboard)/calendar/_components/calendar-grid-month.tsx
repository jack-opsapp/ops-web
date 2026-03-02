"use client";

import { useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
} from "date-fns";
import { cn } from "@/lib/utils/cn";
import {
  type InternalCalendarEvent,
  getEventsForDay,
} from "@/lib/utils/calendar-utils";
import { EventBlockMonth } from "./event-block-month";

interface CalendarGridMonthProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onSelectDate: (date: Date) => void;
  onEventClick?: (event: InternalCalendarEvent) => void;
  t: (key: string) => string;
}

export function CalendarGridMonth({
  currentDate,
  events,
  onSelectDate,
  onEventClick,
  t,
}: CalendarGridMonthProps) {
  const dayNames = useMemo(
    () => [
      t("dayNames.sun"), t("dayNames.mon"), t("dayNames.tue"), t("dayNames.wed"),
      t("dayNames.thu"), t("dayNames.fri"), t("dayNames.sat"),
    ],
    [t]
  );

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const weeks = Math.ceil(days.length / 7);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border shrink-0">
        {dayNames.map((day) => (
          <div
            key={day}
            className="px-1 py-[10px] text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-[0.15em]"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        className="grid grid-cols-7 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${weeks}, 1fr)` }}
      >
        {days.map((day, i) => {
          const dayEvents = getEventsForDay(events, day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <div
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "border-b border-r border-border-subtle p-[6px] cursor-pointer transition-all duration-150 relative overflow-hidden group",
                "hover:bg-background-elevated/30",
                !isCurrentMonth && "opacity-30",
                isWeekend && isCurrentMonth && "bg-background-panel/50",
                isCurrentDay && "bg-ops-accent-muted/30"
              )}
              style={
                isCurrentDay
                  ? {
                      boxShadow:
                        "inset 0 0 20px rgba(65, 115, 148, 0.12), 0 0 8px rgba(65, 115, 148, 0.08)",
                    }
                  : undefined
              }
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-[4px]">
                <span
                  className={cn(
                    "font-mono text-data-sm transition-all duration-150",
                    isCurrentDay
                      ? "w-[26px] h-[26px] rounded-full bg-ops-accent text-white flex items-center justify-center text-[13px] font-semibold shadow-glow-accent"
                      : "text-text-secondary w-[26px] h-[26px] flex items-center justify-center"
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayEvents.length > 0 && !isCurrentDay && (
                  <span className="font-mono text-[9px] text-text-disabled">
                    {dayEvents.length}
                  </span>
                )}
              </div>

              {/* Events */}
              <div className="space-y-[2px]">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventBlockMonth
                    key={event.id}
                    event={event}
                    onClick={onEventClick}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <span className="font-mono text-[10px] text-ops-accent px-[6px] hover:underline">
                    {t("moreEvents").replace("{count}", String(dayEvents.length - 3))}
                  </span>
                )}
              </div>

              {/* Hover indicator */}
              <div className="absolute inset-0 border border-transparent group-hover:border-ops-accent/20 rounded-sm pointer-events-none transition-colors duration-150" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
