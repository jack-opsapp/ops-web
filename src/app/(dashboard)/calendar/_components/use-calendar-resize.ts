"use client";

/**
 * useCalendarResize — shared resize-commit logic for calendar surfaces.
 *
 * Handles the recurrence-aware mutation path: if the source task belongs to
 * a series, prompt the user for scope (this / following / all) before
 * applying the patch. Otherwise call useUpdateTask directly.
 *
 * Used by Day card (all-day + hourly), Month bar, and Week column day card
 * resize affordances. The Crew swimlane has its own dedicated wiring in
 * crew-grid.tsx since it pre-dates this hook.
 */

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { ProjectTask } from "@/lib/types/models";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { useTasks, useUpdateTask, useRecurrenceEdit } from "@/lib/hooks";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";

export interface ResizePatch {
  startDate?: Date;
  endDate?: Date;
  startTime?: string;
  endTime?: string;
}

export function useCalendarResize() {
  const updateTask = useUpdateTask();
  const recurrenceEdit = useRecurrenceEdit();
  const recurrencePrompt = useRecurrenceEditPrompt();

  const { data: taskData } = useTasks();
  const tasksById = useMemo(() => {
    const map = new Map<string, ProjectTask>();
    for (const t of taskData?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [taskData]);

  const commitResize = useCallback(
    async (event: InternalCalendarEvent, patch: ResizePatch) => {
      const sourceTask = tasksById.get(event.id);

      if (sourceTask?.recurrenceId) {
        const scope = await recurrencePrompt.request({
          description: "Resize this occurrence, or the entire series?",
        });
        if (!scope) return;
        recurrenceEdit.mutate(
          {
            task: sourceTask,
            scope,
            patch: patch as Partial<ProjectTask>,
          },
          {
            onError: (err) =>
              toast.error("Failed to resize recurring task", {
                description: err.message,
              }),
          }
        );
        return;
      }

      updateTask.mutate(
        { id: event.id, data: patch as Partial<ProjectTask> },
        {
          onError: (err) =>
            toast.error("Failed to resize task", { description: err.message }),
        }
      );
    },
    [tasksById, updateTask, recurrenceEdit, recurrencePrompt]
  );

  return {
    commitResize,
    promptElement: recurrencePrompt.promptElement,
  };
}
