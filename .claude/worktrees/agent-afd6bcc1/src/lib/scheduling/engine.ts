/**
 * OPS Web — Scheduling Engine
 *
 * Pure TypeScript port of iOS SchedulingEngine.swift.
 * All functions are pure — no state, no React, no Supabase.
 *
 * Key functions:
 *   topologicalSort  — Kahn's algorithm, falls back to displayOrder
 *   pushByDays       — push a task forward by N calendar/business days
 *   calculateCascade — cascade date changes through the dependency graph
 *   autoSchedule     — place unscheduled tasks respecting dependencies
 */

import { addDays, isWeekend, nextMonday } from 'date-fns';
import type {
  SchedulableTask,
  TaskTypeDependency,
  CascadeResult,
  TaskDateChange,
  AutoScheduleResult,
  TaskPlacement,
} from '@/lib/types/scheduling';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Advance a date to the next weekday if it falls on a weekend.
 * Matches iOS SchedulingEngine.skipToWeekday.
 */
function skipToWeekday(date: Date): Date {
  if (isWeekend(date)) {
    return nextMonday(date);
  }
  return date;
}

/**
 * Calculate the earliest start date for a dependent task given
 * the predecessor's start date, duration, and overlap percentage.
 *
 * Matches iOS TaskTypeDependency.earliestStart exactly:
 *   overlap=0   → must wait full duration (finish-to-start)
 *   overlap=50  → can start at 50% of predecessor duration
 *   overlap=100 → can start immediately (start-to-start)
 */
function earliestStart(
  dep: TaskTypeDependency,
  predecessorStart: Date,
  predecessorDuration: number
): Date {
  const clampedOverlap = Math.max(0, Math.min(100, dep.overlap_percentage));
  const completedFraction = (100 - clampedOverlap) / 100;
  const daysToWait = Math.ceil(predecessorDuration * completedFraction);
  return addDays(predecessorStart, daysToWait);
}

// ─── Topological Sort ─────────────────────────────────────────────────────────

/**
 * Sort tasks by dependency order using Kahn's algorithm.
 * Tasks with no dependencies come first.
 * Within the same dependency level, sorted by displayOrder.
 * Circular dependencies are appended at the end (never infinite loop).
 */
