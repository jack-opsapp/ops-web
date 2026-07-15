/**
 * OPS Web - Product Materials Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProductMaterialsService } from "../api/services/product-materials-service";
import type { CreateProductMaterial } from "../types/product-materials";

export function useProductMaterials(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.productMaterials.byProduct(productId ?? ""),
    queryFn: () => ProductMaterialsService.fetchByProduct(productId!),
    enabled: !!productId,
  });
}

export function useSetProductBom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      productId,
      materials,
    }: {
      productId: string;
      materials: CreateProductMaterial[];
    }) => ProductMaterialsService.setBom(productId, materials),
    onSuccess: (_data, { productId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productMaterials.byProduct(productId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.stockIndicator.all,
      });
    },
  });
}
