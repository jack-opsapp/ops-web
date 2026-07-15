/**
 * OPS Web - Task Materials Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { TaskMaterialsService } from "../api/services/task-materials-service";
import type { CreateTaskMaterial } from "../types/product-materials";

export function useTaskMaterials(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.taskMaterials.byTask(taskId ?? ""),
    queryFn: () => TaskMaterialsService.fetchByTask(taskId!),
    enabled: !!taskId,
  });
}

export function useSetTaskMaterials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      materials,
    }: {
      taskId: string;
      materials: CreateTaskMaterial[];
    }) => TaskMaterialsService.setMaterials(taskId, materials),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskMaterials.byTask(taskId),
      });
    },
  });
}
