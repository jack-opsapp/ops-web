/**
 * OPS Web - Calendar Service (Supabase)
 *
 * Sources calendar data from `project_tasks` table (calendar_events is deprecated).
 * Returns CalendarEvent-shaped data so downstream hooks/utils work unchanged.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { CalendarEvent } from "../../types/models";

// ─── Database → CalendarEvent Mapping ────────────────────────────────────────

/**
 * Map a project_tasks row (with joined task_type and project) to CalendarEvent shape.
 * The calendar pipeline expects CalendarEvent objects, so we project task data into that shape.
 */
function mapTaskToCalendarEvent(row: Record<string, unknown>): CalendarEvent {
  const startDate = parseDate(row.start_date);
  const endDate = parseDate(row.end_date);
  const startTime = row.start_time as string | null; // "HH:MM:SS"
  const endTime = row.end_time as string | null;

  // Combine date from start_date with time from start_time for accurate positioning
  let effectiveStart = startDate;
  if (startDate && startTime) {
    const [h, m] = startTime.split(":").map(Number);
    effectiveStart = new Date(startDate);
    effectiveStart.setHours(h, m, 0, 0);
  }

  let effectiveEnd = endDate;
  if (endDate && endTime) {
    const [h, m] = endTime.split(":").map(Number);
    effectiveEnd = new Date(endDate);
    effectiveEnd.setHours(h, m, 0, 0);
  } else if (!endDate && startDate && endTime) {
    // Single-day task: use start_date + end_time
    const [h, m] = endTime.split(":").map(Number);
    effectiveEnd = new Date(startDate);
    effectiveEnd.setHours(h, m, 0, 0);
  }

  // Resolve title: custom_title > task_type.display > "Task"
  const taskType = row.task_type as Record<string, unknown> | null;
  const customTitle = row.custom_title as string | null;
  const taskTypeDisplay = taskType?.display as string | null;
  const title = customTitle || taskTypeDisplay || "Task";

  // Resolve project title for relationship
  const project = row.project as Record<string, unknown> | null;

  return {
    id: row.id as string,
    color: (row.task_color as string) ?? "#417394",
    companyId: row.company_id as string,
    projectId: (row.project_id as string) ?? "",
    taskId: row.id as string, // the task IS the event now
    duration: (row.duration as number) ?? 1,
    endDate: effectiveEnd,
    startDate: effectiveStart,
    title,
    teamMemberIds: (row.team_member_ids as string[]) ?? [],
    eventType: "task",
    opportunityId: null,
    siteVisitId: null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
    // Attach project relationship if loaded
    project: project
      ? { id: project.id as string, title: project.title as string } as CalendarEvent["project"]
      : undefined,
  };
}

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchCalendarEventsOptions {
  /** Filter by project ID */
  projectId?: string;
  /** Filter events starting on or after this date */
  startDateFrom?: Date;
  /** Filter events starting on or before this date */
  startDateTo?: Date;
  /** Filter events ending on or after this date */
  endDateFrom?: Date;
  /** Filter by team member (array containment) */
  teamMemberId?: string;
  /** Sort field (snake_case column name) */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit (max 100) */
  limit?: number;
  /** Pagination offset */
  cursor?: number;
}

// ─── Calendar Service ─────────────────────────────────────────────────────────

