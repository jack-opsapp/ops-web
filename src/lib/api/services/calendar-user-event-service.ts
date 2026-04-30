/**
 * OPS Web - Calendar User Event Service
 *
 * Fetch personal events + time-off requests stored in Supabase
 * `calendar_user_events`. Mirrors the iOS CalendarUserEventRepository.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  CalendarUserEvent,
  CalendarUserEventStatus,
  CalendarUserEventType,
} from "@/lib/types/models";

function mapFromDb(row: Record<string, unknown>): CalendarUserEvent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: row.company_id as string,
    type: ((row.type as string) ?? "personal") as CalendarUserEventType,
    title: row.title as string,
    startDate: parseDate(row.start_date) ?? new Date(0),
    endDate: parseDate(row.end_date) ?? new Date(0),
    allDay: (row.all_day as boolean) ?? true,
    notes: (row.notes as string) ?? null,
    status: ((row.status as string) ?? "none") as CalendarUserEventStatus,
    address: (row.address as string) ?? null,
    teamMemberIds: (row.team_member_ids as string[]) ?? null,
    reviewedBy: (row.reviewed_by as string) ?? null,
    reviewedAt: parseDate(row.reviewed_at),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

export const CalendarUserEventService = {
  /**
   * Fetch user events for a company that overlap [startDate, endDate].
   *
   * Overlap rule: `start_date <= range_end AND end_date >= range_start`.
   * The iOS repository uses the same predicate (CalendarUserEventRepository).
   *
   * Optionally scoped to a single user (calendar.view: own / tasks.view: assigned).
   */
  async fetchForRange(
    companyId: string,
    startDate: Date,
    endDate: Date,
    options: { userId?: string } = {}
  ): Promise<CalendarUserEvent[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("calendar_user_events")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .lte("start_date", endDate.toISOString())
      .gte("end_date", startDate.toISOString())
      .order("start_date", { ascending: true });

    if (options.userId) {
      query = query.eq("user_id", options.userId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch user events: ${error.message}`);
    }
    return (data ?? []).map(mapFromDb);
  },
};
