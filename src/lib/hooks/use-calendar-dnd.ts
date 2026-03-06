/**
 * OPS Web - Calendar Drag-and-Drop Hook
 *
 * Handles DnD state, 15-min snap logic, and optimistic updates for calendar events.
 * Supports dragging existing events to reschedule and dropping unscheduled tasks to schedule.
 */

import { useCallback } from "react";
import type { DragStartEvent, DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import { addMinutes, differenceInMinutes, setHours, setMinutes } from "date-fns";
import { useCreateCalendarEvent, useUpdateCalendarEvent } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCalendarStore } from "@/stores/calendar-store";
import { HOUR_HEIGHT } from "@/lib/utils/calendar-constants";
import {
  type InternalCalendarEvent,
  snapToGrid,
} from "@/lib/utils/calendar-utils";
import type { ProjectTask } from "@/lib/types/models";

interface UseCalendarDndOptions {
  events: InternalCalendarEvent[];
}

export function useCalendarDnd({ events }: UseCalendarDndOptions) {
  const { setDragState } = useCalendarStore();
  const { company } = useAuthStore();
  const updateMutation = useUpdateCalendarEvent();
  const createMutation = useCreateCalendarEvent();

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const eventId = event.active.id as string;
      setDragState(eventId);
    },
    [setDragState]
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, delta } = event;
      const activeId = active.id as string;
      const calEvent = events.find((e) => e.id === activeId);
      if (!calEvent) return;

      const durationMinutes = differenceInMinutes(calEvent.endDate, calEvent.startDate);

      const deltaMinutes = (delta.y / HOUR_HEIGHT) * 60;

      const rawNewStart = addMinutes(calEvent.startDate, deltaMinutes);
      const newStart = snapToGrid(rawNewStart);

      setDragState(activeId, { date: newStart, duration: durationMinutes });
    },
    [events, setDragState]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragState(null);

      const { active, delta } = event;
      const activeId = active.id as string;
      const activeData = active.data?.current as
        | { event?: InternalCalendarEvent; type?: string; task?: ProjectTask }
        | undefined;

      // ── Handle unscheduled task drops ──────────────────────────────
      if (activeId.startsWith("unscheduled-") && activeData?.task) {
        const task = activeData.task;
        if (!company?.id) return;

        // Compute the drop time from vertical delta relative to 9 AM default
        const pixelDeltaMinutes = (delta.y / HOUR_HEIGHT) * 60;
        const defaultStart = new Date();
        setHours(defaultStart, 9);
        setMinutes(defaultStart, 0);
        const dropTime = snapToGrid(addMinutes(defaultStart, pixelDeltaMinutes));
        const dropEnd = addMinutes(dropTime, 60); // Default 1hr duration

        createMutation.mutate({
          title: task.customTitle || task.taskType?.display || "Untitled Task",
          projectId: task.projectId,
          companyId: company.id,
          startDate: dropTime,
          endDate: dropEnd,
          color: task.taskColor || "#59779F",
          teamMemberIds: task.teamMemberIds,
          taskId: task.id,
        });
        return;
      }

      // ── Handle existing event drags ───────────────────────────────
      if (delta.y === 0 && delta.x === 0) return;

      const calEvent = events.find((e) => e.id === activeId);
      if (!calEvent) return;

      // Preserve event duration
      const durationMinutes = differenceInMinutes(calEvent.endDate, calEvent.startDate);

      // Convert pixel delta to time delta
      const deltaMinutes = (delta.y / HOUR_HEIGHT) * 60;

      // Apply time delta to original start, then snap
      const rawNewStart = addMinutes(calEvent.startDate, deltaMinutes);
      const newStart = snapToGrid(rawNewStart);
      const newEnd = addMinutes(newStart, durationMinutes);

      // Don't update if nothing changed
      if (
        newStart.getTime() === calEvent.startDate.getTime() &&
        newEnd.getTime() === calEvent.endDate.getTime()
      ) {
        return;
      }

      updateMutation.mutate({
        id: activeId,
        data: {
          startDate: newStart,
          endDate: newEnd,
        },
      });
    },
    [events, setDragState, updateMutation, createMutation, company?.id]
  );

  const handleDragCancel = useCallback(() => {
    setDragState(null);
  }, [setDragState]);

  return {
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}
