/**
 * OPS Web - Project Photo Service
 *
 * CRUD operations for ProjectPhotos using Supabase.
 * Provides structured photo gallery management per project,
 * grouped by source (site_visit, in_progress, completion, other).
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  ProjectPhoto,
  CreateProjectPhoto,
  PhotoSource,
} from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ProjectPhoto {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    companyId: row.company_id as string,
    url: row.url as string,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    source: row.source as PhotoSource,
    siteVisitId: (row.site_visit_id as string) ?? null,
    uploadedBy: row.uploaded_by as string,
    takenAt: parseDate(row.taken_at),
    caption: (row.caption as string) ?? null,
    deletedAt: parseDate(row.deleted_at),
    createdAt: parseDateRequired(row.created_at),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ProjectPhotoService = {
  async fetchProjectPhotos(
    projectId: string,
    companyId: string
  ): Promise<ProjectPhoto[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("project_photos")
      .select("*")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch project photos: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async createProjectPhoto(data: CreateProjectPhoto): Promise<ProjectPhoto> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("project_photos")
      .insert({
        project_id: data.projectId,
        company_id: data.companyId,
        url: data.url,
        thumbnail_url: data.thumbnailUrl,
        source: data.source,
        site_visit_id: data.siteVisitId,
        uploaded_by: data.uploadedBy,
        taken_at: data.takenAt instanceof Date ? data.takenAt.toISOString() : data.takenAt,
        caption: data.caption,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create project photo: ${error.message}`);
    return mapFromDb(created);
  },

  async deleteProjectPhoto(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("project_photos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete project photo: ${error.message}`);
  },

  /**
   * Called on job win — copies all photos from a SiteVisit into the project gallery.
   * Photos get source = 'site_visit' with site_visit_id set for traceability.
   */
  async attachSiteVisitPhotos(
    siteVisitId: string,
    siteVisitPhotos: string[],
    projectId: string,
    companyId: string,
    uploadedBy: string
  ): Promise<ProjectPhoto[]> {
    if (siteVisitPhotos.length === 0) return [];

    const supabase = requireSupabase();

    const rows = siteVisitPhotos.map((url) => ({
      project_id: projectId,
      company_id: companyId,
      url,
      source: "site_visit" as const,
      site_visit_id: siteVisitId,
      uploaded_by: uploadedBy,
    }));

    const { data, error } = await supabase
      .from("project_photos")
      .insert(rows)
      .select();

    if (error) throw new Error(`Failed to attach site visit photos: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /**
   * One-time migration: if projectImages string exists but no ProjectPhoto rows,
   * creates ProjectPhoto rows with source = 'other' from the comma-separated URLs.
   */
  async migrateProjectImages(
    projectId: string,
    companyId: string,
    projectImagesUrls: string[],
    uploadedBy: string
  ): Promise<void> {
    const supabase = requireSupabase();

    // Check if photos already exist
    const { data: existing } = await supabase
      .from("project_photos")
      .select("id")
      .eq("project_id", projectId)
      .limit(1);

    if ((existing ?? []).length > 0) return; // Already migrated

    if (projectImagesUrls.length === 0) return;

    const rows = projectImagesUrls.map((url) => ({
      project_id: projectId,
      company_id: companyId,
      url,
      source: "other" as const,
      uploaded_by: uploadedBy,
    }));

    await supabase.from("project_photos").insert(rows);
  },
};
