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
