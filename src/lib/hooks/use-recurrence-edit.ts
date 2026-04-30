/**
 * OPS Web - Recurrence Edit Hook (Phase 3)
 *
 * One mutation that resolves the edit-this / this-and-following / entire-series
 * decision the user made in the prompt. Each scope writes a different mix of
 * project_tasks rows + task_recurrences template + task_recurrence_exceptions
 * rows so the cron worker, the calendar, and the notification rail all stay
 * consistent.
 *
 * - "this" → upsert a reschedule exception AND patch the existing task row.
 * - "this_and_following" → cap original template at this date - 1, fork a new
 *    template from this date onward, and re-point future tasks to it.
 * - "all" → patch the original template; cron will regen everything from now.
 */

import { addDays, format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { RecurrenceService, TaskService } from "../api/services";
import { requireSupabase } from "../supabase/helpers";
import type {
  ProjectTask,
  RecurrenceEditScope,
  TaskRecurrence,
} from "../types/models";
import { useAuthStore } from "../store/auth-store";

export interface RecurrenceEditInput {
  task: ProjectTask;
  scope: RecurrenceEditScope;
  patch: Partial<ProjectTask>;
}

/**
 * Fields that, if changed under scope = "this", require Edit Following or
 * Edit All instead. Editing the project, type, or recurrence link of a single
 * occurrence isn't expressible as an exception row.
 */
const EDIT_THIS_BLOCKED_FIELDS = new Set<keyof ProjectTask>([
  "projectId",
  "taskTypeId",
  "recurrenceId",
]);

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function useRecurrenceEdit() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation({
    mutationFn: async ({ task, scope, patch }: RecurrenceEditInput) => {
      if (!task.recurrenceId) {
        throw new Error("Task has no recurrenceId — use useUpdateTask instead");
      }
      if (!task.recurrenceOriginDate) {
        throw new Error(
          "Task is missing recurrenceOriginDate — cannot resolve scope"
        );
      }

      const recurrence = await RecurrenceService.getById(task.recurrenceId);
      if (!recurrence) {
        throw new Error("Recurrence template not found or deleted");
      }

      switch (scope) {
        case "this":
          return await applyEditThis(task, recurrence, patch);
        case "this_and_following":
          return await applyEditThisAndFollowing(task, recurrence, patch);
        case "all":
          return await applyEditAll(recurrence, patch);
        default:
          throw new Error(`Unsupported scope: ${scope as string}`);
      }
    },
    onSuccess: () => {
      // Invalidate everything that could have been touched.
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrences(companyId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
    },
  });
}

// ─── Scope: this ──────────────────────────────────────────────────────────────

async function applyEditThis(
  task: ProjectTask,
  recurrence: TaskRecurrence,
  patch: Partial<ProjectTask>
): Promise<{ scope: "this"; taskId: string }> {
  // Refuse if the patch tries to mutate non-occurrence fields.
  for (const field of Object.keys(patch) as Array<keyof ProjectTask>) {
    if (EDIT_THIS_BLOCKED_FIELDS.has(field)) {
      throw new Error(
        `Cannot edit "${String(field)}" on a single occurrence — use Edit All or Edit Following.`
      );
    }
  }

  const originalDate = task.recurrenceOriginDate!;
  const newStart =
    patch.startDate instanceof Date ? patch.startDate : null;
  const newDateKey = newStart ? isoDate(newStart) : null;

  // Decide what changed for the exception row.
  const startTimeChanged =
    patch.startTime !== undefined && patch.startTime !== task.startTime;
  const endTimeChanged =
    patch.endTime !== undefined && patch.endTime !== task.endTime;
  const teamChanged = patch.teamMemberIds !== undefined;
  const dateChanged = newDateKey !== null && newDateKey !== originalDate;

  // Only write an exception when something the cron will need to re-apply
  // changed (a future regen of this recurrence_id + original_date).
  if (dateChanged || startTimeChanged || endTimeChanged || teamChanged) {
    await RecurrenceService.upsertException({
      recurrenceId: recurrence.id,
      originalDate,
      action: "reschedule",
      newDate: dateChanged ? newDateKey : null,
      newStartTime: startTimeChanged ? (patch.startTime ?? null) : null,
      newEndTime: endTimeChanged ? (patch.endTime ?? null) : null,
      newTeamMemberIds: teamChanged ? (patch.teamMemberIds ?? null) : null,
      notes: null,
    });
  }

  // Always patch the live task row so the user sees their change immediately.
  await TaskService.updateTask(task.id, patch);

  return { scope: "this", taskId: task.id };
}

// ─── Scope: this_and_following ────────────────────────────────────────────────

async function applyEditThisAndFollowing(
  task: ProjectTask,
  recurrence: TaskRecurrence,
  patch: Partial<ProjectTask>
): Promise<{
  scope: "this_and_following";
  oldRecurrenceId: string;
  newRecurrenceId: string;
}> {
  const supabase = requireSupabase();

  const originalDate = task.recurrenceOriginDate!;
  const splitDate = new Date(`${originalDate}T00:00:00Z`);

  // 1. Cap the original template's end_anchor at split - 1 day.
  const cappedEnd = isoDate(addDays(splitDate, -1));
  await RecurrenceService.update(recurrence.id, { endAnchor: cappedEnd });

  // 2. Fork a new template starting at the split date with the patch applied.
  const next: Parameters<typeof RecurrenceService.create>[0] = {
    companyId: recurrence.companyId,
    projectId: patch.projectId ?? recurrence.projectId,
    clientId: recurrence.clientId,
    taskTypeId: patch.taskTypeId ?? recurrence.taskTypeId,
    title: patch.customTitle ?? recurrence.title,
    teamMemberIds: patch.teamMemberIds ?? recurrence.teamMemberIds,
    rrule: recurrence.rrule,
    startAnchor: originalDate,
    endAnchor: recurrence.endAnchor,
    allDay: patch.allDay ?? recurrence.allDay,
    startTime: patch.startTime ?? recurrence.startTime,
    endTime: patch.endTime ?? recurrence.endTime,
    duration: patch.duration ?? recurrence.duration,
    notes: recurrence.notes,
    createdBy: recurrence.createdBy,
  };
  const newTemplate = await RecurrenceService.create(next);

  // 3. Re-point future generated tasks to the new template. We do this in
  // SQL so the unique-on-(recurrence_id, recurrence_origin_date) index
  // tolerates the move. UPDATE … WHERE recurrence_origin_date >= split.
  const { error } = await supabase
    .from("project_tasks")
    .update({ recurrence_id: newTemplate.id })
    .eq("recurrence_id", recurrence.id)
    .gte("recurrence_origin_date", originalDate);
  if (error) {
    throw new Error(
      `Failed to re-point future tasks to new recurrence: ${error.message}`
    );
  }

  // 4. Apply the patch to the live task row so the user sees the change now.
  await TaskService.updateTask(task.id, patch);

  return {
    scope: "this_and_following",
    oldRecurrenceId: recurrence.id,
    newRecurrenceId: newTemplate.id,
  };
}

// ─── Scope: all ───────────────────────────────────────────────────────────────

async function applyEditAll(
  recurrence: TaskRecurrence,
  patch: Partial<ProjectTask>
): Promise<{ scope: "all"; recurrenceId: string }> {
  // Map task-shaped patch onto the template fields it can affect.
  const tplPatch: Partial<TaskRecurrence> = {};
  if (patch.customTitle !== undefined) tplPatch.title = patch.customTitle ?? "";
  if (patch.teamMemberIds !== undefined)
    tplPatch.teamMemberIds = patch.teamMemberIds;
  if (patch.allDay !== undefined) tplPatch.allDay = patch.allDay;
  if (patch.startTime !== undefined) tplPatch.startTime = patch.startTime;
  if (patch.endTime !== undefined) tplPatch.endTime = patch.endTime;
  if (patch.duration !== undefined) tplPatch.duration = patch.duration;
  if (patch.taskTypeId !== undefined) tplPatch.taskTypeId = patch.taskTypeId;
  if (patch.projectId !== undefined) tplPatch.projectId = patch.projectId;
  if (patch.taskNotes !== undefined) tplPatch.notes = patch.taskNotes;

  const updated = await RecurrenceService.update(recurrence.id, tplPatch);
  return { scope: "all", recurrenceId: updated.id };
}