export function topologicalSort(tasks: SchedulableTask[]): SchedulableTask[] {
  const taskTypeIds = new Set(tasks.map(t => t.taskTypeId));

  // Build adjacency: taskTypeId → in-degree count
  const inDegree = new Map<string, number>();
  // taskTypeId → [taskTypeIds that depend on it]
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    const typeId = task.taskTypeId;
    if (!inDegree.has(typeId)) {
      inDegree.set(typeId, 0);
    }

    for (const dep of task.effectiveDependencies) {
      if (taskTypeIds.has(dep.depends_on_task_type_id)) {
        inDegree.set(typeId, (inDegree.get(typeId) ?? 0) + 1);
        const existing = dependents.get(dep.depends_on_task_type_id) ?? [];
        existing.push(typeId);
        dependents.set(dep.depends_on_task_type_id, existing);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [typeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(typeId);
    }
  }
  queue.sort(); // Deterministic initial order

  const orderedTypeIds: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    orderedTypeIds.push(current);

    for (const dep of dependents.get(current) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }

  // Circular deps go at end (any typeId not yet in orderedTypeIds)
  for (const typeId of taskTypeIds) {
    if (!orderedTypeIds.includes(typeId)) {
      orderedTypeIds.push(typeId);
    }
  }

  // Map back to tasks, sorted by type order then displayOrder
  const typeOrder = new Map<string, number>();
  orderedTypeIds.forEach((typeId, index) => {
    typeOrder.set(typeId, index);
  });

  return [...tasks].sort((a, b) => {
    const orderA = typeOrder.get(a.taskTypeId) ?? Number.MAX_SAFE_INTEGER;
    const orderB = typeOrder.get(b.taskTypeId) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.displayOrder - b.displayOrder;
  });
}

// ─── Push By Days ─────────────────────────────────────────────────────────────

/**
 * Push a single task by N days. Returns new start and end dates.
 * If the task has no startDate, uses now as the base.
 */
export function pushByDays(
  task: SchedulableTask,
  days: number,
  skipWeekends: boolean = false
): { newStart: Date; newEnd: Date } {
  const start = task.startDate ?? new Date();

  let newStart = addDays(start, days);
  if (skipWeekends) {
    newStart = skipToWeekday(newStart);
  }

  const newEnd = addDays(newStart, Math.max(task.duration - 1, 0));
  return { newStart, newEnd };
}

// ─── Calculate Cascade ────────────────────────────────────────────────────────

/**
 * Calculate cascade effects when a task is pushed.
 * Returns all tasks that need to move (NOT including the pushed task itself).
 *
 * Matches iOS SchedulingEngine.calculateCascade exactly:
 * 1. Record the pushed task's new dates
 * 2. Walk tasks in topological order
 * 3. For each task, check if any dependency predecessor moved
 * 4. If the earliest allowed start is later than current start, cascade forward
 */
export function calculateCascade(
  pushedTaskId: string,
  newStartDate: Date,
  newEndDate: Date,
  allProjectTasks: SchedulableTask[],
  skipWeekends: boolean = false
): CascadeResult {
  // Track new dates for all tasks
  const newDates = new Map<string, { start: Date; end: Date }>();
  newDates.set(pushedTaskId, { start: newStartDate, end: newEndDate });

  // Topological sort
  const sorted = topologicalSort(allProjectTasks);

  const changes: TaskDateChange[] = [];

  for (const task of sorted) {
    if (task.id === pushedTaskId) continue;

    // Check if any of this task's dependencies have moved
    let latestEarliestStart: Date | null = null;

    for (const dep of task.effectiveDependencies) {
      const predecessors = allProjectTasks.filter(
        t => t.taskTypeId === dep.depends_on_task_type_id
      );

      for (const pred of predecessors) {
        const predStart = newDates.get(pred.id)?.start ?? pred.startDate ?? new Date();
        const predDuration = pred.duration;
        const earliest = earliestStart(dep, predStart, predDuration);

        if (latestEarliestStart === null || earliest > latestEarliestStart) {
          latestEarliestStart = earliest;
        }
      }
    }

    // If this task needs to move forward
    if (
      latestEarliestStart !== null &&
      task.startDate !== null &&
      latestEarliestStart > task.startDate
    ) {
      let adjustedStart = latestEarliestStart;
      if (skipWeekends) {
        adjustedStart = skipToWeekday(adjustedStart);
      }
      const adjustedEnd = addDays(adjustedStart, Math.max(task.duration - 1, 0));

      newDates.set(task.id, { start: adjustedStart, end: adjustedEnd });
      changes.push({
        id: task.id,
        taskTypeId: task.taskTypeId,
        oldStartDate: task.startDate,
        oldEndDate: task.endDate,
        newStartDate: adjustedStart,
        newEndDate: adjustedEnd,
      });
    }
  }

  return { changes };
}

// ─── Auto-Schedule ────────────────────────────────────────────────────────────

/**
 * Auto-schedule unscheduled tasks starting from an anchor date.
 * Respects dependency order; falls back to displayOrder when no dependencies.
 *
 * Matches iOS SchedulingEngine.autoSchedule exactly:
 * 1. Topologically sort unscheduled tasks
 * 2. Seed placedDates with already-scheduled tasks
 * 3. Walk sorted tasks, compute earliest start from dependencies
 * 4. Pack tight: next task starts day after previous
 */
export function autoSchedule(
  unscheduledTasks: SchedulableTask[],
  allProjectTasks: SchedulableTask[],
  anchorDate: Date,
  _respectTeamAvailability: boolean = false,
  skipWeekends: boolean = false
): AutoScheduleResult {
  const sorted = topologicalSort(unscheduledTasks);

  // Track placed dates (include already-scheduled tasks)
  const placedDates = new Map<string, { start: Date; end: Date }>();
  for (const task of allProjectTasks) {
    if (task.startDate !== null && task.endDate !== null) {
      placedDates.set(task.id, { start: task.startDate, end: task.endDate });
    }
  }

  const placements: TaskPlacement[] = [];
  let nextAvailable = skipWeekends ? skipToWeekday(anchorDate) : anchorDate;

  for (const task of sorted) {
    let taskStart = nextAvailable;

    // Check dependency constraints
    for (const dep of task.effectiveDependencies) {
      const predecessors = allProjectTasks.filter(
        t => t.taskTypeId === dep.depends_on_task_type_id
      );

      for (const pred of predecessors) {
        const predDates = placedDates.get(pred.id);
        if (predDates) {
          const earliest = earliestStart(dep, predDates.start, pred.duration);
          if (earliest > taskStart) {
            taskStart = earliest;
          }
        }
      }
    }

    if (skipWeekends) {
      taskStart = skipToWeekday(taskStart);
    }

    const taskEnd = addDays(taskStart, Math.max(task.duration - 1, 0));

    placedDates.set(task.id, { start: taskStart, end: taskEnd });
    placements.push({
      id: task.id,
      taskTypeId: task.taskTypeId,
      startDate: taskStart,
      endDate: taskEnd,
    });

    // Pack tight: next task starts day after this one
    const dayAfter = addDays(taskEnd, 1);
    if (dayAfter > nextAvailable) {
      nextAvailable = dayAfter;
    }
  }

  return { placements };
}

// ─── Cycle Detection ──────────────────────────────────────────────────────────

/**
 * Check if adding a dependency would create a circular reference.
 * Matches iOS SchedulingEngine.wouldCreateCycle.
 */
export function wouldCreateCycle(
  taskTypeId: string,
  newDependsOnId: string,
  allTaskTypes: Array<{ id: string; dependencies: TaskTypeDependency[] }>
): boolean {
  const visited = new Set<string>();
  const queue: string[] = [newDependsOnId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskTypeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const taskType = allTaskTypes.find(tt => tt.id === current);
    if (taskType) {
      for (const dep of taskType.dependencies) {
        queue.push(dep.depends_on_task_type_id);
      }
    }
  }

  return false;
}
