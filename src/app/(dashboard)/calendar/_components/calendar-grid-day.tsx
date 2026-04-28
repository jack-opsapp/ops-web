"use client";

import { useCallback, useMemo } from "react";
import { format, isToday } from "date-fns";
import { AnimatePresence } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import {
  type InternalCalendarEvent,
  getEventsForDay,
} from "@/lib/utils/calendar-utils";
import { HOUR_HEIGHT } from "@/lib/utils/calendar-constants";
import { DayTaskCard } from "./day/day-task-card";
import { DayHourlyGrid } from "./day/day-hourly-grid";
import { useTasks, useUpdateTask, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
import type { ProjectTask } from "@/lib/types/models";
import { toast } from "sonner";

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
  onEventClick,
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

  // ── DnD for hourly mode (drag = vertical reschedule with 15-min snap) ─

  const updateTask = useUpdateTask();
  const recurrenceEdit = useRecurrenceEdit();
  const recurrencePrompt = useRecurrenceEditPrompt();
  const { data: taskData } = useTasks();
  const tasksById = useMemo(() => {
    const map = new Map<string, ProjectTask>();
    for (const t of taskData?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [taskData]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const data = e.active.data?.current as
        | { type?: string; event?: InternalCalendarEvent }
        | undefined;
      if (data?.type !== "day-hourly-event" || !data.event) return;
      const event = data.event;

      // Snap pixel delta → minutes (15-min increments).
      const SNAP_MIN = 15;
      const PX_PER_MIN = HOUR_HEIGHT / 60;
      const SNAP_PX = SNAP_MIN * PX_PER_MIN;
      const snappedY = Math.round(e.delta.y / SNAP_PX) * SNAP_PX;
      const minutes = Math.round(snappedY / PX_PER_MIN);
      if (minutes === 0) return;

      const newStart = new Date(event.startDate.getTime() + minutes * 60_000);
      const newEnd = new Date(event.endDate.getTime() + minutes * 60_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

      const patch: Partial<ProjectTask> = {
        startDate: newStart,
        endDate: newEnd,
        startTime: fmt(newStart),
        endTime: fmt(newEnd),
      };

      const sourceTask = tasksById.get(event.id);
      if (sourceTask?.recurrenceId) {
        const scope = await recurrencePrompt.request({
          description: "Move this occurrence, or shift the entire series?",
        });
        if (!scope) return;
        recurrenceEdit.mutate(
          { task: sourceTask, scope, patch },
          {
            onError: (err) =>
              toast.error("Failed to move recurring task", {
                description: err.message,
              }),
          }
        );
        return;
      }
      updateTask.mutate(
        { id: event.id, data: patch },
        {
          onError: (err) =>
            toast.error("Failed to move task", { description: err.message }),
        }
      );
    },
    [tasksById, updateTask, recurrenceEdit, recurrencePrompt]
  );

  const handleEventClick = useCallback(
    (event: InternalCalendarEvent) => {
      onEventClick?.(event);
    },
    [onEventClick]
  );

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

      {/* Phase 3: hourly mode when any event is timed; otherwise legacy list */}
      {hasTimedEvents ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <DayHourlyGrid
            currentDate={currentDate}
            events={dayEvents}
            onEventClick={handleEventClick}
          />
          {recurrencePrompt.promptElement}
        </DndContext>
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
      )}
    </div>
  );
}
