/**
 * OPS Web - Project Service
 *
 * Complete CRUD operations for Projects using the Bubble Data API.
 * All queries filter out soft-deleted items (deletedAt == null).
 * Project teamMembers is computed from tasks, NOT from Bubble legacy field.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleProjectFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type ProjectDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  projectDtoToModel,
  projectModelToDto,
} from "../../types/dto";
import type { Project, ProjectStatus } from "../../types/models";

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
  /** Sort field */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit (max 100) */
  limit?: number;
  /** Pagination cursor (offset) */
  cursor?: number;
}

// ─── Project Service ──────────────────────────────────────────────────────────

export const ProjectService = {
  /**
   * Fetch all projects for a company with optional filters.
   * Automatically filters out soft-deleted items.
   */
  async fetchProjects(
    companyId: string,
    options: FetchProjectsOptions = {}
  ): Promise<{ projects: Project[]; remaining: number; count: number }> {
    const client = getBubbleClient();

    // Build constraints
    const constraints: BubbleConstraint[] = [
      {
        key: BubbleProjectFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleProjectFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    // Optional status filter
    if (options.status) {
      constraints.push({
        key: BubbleProjectFields.status,
        constraint_type: BubbleConstraintType.equals,
        value: options.status,
      });
    }

    // Optional client filter
    if (options.clientId) {
      constraints.push({
        key: BubbleProjectFields.client,
        constraint_type: BubbleConstraintType.equals,
        value: options.clientId,
      });
    }

    // Optional date range filter
    if (options.startDateFrom) {
      constraints.push({
        key: BubbleProjectFields.startDate,
        constraint_type: BubbleConstraintType.greaterThan,
        value: options.startDateFrom.toISOString(),
      });
    }

    if (options.startDateTo) {
      constraints.push({
        key: BubbleProjectFields.startDate,
        constraint_type: BubbleConstraintType.lessThan,
        value: options.startDateTo.toISOString(),
      });
    }

    // Build query params
    const params: Record<string, string | number> = {
      constraints: JSON.stringify(constraints),
      limit: Math.min(options.limit ?? 100, 100),
      cursor: options.cursor ?? 0,
    };

    if (options.sortField) {
      params.sort_field = options.sortField;
      params.descending = options.descending ? "true" : "false";
    }

    const response = await client.get<BubbleListResponse<ProjectDTO>>(
      `/obj/${BubbleTypes.project.toLowerCase()}`,
      { params }
    );

    const projects = response.response.results.map(projectDtoToModel);

    return {
      projects,
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  /**
   * Fetch all projects assigned to a specific user (for field crew view).
   * Filters by teamMembers containing the user ID.
   */
  async fetchUserProjects(
    userId: string,
    companyId: string,
    options: Omit<FetchProjectsOptions, "clientId"> = {}
  ): Promise<{ projects: Project[]; remaining: number; count: number }> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleProjectFields.company,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleProjectFields.teamMembers,
        constraint_type: BubbleConstraintType.contains,
        value: userId,
      },
      {
        key: BubbleProjectFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.status) {
      constraints.push({
        key: BubbleProjectFields.status,
        constraint_type: BubbleConstraintType.equals,
        value: options.status,
      });
    }

    const params: Record<string, string | number> = {
      constraints: JSON.stringify(constraints),
      limit: Math.min(options.limit ?? 100, 100),
      cursor: options.cursor ?? 0,
    };

    if (options.sortField) {
      params.sort_field = options.sortField;
      params.descending = options.descending ? "true" : "false";
    }

    const response = await client.get<BubbleListResponse<ProjectDTO>>(
      `/obj/${BubbleTypes.project.toLowerCase()}`,
      { params }
    );

    const projects = response.response.results.map(projectDtoToModel);

    return {
      projects,
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  /**
   * Fetch a single project by ID.
   */
  async fetchProject(id: string): Promise<Project> {
    const client = getBubbleClient();

    const response = await client.get<BubbleObjectResponse<ProjectDTO>>(
      `/obj/${BubbleTypes.project.toLowerCase()}/${id}`
    );

    return projectDtoToModel(response.response);
  },

  /**
   * Create a new project.
   * Maps field names to exact Bubble field names.
   */
  async createProject(
    data: Partial<Project> & { title: string; companyId: string }
  ): Promise<string> {
    const client = getBubbleClient();

    const dto = projectModelToDto(data);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleTypes.project.toLowerCase()}`,
      dto
    );

    return response.id;
  },

  /**
   * Update an existing project.
   * Only sends changed fields to minimize API calls.
   */
  async updateProject(
    id: string,
    data: Partial<Project>
  ): Promise<void> {
    const client = getBubbleClient();

    const dto = projectModelToDto(data);

    await client.patch(
      `/obj/${BubbleTypes.project.toLowerCase()}/${id}`,
      dto
    );
  },

  /**
   * Update project status via workflow API.
   * Some status transitions may trigger server-side logic.
   */
  async updateProjectStatus(
    id: string,
    status: ProjectStatus
  ): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.project.toLowerCase()}/${id}`,
      { [BubbleProjectFields.status]: status }
    );
  },

  /**
   * Soft delete a project.
   * Sets deletedAt timestamp rather than physically deleting.
   */
  async deleteProject(id: string): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.project.toLowerCase()}/${id}`,
      { [BubbleProjectFields.deletedAt]: new Date().toISOString() }
    );
  },

  /**
   * Fetch all projects with pagination support (auto-fetches all pages).
   */
  async fetchAllProjects(
    companyId: string,
    options: Omit<FetchProjectsOptions, "limit" | "cursor"> = {}
  ): Promise<Project[]> {
    const allProjects: Project[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await ProjectService.fetchProjects(companyId, {
        ...options,
        limit: 100,
        cursor,
      });

      allProjects.push(...result.projects);
      remaining = result.remaining;
      cursor += result.projects.length;
    }

    return allProjects;
  },
};

export default ProjectService;
