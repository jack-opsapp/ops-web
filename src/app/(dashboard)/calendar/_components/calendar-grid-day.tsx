"use client";

import { useCallback, useMemo } from "react";
import { format, isToday } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import {
  type InternalCalendarEvent,
  getEventsForDay,
} from "@/lib/utils/calendar-utils";
import { DayTaskCard } from "./day/day-task-card";
import { DayHourlyGrid } from "./day/day-hourly-grid";
import { useCalendarResize } from "./use-calendar-resize";

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

// ── Draggable list-mode card wrapper ───────────────────────────────────────

function DraggableDayListCard({
  event,
  index,
  onResize,
}: {
  event: InternalCalendarEvent;
  index: number;
  onResize: (event: InternalCalendarEvent, newEndDate: Date) => void;
}) {
  const locked =
    event.statusKey === "completed" || event.statusKey === "cancelled";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `day-list-event-${event.id}`,
      data: { type: "day-list-event", event },
      disabled: locked,
    });

  const style: React.CSSProperties = transform
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

export function CalendarGridDay({
  currentDate,
  events,
  onEventClick,
  t,
}: CalendarGridDayProps) {
  const dayIsToday = isToday(currentDate);

  // ── Filter and sort events for this day ───────────────────────────────

  const dayEvents = useMemo(() => {
    const filtered = getEventsForDay(events, currentDate);
    return [...filtered].sort((a, b) => {
      const timeDiff = a.startDate.getTime() - b.startDate.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.title.localeCompare(b.title);
    });
  }, [events, currentDate]);

  // Phase 3 — switch to hourly mode when at least one event is timed.
  const hasTimedEvents = useMemo(
    () => dayEvents.some((e) => !e.allDay),
    [dayEvents]
  );

  // ── Task count label ──────────────────────────────────────────────────

  const taskCountLabel = useMemo(() => {
    const count = dayEvents.length;
    const template = count !== 1 ? t("eventCountPlural") : t("eventCount");
    return template.replace("{count}", String(count));
  }, [dayEvents.length, t]);

  // ── Day-level droppable: every panel is a drop target keyed by its day,
  //    so cross-day drag in the horizontal scroll container can land here
  //    regardless of hourly vs list rendering. ────────────────────────────
  const { setNodeRef: setDayDroppableRef, isOver } = useDroppable({
    id: `day-cell-${currentDate.toISOString()}`,
    data: { type: "day-cell", day: currentDate },
  });

  const handleEventClick = useCallback(
    (event: InternalCalendarEvent) => {
      onEventClick?.(event);
    },
    [onEventClick]
  );

  // ── Resize commit (list-mode all-day cards) ──────────────────────────
  const { commitResize, promptElement: resizePromptElement } =
    useCalendarResize();
  const handleListResize = useCallback(
    (event: InternalCalendarEvent, newEndDate: Date) => {
      commitResize(event, { endDate: newEndDate });
    },
    [commitResize]
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={setDayDroppableRef}
      className="flex flex-col flex-1 min-h-0"
      style={{
        background: isOver ? "rgba(111, 148, 176, 0.06)" : undefined,
        transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
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

      {/* Phase 3: hourly mode when any event is timed; otherwise legacy list */}
      {hasTimedEvents ? (
        <DayHourlyGrid
          currentDate={currentDate}
          events={dayEvents}
          onEventClick={handleEventClick}
        />
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 px-[16px] py-[12px]">
          <AnimatePresence mode="wait">
            {dayEvents.length === 0 ? (
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
              <div className="flex flex-col gap-[8px]" key="cards">
                {dayEvents.map((event, index) => (
                  <DraggableDayListCard
                    key={event.id}
                    event={event}
                    index={index}
                    onResize={handleListResize}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>
      )}
      {resizePromptElement}
    </div>
  );
}
