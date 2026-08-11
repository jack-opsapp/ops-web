/**
 * OPS Web - Site Visit Service
 *
 * CRUD operations for SiteVisits using Supabase.
 * Site visits are schedulable field inspections linked to opportunities or projects.
 * Completing a visit auto-creates an Activity on the opportunity timeline.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  SiteVisit,
  CreateSiteVisit,
  SiteVisitStatus,
} from "@/lib/types/pipeline";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchSiteVisitsOptions {
  opportunityId?: string;
  projectId?: string;
  status?: SiteVisitStatus;
  includeDeleted?: boolean;
}

// ─── Booking (RPC-only write path) ───────────────────────────────────────────

/**
 * Presentable failure classes for the three booking RPCs, mapped from the
 * SQLSTATE the server raises:
 *   42501          → permission (edit boundary / company mismatch / no actor)
 *   55000          → conflict   (open booking exists, started, completed, …)
 *   22023 / 22004  → validation (past time, duration/reminder range, assignees)
 *   P0002          → not_found  (visit or opportunity gone)
 */
export type SiteVisitBookingErrorCode =
  | "permission"
  | "conflict"
  | "validation"
  | "not_found"
  | "unknown";

export class SiteVisitBookingError extends Error {
  constructor(
    readonly code: SiteVisitBookingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SiteVisitBookingError";
  }
}

function toBookingError(error: {
  code?: string;
  message: string;
}): SiteVisitBookingError {
  const code = ((): SiteVisitBookingErrorCode => {
    switch (error.code) {
      case "42501":
        return "permission";
      case "55000":
        return "conflict";
      case "22023":
      case "22004":
        return "validation";
      case "P0002":
        return "not_found";
      default:
        return "unknown";
    }
  })();
  return new SiteVisitBookingError(code, error.message);
}

export interface BookSiteVisitInput {
  opportunityId: string;
  scheduledAt: Date;
  /** Omit → server default (60). */
  durationMinutes?: number;
  /** Omit → server defaults to the booker. Same-company user ids. */
  assigneeIds?: string[];
  /** Omit → the assignee's own default lead applies at prompt time. */
  reminderLeadMinutes?: number;
}

export interface RescheduleSiteVisitInput {
  siteVisitId: string;
  /** Always required by the RPC — pass the current time unchanged to keep it. */
  scheduledAt: Date;
  /** Omit → keep the stored duration. */
  durationMinutes?: number;
  /** Omit → keep the stored assignees. */
  assigneeIds?: string[];
  /** Omit → keep; -1 → clear back to the user default; 0–1440 → set. */
  reminderLeadMinutes?: number;
}

/** Lead context embedded on calendar reads — a booking is always lead-attached. */
export interface BookedVisitLead {
  id: string;
  title: string;
  address: string | null;
  clientName: string | null;
}

export type BookedVisitWithLead = SiteVisit & {
  /** Null only if the lead row is unreadable (deleted out from under the visit). */
  lead: BookedVisitLead | null;
};

