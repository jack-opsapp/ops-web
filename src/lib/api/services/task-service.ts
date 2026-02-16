/**
 * OPS Web - Task Service
 *
 * Complete CRUD operations for Tasks using the Bubble Data API.
 * Includes calendar event creation for task scheduling.
 * All queries filter out soft-deleted items.
 */

import { getBubbleClient } from "../bubble-client";
import {
  BubbleTypes,
  BubbleTaskFields,
  BubbleCalendarEventFields,
  BubbleConstraintType,
  type BubbleConstraint,
} from "../../constants/bubble-fields";
import {
  type TaskDTO,
  type CalendarEventDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  type BubbleCreationResponse,
  taskDtoToModel,
  taskModelToDto,
  calendarEventDtoToModel,
  calendarEventModelToDto,
} from "../../types/dto";
import type { ProjectTask, CalendarEvent, TaskStatus } from "../../types/models";

// ─── Query Options ────────────────────────────────────────────────────────────

export interface FetchTasksOptions {
  /** Filter by project ID */
  projectId?: string;
  /** Filter by status */
  status?: TaskStatus;
  /** Filter by team member */
  teamMemberId?: string;
  /** Sort field */
  sortField?: string;
  /** Sort direction */
  descending?: boolean;
  /** Pagination limit */
  limit?: number;
  /** Pagination cursor */
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
   * Fetch all tasks for a company with optional filters.
   */
  async fetchTasks(
    companyId: string,
    options: FetchTasksOptions = {}
  ): Promise<{ tasks: ProjectTask[]; remaining: number; count: number }> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleTaskFields.companyId,
        constraint_type: BubbleConstraintType.equals,
        value: companyId,
      },
      {
        key: BubbleTaskFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    if (options.projectId) {
      constraints.push({
        key: BubbleTaskFields.projectId,
        constraint_type: BubbleConstraintType.equals,
        value: options.projectId,
      });
    }

    if (options.status) {
      constraints.push({
        key: BubbleTaskFields.status,
        constraint_type: BubbleConstraintType.equals,
        value: options.status,
      });
    }

    if (options.teamMemberId) {
      constraints.push({
        key: BubbleTaskFields.teamMembers,
        constraint_type: BubbleConstraintType.contains,
        value: options.teamMemberId,
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

    const response = await client.get<BubbleListResponse<TaskDTO>>(
      `/obj/${BubbleTypes.task.toLowerCase()}`,
      { params }
    );

    const tasks = response.response.results.map((dto) => taskDtoToModel(dto));

    return {
      tasks,
      remaining: response.response.remaining,
      count: response.response.count,
    };
  },

  /**
   * Fetch tasks for a specific project.
   */
  async fetchProjectTasks(projectId: string): Promise<ProjectTask[]> {
    const client = getBubbleClient();

    const constraints: BubbleConstraint[] = [
      {
        key: BubbleTaskFields.projectId,
        constraint_type: BubbleConstraintType.equals,
        value: projectId,
      },
      {
        key: BubbleTaskFields.deletedAt,
        constraint_type: BubbleConstraintType.isEmpty,
      },
    ];

    const params = {
      constraints: JSON.stringify(constraints),
      limit: 100,
      cursor: 0,
    };

    const response = await client.get<BubbleListResponse<TaskDTO>>(
      `/obj/${BubbleTypes.task.toLowerCase()}`,
      { params }
    );

    return response.response.results.map((dto) => taskDtoToModel(dto));
  },

  /**
   * Fetch a single task by ID.
   */
  async fetchTask(id: string): Promise<ProjectTask> {
    const client = getBubbleClient();

    const response = await client.get<BubbleObjectResponse<TaskDTO>>(
      `/obj/${BubbleTypes.task.toLowerCase()}/${id}`
    );

    return taskDtoToModel(response.response);
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
    const client = getBubbleClient();

    const dto = taskModelToDto(data);

    const response = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleTypes.task.toLowerCase()}`,
      dto
    );

    return response.id;
  },

  /**
   * Create a task with an associated calendar event (atomic operation).
   * Creates the calendar event first, then the task with a reference to it.
   */
  async createTaskWithEvent(
    data: CreateTaskWithEventData
  ): Promise<{ taskId: string; calendarEventId: string | null }> {
    const client = getBubbleClient();
    let calendarEventId: string | null = null;

    // Step 1: Create calendar event if scheduling data is provided
    if (data.calendarEvent) {
      const eventDto: Record<string, unknown> = {
        [BubbleCalendarEventFields.title]: data.calendarEvent.title,
        [BubbleCalendarEventFields.startDate]:
          data.calendarEvent.startDate.toISOString(),
        [BubbleCalendarEventFields.color]:
          data.calendarEvent.color ?? data.task.taskColor ?? "#59779F",
        [BubbleCalendarEventFields.duration]:
          data.calendarEvent.duration ?? 1,
        [BubbleCalendarEventFields.companyId]: data.task.companyId,
        [BubbleCalendarEventFields.projectId]: data.task.projectId,
      };

      if (data.calendarEvent.endDate) {
        eventDto[BubbleCalendarEventFields.endDate] =
          data.calendarEvent.endDate.toISOString();
      }

      if (
        data.calendarEvent.teamMemberIds &&
        data.calendarEvent.teamMemberIds.length > 0
      ) {
        eventDto[BubbleCalendarEventFields.teamMembers] =
          data.calendarEvent.teamMemberIds;
      }

      const eventResponse = await client.post<BubbleCreationResponse>(
        `/obj/${BubbleTypes.calendarEvent}`,
        eventDto
      );

      calendarEventId = eventResponse.id;
    }

    // Step 2: Create the task with calendar event reference
    const taskDto = taskModelToDto({
      ...data.task,
      calendarEventId,
    });

    const taskResponse = await client.post<BubbleCreationResponse>(
      `/obj/${BubbleTypes.task.toLowerCase()}`,
      taskDto
    );

    // Step 3: If we created a calendar event, update it with the task ID
    if (calendarEventId) {
      await client.patch(
        `/obj/${BubbleTypes.calendarEvent}/${calendarEventId}`,
        { [BubbleCalendarEventFields.taskId]: taskResponse.id }
      );
    }

    return { taskId: taskResponse.id, calendarEventId };
  },

  /**
   * Update an existing task.
   */
  async updateTask(
    id: string,
    data: Partial<ProjectTask>
  ): Promise<void> {
    const client = getBubbleClient();

    const dto = taskModelToDto(data);

    await client.patch(
      `/obj/${BubbleTypes.task.toLowerCase()}/${id}`,
      dto
    );
  },

  /**
   * Update task status.
   */
  async updateTaskStatus(
    id: string,
    status: TaskStatus
  ): Promise<void> {
    const client = getBubbleClient();

    await client.patch(
      `/obj/${BubbleTypes.task.toLowerCase()}/${id}`,
      { [BubbleTaskFields.status]: status }
    );
  },

  /**
   * Soft delete a task.
   * Also soft deletes the associated calendar event if it exists.
   */
  async deleteTask(
    id: string,
    calendarEventId?: string | null
  ): Promise<void> {
    const client = getBubbleClient();
    const now = new Date().toISOString();

    // Soft delete the task
    await client.patch(
      `/obj/${BubbleTypes.task.toLowerCase()}/${id}`,
      { [BubbleTaskFields.deletedAt]: now }
    );

    // Also soft delete the associated calendar event
    if (calendarEventId) {
      await client.patch(
        `/obj/${BubbleTypes.calendarEvent}/${calendarEventId}`,
        { [BubbleCalendarEventFields.deletedAt]: now }
      );
    }
  },

  /**
   * Reorder tasks within a project.
   * Updates the taskIndex for each task.
   */
  async reorderTasks(
    tasks: Array<{ id: string; taskIndex: number }>
  ): Promise<void> {
    const client = getBubbleClient();

    // Update each task's index in parallel
    await Promise.all(
      tasks.map((task) =>
        client.patch(
          `/obj/${BubbleTypes.task.toLowerCase()}/${task.id}`,
          { [BubbleTaskFields.taskIndex]: task.taskIndex }
        )
      )
    );
  },

  /**
   * Fetch all tasks with pagination support.
   */
  async fetchAllTasks(
    companyId: string,
    options: Omit<FetchTasksOptions, "limit" | "cursor"> = {}
  ): Promise<ProjectTask[]> {
    const allTasks: ProjectTask[] = [];
    let cursor = 0;
    let remaining = 1;

    while (remaining > 0) {
      const result = await TaskService.fetchTasks(companyId, {
        ...options,
        limit: 100,
        cursor,
      });

      allTasks.push(...result.tasks);
      remaining = result.remaining;
      cursor += result.tasks.length;
    }

    return allTasks;
  },
};

export default TaskService;
