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
  // Production project_tasks.status CHECK constraint — verified
  // 2026-04-14 via information_schema.check_constraints:
  //   status IN ('active', 'completed', 'cancelled')
  //
  // There is intentionally NO 'in_progress' slot on project_tasks — the
  // migrate_task_status_to_active migration collapsed Booked+InProgress
  // into a single 'active' state. The TS enum keeps both values for iOS
  // parity, so we collapse InProgress → active on write. parseTaskStatus
  // still accepts in_progress on read for forward-compat.
  switch (status) {
    case TaskStatus.Booked: return "active";
    case TaskStatus.InProgress: return "active";
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

function mapClientFromDb(raw: unknown): import("@/lib/types/models").Client | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.name as string,
    email: (r.email as string) ?? null,
    phoneNumber: (r.phone_number as string) ?? null,
    address: (r.address as string) ?? null,
    latitude: (r.latitude as number) ?? null,
    longitude: (r.longitude as number) ?? null,
    profileImageURL: (r.profile_image_url as string) ?? null,
    notes: (r.notes as string) ?? null,
    companyId: (r.company_id as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    createdAt: parseDate(r.created_at),
    deletedAt: parseDate(r.deleted_at),
  };
}

function mapProjectFromDb(raw: unknown): import("@/lib/types/models").Project | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawVisibility = r.visibility;
  const visibility: import("@/lib/types/models").Project["visibility"] =
    rawVisibility === "office" || rawVisibility === "private"
      ? rawVisibility
      : "all";
  return {
    id: r.id as string,
    title: r.title as string,
    address: (r.address as string) ?? null,
    latitude: (r.latitude as number) ?? null,
    longitude: (r.longitude as number) ?? null,
    startDate: parseDate(r.start_date),
    endDate: parseDate(r.end_date),
    duration: (r.duration as number) ?? null,
    status: (r.status as import("@/lib/types/models").Project["status"]) ?? "rfq" as never,
    notes: (r.notes as string) ?? null,
    companyId: r.company_id as string,
    clientId: (r.client_id as string) ?? null,
    opportunityId: (r.opportunity_id as string) ?? null,
    allDay: (r.all_day as boolean) ?? true,
    teamMemberIds: (r.team_member_ids as string[]) ?? [],
    projectDescription: (r.project_description as string) ?? null,
    projectImages: (r.project_images as string[]) ?? [],
    trade:
      r.trade === "roofing" || r.trade === "hvac" || r.trade === "plumbing"
        ? (r.trade as "roofing" | "hvac" | "plumbing")
        : null,
    visibility,
    createdAt: parseDate(r.created_at),
    lastSyncedAt: null,
    needsSync: false,
    syncPriority: (r.sync_priority as number) ?? 0,
    deletedAt: parseDate(r.deleted_at),
    client: mapClientFromDb(r.client),
  };
}

/**
 * Find a default admin/owner user id for a company. Used by fire-and-forget
 * hooks inside task mutations to attribute agent actions without requiring
 * the caller to pass a userId.
 */
