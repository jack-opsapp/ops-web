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
import type { ProjectTask, TaskStatus } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all tasks for the current company.
 */
export function useTasks(
  options?: FetchTasksOptions,
  queryOptions?: Partial<UseQueryOptions<{ tasks: ProjectTask[]; remaining: number; count: number }>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.tasks.list(companyId, options as Record<string, unknown>),
    queryFn: () => TaskService.fetchTasks(companyId, options),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch tasks for a specific project.
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

    onSuccess: (_id, variables) => {
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

    onSuccess: (_result, variables) => {
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
 * Soft delete a task (and its calendar event).
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      calendarEventId,
    }: {
      id: string;
      calendarEventId?: string | null;
      projectId?: string;
    }) => TaskService.deleteTask(id, calendarEventId),

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
