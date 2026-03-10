"use client";

import { useCallback } from "react";
import { useCalendarStore } from "@/stores/calendar-store";
import { useUpdateTask } from "@/lib/hooks/use-tasks";
import { calculateCascade } from "@/lib/scheduling/engine";
import type {
  SchedulableTask,
  GhostPreview,
  CascadeResult,
} from "@/lib/types/scheduling";

/**
 * useCascade — preview and apply cascade date changes.
 *
 * 1. `previewCascade` runs the pure engine, writes ghost previews + confirm bar to the store.
 * 2. `cancelCascade` clears everything.
 * 3. The confirm bar's "Apply" button calls the closure that persists changes via mutateAsync.
 */
export function useCascade() {
  const setGhostPreviews = useCalendarStore((s) => s.setGhostPreviews);
  const clearGhostPreviews = useCalendarStore((s) => s.clearGhostPreviews);
  const showConfirmBar = useCalendarStore((s) => s.showConfirmBar);
  const hideConfirmBar = useCalendarStore((s) => s.hideConfirmBar);
  const updateTask = useUpdateTask();

  const previewCascade = useCallback(
    (
      pushedTaskId: string,
      newStartDate: Date,
      newEndDate: Date,
      allTasks: SchedulableTask[],
      skipWeekends: boolean
    ): CascadeResult | null => {
      const result = calculateCascade(
        pushedTaskId,
        newStartDate,
        newEndDate,
        allTasks,
        skipWeekends
      );

      if (result.changes.length > 0) {
        const ghosts: GhostPreview[] = result.changes.map((c) => ({
          taskId: c.id,
          originalStart: c.oldStartDate,
          originalEnd: c.oldEndDate,
          newStart: c.newStartDate,
          newEnd: c.newEndDate,
          type: "cascade" as const,
        }));
        setGhostPreviews(ghosts);

        const applyFn = async () => {
          for (const change of result.changes) {
            await updateTask.mutateAsync({
              id: change.id,
              data: {
                startDate: change.newStartDate,
                endDate: change.newEndDate,
              },
            });
          }
          clearGhostPreviews();
          hideConfirmBar();
        };

        showConfirmBar(
          `${result.changes.length} task${result.changes.length > 1 ? "s" : ""} will cascade.`,
          applyFn
        );
        return result;
      }
      return null;
    },
    [setGhostPreviews, clearGhostPreviews, showConfirmBar, hideConfirmBar, updateTask]
  );

  const cancelCascade = useCallback(() => {
    clearGhostPreviews();
    hideConfirmBar();
  }, [clearGhostPreviews, hideConfirmBar]);

  return { previewCascade, cancelCascade };
}
