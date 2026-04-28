"use client";

import { useCallback, useMemo } from "react";
import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  differenceInCalendarDays,
  addDays,
} from "date-fns";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import type { ProjectTask } from "@/lib/types/models";
import { useUpdateTask, useTasks, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
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
 * multi-day events). When Phase 3 lands and any event has allDay=false, the
 * grid switches to an hourly variant. That switch is owned by Phase 3.
 *
 * Drag-drop:
 *   - week-event: existing scheduled card → another column → reschedules the
 *     start_date (and end_date by the same delta to preserve duration).
 *   - unscheduled-task: from the unscheduled tray → schedules into the column
 *     (sets start_date; preserves duration via stored value).
 */
export function WeekGrid({ currentDate, events }: WeekGridProps) {
  // Mon–Sun week
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

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
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragEnd = useCallback(
    async (dragEvent: DragEndEvent) => {
      const { active, over } = dragEvent;
      if (!over) return;

      const activeData = active.data?.current as
        | { type?: string; event?: InternalCalendarEvent; task?: { id: string; duration: number } }
        | undefined;
      const overData = over.data?.current as
        | { type?: string; day?: Date }
        | undefined;

      if (overData?.type !== "week-day" || !overData.day) return;
      const targetDay = overData.day;

      // ── Reschedule existing scheduled event ──────────────────────────
      if (activeData?.type === "week-event" && activeData.event) {
        const calEvent = activeData.event;
        const eventStart = calEvent.startDate instanceof Date
          ? calEvent.startDate
          : new Date(calEvent.startDate);
        const eventEnd = calEvent.endDate instanceof Date
          ? calEvent.endDate
          : new Date(calEvent.endDate);

        const dayDelta = differenceInCalendarDays(targetDay, eventStart);
        if (dayDelta === 0) return;

        const newStart = addDays(eventStart, dayDelta);
        const newEnd = addDays(eventEnd, dayDelta);

        // Phase 3 — series-aware drag.
        const sourceTask = tasksById.get(calEvent.id);
        if (sourceTask?.recurrenceId) {
          const scope = await recurrencePrompt.request({
            description: "Move this occurrence, or shift the entire series?",
          });
          if (!scope) return;
          recurrenceEdit.mutate(
            {
              task: sourceTask,
              scope,
              patch: { startDate: newStart, endDate: newEnd },
            },
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
          { id: calEvent.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error("Failed to move task", { description: err.message }),
          }
        );
        return;
      }

      // ── Schedule from unscheduled tray ───────────────────────────────
      if (activeData?.type === "unscheduled-task" && activeData.task) {
        const task = activeData.task;
        const duration = Math.max(task.duration ?? 1, 1);
        const newStart = targetDay;
        const newEnd = addDays(newStart, duration);

        updateTask.mutate(
          { id: task.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error("Failed to schedule task", { description: err.message }),
          }
        );
        return;
      }

      // ── Schedule from project drawer ────────────────────────────────
      if (activeData?.type === "project-drawer-task" && activeData.task) {
        const task = activeData.task;
        const duration = Math.max(task.duration ?? 1, 1);
        const newStart = targetDay;
        const newEnd = addDays(newStart, duration);

        updateTask.mutate(
          { id: task.id, data: { startDate: newStart, endDate: newEnd } },
          {
            onError: (err) =>
              toast.error("Failed to schedule task", { description: err.message }),
          }
        );
        return;
      }
    },
    [updateTask, recurrenceEdit, recurrencePrompt, tasksById]
  );

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
        {/* Phase 3 — recurrence scope prompt */}
        {recurrencePrompt.promptElement}
      </div>
    </DndContext>
  );
}
