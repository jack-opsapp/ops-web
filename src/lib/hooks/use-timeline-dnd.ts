/**
 * OPS Web - Timeline Drag-and-Drop Hook
 *
 * Manages all timeline (Gantt) drag interactions:
 * - Drag to move: reposition task blocks across days / team member rows
 * - Drop from unscheduled tray: accept data.type === 'unscheduled-task'
 * - Drop from project drawer: accept data.type === 'project-drawer-task'
 *
 * Edge-resize is handled locally inside TimelineTaskBlock (mousedown/move/up)
 * and committed through an `onResize` callback that calls useUpdateCalendarEvent.
 */

import { useCallback, useRef } from "react";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { addDays, differenceInCalendarDays } from "date-fns";
import { useCreateCalendarEvent, useUpdateCalendarEvent } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCalendarStore } from "@/stores/calendar-store";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import type { ProjectTask } from "@/lib/types/models";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UseTimelineDndOptions {
  events: InternalCalendarEvent[];
  startDate: Date;
  daysShown: number;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTimelineDnd({ events, startDate, daysShown }: UseTimelineDndOptions) {
  const { setDragState } = useCalendarStore();
  const { company } = useAuthStore();
  const updateMutation = useUpdateCalendarEvent();
  const createMutation = useCreateCalendarEvent();

  /** Ref to store the grid container width at drag start for pixel-to-day math */
  const gridWidthRef = useRef<number>(0);

  // ── Drag start ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const eventId = event.active.id as string;
      setDragState(eventId);

      // Measure the grid container width (the flex-1 area minus the gutter)
      // The droppable rows provide this via data.gridWidth — fall back to 0.
      const activeData = event.active.data?.current as Record<string, unknown> | undefined;
      if (activeData?.gridWidth) {
        gridWidthRef.current = activeData.gridWidth as number;
      }
    },
    [setDragState]
  );

  // ── Drag end ────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragState(null);

      const { active, over, delta } = event;
      const activeId = active.id as string;
      const activeData = active.data?.current as
        | {
            type?: string;
            event?: InternalCalendarEvent;
            task?: ProjectTask;
            gridWidth?: number;
          }
        | undefined;

      // Use over data to figure out target team member row
      const overData = over?.data?.current as
        | { type?: string; teamMemberId?: string; gridWidth?: number }
        | undefined;

      // Get grid width — prefer over (droppable) data, then active data, then ref
      const gridWidth =
        (overData?.gridWidth as number) ||
        (activeData?.gridWidth as number) ||
        gridWidthRef.current;

      // Calculate day column width in pixels
      const dayColumnWidth = gridWidth > 0 ? gridWidth / daysShown : 0;

      // ── Handle unscheduled-task drops ─────────────────────────────────
      if (
        activeData?.type === "unscheduled-task" &&
        activeData.task &&
        overData?.type === "timeline-row"
      ) {
        const task = activeData.task;
        if (!company?.id) return;

        // Calculate target day from horizontal drop offset
        const dayDelta = dayColumnWidth > 0 ? Math.round(delta.x / dayColumnWidth) : 0;
        const targetDate = addDays(startDate, Math.max(0, Math.min(dayDelta, daysShown - 1)));
        const targetEndDate = addDays(targetDate, 1); // Default 1-day duration

        createMutation.mutate({
          title: task.customTitle || task.taskType?.display || "Untitled Task",
          projectId: task.projectId,
          companyId: company.id,
          startDate: targetDate,
          endDate: targetEndDate,
          color: task.taskColor || "#59779F",
          teamMemberIds: overData.teamMemberId
            ? [overData.teamMemberId]
            : task.teamMemberIds,
          taskId: task.id,
        });
        return;
      }

      // ── Handle project-drawer-task drops ──────────────────────────────
      if (
        activeData?.type === "project-drawer-task" &&
        activeData.task &&
        overData?.type === "timeline-row"
      ) {
        const task = activeData.task;
        if (!company?.id) return;

        const dayDelta = dayColumnWidth > 0 ? Math.round(delta.x / dayColumnWidth) : 0;
        const targetDate = addDays(startDate, Math.max(0, Math.min(dayDelta, daysShown - 1)));
        const targetEndDate = addDays(targetDate, 1);

        createMutation.mutate({
          title: task.customTitle || task.taskType?.display || "Untitled Task",
          projectId: task.projectId,
          companyId: company.id,
          startDate: targetDate,
          endDate: targetEndDate,
          color: task.taskColor || "#59779F",
          teamMemberIds: overData.teamMemberId
            ? [overData.teamMemberId]
            : task.teamMemberIds,
          taskId: task.id,
        });
        return;
      }

      // ── Handle timeline-event drags (move) ────────────────────────────
      if (activeData?.type === "timeline-event" && activeData.event) {
        if (delta.x === 0 && delta.y === 0 && !overData?.teamMemberId) return;

        const calEvent = events.find((e) => e.id === activeData.event!.id);
        if (!calEvent) return;

        // Compute day delta from horizontal pixel movement
        const dayDelta = dayColumnWidth > 0 ? Math.round(delta.x / dayColumnWidth) : 0;

        // Preserve event duration
        const durationDays = differenceInCalendarDays(calEvent.endDate, calEvent.startDate);
        const newStart = addDays(calEvent.startDate, dayDelta);
        const newEnd = addDays(newStart, durationDays);

        // Determine if team member assignment changed
        const newTeamMemberIds =
          overData?.type === "timeline-row" && overData.teamMemberId
            ? [overData.teamMemberId]
            : undefined;

        // Don't update if nothing changed
        const dateUnchanged =
          newStart.getTime() === calEvent.startDate.getTime() &&
          newEnd.getTime() === calEvent.endDate.getTime();
        const memberUnchanged =
          !newTeamMemberIds ||
          (calEvent.teamMemberIds.length === 1 &&
            calEvent.teamMemberIds[0] === newTeamMemberIds[0]);

        if (dateUnchanged && memberUnchanged) return;

        updateMutation.mutate({
          id: calEvent.id,
          data: {
            startDate: newStart,
            endDate: newEnd,
            ...(newTeamMemberIds ? { teamMemberIds: newTeamMemberIds } : {}),
          },
        });
        return;
      }
    },
    [events, setDragState, updateMutation, createMutation, company?.id, startDate, daysShown]
  );

  // ── Drag cancel ─────────────────────────────────────────────────────────

  const handleDragCancel = useCallback(() => {
    setDragState(null);
  }, [setDragState]);

  return {
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