async function findDefaultUserForCompany(
  companyId: string
): Promise<string | null> {
  const supabase = requireSupabase();

  const { data: company } = await supabase
    .from("companies")
    .select("admin_ids")
    .eq("id", companyId)
    .maybeSingle();

  // companies.admin_ids is text[] in Supabase; older code paths assumed it
  // came back as a comma-separated string. Handle both shapes defensively.
  const rawAdminIds = company?.admin_ids;
  const adminIds: string[] = Array.isArray(rawAdminIds)
    ? rawAdminIds.filter((s): s is string => typeof s === "string" && s.length > 0)
    : typeof rawAdminIds === "string"
      ? rawAdminIds.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  if (adminIds.length > 0) return adminIds[0];

  const { data: roleMatch } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .in("role", ["admin", "owner"])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  return (roleMatch?.id as string) ?? null;
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
    allDay: (row.all_day as boolean) ?? true,
    recurrenceId: (row.recurrence_id as string) ?? null,
    recurrenceOriginDate: (row.recurrence_origin_date as string) ?? null,
    scheduleConfirmedAt: parseDate(row.schedule_confirmed_at),
    scheduleConfirmedBy: (row.schedule_confirmed_by as string) ?? null,
    updatedAt: parseDate(row.updated_at),
    inventoryDeducted: (row.inventory_deducted as boolean) ?? false,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
    taskType: mapTaskTypeFromDb(row.task_type),
    project: mapProjectFromDb(row.project),
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
  if (data.allDay !== undefined) row.all_day = data.allDay;
  if (data.recurrenceId !== undefined) row.recurrence_id = data.recurrenceId;
  if (data.recurrenceOriginDate !== undefined) row.recurrence_origin_date = data.recurrenceOriginDate;
  // Map both taskIndex and displayOrder to display_order
  if (data.displayOrder !== undefined) row.display_order = data.displayOrder;
  else if (data.taskIndex !== undefined) row.display_order = data.taskIndex;
  if (data.inventoryDeducted !== undefined) row.inventory_deducted = data.inventoryDeducted;
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
  /**
   * Filter tasks whose span overlaps the visible window. Sets
   * `start_date <= rangeEnd AND (end_date >= rangeStart OR end_date IS NULL
   * AND start_date >= rangeStart)`. Mutually exclusive with startDateFrom /
   * startDateTo — use one or the other.
   */
  overlapRangeStart?: Date;
  overlapRangeEnd?: Date;
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
      .select("*, task_type:task_types(*), project:projects(*, client:clients(*))", { count: "exact" })
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

    if (options.overlapRangeStart && options.overlapRangeEnd) {
      // Range-overlap filter for multi-day tasks. Without this a task that
      // spans Mon→Fri but starts before the visible Wed→Sun window would
      // vanish from the calendar even though it's actively in flight.
      // Postgres-side: start_date <= rangeEnd AND
      //   (end_date >= rangeStart OR (end_date IS NULL AND start_date >= rangeStart))
      // Single-day tasks (end_date IS NULL) still surface because the
      // start_date upper bound is the rangeEnd; the OR catches them when
      // their start sits inside the window.
      const rangeStartISO = options.overlapRangeStart.toISOString();
      const rangeEndISO = options.overlapRangeEnd.toISOString();
      query = query
        .lte("start_date", rangeEndISO)
        .or(
          `end_date.gte.${rangeStartISO},and(end_date.is.null,start_date.gte.${rangeStartISO})`,
        );
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
      .select("*, task_type:task_types(*), project:projects(*, client:clients(*))")
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
      .select("*, task_type:task_types(*), project:projects(*, client:clients(*))")
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

    const newTaskId = taskCreated.id as string;

    // S2 Amendment: fire the full_auto appointment confirmation dispatcher
    // if the company's appointment_confirmation.level is 'full_auto'. This
    // catches manual creation paths (calendar, task-form, task-list) —
    // executeCreateTask (agent path) also fires this, so both surfaces are
    // covered. Phase C gated inside the service; fire-and-forget.
    if (taskData.startDate && data.task.companyId) {
      const companyIdValue = data.task.companyId;
      void (async () => {
        try {
          const userId = await findDefaultUserForCompany(companyIdValue);
          if (!userId) return;
          const { ClientSchedulingCommsService } = await import(
            "./client-scheduling-comms-service"
          );
          await ClientSchedulingCommsService.onTaskCreatedMaybeFullAuto(
            companyIdValue,
            userId,
            newTaskId
          );
        } catch (err) {
          console.error(
            "[task-service] full_auto dispatcher after createTaskWithEvent:",
            err instanceof Error ? err.message : err
          );
        }
      })();
    }

    return { taskId: newTaskId };
  },

  /**
   * Update an existing task.
   *
   * Fires a fire-and-forget schedule cascade check when schedule-relevant
   * fields change (start/end dates, team member assignments). This lets the
   * agent detect downstream impacts from manual calendar/task edits —
   * drag-and-drop schedule changes, direct reassignments, etc.
   */
  async updateTask(id: string, data: Partial<ProjectTask>): Promise<void> {
    const supabase = requireSupabase();

    // Capture prior state — needed to detect "confirmed task rescheduled"
    // which fires the appointment_confirmation.reschedule_behavior dispatcher.
    const { data: priorRow } = await supabase
      .from("project_tasks")
      .select("company_id, start_date, schedule_confirmed_at")
      .eq("id", id)
      .maybeSingle();

    const row = mapToDb(data);

    const { error } = await supabase
      .from("project_tasks")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update task: ${error.message}`);

    // Detect if schedule-relevant fields changed → fire cascade check.
    const scheduleRelevant =
      data.startDate !== undefined ||
      data.endDate !== undefined ||
      data.startTime !== undefined ||
      data.endTime !== undefined ||
      data.allDay !== undefined ||
      data.teamMemberIds !== undefined ||
      data.duration !== undefined;

    // Detect if start_date actually changed on a previously-confirmed task.
    const priorStartIso = priorRow?.start_date as string | null | undefined;
    const newStart = data.startDate;
    const startChanged =
      newStart !== undefined &&
      (priorStartIso ?? null) !== (newStart?.toISOString() ?? null);
    const wasConfirmed = !!priorRow?.schedule_confirmed_at;
    const shouldFireRescheduleHook = startChanged && wasConfirmed;

    if (scheduleRelevant || shouldFireRescheduleHook) {
      // Fire-and-forget cascade + reschedule-behavior dispatcher.
      // Wrapped in async IIFE so all awaits run off the main path.
      void (async () => {
        try {
          const companyId = priorRow?.company_id as string | undefined;
          if (!companyId) return;

          const userId = await findDefaultUserForCompany(companyId);
          if (!userId) return;

          if (scheduleRelevant) {
            const { ScheduleOptimizationService } = await import(
              "./schedule-optimization-service"
            );
            await ScheduleOptimizationService.handleRescheduleCascade(
              companyId,
              userId,
              id,
              "manual_update"
            );
          }

          // S2 Amendment: fire reschedule-behavior dispatcher when a
          // previously-confirmed task gets a new start_date. This covers
          // calendar drag-and-drop and task-form edit paths that bypass
          // the approval queue executor hooks. The prior start_date is
          // passed so the draft email can reference it explicitly.
          if (shouldFireRescheduleHook) {
            const { ClientSchedulingCommsService } = await import(
              "./client-scheduling-comms-service"
            );
            await ClientSchedulingCommsService.onConfirmedTaskRescheduled(
              companyId,
              userId,
              id,
              priorStartIso ?? null
            );
          }
        } catch (err) {
          console.error(
            "[task-service] hooks after manual update:",
            err instanceof Error ? err.message : err
          );
        }
      })();
    }
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
    options: Omit<
      FetchTasksOptions,
      | "startDateFrom"
      | "startDateTo"
      | "overlapRangeStart"
      | "overlapRangeEnd"
      | "scheduledOnly"
      | "limit"
      | "cursor"
    > = {}
  ): Promise<ProjectTask[]> {
    const allTasks: ProjectTask[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await TaskService.fetchTasks(companyId, {
        ...options,
        // Range-overlap (not just start_date BETWEEN) so multi-day work
        // that begins before the window but is still active inside it
        // still surfaces on the calendar.
        overlapRangeStart: startDate,
        overlapRangeEnd: endDate,
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
      status: "active",
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
