"use client";

import { useMemo } from "react";
import { format, isToday } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import {
  type InternalCalendarEvent,
  getEventsForDay,
} from "@/lib/utils/calendar-utils";
import { DayTaskCard } from "./day/day-task-card";

// ── Props ──────────────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────

export function CalendarGridDay({
  currentDate,
  events,
  t,
}: CalendarGridDayProps) {
  const dayIsToday = isToday(currentDate);

  // ── Filter and sort events for this day ───────────────────────────────

  const dayEvents = useMemo(() => {
    const filtered = getEventsForDay(events, currentDate);
    // Sort by start time, then by title for consistent ordering
    return [...filtered].sort((a, b) => {
      const timeDiff = a.startDate.getTime() - b.startDate.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.title.localeCompare(b.title);
    });
  }, [events, currentDate]);

  // ── Task count label ──────────────────────────────────────────────────

  const taskCountLabel = useMemo(() => {
    const count = dayEvents.length;
    const template = count !== 1 ? t("eventCountPlural") : t("eventCount");
    return template.replace("{count}", String(count));
  }, [dayEvents.length, t]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Day header. Today indicator: TODAY badge with solid accent fill, black text. */}
      <div
        className="px-[16px] py-[14px] border-b shrink-0 flex items-start justify-between"
        style={{
          borderColor: "var(--line)",
          // Today: 2px accent top border on the day header (signal #2)
          borderTop: dayIsToday ? "2px solid var(--ops-accent)" : "2px solid transparent",
        }}
      >
        {/* Left: Day name + date + TODAY badge */}
        <div className="flex flex-col">
          <div className="flex items-center gap-[8px]">
            <span
              className={cn(
                "font-cakemono font-light text-[22px] leading-tight uppercase"
              )}
              style={{ color: "var(--text)" }}
            >
              {format(currentDate, "EEEE")}
            </span>
            {dayIsToday && (
              <span
                className="font-cakemono font-light leading-tight uppercase"
                style={{
                  color: "#000",
                  background: "var(--ops-accent)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                }}
              >
                TODAY
              </span>
            )}
          </div>
          <span
            className="font-mono text-[12px] uppercase tracking-wider mt-[2px] leading-tight"
            style={{ color: "var(--text-3)" }}
          >
            {format(currentDate, "MMMM d, yyyy").toUpperCase()}
          </span>
        </div>

        {/* Right: Task count */}
        <div className="flex items-center mt-[4px]">
          <span
            className="font-mono text-[12px] uppercase tracking-wider leading-tight"
            style={{ color: "#999999" }}
          >
            {taskCountLabel}
          </span>
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-[16px] py-[12px]">
        <AnimatePresence mode="wait">
          {dayEvents.length === 0 ? (
            /* Empty state */
            <div
              className="flex items-center justify-start pt-[48px]"
              key="empty"
            >
              <span
                className="font-mono text-[12px] uppercase tracking-wider"
                style={{ color: "rgba(255, 255, 255, 0.30)" }}
              >
                NO TASKS SCHEDULED
              </span>
            </div>
          ) : (
            /* Card list */
            <div className="flex flex-col gap-[8px]" key="cards">
              {dayEvents.map((event, index) => (
                <DayTaskCard
                  key={event.id}
                  event={event}
                  index={index}
                />
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
