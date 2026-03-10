"use client";

import { useCallback } from "react";
import { format } from "date-fns";
import { useCalendarStore } from "@/stores/calendar-store";
import { useUpdateTask } from "@/lib/hooks/use-tasks";
import { autoSchedule } from "@/lib/scheduling/engine";
import type {
  SchedulableTask,
  GhostPreview,
  AutoScheduleResult,
} from "@/lib/types/scheduling";

/**
 * useAutoSchedule — preview and apply auto-scheduled task placements.
 *
 * 1. `previewAutoSchedule` runs the pure engine, writes ghost previews + confirm bar to the store.
 * 2. `cancelAutoSchedule` clears everything.
 * 3. The confirm bar's "Apply" button calls the closure that persists changes via mutateAsync.
 *
 * Follows the same pattern as `useCascade`.
 */
export function useAutoSchedule() {
  const setGhostPreviews = useCalendarStore((s) => s.setGhostPreviews);
  const clearGhostPreviews = useCalendarStore((s) => s.clearGhostPreviews);
  const showConfirmBar = useCalendarStore((s) => s.showConfirmBar);
  const hideConfirmBar = useCalendarStore((s) => s.hideConfirmBar);
  const updateTask = useUpdateTask();

  const previewAutoSchedule = useCallback(
    (
      unscheduledTasks: SchedulableTask[],
      allTasks: SchedulableTask[],
      anchorDate: Date,
      skipWeekends: boolean,
      scopeProjectId?: string,
      /** Map of taskId → projectId, needed for scoping when scopeProjectId is set */
      taskProjectMap?: Map<string, string>
    ): AutoScheduleResult | null => {
      let tasksToSchedule = unscheduledTasks;

      // Scope to a single project if requested
      if (scopeProjectId && taskProjectMap) {
        tasksToSchedule = tasksToSchedule.filter(
          (t) => taskProjectMap.get(t.id) === scopeProjectId
        );
      }

      const result = autoSchedule(
        tasksToSchedule,
        allTasks,
        anchorDate,
        false,
        skipWeekends
      );

      if (result.placements.length > 0) {
        const ghosts: GhostPreview[] = result.placements.map((p) => ({
          taskId: p.id,
          originalStart: null,
          originalEnd: null,
          newStart: p.startDate,
          newEnd: p.endDate,
          type: "auto-schedule" as const,
        }));
        setGhostPreviews(ghosts);

        const applyFn = async () => {
          for (const placement of result.placements) {
            await updateTask.mutateAsync({
              id: placement.id,
              data: {
                startDate: placement.startDate,
                endDate: placement.endDate,
              },
            });
          }
          clearGhostPreviews();
          hideConfirmBar();
        };

        const dateLabel = format(anchorDate, "EEE MMM d");
        showConfirmBar(
          `Auto-schedule ${result.placements.length} task${result.placements.length > 1 ? "s" : ""} starting ${dateLabel}?`,
          applyFn
        );
        return result;
      }

      return null;
    },
    [
      setGhostPreviews,
      clearGhostPreviews,
      showConfirmBar,
      hideConfirmBar,
      updateTask,
    ]
  );

  const cancelAutoSchedule = useCallback(() => {
    clearGhostPreviews();
    hideConfirmBar();
  }, [clearGhostPreviews, hideConfirmBar]);

  return { previewAutoSchedule, cancelAutoSchedule };
}
