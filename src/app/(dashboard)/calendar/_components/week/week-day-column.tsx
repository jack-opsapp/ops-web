"use client";

import { useMemo } from "react";
import { format, isToday, isWeekend, isSameDay, differenceInCalendarDays } from "date-fns";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { DayTaskCard } from "../day/day-task-card";

// ── Props ──────────────────────────────────────────────────────────────────

interface WeekDayColumnProps {
  day: Date;
  events: InternalCalendarEvent[];
  /**
   * Bottom-edge resize callback — passed through to each DayTaskCard so the
   * user can extend / shrink an event's duration in whole-day increments.
   * The WeekGrid owns the recurrence-aware mutation path and provides this
   * callback via useCalendarResize.
   */
  onCardResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
}

// ── Draggable card wrapper ──────────────────────────────────────────────

function DraggableWeekCard({
  event,
  index,
  onResize,
}: {
  event: InternalCalendarEvent;
  index: number;
  onResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
}) {
  const locked =
    event.statusKey === "completed" || event.statusKey === "cancelled";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `week-event-${event.id}`,
    data: { type: "week-event", event },
    disabled: locked,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: 0.6,
        zIndex: 100,
      }
    : isDragging
      ? { opacity: 0.4 }
      : {};

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DayTaskCard event={event} index={index} onResize={onResize} />
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function WeekDayColumn({ day, events, onCardResize }: WeekDayColumnProps) {
  const today = isToday(day);
  const weekend = isWeekend(day);

  // Filter events that start on this day (or overlap with this day for multi-day)
  const dayEvents = useMemo(() => {
    return events
      .filter((event) => {
        // Single-day: event starts on this day
        if (isSameDay(event.startDate, event.endDate)) {
          return isSameDay(event.startDate, day);
        }
        // Multi-day: event spans this day (start ≤ day ≤ end)
        const dayStart = differenceInCalendarDays(event.startDate, day);
        const dayEnd = differenceInCalendarDays(event.endDate, day);
        return dayStart <= 0 && dayEnd >= 0;
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [events, day]);

  // ── Droppable target ──
  const { setNodeRef, isOver } = useDroppable({
    id: `week-day-${day.toISOString()}`,
    data: { type: "week-day", day },
  });

  return (
    <div
      ref={setNodeRef}
      className="relative flex flex-col min-h-0"
      style={{
        flex: "1 0 0",
        opacity: weekend ? 0.85 : 1,
        background: isOver
          ? "rgba(111, 148, 176, 0.10)"
          : today
            ? "rgba(111, 148, 176, 0.06)"
            : "transparent",
        borderRight: "1px solid var(--line)",
        // Today column: 2px accent top border (T14 — today indicator signal #2)
        borderTop: today ? "2px solid var(--ops-accent)" : "2px solid transparent",
        transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* Column header */}
      <div
        className="shrink-0 px-[10px] py-[10px] flex items-center gap-[8px]"
        style={{
          borderBottom: "1px solid var(--line)",
          minHeight: 56,
        }}
      >
        <div className="flex flex-col">
          <span
            className="font-mohave"
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              lineHeight: 1.2,
            }}
          >
            {format(day, "EEE")}
          </span>

          {today ? (
            <span
              className="inline-flex items-center justify-center font-cakemono font-light mt-[3px]"
              style={{
                width: 24,
                height: 24,
                background: "var(--ops-accent)",
                color: "#000",
                fontSize: 13,
                borderRadius: 4,
                letterSpacing: 0,
              }}
            >
              {format(day, "d")}
            </span>
          ) : (
            <span
              className="font-cakemono font-light leading-tight mt-[1px]"
              style={{
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {format(day, "d")}
            </span>
          )}
        </div>

        {dayEvents.length > 0 && (
          <span
            className="ml-auto font-mono text-micro tabular-nums"
            style={{
              color: "var(--text-3)",
              fontFeatureSettings: '"tnum" 1, "zero" 1',
            }}
          >
            {`[${dayEvents.length}]`}
          </span>
        )}
      </div>

      {/* Card stack */}
      <div className="flex-1 overflow-y-auto min-h-0 px-[8px] py-[10px]">
        {dayEvents.length === 0 ? (
          <div className="pt-[24px]">
            <span
              className="font-mono text-[10px] uppercase tracking-wider"
              style={{ color: "var(--text-mute)" }}
            >
              —
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-[6px]">
            {dayEvents.map((event, idx) => (
              <DraggableWeekCard
                key={event.id}
                event={event}
                index={idx}
                onResize={onCardResize}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
