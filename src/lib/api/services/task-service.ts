/**
 * OPS Web - Task Service (Supabase)
 *
 * Complete CRUD operations for ProjectTasks stored in Supabase `project_tasks` table.
 * Includes calendar event creation for task scheduling.
 * Replaces the old Bubble.io-based implementation.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { ProjectTask, TaskStatus } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ProjectTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    calendarEventId: (row.calendar_event_id as string) ?? null,
    companyId: row.company_id as string,
    status: (row.status as TaskStatus) ?? "Booked",
    taskColor: (row.task_color as string) ?? "#417394",
    taskNotes: (row.task_notes as string) ?? null,
    taskTypeId: (row.task_type_id as string) ?? "",
    taskIndex: (row.display_order as number) ?? null,
    displayOrder: (row.display_order as number) ?? 0,
    customTitle: (row.custom_title as string) ?? null,
    teamMemberIds: (row.team_member_ids as string[]) ?? [],
    sourceLineItemId: (row.source_line_item_id as string) ?? null,
    sourceEstimateId: (row.source_estimate_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapToDb(data: Partial<ProjectTask>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.projectId !== undefined) row.project_id = data.projectId;
  if (data.calendarEventId !== undefined) row.calendar_event_id = data.calendarEventId;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.status !== undefined) row.status = data.status;
  if (data.taskColor !== undefined) row.task_color = data.taskColor;
  if (data.taskNotes !== undefined) row.task_notes = data.taskNotes;
  if (data.taskTypeId !== undefined) row.task_type_id = data.taskTypeId;
  if (data.customTitle !== undefined) row.custom_title = data.customTitle;
  if (data.teamMemberIds !== undefined) row.team_member_ids = data.teamMemberIds;
  if (data.sourceLineItemId !== undefined) row.source_line_item_id = data.sourceLineItemId;
  if (data.sourceEstimateId !== undefined) row.source_estimate_id = data.sourceEstimateId;
  // Map both taskIndex and displayOrder to display_order
  if (data.displayOrder !== undefined) row.display_order = data.displayOrder;
  else if (data.taskIndex !== undefined) row.display_order = data.taskIndex;
  return row;
}

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchTasksOptions {
  /** Filter by project ID */
  projectId?: string;
  /** Filter by status */
  status?: TaskStatus;
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

export interface CreateTaskWithEventData {
  task: Partial<ProjectTask> & {
    projectId: string;
    companyId: string;
    taskTypeId: string;
  };
  calendarEvent?: {
    title: string;
    startDate: Date;
    endDate?: Date;
    color?: string;
    duration?: number;
    teamMemberIds?: string[];
  };
}

// ─── Task Service ─────────────────────────────────────────────────────────────

