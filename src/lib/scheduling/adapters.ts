/**
 * OPS Web — Scheduling Adapters
 *
 * Converts domain models (ProjectTask, TaskType)
 * into the minimal SchedulableTask interface used by the engine.
 */

import type { ProjectTask, TaskType } from '@/lib/types/models';
import type { SchedulableTask, TaskTypeDependency } from '@/lib/types/scheduling';

/**
 * Convert a ProjectTask + its TaskType into a SchedulableTask
 * that the engine can work with.
 *
 * Dates come directly from project_tasks (startDate, endDate, duration).
 *
 * effectiveDependencies priority:
 *   1. task.dependencyOverrides (per-task overrides)
 *   2. taskType.dependencies    (type-level defaults)
 *   3. empty array              (no dependencies)
 */
export function taskToSchedulable(
  task: ProjectTask,
  taskTypes: TaskType[],
): SchedulableTask {
  const taskType = taskTypes.find(tt => tt.id === task.taskTypeId);
  const effectiveDependencies: TaskTypeDependency[] =
    task.dependencyOverrides ?? taskType?.dependencies ?? [];

  const startDate = task.startDate
    ? (task.startDate instanceof Date ? task.startDate : new Date(task.startDate))
    : null;
  const endDate = task.endDate
    ? (task.endDate instanceof Date ? task.endDate : new Date(task.endDate))
    : null;

  return {
    id: task.id,
    taskTypeId: task.taskTypeId,
    startDate,
    endDate,
    duration: task.duration ?? 1,
    effectiveDependencies,
    displayOrder: task.displayOrder ?? 0,
    teamMemberIds: task.teamMemberIds ?? [],
  };
}
