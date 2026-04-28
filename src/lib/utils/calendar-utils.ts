/**
 * OPS Web - Calendar Utilities
 *
 * Pure functions for calendar event positioning, formatting, mapping, and overlap resolution.
 */

import { differenceInMinutes, getHours, getMinutes, isSameDay } from "date-fns";
import {
  HOUR_HEIGHT,
  FIRST_HOUR,
  LAST_HOUR,
  TASK_TYPE_COLORS,
  DEFAULT_TASK_TYPE_COLORS,
  TASK_STATUS_COLORS,
  type TaskTypeColors,
  type TaskStatusColors,
  type TaskStatusKey,
} from "./calendar-constants";
import { TaskStatus } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";

// ─── Internal Event Type ─────────────────────────────────────────────────────

/**
 * The unified calendar event shape consumed by every view (Day, Week, Month,
 * Crew). Built once via mapTaskToInternalEvent — consumers must not re-derive
 * colors, titles, or status from the underlying ProjectTask. The shape is the
 * single source of truth.
 *
 * Three-source rule:
 *   - Title (line 1)    → projectTitle ?? taskTitle
 *   - Subtitle          → taskTitle (when distinct from projectTitle)
 *   - Body fill / border→ statusColors (status-driven)
 *   - Left accent stripe→ typeColors.border (type-driven)
 *   - Type badge        → typeLabel (uppercase Cake Mono Light)
 */
export interface InternalCalendarEvent {
  id: string;
  /**
   * Primary display title. Equal to projectTitle ?? taskTitle.
   * Preserved as a top-level field for backward compatibility.
   */
  title: string;
  startDate: Date;
  endDate: Date;
  color: string;
  taskType: string;
  status: string;
  teamMember?: string;
  teamMemberIds: string[];
  project?: string;
  projectId?: string;

  // ── Unified mapping (T8) — three-source rule
  projectTitle: string | null;
  taskTitle: string;
  typeLabel: string;
  typeColors: TaskTypeColors;
  statusColors: TaskStatusColors;
  statusKey: TaskStatusKey;
  crewIds: string[];
  address: string | null;

  // ── Phase 3 fields (provisioned now, populated when allDay=false ships)
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

export function getEventColors(taskType: string): TaskTypeColors {
  return TASK_TYPE_COLORS[taskType] ?? DEFAULT_TASK_TYPE_COLORS;
}

export function getStatusColors(key: TaskStatusKey): TaskStatusColors {
  return TASK_STATUS_COLORS[key];
}

// ─── Status Derivation ──────────────────────────────────────────────────────

/**
 * Map a ProjectTask to a TaskStatusKey for card coloring.
 *
 * Production project_tasks.status only stores 'active' | 'completed' |
 * 'cancelled'. The TS enum's Booked/InProgress both round-trip to 'active'.
 *
 * Computed states layered on top of 'active':
 *   - end_date < now            → 'overdue'
 *   - start_date <= now < end   → 'in_progress'
 *   - otherwise (future-active) → 'scheduled'
 */
export function deriveTaskStatusKey(
  task: Pick<ProjectTask, "status" | "startDate" | "endDate" | "duration">,
  now: Date = new Date()
): TaskStatusKey {
  if (task.status === TaskStatus.Completed) return "completed";
  if (task.status === TaskStatus.Cancelled) return "cancelled";

  // Active state — split by date relationship to now.
  const start = task.startDate ? new Date(task.startDate) : null;
  let end = task.endDate ? new Date(task.endDate) : null;

  // Fall back to start + duration when end_date is missing.
  if (!end && start && task.duration > 0) {
    end = new Date(start.getTime() + task.duration * 24 * 60 * 60 * 1000);
  }

  if (end && end < now) return "overdue";
  if (start && end && start <= now && now <= end) return "in_progress";
  return "scheduled";
}

// ─── Task Type Derivation ────────────────────────────────────────────────────

export function deriveTaskType(title: string, color: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("install") || lower.includes("demo")) return "installation";
  if (lower.includes("material") || lower.includes("pickup") || lower.includes("delivery")) return "material";
  if (lower.includes("estimate")) return "estimate";
  if (lower.includes("inspect")) return "inspection";
  if (lower.includes("quote") || lower.includes("survey")) return "quote";
  if (lower.includes("walkthrough") || lower.includes("completion") || lower.includes("final")) return "completion";

  const colorMap: Record<string, string> = {
    "#B58289": "installation",
    "#C4A868": "material",
    "#9DB582": "estimate",
    "#A69AB5": "inspection",
    "#6F94B0": "quote",
    "#9C938A": "completion",
    // Legacy hexes (pre-spec-v2) — kept for existing ProjectTask rows stored
    // with the old palette so derivation still works during data migration.
    "#931A32": "installation",
    "#A5B368": "estimate",
    "#7B68A6": "inspection",
    "#59779F": "quote",
    "#4A4A4A": "completion",
  };
  return colorMap[color] ?? "task";
}

