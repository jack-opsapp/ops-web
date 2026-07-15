/**
 * OPS Web - Inventory Deductions Hooks
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { InventoryDeductionService } from "../api/services/inventory-deduction-service";

export function useProjectDeductions(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventoryDeductions.byProject(projectId ?? ""),
    queryFn: () => InventoryDeductionService.fetchByProject(projectId!),
    enabled: !!projectId,
  });
}

export function useTaskDeductions(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventoryDeductions.byTask(taskId ?? ""),
    queryFn: () => InventoryDeductionService.fetchByTask(taskId!),
    enabled: !!taskId,
  });
}
