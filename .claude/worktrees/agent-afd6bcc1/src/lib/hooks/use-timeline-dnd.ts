/**
 * OPS Web - Timeline Drag-and-Drop Hook
 *
 * Manages all timeline (Gantt) drag interactions:
 * - Drag to move: reposition task blocks across days / team member rows
 * - Drop from unscheduled tray: accept data.type === 'unscheduled-task'
 * - Drop from project drawer: accept data.type === 'project-drawer-task'
 * - Dependency enforcement: validates moves against dependency constraints
 * - Smart insert: detects insert-between scenarios and cascades push offsets
 *
 * Edge-resize is handled locally inside TimelineTaskBlock (mousedown/move/up)
 * and committed through an `onResize` callback that calls useUpdateTask.
 */

import { useCallback, useEffect, useRef } from "react";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { addDays, differenceInCalendarDays, isAfter } from "date-fns";
import { toast } from "sonner";
import { useCreateTask, useUpdateTask } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCalendarStore } from "@/stores/calendar-store";
import { useCascade } from "@/lib/hooks/use-cascade";
import { useSmartInsert } from "@/lib/hooks/use-smart-insert";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import type { ProjectTask } from "@/lib/types/models";
import type { SchedulableTask } from "@/lib/types/scheduling";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UseTimelineDndOptions {
  events: InternalCalendarEvent[];
  startDate: Date;
  daysShown: number;
  /** All project tasks converted to SchedulableTask for dependency checking */
  schedulableTasks?: SchedulableTask[];
  /** Whether the company skips weekends in scheduling */
  skipWeekends?: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTimelineDnd({
  events,
  startDate,
  daysShown,
  schedulableTasks = [],
  skipWeekends = false,
}: UseTimelineDndOptions) {
  const { setDragState } = useCalendarStore();
  const { company } = useAuthStore();
  const updateMutation = useUpdateTask();
  const createMutation = useCreateTask();
  const { previewCascade } = useCascade();
  const { detectInsertPoint, calculatePushOffsets } = useSmartInsert();

  /** Ref to store the grid container width at drag start for pixel-to-day math */
  const gridWidthRef = useRef<number>(0);

  /** Track whether Alt key is held during drop (bypass dependency enforcement) */
  const altKeyRef = useRef<boolean>(false);

  // ── Alt key tracking ────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.altKey) {
        altKeyRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" || !e.altKey) {
        altKeyRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ── Dependency violation check ──────────────────────────────────────────

  /**
   * Checks if moving a task to newStart violates any dependency constraints.
   * Returns the name of the violated predecessor if found, null otherwise.
   */
  const checkDependencyViolation = useCallback(
    (
      taskId: string,
      newStart: Date
    ): { violated: boolean; predecessorName: string; taskName: string } | null => {
      if (schedulableTasks.length === 0) return null;

      const task = schedulableTasks.find((t) => t.id === taskId);
      if (!task || task.effectiveDependencies.length === 0) return null;

      for (const dep of task.effectiveDependencies) {
        // Find all predecessor tasks matching this dependency's task type
        const predecessors = schedulableTasks.filter(
          (t) => t.taskTypeId === dep.depends_on_task_type_id
        );

        for (const pred of predecessors) {
          if (!pred.startDate || !pred.endDate) continue;

          // Calculate the earliest allowed start for the dependent task
          const clampedOverlap = Math.max(0, Math.min(100, dep.overlap_percentage));
          const completedFraction = (100 - clampedOverlap) / 100;
          const daysToWait = Math.ceil(pred.duration * completedFraction);
          const earliestAllowed = addDays(pred.startDate, daysToWait);

          // If the new start is before the earliest allowed, it's a violation
          if (isAfter(earliestAllowed, newStart)) {
            // Look up display names from the events array
            const predEvent = events.find((e) => e.id === pred.id);
            const taskEvent = events.find((e) => e.id === task.id);

            return {
              violated: true,
              predecessorName: predEvent?.title ?? pred.taskTypeId,
              taskName: taskEvent?.title ?? task.taskTypeId,
            };
          }
        }
      }

      return null;
    },
    [schedulableTasks, events]
  );

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

        // Smart insert: check if dropping between existing events
        if (overData.teamMemberId) {
          const insertPoint = detectInsertPoint(
            task.id,
            overData.teamMemberId,
            targetDate,
            events,
            startDate,
            daysShown
          );

          if (insertPoint && insertPoint.after) {
            const pushOffsets = calculatePushOffsets(
              1, // Default 1-day duration for new tasks
              insertPoint.before,
              insertPoint.after,
              events,
              overData.teamMemberId
            );

            // Apply push offsets to surrounding events
            for (const offset of pushOffsets) {
              updateMutation.mutate({
                id: offset.eventId,
                data: { startDate: offset.newStart, endDate: offset.newEnd },
              });
            }
          }
        }

        createMutation.mutate({
          customTitle: task.customTitle || task.taskType?.display || "Untitled Task",
          projectId: task.projectId,
          companyId: company.id,
          taskTypeId: task.taskTypeId || task.taskType?.id || "",
          startDate: targetDate,
          endDate: targetEndDate,
          taskColor: task.taskColor || "#59779F",
          teamMemberIds: overData.teamMemberId
            ? [overData.teamMemberId]
            : task.teamMemberIds,
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

        // Smart insert: check if dropping between existing events
        if (overData.teamMemberId) {
          const insertPoint = detectInsertPoint(
            task.id,
            overData.teamMemberId,
            targetDate,
            events,
            startDate,
            daysShown
          );

          if (insertPoint && insertPoint.after) {
            const pushOffsets = calculatePushOffsets(
              1,
              insertPoint.before,
              insertPoint.after,
              events,
              overData.teamMemberId
            );

            for (const offset of pushOffsets) {
              updateMutation.mutate({
                id: offset.eventId,
                data: { startDate: offset.newStart, endDate: offset.newEnd },
              });
            }
          }
        }

        createMutation.mutate({
          customTitle: task.customTitle || task.taskType?.display || "Untitled Task",
          projectId: task.projectId,
          companyId: company.id,
          taskTypeId: task.taskTypeId || task.taskType?.id || "",
          startDate: targetDate,
          endDate: targetEndDate,
          taskColor: task.taskColor || "#59779F",
          teamMemberIds: overData.teamMemberId
            ? [overData.teamMemberId]
            : task.teamMemberIds,
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

        // ── Dependency enforcement ────────────────────────────────────
        // Check if the new position violates dependency constraints.
        // Alt key held during drop skips enforcement.
        if (!altKeyRef.current && schedulableTasks.length > 0) {
          const violation = checkDependencyViolation(calEvent.id, newStart);

          if (violation) {
            toast.warning(
              `${violation.taskName} depends on ${violation.predecessorName} — will auto-correct.`,
              { duration: 3000 }
            );

            // Use cascade preview to show the correction — the confirm bar
            // lets the user apply or cancel
            const cascadeResult = previewCascade(
              calEvent.id,
              newStart,
              newEnd,
              schedulableTasks,
              skipWeekends
            );

            if (cascadeResult && cascadeResult.changes.length > 0) {
              // Don't apply the move yet — let confirm bar handle it
              // But still apply the primary move + team member change
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
          }
        }

        // ── Cascade check for dependents ─────────────────────────────
        // Even if no violation, check if this move cascades to downstream tasks
        if (schedulableTasks.length > 0) {
          const cascadeResult = previewCascade(
            calEvent.id,
            newStart,
            newEnd,
            schedulableTasks,
            skipWeekends
          );

          if (cascadeResult && cascadeResult.changes.length > 0) {
            // Apply the primary move, let confirm bar handle cascade changes
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
        }

        // ── Smart insert check ───────────────────────────────────────
        // Check if this move inserts the task between existing events
        const targetTeamMemberId =
          newTeamMemberIds?.[0] ?? calEvent.teamMemberIds[0];

        if (targetTeamMemberId) {
          const insertPoint = detectInsertPoint(
            calEvent.id,
            targetTeamMemberId,
            newStart,
            events,
            startDate,
            daysShown
          );

          if (insertPoint && insertPoint.after) {
            const pushOffsets = calculatePushOffsets(
              durationDays || 1,
              insertPoint.before,
              insertPoint.after,
              events,
              targetTeamMemberId
            );

            // Apply push offsets to make room
            for (const offset of pushOffsets) {
              updateMutation.mutate({
                id: offset.eventId,
                data: { startDate: offset.newStart, endDate: offset.newEnd },
              });
            }
          }
        }

        // No cascade needed — apply the move directly
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
    [
      events,
      setDragState,
      updateMutation,
      createMutation,
      company?.id,
      startDate,
      daysShown,
      schedulableTasks,
      skipWeekends,
      checkDependencyViolation,
      previewCascade,
      detectInsertPoint,
      calculatePushOffsets,
    ]
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
