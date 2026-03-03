/**
 * OPS Web — Scheduling Adapters
 *
 * Converts domain models (ProjectTask, TaskType, CalendarEvent)
 * into the minimal SchedulableTask interface used by the engine.
 */

import type { ProjectTask, TaskType } from '@/lib/types/models';
import type { SchedulableTask, TaskTypeDependency } from '@/lib/types/scheduling';

/**
 * Convert a ProjectTask + its TaskType + optional calendar event dates
 * into a SchedulableTask that the engine can work with.
 *
 * effectiveDependencies priority:
 *   1. task.dependencyOverrides (per-task overrides)
 *   2. taskType.dependencies    (type-level defaults)
 *   3. empty array              (no dependencies)
 */
export function taskToSchedulable(
  task: ProjectTask,
  taskTypes: TaskType[],
  calendarEventDates?: { startDate: Date | null; endDate: Date | null; duration: number }
): SchedulableTask {
  const taskType = taskTypes.find(tt => tt.id === task.taskTypeId);
  const effectiveDependencies: TaskTypeDependency[] =
    task.dependencyOverrides ?? taskType?.dependencies ?? [];

  return {
    id: task.id,
    taskTypeId: task.taskTypeId,
    startDate: calendarEventDates?.startDate ?? null,
    endDate: calendarEventDates?.endDate ?? null,
    duration: calendarEventDates?.duration ?? 1,
    effectiveDependencies,
    displayOrder: task.displayOrder ?? 0,
    teamMemberIds: task.teamMemberIds ?? [],
  };
}