function mapLeadEmbed(row: Record<string, unknown>): BookedVisitLead | null {
  const lead = row.opportunity as Record<string, unknown> | null | undefined;
  if (!lead) return null;
  const client = lead.client as Record<string, unknown> | null | undefined;
  return {
    id: lead.id as string,
    title: (lead.title as string) ?? "",
    address: (lead.address as string) ?? null,
    clientName: (client?.name as string) ?? null,
  };
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): SiteVisit {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    opportunityId: (row.opportunity_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    scheduledAt: parseDateRequired(row.scheduled_at),
    durationMinutes: Number(row.duration_minutes ?? 60),
    assigneeIds: (row.assignee_ids as string[]) ?? [],
    status: row.status as SiteVisitStatus,
    completedAt: parseDate(row.completed_at),
    notes: (row.notes as string) ?? null,
    internalNotes: (row.internal_notes as string) ?? null,
    measurements: (row.measurements as string) ?? null,
    photos: (row.photos as string[]) ?? [],
    activityId: (row.activity_id as string) ?? null,
    calendarEventId: (row.calendar_event_id as string) ?? null,
    createdBy: row.created_by as string,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
    bookedAt: parseDate(row.booked_at),
    reminderLeadMinutes:
      row.reminder_lead_minutes == null
        ? null
        : Number(row.reminder_lead_minutes),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const SiteVisitService = {
  async fetchSiteVisits(
    companyId: string,
    options: FetchSiteVisitsOptions = {}
  ): Promise<SiteVisit[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("site_visits")
      .select("*")
      .eq("company_id", companyId);

    if (!options.includeDeleted) {
      query = query.is("deleted_at", null);
    }
    if (options.opportunityId) {
      query = query.eq("opportunity_id", options.opportunityId);
    }
    if (options.projectId) {
      query = query.eq("project_id", options.projectId);
    }
    if (options.status) {
      query = query.eq("status", options.status);
    }

    query = query.order("scheduled_at", { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch site visits: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async fetchSiteVisit(id: string): Promise<SiteVisit> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("site_visits")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch site visit: ${error.message}`);
    return mapFromDb(data);
  },

  async createSiteVisit(data: CreateSiteVisit): Promise<SiteVisit> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("site_visits")
      .insert({
        company_id: data.companyId,
        opportunity_id: data.opportunityId,
        project_id: data.projectId,
        client_id: data.clientId,
        scheduled_at: data.scheduledAt instanceof Date
          ? data.scheduledAt.toISOString()
          : data.scheduledAt,
        duration_minutes: data.durationMinutes,
        assignee_ids: data.assigneeIds,
        status: data.status ?? "scheduled",
        notes: data.notes,
        internal_notes: data.internalNotes,
        measurements: data.measurements,
        photos: data.photos ?? [],
        calendar_event_id: data.calendarEventId,
        created_by: data.createdBy,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create site visit: ${error.message}`);
    return mapFromDb(created);
  },

  async updateSiteVisit(id: string, data: Partial<CreateSiteVisit>): Promise<SiteVisit> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (data.scheduledAt !== undefined) {
      row.scheduled_at = data.scheduledAt instanceof Date
        ? data.scheduledAt.toISOString()
        : data.scheduledAt;
    }
    if (data.durationMinutes !== undefined) row.duration_minutes = data.durationMinutes;
    if (data.assigneeIds !== undefined) row.assignee_ids = data.assigneeIds;
    if (data.notes !== undefined) row.notes = data.notes;
    if (data.internalNotes !== undefined) row.internal_notes = data.internalNotes;
    if (data.measurements !== undefined) row.measurements = data.measurements;
    if (data.photos !== undefined) row.photos = data.photos;
    if (data.calendarEventId !== undefined) row.calendar_event_id = data.calendarEventId;

    const { data: updated, error } = await supabase
      .from("site_visits")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update site visit: ${error.message}`);
    return mapFromDb(updated);
  },

  async deleteSiteVisit(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("site_visits")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete site visit: ${error.message}`);
  },

  async startSiteVisit(id: string): Promise<SiteVisit> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("site_visits")
      .update({ status: "in_progress" })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to start site visit: ${error.message}`);
    return mapFromDb(data);
  },

  async completeSiteVisit(
    id: string,
    completionData: {
      notes?: string;
      measurements?: string;
      photos?: string[];
      internalNotes?: string;
    }
  ): Promise<SiteVisit> {
    const supabase = requireSupabase();

    const completion: Record<string, unknown> = {};
    if (completionData.notes !== undefined) completion.notes = completionData.notes;
    if (completionData.measurements !== undefined) {
      completion.measurements = completionData.measurements;
    }
    if (completionData.photos !== undefined) completion.photos = completionData.photos;
    if (completionData.internalNotes !== undefined) {
      completion.internal_notes = completionData.internalNotes;
    }

    const { data, error } = await supabase.rpc("complete_site_visit_guarded", {
      p_site_visit_id: id,
      p_completion: completion,
    });

    if (error) throw new Error(`Failed to complete site visit: ${error.message}`);
    const result = data as { visit?: Record<string, unknown> } | null;
    if (!result?.visit) {
      throw new Error("Failed to complete site visit: invalid database response");
    }
    return mapFromDb(result.visit);
  },

  async cancelSiteVisit(id: string): Promise<SiteVisit> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("site_visits")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to cancel site visit: ${error.message}`);
    return mapFromDb(data);
  },

  // ── Booking (RPC-only write path — side effects live server-side) ─────────

  /**
   * Book an appointment on a lead via `book_site_visit`. The RPC owns every
   * side effect: the visit row, the timeline activity, the new_lead →
   * qualifying nudge, and Google Calendar sync enqueueing.
   */
  async bookSiteVisit(input: BookSiteVisitInput): Promise<string> {
    const supabase = requireSupabase();

    const args: Record<string, unknown> = {
      p_opportunity_id: input.opportunityId,
      p_scheduled_at: input.scheduledAt.toISOString(),
    };
    if (input.durationMinutes !== undefined) {
      args.p_duration_minutes = input.durationMinutes;
    }
    if (input.assigneeIds !== undefined) {
      args.p_assignee_ids = input.assigneeIds;
    }
    if (input.reminderLeadMinutes !== undefined) {
      args.p_reminder_lead_minutes = input.reminderLeadMinutes;
    }

    const { data, error } = await supabase.rpc("book_site_visit", args);
    if (error) throw toBookingError(error);
    return data as string;
  },

  /**
   * Move / edit an open booking via `reschedule_site_visit`. Only
   * `status='scheduled'` bookings can move; the changed time re-arms the
   * reminder prompts by construction (dedupe keys carry the epoch).
   */
  async rescheduleSiteVisit(input: RescheduleSiteVisitInput): Promise<string> {
    const supabase = requireSupabase();

    const args: Record<string, unknown> = {
      p_site_visit_id: input.siteVisitId,
      p_scheduled_at: input.scheduledAt.toISOString(),
    };
    if (input.durationMinutes !== undefined) {
      args.p_duration_minutes = input.durationMinutes;
    }
    if (input.assigneeIds !== undefined) {
      args.p_assignee_ids = input.assigneeIds;
    }
    if (input.reminderLeadMinutes !== undefined) {
      args.p_reminder_lead_minutes = input.reminderLeadMinutes;
    }

    const { data, error } = await supabase.rpc("reschedule_site_visit", args);
    if (error) throw toBookingError(error);
    return data as string;
  },

  /**
   * Cancel an open booking via `cancel_site_visit_booking` (idempotent — a
   * second cancel of the same booking is a no-op success).
   */
  async cancelSiteVisitBooking(siteVisitId: string): Promise<string> {
    const supabase = requireSupabase();

    const { data, error } = await supabase.rpc("cancel_site_visit_booking", {
      p_site_visit_id: siteVisitId,
    });
    if (error) throw toBookingError(error);
    return data as string;
  },

  /**
   * Booked appointments for the calendar's third source. Guarded read:
   * `booked_at IS NOT NULL AND deleted_at IS NULL` (never status alone —
   * legacy walk-up rows carry junk scheduled_at values), active statuses
   * only, ordered by start. Rides the `site_visits_booked_window_idx`
   * partial index on (company_id, scheduled_at).
   */
  async getBookedVisitsInRange(
    companyId: string,
    rangeStart: Date,
    rangeEnd: Date,
    options: { assigneeId?: string } = {}
  ): Promise<BookedVisitWithLead[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("site_visits")
      .select("*, opportunity:opportunities(id, title, address, client:clients(name))")
      .eq("company_id", companyId)
      .not("booked_at", "is", null)
      .is("deleted_at", null)
      .in("status", ["scheduled", "in_progress"])
      .gte("scheduled_at", rangeStart.toISOString())
      .lte("scheduled_at", rangeEnd.toISOString());

    if (options.assigneeId) {
      query = query.contains("assignee_ids", [options.assigneeId]);
    }

    const { data, error } = await query.order("scheduled_at", {
      ascending: true,
    });

    if (error) {
      throw new Error(`Failed to fetch booked visits: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
      ...mapFromDb(row),
      lead: mapLeadEmbed(row),
    }));
  },

  /**
   * The lead's open booking, if any — the one-open-booking rule means there
   * is at most one `scheduled` booked visit per lead at a time. Guarded read
   * (booked_at discriminator), soonest first for safety.
   */
  async fetchOpenBooking(opportunityId: string): Promise<SiteVisit | null> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("site_visits")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .not("booked_at", "is", null)
      .is("deleted_at", null)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(1);

    if (error) {
      throw new Error(`Failed to fetch open booking: ${error.message}`);
    }
    const row = (data ?? [])[0];
    return row ? mapFromDb(row) : null;
  },

  async addPhoto(id: string, url: string): Promise<SiteVisit> {
    const supabase = requireSupabase();

    // Use array append so we don't overwrite concurrently added photos
    const { data, error } = await supabase.rpc("append_site_visit_photo", {
      p_id: id,
      p_url: url,
    });

    if (error) {
      // Fallback: fetch current photos and append manually
      const current = await SiteVisitService.fetchSiteVisit(id);
      return SiteVisitService.updateSiteVisit(id, {
        photos: [...current.photos, url],
      });
    }

    return mapFromDb(data);
  },
};
