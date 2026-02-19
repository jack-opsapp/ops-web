/**
 * OPS Web - Project Service (Supabase)
 *
 * Complete CRUD operations for Projects stored in Supabase `projects` table.
 * Project teamMembers is computed from tasks, NOT stored directly.
 * Replaces the old Bubble.io-based implementation.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { Project, ProjectStatus } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    title: row.title as string,
    address: (row.address as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    startDate: parseDate(row.start_date),
    endDate: parseDate(row.end_date),
    duration: (row.duration as number) ?? null,
    status: (row.status as ProjectStatus) ?? "RFQ",
    notes: (row.notes as string) ?? null,
    companyId: row.company_id as string,
    clientId: (row.client_id as string) ?? null,
    allDay: (row.all_day as boolean) ?? false,
    teamMemberIds: (row.team_member_ids as string[]) ?? [],
    projectDescription: (row.description as string) ?? null,
    projectImages: (row.project_images as string[]) ?? [],
    opportunityId: (row.opportunity_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    syncPriority: 0,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapToDb(data: Partial<Project>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.title !== undefined) row.title = data.title;
  if (data.address !== undefined) row.address = data.address;
  if (data.latitude !== undefined) row.latitude = data.latitude;
  if (data.longitude !== undefined) row.longitude = data.longitude;
  if (data.startDate !== undefined)
    row.start_date = data.startDate?.toISOString() ?? null;
  if (data.endDate !== undefined)
    row.end_date = data.endDate?.toISOString() ?? null;
  if (data.duration !== undefined) row.duration = data.duration;
  if (data.status !== undefined) row.status = data.status;
  if (data.notes !== undefined) row.notes = data.notes;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.clientId !== undefined) row.client_id = data.clientId;
  if (data.allDay !== undefined) row.all_day = data.allDay;
  if (data.teamMemberIds !== undefined) row.team_member_ids = data.teamMemberIds;
  if (data.projectDescription !== undefined) row.description = data.projectDescription;
  if (data.projectImages !== undefined) row.project_images = data.projectImages;
  if (data.opportunityId !== undefined) row.opportunity_id = data.opportunityId;
  return row;
}

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchProjectsOptions {
  /** Filter by status */
  status?: ProjectStatus;
  /** Filter by client ID */
  clientId?: string;
  /** Start date filter (projects starting on or after this date) */
  startDateFrom?: Date;
  /** Start date filter (projects starting on or before this date) */
  startDateTo?: Date;
  /** Sort field (snake_case column name) */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit (max 100) */
  limit?: number;
  /** Pagination offset */
  cursor?: number;
}

// ─── Project Service ──────────────────────────────────────────────────────────

export const ProjectService = {
  /**
   * Fetch projects for a company with optional filters and pagination.
   */
  async fetchProjects(
    companyId: string,
    options: FetchProjectsOptions = {}
  ): Promise<{ projects: Project[]; remaining: number; count: number }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const offset = options.cursor ?? 0;

    let query = supabase
      .from("projects")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.clientId) {
      query = query.eq("client_id", options.clientId);
    }

    if (options.startDateFrom) {
      query = query.gte("start_date", options.startDateFrom.toISOString());
    }

    if (options.startDateTo) {
      query = query.lte("start_date", options.startDateTo.toISOString());
    }

    if (options.sortField) {
      query = query.order(options.sortField, { ascending: !options.descending });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch projects: ${error.message}`);

    const total = count ?? 0;
    const projects = (data ?? []).map(mapFromDb);
    const remaining = Math.max(0, total - offset - projects.length);

    return { projects, remaining, count: total };
  },

  /**
   * Fetch projects assigned to a specific user (field crew view).
   * Uses PostgreSQL array containment to match team_member_ids.
   */
  async fetchUserProjects(
    userId: string,
    companyId: string,
    options: Omit<FetchProjectsOptions, "clientId"> = {}
  ): Promise<{ projects: Project[]; remaining: number; count: number }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const offset = options.cursor ?? 0;

    let query = supabase
      .from("projects")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .contains("team_member_ids", [userId])
      .is("deleted_at", null);

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.startDateFrom) {
      query = query.gte("start_date", options.startDateFrom.toISOString());
    }

    if (options.startDateTo) {
      query = query.lte("start_date", options.startDateTo.toISOString());
    }

    if (options.sortField) {
      query = query.order(options.sortField, { ascending: !options.descending });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch user projects: ${error.message}`);

    const total = count ?? 0;
    const projects = (data ?? []).map(mapFromDb);
    const remaining = Math.max(0, total - offset - projects.length);

    return { projects, remaining, count: total };
  },

  /**
   * Fetch a single project by ID.
   */
  async fetchProject(id: string): Promise<Project> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch project: ${error.message}`);
    return mapFromDb(data);
  },

  /**
   * Create a new project.
   */
  async createProject(
    data: Partial<Project> & { title: string; companyId: string }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: created, error } = await supabase
      .from("projects")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create project: ${error.message}`);
    return created.id as string;
  },

  /**
   * Update an existing project.
   */
  async updateProject(id: string, data: Partial<Project>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { error } = await supabase
      .from("projects")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update project: ${error.message}`);
  },

  /**
   * Update only the project status.
   */
  async updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("projects")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`Failed to update project status: ${error.message}`);
  },

  /**
   * Soft delete a project.
   */
  async deleteProject(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete project: ${error.message}`);
  },

  /**
   * Fetch all projects with auto-pagination.
   */
  async fetchAllProjects(
    companyId: string,
    options: Omit<FetchProjectsOptions, "limit" | "cursor"> = {}
  ): Promise<Project[]> {
    const allProjects: Project[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await ProjectService.fetchProjects(companyId, {
        ...options,
        limit: 100,
        cursor: offset,
      });

      allProjects.push(...result.projects);
      hasMore = result.remaining > 0;
      offset += result.projects.length;
    }

    return allProjects;
  },
};

export default ProjectService;
