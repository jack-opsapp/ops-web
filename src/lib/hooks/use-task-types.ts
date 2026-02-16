/**
 * OPS Web - TaskType Hooks
 *
 * TanStack Query hooks for TaskType CRUD operations.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { TaskTypeService } from "../api/services";
import type { TaskType } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch all task types for the current company.
 */
export function useTaskTypes(
  queryOptions?: Partial<UseQueryOptions<TaskType[]>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.taskTypes.list(companyId),
    queryFn: () => TaskTypeService.fetchTaskTypes(companyId),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a single task type by ID.
 */
export function useTaskType(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<TaskType>>
) {
  return useQuery({
    queryKey: queryKeys.taskTypes.detail(id ?? ""),
    queryFn: () => TaskTypeService.fetchTaskType(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new task type.
 */
export function useCreateTaskType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Partial<TaskType> & { display: string; color: string }
    ) => TaskTypeService.createTaskType(data),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTypes.all,
      });
    },
  });
}

/**
 * Update an existing task type.
 */
export function useUpdateTaskType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<TaskType>;
    }) => TaskTypeService.updateTaskType(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.taskTypes.detail(id),
      });

      const previousTaskType = queryClient.getQueryData<TaskType>(
        queryKeys.taskTypes.detail(id)
      );

      if (previousTaskType) {
        queryClient.setQueryData(queryKeys.taskTypes.detail(id), {
          ...previousTaskType,
          ...data,
        });
      }

      return { previousTaskType };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousTaskType) {
        queryClient.setQueryData(
          queryKeys.taskTypes.detail(id),
          context.previousTaskType
        );
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTypes.all,
      });
    },
  });
}

/**
 * Soft delete a task type.
 */
export function useDeleteTaskType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => TaskTypeService.deleteTaskType(id),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTypes.all,
      });
    },
  });
}

/**
 * Create default task types for a new company.
 */
export function useCreateDefaultTaskTypes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) =>
      TaskTypeService.createDefaultTaskTypes(companyId),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTypes.all,
      });
    },
  });
}
