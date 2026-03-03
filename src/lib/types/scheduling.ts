/**
 * OPS Web - Scheduling & Dependency Types
 *
 * Type definitions for the scheduling engine, cascade operations,
 * and UI state. Matches the iOS app's data model (same Supabase schema).
 */

// ─── Dependency Types ────────────────────────────────────────────────────────

/**
 * Dependency between task types — matches iOS TaskTypeDependency.
 * Stored as JSONB in Supabase on task_types.dependencies and project_tasks.dependency_overrides.
 */
export interface TaskTypeDependency {
  depends_on_task_type_id: string;
  overlap_percentage: number; // 0-100: 0 = must finish first, 100 = full overlap allowed
}

// ─── Scheduling Engine Types ─────────────────────────────────────────────────

/** Minimal task representation for scheduling calculations */
export interface SchedulableTask {
  id: string;
  taskTypeId: string;
  startDate: Date | null;
  endDate: Date | null;
  duration: number; // in days
  effectiveDependencies: TaskTypeDependency[];
  displayOrder: number;
  teamMemberIds: string[];
}

/** Result of a cascade push operation */
export interface CascadeResult {
  changes: TaskDateChange[];
}

export interface TaskDateChange {
  id: string;
  taskTypeId: string;
  oldStartDate: Date | null;
  oldEndDate: Date | null;
  newStartDate: Date;
  newEndDate: Date;
}

/** Result of auto-scheduling unscheduled tasks */
export interface AutoScheduleResult {
  placements: TaskPlacement[];
}

export interface TaskPlacement {
  id: string;
  taskTypeId: string;
  startDate: Date;
  endDate: Date;
}

// ─── Calendar / Scheduler UI Types ───────────────────────────────────────────

/** Calendar view types (replacing old CalendarView) */
export type SchedulerView = 'timeline' | 'month' | 'day';

/** Ghost preview for cascade/auto-schedule visualization */
export interface GhostPreview {
  taskId: string;
  originalStart: Date | null;
  originalEnd: Date | null;
  newStart: Date;
  newEnd: Date;
  type: 'cascade' | 'auto-schedule' | 'smart-insert';
}

/** Side panel modes */
export type SidePanelMode = 'task-detail' | 'project-drawer' | null;

/** Inline edit state */
export interface InlineEditState {
  taskId: string;
  field: 'title' | 'notes';
}