export const TaskService = {
  /**
   * Fetch tasks for a company with optional filters.
   */
  async fetchTasks(
    companyId: string,
    options: FetchTasksOptions = {}
  ): Promise<{ tasks: ProjectTask[]; remaining: number; count: number }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const offset = options.cursor ?? 0;

    let query = supabase
      .from("project_tasks")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (options.projectId) {
      query = query.eq("project_id", options.projectId);
    }

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.teamMemberId) {
      query = query.contains("team_member_ids", [options.teamMemberId]);
    }

    if (options.sortField) {
      query = query.order(options.sortField, { ascending: !options.descending });
    } else {
      query = query.order("display_order");
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch tasks: ${error.message}`);

    const total = count ?? 0;
    const tasks = (data ?? []).map(mapFromDb);
    const remaining = Math.max(0, total - offset - tasks.length);

    return { tasks, remaining, count: total };
  },

  /**
   * Fetch all tasks for a specific project.
   */
  async fetchProjectTasks(projectId: string): Promise<ProjectTask[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("display_order");

    if (error) throw new Error(`Failed to fetch project tasks: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /**
   * Fetch a single task by ID.
   */
  async fetchTask(id: string): Promise<ProjectTask> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch task: ${error.message}`);
    return mapFromDb(data);
  },

  /**
   * Create a new task.
   */
  async createTask(
    data: Partial<ProjectTask> & {
      projectId: string;
      companyId: string;
      taskTypeId: string;
    }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: created, error } = await supabase
      .from("project_tasks")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create task: ${error.message}`);
    return created.id as string;
  },

  /**
   * Create a task with an associated calendar event (atomic-ish operation).
   * Creates the calendar event first, then the task with a reference to it.
   */
  async createTaskWithEvent(
    data: CreateTaskWithEventData
  ): Promise<{ taskId: string; calendarEventId: string | null }> {
    const supabase = requireSupabase();
    let calendarEventId: string | null = null;

    // Step 1: Create calendar event if scheduling data is provided
    if (data.calendarEvent) {
      const eventRow: Record<string, unknown> = {
        title: data.calendarEvent.title,
        start_date: data.calendarEvent.startDate.toISOString(),
        color: data.calendarEvent.color ?? data.task.taskColor ?? "#417394",
        duration: data.calendarEvent.duration ?? 1,
        company_id: data.task.companyId,
        project_id: data.task.projectId,
      };

      if (data.calendarEvent.endDate) {
        eventRow.end_date = data.calendarEvent.endDate.toISOString();
      }

      if (data.calendarEvent.teamMemberIds?.length) {
        eventRow.team_member_ids = data.calendarEvent.teamMemberIds;
      }

      const { data: created, error: eventError } = await supabase
        .from("calendar_events")
        .insert(eventRow)
        .select("id")
        .single();

      if (eventError) throw new Error(`Failed to create calendar event: ${eventError.message}`);
      calendarEventId = created.id as string;
    }

    // Step 2: Create the task with calendar event reference
    const taskRow = mapToDb({
      ...data.task,
      calendarEventId,
    });

    const { data: taskCreated, error: taskError } = await supabase
      .from("project_tasks")
      .insert(taskRow)
      .select("id")
      .single();

    if (taskError) throw new Error(`Failed to create task: ${taskError.message}`);

    return { taskId: taskCreated.id as string, calendarEventId };
  },

  /**
   * Update an existing task.
   */
  async updateTask(id: string, data: Partial<ProjectTask>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { error } = await supabase
      .from("project_tasks")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update task: ${error.message}`);
  },

  /**
   * Update only the task status.
   */
  async updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("project_tasks")
      .update({ status })
      .eq("id", id);

    if (error) throw new Error(`Failed to update task status: ${error.message}`);
  },

  /**
   * Soft delete a task and optionally its associated calendar event.
   */
  async deleteTask(id: string, calendarEventId?: string | null): Promise<void> {
    const supabase = requireSupabase();
    const now = new Date().toISOString();

    const { error: taskError } = await supabase
      .from("project_tasks")
      .update({ deleted_at: now })
      .eq("id", id);

    if (taskError) throw new Error(`Failed to delete task: ${taskError.message}`);

    if (calendarEventId) {
      const { error: eventError } = await supabase
        .from("calendar_events")
        .update({ deleted_at: now })
        .eq("id", calendarEventId);

      if (eventError) throw new Error(`Failed to delete calendar event: ${eventError.message}`);
    }
  },

  /**
   * Reorder tasks within a project.
   * Updates display_order for each task.
   */
  async reorderTasks(
    tasks: Array<{ id: string; taskIndex: number }>
  ): Promise<void> {
    const supabase = requireSupabase();

    await Promise.all(
      tasks.map((task) =>
        supabase
          .from("project_tasks")
          .update({ display_order: task.taskIndex })
          .eq("id", task.id)
      )
    );
  },

  /**
   * Fetch all tasks with auto-pagination.
   */
  async fetchAllTasks(
    companyId: string,
    options: Omit<FetchTasksOptions, "limit" | "cursor"> = {}
  ): Promise<ProjectTask[]> {
    const allTasks: ProjectTask[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await TaskService.fetchTasks(companyId, {
        ...options,
        limit: 100,
        cursor: offset,
      });

      allTasks.push(...result.tasks);
      hasMore = result.remaining > 0;
      offset += result.tasks.length;
    }

    return allTasks;
  },

  /**
   * Bulk-create ProjectTasks from approved task proposals.
   * Called after the Review Tasks modal is confirmed.
   */
  async createTasksFromProposals(
    proposals: Array<{
      title: string;
      taskTypeId: string;
      defaultTeamMemberIds: string[];
      lineItemId: string;
      estimateId: string;
      selected: boolean;
    }>,
    projectId: string,
    companyId: string
  ): Promise<string[]> {
    const supabase = requireSupabase();
    const selected = proposals.filter((p) => p.selected);

    const rows = selected.map((proposal, idx) => ({
      project_id: projectId,
      company_id: companyId,
      task_type_id: proposal.taskTypeId,
      status: "Booked",
      display_order: idx,
      team_member_ids: proposal.defaultTeamMemberIds,
      custom_title: proposal.title,
      source_line_item_id: proposal.lineItemId,
      source_estimate_id: proposal.estimateId,
    }));

    const { data, error } = await supabase
      .from("project_tasks")
      .insert(rows)
      .select("id");

    if (error) throw new Error(`Failed to create tasks from proposals: ${error.message}`);
    return (data ?? []).map((r) => r.id as string);
  },
};

export default TaskService;
