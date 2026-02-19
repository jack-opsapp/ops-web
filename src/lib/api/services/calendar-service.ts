/**
 * OPS Web - Calendar Event Service (Supabase)
 *
 * Complete CRUD operations for CalendarEvents stored in Supabase `calendar_events` table.
 * Replaces the old Bubble.io-based implementation.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { CalendarEvent } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as string,
    color: (row.color as string) ?? "#417394",
    companyId: row.company_id as string,
    projectId: (row.project_id as string) ?? null,
    taskId: null, // reverse lookup via project_tasks.calendar_event_id
    duration: (row.duration as number) ?? 1,
    endDate: parseDate(row.end_date),
    startDate: parseDate(row.start_date),
    title: row.title as string,
    teamMemberIds: (row.team_member_ids as string[]) ?? [],
    eventType: "task",
    opportunityId: null,
    siteVisitId: null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapToDb(data: Partial<CalendarEvent>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.color !== undefined) row.color = data.color;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.projectId !== undefined) row.project_id = data.projectId;
  if (data.title !== undefined) row.title = data.title;
  if (data.startDate !== undefined)
    row.start_date = data.startDate?.toISOString() ?? null;
  if (data.endDate !== undefined)
    row.end_date = data.endDate?.toISOString() ?? null;
  if (data.duration !== undefined) row.duration = data.duration;
  if (data.teamMemberIds !== undefined) row.team_member_ids = data.teamMemberIds;
  return row;
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

// ─── Calendar Event Service ───────────────────────────────────────────────────

export const CalendarService = {
  /**
   * Fetch calendar events for a company with optional filters.
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
      .from("calendar_events")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);

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
    const events = (data ?? []).map(mapFromDb);
    const remaining = Math.max(0, total - offset - events.length);

    return { events, remaining, count: total };
  },

  /**
   * Fetch calendar events for a specific date range.
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
   * Fetch a single calendar event by ID.
   */
  async fetchCalendarEvent(id: string): Promise<CalendarEvent | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("calendar_events")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // not found
      throw new Error(`Failed to fetch calendar event: ${error.message}`);
    }
    return mapFromDb(data);
  },

  /**
   * Create a new calendar event.
   */
  async createCalendarEvent(
    data: Partial<CalendarEvent> & {
      projectId: string;
      companyId: string;
      title: string;
    }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: created, error } = await supabase
      .from("calendar_events")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create calendar event: ${error.message}`);
    return created.id as string;
  },

  /**
   * Update an existing calendar event.
   */
  async updateCalendarEvent(
    id: string,
    data: Partial<CalendarEvent>
  ): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { error } = await supabase
      .from("calendar_events")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update calendar event: ${error.message}`);
  },

  /**
   * Soft delete a calendar event.
   */
  async deleteCalendarEvent(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("calendar_events")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete calendar event: ${error.message}`);
  },

  /**
   * Fetch all calendar events with auto-pagination.
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
};

export default CalendarService;
