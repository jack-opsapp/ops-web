/**
 * OPS Web - Task Hooks
 *
 * TanStack Query hooks for task data with optimistic updates.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  TaskService,
  type FetchTasksOptions,
  type CreateTaskWithEventData,
} from "../api/services";
import {
  dispatchTaskAssignment,
  dispatchTaskCompleted,
  dispatchScheduleChange,
} from "../api/services/notification-dispatch";
import type { Project, ProjectTask, TaskStatus } from "../types/models";
import { getTaskDisplayTitle } from "../types/models";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all tasks for the current company (auto-paginates past 100).
 * Scope-aware: users without "all" scope only fetch tasks assigned to them.
 */
export function useTasks(
  options?: FetchTasksOptions,
  queryOptions?: Partial<UseQueryOptions<{ tasks: ProjectTask[]; remaining: number; count: number }>>
) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const tasksScope = usePermissionStore((s) => s.permissions.get("tasks.view"));
  const hasAllScope = tasksScope === "all";
  const scopedUserId = !hasAllScope ? currentUser?.id : undefined;

  const effectiveOptions: FetchTasksOptions = {
    ...options,
    ...(scopedUserId && !options?.teamMemberId ? { teamMemberId: scopedUserId } : {}),
  };

  return useQuery({
    queryKey: queryKeys.tasks.list(companyId, effectiveOptions as Record<string, unknown>),
    queryFn: async () => {
      const tasks = await TaskService.fetchAllTasks(companyId, effectiveOptions);
      return { tasks, remaining: 0, count: tasks.length };
    },
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch all tasks for a specific project (auto-paginates past 100).
 */
export function useProjectTasks(
  projectId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<ProjectTask[]>>
) {
  return useQuery({
    queryKey: queryKeys.tasks.projectTasks(projectId ?? ""),
    queryFn: () => TaskService.fetchProjectTasks(projectId!),
    enabled: !!projectId,
    ...queryOptions,
  });
}

/**
 * Fetch a single task by ID.
 */
export function useTask(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<ProjectTask>>
) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id ?? ""),
    queryFn: () => TaskService.fetchTask(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

/**
 * Fetch scheduled tasks for a specific date range.
 * Used by the calendar view — replaces the old useCalendarEventsForRange.
 */
export function useScheduledTasks(
  startDate: Date | null,
  endDate: Date | null,
  queryOptions?: Partial<UseQueryOptions<ProjectTask[]>>
) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  // Scope-aware: users with calendar.view: own or tasks.view: assigned
  // only see tasks they're assigned to. Users with "all" scope see everything.
  const calendarScope = usePermissionStore((s) => s.permissions.get("calendar.view"));
  const tasksScope = usePermissionStore((s) => s.permissions.get("tasks.view"));
  const hasAllScope = calendarScope === "all" || tasksScope === "all";
  const scopedUserId = !hasAllScope ? currentUser?.id : undefined;

  const startStr = startDate?.toISOString() ?? "";
  const endStr = endDate?.toISOString() ?? "";

  return useQuery({
    queryKey: queryKeys.calendar.scheduled(companyId, startStr, endStr, scopedUserId ?? ""),
    queryFn: () =>
      TaskService.fetchScheduledTasksForRange(
        companyId,
        startDate!,
        endDate!,
        scopedUserId ? { teamMemberId: scopedUserId } : {}
      ),
    enabled: !!companyId && !!startDate && !!endDate,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new task (without calendar event).
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Partial<ProjectTask> & {
        projectId: string;
        companyId: string;
        taskTypeId: string;
      }
    ) => TaskService.createTask(data),

    onSuccess: (taskId, variables) => {
      // Invalidate relevant task lists
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
      // Also invalidate the project's task list
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.projectTasks(variables.projectId),
      });
      // Project data may have changed (computed fields)
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.projectId),
      });

      // Notify assigned team members
      const memberIds = variables.teamMemberIds ?? [];
      if (memberIds.length > 0) {
        const project = queryClient.getQueryData<Project>(
          queryKeys.projects.detail(variables.projectId)
        );
        dispatchTaskAssignment({
          taskId,
          taskTitle: getTaskDisplayTitle(
            { customTitle: variables.customTitle ?? null },
          ),
          projectId: variables.projectId,
          projectTitle: project?.title ?? "a project",
          newMemberIds: memberIds,
          companyId: variables.companyId,
        });
      }
    },
  });
}

/**
 * Create a task with an associated calendar event.
 */