// ─── ProjectTask → Internal Calendar Event ──────────────────────────────────

/**
 * Map a ProjectTask to the calendar's internal event representation.
 * Tasks without a startDate are excluded (returns null).
 */
/**
 * Normalize a date that may be stored as UTC midnight to local midnight.
 * Prevents UTC dates like "2026-03-25T00:00:00Z" from rendering as March 24 in Pacific time.
 */
function normalizeToLocalDate(d: Date): Date {
  // Extract the UTC date components and create a local date
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function mapTaskToInternalEvent(task: ProjectTask): InternalCalendarEvent | null {
  if (!task.startDate) return null;

  const rawStart = task.startDate instanceof Date ? task.startDate : new Date(task.startDate);
  // For all-day tasks, normalize UTC midnight to local midnight so display
  // matches the calendar grid. Timed tasks keep the raw timestamp so the
  // applied start_time positions them correctly within the day.
  const startDate = task.allDay ? normalizeToLocalDate(rawStart) : rawStart;

  // Combine start date with startTime for precise positioning when timed.
  if (!task.allDay && task.startTime) {
    const [h, m] = task.startTime.split(":").map(Number);
    if (!isNaN(h) && !isNaN(m)) startDate.setHours(h, m, 0, 0);
  }

  let endDate: Date;
  if (task.endDate) {
    const rawEnd = task.endDate instanceof Date ? new Date(task.endDate) : new Date(task.endDate);
    endDate = task.allDay ? normalizeToLocalDate(rawEnd) : rawEnd;
    if (!task.allDay && task.endTime) {
      const [h, m] = task.endTime.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) endDate.setHours(h, m, 0, 0);
    }
  } else if (task.duration > 0) {
    endDate = new Date(startDate.getTime() + task.duration * 24 * 60 * 60 * 1000);
    // Single-day timed tasks honor endTime to set the closing wall-clock.
    if (!task.allDay && task.endTime && task.duration <= 1) {
      const [h, m] = task.endTime.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        endDate = new Date(startDate);
        endDate.setHours(h, m, 0, 0);
      }
    }
  } else {
    // Default: same day, apply endTime or default to +9 hours
    endDate = new Date(startDate);
    if (!task.allDay && task.endTime) {
      const [h, m] = task.endTime.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) endDate.setHours(h, m, 0, 0);
    } else {
      endDate.setHours(startDate.getHours() + 9, 0, 0, 0);
    }
  }

  // Three-source title rule:
  //   primary display = projectTitle ?? taskTitle (taskTitle = customTitle ?? typeLabel)
  const projectTitle: string | null = task.project?.title ?? null;
  const typeLabel = task.taskType?.display ?? "Task";
  const taskTitle = task.customTitle ?? typeLabel;
  const displayTitle = projectTitle ?? taskTitle;

  // Type-derived palette (left stripe + badge)
  const taskTypeKey = deriveTaskType(taskTitle, task.taskColor);
  const typeColors = getEventColors(taskTypeKey);

  // Status-derived palette (body fill + border)
  const statusKey = deriveTaskStatusKey(task);
  const statusColors = getStatusColors(statusKey);

  return {
    id: task.id,
    title: displayTitle,
    startDate,
    endDate,
    color: task.taskColor,
    taskType: taskTypeKey,
    status: task.status,
    teamMember: task.teamMemberIds.length > 0 ? "Team" : undefined,
    teamMemberIds: task.teamMemberIds,
    project: projectTitle ?? undefined,
    projectId: task.projectId,

    // Unified mapping
    projectTitle,
    taskTitle,
    typeLabel,
    typeColors,
    statusColors,
    statusKey,
    crewIds: task.teamMemberIds,
    address: task.project?.address ?? null,

    // Phase 3 — task.allDay is authoritative. Pre-Phase-3 rows default to
    // true (verified at task-service.mapFromDb), so legacy rows with
    // hardcoded 08:00–17:00 read as all-day.
    startTime: task.startTime ?? null,
    endTime: task.endTime ?? null,
    allDay: task.allDay,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export function formatTime24(date: Date): string {
  return `${getHours(date).toString().padStart(2, "0")}:${getMinutes(date).toString().padStart(2, "0")}`;
}

// ─── Positioning ─────────────────────────────────────────────────────────────

export function getEventTopOffset(date: Date): number {
  const hours = getHours(date);
  const minutes = getMinutes(date);
  return (hours - FIRST_HOUR) * HOUR_HEIGHT + (minutes / 60) * HOUR_HEIGHT;
}

export function getEventHeight(start: Date, end: Date): number {
  const minutes = differenceInMinutes(end, start);
  return Math.max((minutes / 60) * HOUR_HEIGHT, 24);
}

export function getCurrentTimeOffset(): number {
  const now = new Date();
  const hours = getHours(now);
  const minutes = getMinutes(now);
  return (hours - FIRST_HOUR) * HOUR_HEIGHT + (minutes / 60) * HOUR_HEIGHT;
}

export function isWithinVisibleHours(date: Date): boolean {
  const hour = getHours(date);
  return hour >= FIRST_HOUR && hour < LAST_HOUR;
}

// ─── Event Filtering ─────────────────────────────────────────────────────────

export function getEventsForDay(events: InternalCalendarEvent[], day: Date): InternalCalendarEvent[] {
  return events.filter((e) => isSameDay(e.startDate, day));
}

// ─── Overlap Resolution ──────────────────────────────────────────────────────

export interface ResolvedColumn {
  event: InternalCalendarEvent;
  columnIndex: number;
  totalColumns: number;
}

/**
 * Given a list of events for a single day, compute stacking columns for overlapping events.
 * Returns each event annotated with its column index and total columns in its overlap group.
 */
export function resolveEventColumns(events: InternalCalendarEvent[]): ResolvedColumn[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const result: ResolvedColumn[] = [];

  // Group events into overlapping clusters
  const clusters: InternalCalendarEvent[][] = [];
  let currentCluster: InternalCalendarEvent[] = [sorted[0]];
  let clusterEnd = sorted[0].endDate.getTime();

  for (let i = 1; i < sorted.length; i++) {
    const event = sorted[i];
    if (event.startDate.getTime() < clusterEnd) {
      currentCluster.push(event);
      clusterEnd = Math.max(clusterEnd, event.endDate.getTime());
    } else {
      clusters.push(currentCluster);
      currentCluster = [event];
      clusterEnd = event.endDate.getTime();
    }
  }
  clusters.push(currentCluster);

  // For each cluster, assign columns greedily
  for (const cluster of clusters) {
    const columns: InternalCalendarEvent[][] = [];

    for (const event of cluster) {
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        const lastInCol = columns[col][columns[col].length - 1];
        if (lastInCol.endDate.getTime() <= event.startDate.getTime()) {
          columns[col].push(event);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
      }
    }

    const totalColumns = columns.length;
    for (let col = 0; col < columns.length; col++) {
      for (const event of columns[col]) {
        result.push({ event, columnIndex: col, totalColumns });
      }
    }
  }

  return result;
}

// ─── Time Snapping ───────────────────────────────────────────────────────────

/** Snap a date to the nearest 15-minute interval */
export function snapToGrid(date: Date, intervalMinutes: number = 15): Date {
  const ms = date.getTime();
  const intervalMs = intervalMinutes * 60 * 1000;
  const snapped = Math.round(ms / intervalMs) * intervalMs;
  return new Date(snapped);
}

/** Convert a pixel Y offset to a Date for a given day */
export function yOffsetToDate(y: number, day: Date): Date {
  const totalMinutes = (y / HOUR_HEIGHT) * 60;
  const hours = Math.floor(totalMinutes / 60) + FIRST_HOUR;
  const minutes = Math.round(totalMinutes % 60);
  const result = new Date(day);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

export interface Conflict {
  eventA: InternalCalendarEvent;
  eventB: InternalCalendarEvent;
  memberId: string;
}

/**
 * Detect scheduling conflicts: events that overlap in time for the same team member.
 * Returns a Set of event IDs that have at least one conflict.
 */
export function detectConflicts(events: InternalCalendarEvent[]): Set<string> {
  const conflictingIds = new Set<string>();

  // Group events by team member
  const byMember = new Map<string, InternalCalendarEvent[]>();
  for (const event of events) {
    for (const memberId of event.teamMemberIds) {
      if (!byMember.has(memberId)) byMember.set(memberId, []);
      byMember.get(memberId)!.push(event);
    }
  }

  // Check overlaps within each member's events
  for (const memberEvents of byMember.values()) {
    if (memberEvents.length < 2) continue;

    const sorted = [...memberEvents].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime()
    );

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        // If j starts after i ends, no overlap possible for remaining events
        if (sorted[j].startDate.getTime() >= sorted[i].endDate.getTime()) break;
        // Overlap detected
        conflictingIds.add(sorted[i].id);
        conflictingIds.add(sorted[j].id);
      }
    }
  }

  return conflictingIds;
}
