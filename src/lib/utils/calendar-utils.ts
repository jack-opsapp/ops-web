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
  type TaskTypeColors,
} from "./calendar-constants";
import type { CalendarEvent as ApiCalendarEvent } from "@/lib/types/models";

// ─── Internal Event Type ─────────────────────────────────────────────────────

export interface InternalCalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  color: string;
  taskType: string;
  teamMember?: string;
  teamMemberIds: string[];
  project?: string;
  projectId?: string;
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

export function getEventColors(taskType: string): TaskTypeColors {
  return TASK_TYPE_COLORS[taskType] ?? DEFAULT_TASK_TYPE_COLORS;
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
    "#931A32": "installation",
    "#C4A868": "material",
    "#A5B368": "estimate",
    "#7B68A6": "inspection",
    "#59779F": "quote",
    "#4A4A4A": "completion",
  };
  return colorMap[color] ?? "task";
}

// ─── API → Internal Mapping ─────────────────────────────────────────────────

export function mapApiEventToInternal(event: ApiCalendarEvent): InternalCalendarEvent | null {
  if (!event.startDate) return null;

  const startDate = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);

  let endDate: Date;
  if (event.endDate) {
    endDate = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);
  } else if (event.duration > 0) {
    endDate = new Date(startDate.getTime() + event.duration * 60 * 1000);
  } else {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  }

  return {
    id: event.id,
    title: event.title,
    startDate,
    endDate,
    color: event.color,
    taskType: deriveTaskType(event.title, event.color),
    teamMember: event.teamMemberIds.length > 0 ? "Team" : undefined,
    teamMemberIds: event.teamMemberIds,
    project: event.project?.title ?? undefined,
    projectId: event.projectId ?? undefined,
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
