/**
 * OPS Web - Product Pricing Modifier Hooks
 *
 * TanStack Query hooks for `product_pricing_modifiers`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProductPricingModifiersService } from "../api/services";
import type {
  CreateProductPricingModifier,
  UpdateProductPricingModifier,
} from "../types/product-options";

export function useProductPricingModifiers(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.productPricingModifiers.byProduct(productId ?? ""),
    queryFn: () =>
      ProductPricingModifiersService.fetchByProduct(productId!),
    enabled: !!productId,
  });
}

export function useCreateProductPricingModifier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProductPricingModifier) =>
      ProductPricingModifiersService.createModifier(data),
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productPricingModifiers.byProduct(
          variables.productId
        ),
      });
    },
  });
}

export function useUpdateProductPricingModifier(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateProductPricingModifier;
    }) => ProductPricingModifiersService.updateModifier(id, data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productPricingModifiers.byProduct(productId),
      });
    },
  });
}

export function useDeleteProductPricingModifier(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      ProductPricingModifiersService.deleteModifier(id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productPricingModifiers.byProduct(productId),
      });
    },
  });
}
