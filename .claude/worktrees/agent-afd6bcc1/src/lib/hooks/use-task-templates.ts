/**
 * OPS Web - Task Template Hooks
 *
 * TanStack Query hooks for task templates and proposed task generation.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { TaskTemplateService } from "../api/services/task-template-service";
import type { CreateTaskTemplate, UpdateTaskTemplate } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

export function useTaskTemplates(taskTypeId?: string) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.taskTemplates.list(companyId, taskTypeId),
    queryFn: () => TaskTemplateService.fetchTaskTemplates(companyId, taskTypeId),
    enabled: !!companyId,
  });
}

export function useProposedTasks(estimateId: string | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.taskTemplates.proposed(estimateId ?? ""),
    queryFn: () => TaskTemplateService.getProposedTasks(estimateId!, companyId),
    enabled: !!estimateId && !!companyId,
  });
}

export function useCreateTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskTemplate) =>
      TaskTemplateService.createTaskTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplates.lists(),
      });
    },
  });
}

export function useUpdateTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskTemplate }) =>
      TaskTemplateService.updateTaskTemplate(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplates.lists(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplates.detail(id),
      });
    },
  });
}

export function useDeleteTaskTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => TaskTemplateService.deleteTaskTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskTemplates.lists(),
      });
    },
  });
}
