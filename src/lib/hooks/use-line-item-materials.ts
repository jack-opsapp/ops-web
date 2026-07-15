/**
 * OPS Web - Line Item Materials Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { LineItemMaterialsService } from "../api/services/line-item-materials-service";
import type { CreateLineItemMaterial } from "../types/product-materials";

export function useLineItemMaterials(lineItemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.lineItemMaterials.byLineItem(lineItemId ?? ""),
    queryFn: () => LineItemMaterialsService.fetchByLineItem(lineItemId!),
    enabled: !!lineItemId,
  });
}

export function useSetLineItemMaterials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      lineItemId,
      materials,
    }: {
      lineItemId: string;
      materials: CreateLineItemMaterial[];
    }) => LineItemMaterialsService.setOverrides(lineItemId, materials),
    onSuccess: (_data, { lineItemId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.lineItemMaterials.byLineItem(lineItemId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.stockIndicator.all,
      });
    },
  });
}
