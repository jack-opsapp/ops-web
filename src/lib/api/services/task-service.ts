/**
 * OPS Web - Task Service (Supabase)
 *
 * Complete CRUD operations for ProjectTasks stored in Supabase `project_tasks` table.
 * Scheduling data (dates, duration) is stored directly on the task.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import { TaskStatus } from "../../types/models";
import type { ProjectTask, TaskType } from "../../types/models";

// ─── Status Mapping (DB snake_case ↔ TypeScript enum) ────────────────────────

function parseTaskStatus(raw: unknown): TaskStatus {
  if (typeof raw !== "string") return TaskStatus.Booked;
  switch (raw.toLowerCase().replace(/\s+/g, "_")) {
    case "booked":
    case "active": return TaskStatus.Booked;
    case "in_progress": return TaskStatus.InProgress;
    case "completed": return TaskStatus.Completed;
    case "cancelled": return TaskStatus.Cancelled;
    default: return TaskStatus.Booked;
  }
}

function serializeTaskStatus(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.Booked: return "active";
    case TaskStatus.InProgress: return "in_progress";
    case TaskStatus.Completed: return "completed";
    case TaskStatus.Cancelled: return "cancelled";
    default: return "active";
  }
}

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapTaskTypeFromDb(raw: unknown): TaskType | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: r.id as string,
    display: r.display as string,
    color: r.color as string,
    icon: (r.icon as string) ?? null,
    isDefault: (r.is_default as boolean) ?? false,
    companyId: r.company_id as string,
    displayOrder: (r.display_order as number) ?? 0,
    defaultTeamMemberIds: (r.default_team_member_ids as string[]) ?? [],
    dependencies: (r.dependencies as TaskType["dependencies"]) ?? [],
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(r.deleted_at),
  };
}

function mapFromDb(row: Record<string, unknown>): ProjectTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    companyId: row.company_id as string,
    status: parseTaskStatus(row.status),
    taskColor: (row.task_color as string) ?? "#417394",
    taskNotes: (row.task_notes as string) ?? null,
    taskTypeId: (row.task_type_id as string) ?? "",
    taskIndex: (row.display_order as number) ?? null,
    displayOrder: (row.display_order as number) ?? 0,
    customTitle: (row.custom_title as string) ?? null,
    teamMemberIds: (row.team_member_ids as string[]) ?? [],
    sourceLineItemId: (row.source_line_item_id as string) ?? null,
    sourceEstimateId: (row.source_estimate_id as string) ?? null,
    dependencyOverrides: (row.dependency_overrides as ProjectTask["dependencyOverrides"]) ?? null,
    startDate: parseDate(row.start_date),
    endDate: parseDate(row.end_date),
    duration: (row.duration as number) ?? 1,
    startTime: (row.start_time as string) ?? null,
    endTime: (row.end_time as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
    taskType: mapTaskTypeFromDb(row.task_type),
  };
}

function mapToDb(data: Partial<ProjectTask>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.projectId !== undefined) row.project_id = data.projectId;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.status !== undefined) row.status = serializeTaskStatus(data.status);
  if (data.taskColor !== undefined) row.task_color = data.taskColor;
  if (data.taskNotes !== undefined) row.task_notes = data.taskNotes;
  if (data.taskTypeId !== undefined) row.task_type_id = data.taskTypeId;
  if (data.customTitle !== undefined) row.custom_title = data.customTitle;
  if (data.teamMemberIds !== undefined) row.team_member_ids = data.teamMemberIds;
  if (data.sourceLineItemId !== undefined) row.source_line_item_id = data.sourceLineItemId;
  if (data.sourceEstimateId !== undefined) row.source_estimate_id = data.sourceEstimateId;
  if (data.dependencyOverrides !== undefined) row.dependency_overrides = data.dependencyOverrides;
  if (data.startDate !== undefined) row.start_date = data.startDate?.toISOString() ?? null;
  if (data.endDate !== undefined) row.end_date = data.endDate?.toISOString() ?? null;
  if (data.duration !== undefined) row.duration = data.duration;
  if (data.startTime !== undefined) row.start_time = data.startTime;
  if (data.endTime !== undefined) row.end_time = data.endTime;
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
  /** Filter tasks starting on or after this date */
  startDateFrom?: Date;
  /** Filter tasks starting on or before this date */
  startDateTo?: Date;
  /** Only return tasks that have a start_date (scheduled) */
  scheduledOnly?: boolean;
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
  schedule?: {
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
      .select("*, task_type:task_types(*)", { count: "exact" })
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (options.projectId) {
      query = query.eq("project_id", options.projectId);
    }

    if (options.status) {
      query = query.eq("status", serializeTaskStatus(options.status));
    }

    if (options.teamMemberId) {
      query = query.contains("team_member_ids", [options.teamMemberId]);
    }

    if (options.scheduledOnly) {
      query = query.not("start_date", "is", null);
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
      .select("*, task_type:task_types(*)")
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
      .select("*, task_type:task_types(*)")
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
   * Create a task with scheduling data.
   * Dates are stored directly on the task (calendar_events table is deprecated).
   */
  async createTaskWithEvent(
    data: CreateTaskWithEventData
  ): Promise<{ taskId: string }> {
    const supabase = requireSupabase();

    // Merge scheduling data into the task
    const taskData: Partial<ProjectTask> = { ...data.task };
    if (data.schedule) {
      taskData.startDate = data.schedule.startDate;
      taskData.endDate = data.schedule.endDate ?? null;
      taskData.duration = data.schedule.duration ?? 1;
      if (data.schedule.teamMemberIds?.length) {
        taskData.teamMemberIds = data.schedule.teamMemberIds;
      }
      if (data.schedule.color) {
        taskData.taskColor = data.schedule.color;
      }
    }

    const taskRow = mapToDb(taskData);

    const { data: taskCreated, error: taskError } = await supabase
      .from("project_tasks")
      .insert(taskRow)
      .select("id")
      .single();

    if (taskError) throw new Error(`Failed to create task: ${taskError.message}`);

    return { taskId: taskCreated.id as string };
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
      .update({ status: serializeTaskStatus(status) })
      .eq("id", id);

    if (error) throw new Error(`Failed to update task status: ${error.message}`);
  },

  /**
   * Soft delete a task.
   */
  async deleteTask(id: string): Promise<void> {
    const supabase = requireSupabase();
    const now = new Date().toISOString();

    const { error: taskError } = await supabase
      .from("project_tasks")
      .update({ deleted_at: now })
      .eq("id", id);

    if (taskError) throw new Error(`Failed to delete task: ${taskError.message}`);
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
   * Fetch all scheduled tasks for a date range (auto-paginates).
   * Used by the calendar view.
   */
  async fetchScheduledTasksForRange(
    companyId: string,
    startDate: Date,
    endDate: Date,
    options: Omit<FetchTasksOptions, "startDateFrom" | "startDateTo" | "scheduledOnly" | "limit" | "cursor"> = {}
  ): Promise<ProjectTask[]> {
    const allTasks: ProjectTask[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await TaskService.fetchTasks(companyId, {
        ...options,
        startDateFrom: startDate,
        startDateTo: endDate,
        scheduledOnly: true,
        sortField: "start_date",
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