export const CalendarService = {
  /**
   * Fetch scheduled tasks for a company, shaped as CalendarEvent objects.
   * Sources from `project_tasks` table with joins to `task_types` and `projects`.
   */
  async fetchCalendarEvents(
    companyId: string,
    options: FetchCalendarEventsOptions = {}
  ): Promise<{
    events: CalendarEvent[];
    remaining: number;
    count: number;
  }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const offset = options.cursor ?? 0;

    let query = supabase
      .from("project_tasks")
      .select("*, task_type:task_types(display), project:projects(id, title)", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .not("start_date", "is", null); // Only tasks with scheduled dates

    if (options.projectId) {
      query = query.eq("project_id", options.projectId);
    }

    if (options.startDateFrom) {
      query = query.gte("start_date", options.startDateFrom.toISOString());
    }

    if (options.startDateTo) {
      query = query.lte("start_date", options.startDateTo.toISOString());
    }

    if (options.endDateFrom) {
      query = query.gte("end_date", options.endDateFrom.toISOString());
    }

    if (options.teamMemberId) {
      query = query.contains("team_member_ids", [options.teamMemberId]);
    }

    if (options.sortField) {
      query = query.order(options.sortField, { ascending: !options.descending });
    } else {
      query = query.order("start_date", { ascending: true });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch calendar events: ${error.message}`);

    const total = count ?? 0;
    const events = (data ?? []).map(mapTaskToCalendarEvent);
    const remaining = Math.max(0, total - offset - events.length);

    return { events, remaining, count: total };
  },

  /**
   * Fetch scheduled tasks for a specific date range.
   * Commonly used for calendar view rendering.
   */
  async fetchEventsForDateRange(
    companyId: string,
    startDate: Date,
    endDate: Date,
    options: Omit<FetchCalendarEventsOptions, "startDateFrom" | "startDateTo"> = {}
  ): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await CalendarService.fetchCalendarEvents(companyId, {
        ...options,
        startDateFrom: startDate,
        startDateTo: endDate,
        limit: 100,
        cursor: offset,
      });

      allEvents.push(...result.events);
      hasMore = result.remaining > 0;
      offset += result.events.length;
    }

    return allEvents;
  },

  /**
   * Fetch a single task as a calendar event by ID.
   */
  async fetchCalendarEvent(id: string): Promise<CalendarEvent | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_tasks")
      .select("*, task_type:task_types(display), project:projects(id, title)")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      throw new Error(`Failed to fetch calendar event: ${error.message}`);
    }
    return mapTaskToCalendarEvent(data);
  },

  /**
   * Fetch all scheduled tasks with auto-pagination.
   */
  async fetchAllCalendarEvents(
    companyId: string,
    options: Omit<FetchCalendarEventsOptions, "limit" | "cursor"> = {}
  ): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await CalendarService.fetchCalendarEvents(companyId, {
        ...options,
        limit: 100,
        cursor: offset,
      });

      allEvents.push(...result.events);
      hasMore = result.remaining > 0;
      offset += result.events.length;
    }

    return allEvents;
  },

  /**
   * Create a calendar event in the calendar_events table.
   * Used for site visits and other non-task calendar entries.
   */
  async createCalendarEvent(
    data: Omit<CalendarEvent, "id" | "lastSyncedAt" | "deletedAt" | "project" | "task" | "teamMembers">
  ): Promise<CalendarEvent> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {
      color: data.color,
      company_id: data.companyId,
      project_id: data.projectId || null,
      task_id: data.taskId || null,
      duration: data.duration ?? 1,
      end_date: data.endDate?.toISOString() ?? null,
      start_date: data.startDate?.toISOString() ?? null,
      title: data.title,
      team_member_ids: data.teamMemberIds ?? [],
      event_type: data.eventType ?? "event",
      opportunity_id: data.opportunityId ?? null,
      site_visit_id: data.siteVisitId ?? null,
      needs_sync: data.needsSync ?? false,
    };

    const { data: created, error } = await supabase
      .from("calendar_events")
      .insert(row)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create calendar event: ${error.message}`);

    return {
      id: created.id as string,
      color: (created.color as string) ?? "#417394",
      companyId: created.company_id as string,
      projectId: (created.project_id as string) ?? "",
      taskId: (created.task_id as string) ?? null,
      duration: (created.duration as number) ?? 1,
      endDate: parseDate(created.end_date),
      startDate: parseDate(created.start_date),
      title: (created.title as string) ?? "",
      teamMemberIds: (created.team_member_ids as string[]) ?? [],
      eventType: (created.event_type as string) ?? "event",
      opportunityId: (created.opportunity_id as string) ?? null,
      siteVisitId: (created.site_visit_id as string) ?? null,
      lastSyncedAt: null,
      needsSync: false,
      deletedAt: null,
    };
  },
};

export default CalendarService;