export function useCreateTaskWithEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskWithEventData) =>
      TaskService.createTaskWithEvent(data),

    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.projectTasks(variables.task.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(variables.task.projectId),
      });

      // Notify assigned team members (from task or schedule data)
      const memberIds =
        variables.task.teamMemberIds ??
        variables.schedule?.teamMemberIds ??
        [];
      if (memberIds.length > 0) {
        const project = queryClient.getQueryData<Project>(
          queryKeys.projects.detail(variables.task.projectId)
        );
        dispatchTaskAssignment({
          taskId: result.taskId,
          taskTitle: getTaskDisplayTitle(
            { customTitle: variables.task.customTitle ?? null },
          ),
          projectId: variables.task.projectId,
          projectTitle: project?.title ?? "a project",
          newMemberIds: memberIds,
          companyId: variables.task.companyId,
        });
      }
    },
  });
}

/**
 * Update an existing task with optimistic update.
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ProjectTask>;
    }) => TaskService.updateTask(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.tasks.detail(id),
      });

      const previousTask = queryClient.getQueryData<ProjectTask>(
        queryKeys.tasks.detail(id)
      );

      if (previousTask) {
        queryClient.setQueryData(queryKeys.tasks.detail(id), {
          ...previousTask,
          ...data,
        });
      }

      return { previousTask };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousTask) {
        queryClient.setQueryData(
          queryKeys.tasks.detail(id),
          context.previousTask
        );
      }
    },

    onSuccess: (_data, { id, data }, context) => {
      if (!context?.previousTask) return;

      const prev = context.previousTask;
      const project = queryClient.getQueryData<Project>(
        queryKeys.projects.detail(prev.projectId)
      );
      const taskTitle = getTaskDisplayTitle(
        { customTitle: data.customTitle ?? prev.customTitle },
        prev.taskType
      );
      const projectTitle = project?.title ?? "a project";

      // Notify newly assigned team members
      if (data.teamMemberIds !== undefined) {
        const previousIds = new Set(prev.teamMemberIds ?? []);
        const newMembers = (data.teamMemberIds ?? []).filter(
          (memberId) => !previousIds.has(memberId)
        );
        if (newMembers.length > 0) {
          dispatchTaskAssignment({
            taskId: id,
            taskTitle,
            projectId: prev.projectId,
            projectTitle,
            newMemberIds: newMembers,
            companyId: prev.companyId,
          });
        }
      }

      // Notify team when schedule changes (start or end date moved)
      const dateChanged =
        (data.startDate !== undefined &&
          data.startDate?.getTime() !== prev.startDate?.getTime()) ||
        (data.endDate !== undefined &&
          data.endDate?.getTime() !== prev.endDate?.getTime());

      if (dateChanged) {
        const allMembers = data.teamMemberIds ?? prev.teamMemberIds ?? [];
        if (allMembers.length > 0) {
          dispatchScheduleChange({
            taskId: id,
            taskTitle,
            projectId: prev.projectId,
            projectTitle,
            teamMemberIds: allMembers,
            companyId: prev.companyId,
          });
        }
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
    },
  });
}

/**
 * Update task status with optimistic update.
 */
export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuthStore();

  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: TaskStatus;
    }) => TaskService.updateTaskStatus(id, status),

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.tasks.detail(id),
      });

      const previousTask = queryClient.getQueryData<ProjectTask>(
        queryKeys.tasks.detail(id)
      );

      if (previousTask) {
        queryClient.setQueryData(queryKeys.tasks.detail(id), {
          ...previousTask,
          status,
        });
      }

      return { previousTask };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousTask) {
        queryClient.setQueryData(
          queryKeys.tasks.detail(id),
          context.previousTask
        );
      }
    },

    onSuccess: (_data, { id, status }, context) => {
      // Notify project team when a task is completed
      if (status === "Completed" && context?.previousTask) {
        const prev = context.previousTask;
        const allMembers = prev.teamMemberIds ?? [];

        if (allMembers.length > 0) {
          const project = queryClient.getQueryData<Project>(
            queryKeys.projects.detail(prev.projectId)
          );
          dispatchTaskCompleted({
            taskId: id,
            taskTitle: getTaskDisplayTitle(prev, prev.taskType),
            projectId: prev.projectId,
            projectTitle: project?.title ?? "a project",
            completedByName: currentUser
              ? `${currentUser.firstName} ${currentUser.lastName}`.trim()
              : "A team member",
            teamMemberIds: allMembers,
            companyId: prev.companyId,
          });
        }
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.lists(),
      });
    },
  });
}

/**
 * Soft delete a task.
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
    }: {
      id: string;
      projectId?: string;
    }) => TaskService.deleteTask(id),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.all,
      });
      if (variables.projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(variables.projectId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.lists(),
      });
    },
  });
}

/**
 * Reorder tasks within a project.
 */
export function useReorderTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tasks: Array<{ id: string; taskIndex: number }>) =>
      TaskService.reorderTasks(tasks),

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
    },
  });
}
