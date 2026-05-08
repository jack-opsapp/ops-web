/**
 * OPS Web - Product Option Hooks
 *
 * TanStack Query hooks for `product_options` and `product_option_values`.
 * Mutations invalidate the parent product's option list AND the option-value
 * cache to keep child rows in sync without a refetch storm.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProductOptionsService } from "../api/services";
import type {
  CreateProductOption,
  CreateProductOptionValue,
  UpdateProductOption,
  UpdateProductOptionValue,
} from "../types/product-options";

// ─── Reads ──────────────────────────────────────────────────────────────────

export function useProductOptions(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.productOptions.byProduct(productId ?? ""),
    queryFn: () => ProductOptionsService.fetchOptions(productId!),
    enabled: !!productId,
  });
}

/**
 * Fetch all option values across the supplied option ids in one query.
 * Cached under the product id so a single invalidation refreshes both
 * the option list and its values together.
 */
export function useProductOptionValues(
  productId: string | undefined,
  optionIds: string[]
) {
  return useQuery({
    queryKey: queryKeys.productOptions.valuesByProduct(productId ?? ""),
    queryFn: () => ProductOptionsService.fetchValuesForOptions(optionIds),
    enabled: !!productId && optionIds.length > 0,
  });
}

// ─── Option mutations ───────────────────────────────────────────────────────

export function useCreateProductOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProductOption) =>
      ProductOptionsService.createOption(data),
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.byProduct(variables.productId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.valuesByProduct(variables.productId),
      });
    },
  });
}

export function useUpdateProductOption(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductOption }) =>
      ProductOptionsService.updateOption(id, data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.byProduct(productId),
      });
    },
  });
}

export function useReorderProductOptions(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      ProductOptionsService.reorderOptions(productId, orderedIds),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.byProduct(productId),
      });
    },
  });
}

export function useDeleteProductOption(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ProductOptionsService.deleteOption(id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.byProduct(productId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.valuesByProduct(productId),
      });
      // A deleted option cascades to any modifier that referenced it.
      queryClient.invalidateQueries({
        queryKey: queryKeys.productPricingModifiers.byProduct(productId),
      });
    },
  });
}

// ─── Option Value mutations ─────────────────────────────────────────────────

export function useCreateProductOptionValue(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProductOptionValue) =>
      ProductOptionsService.createValue(data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.valuesByProduct(productId),
      });
    },
  });
}

export function useUpdateProductOptionValue(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateProductOptionValue;
    }) => ProductOptionsService.updateValue(id, data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.valuesByProduct(productId),
      });
    },
  });
}

export function useReorderProductOptionValues(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      optionId,
      orderedIds,
    }: {
      optionId: string;
      orderedIds: string[];
    }) => ProductOptionsService.reorderValues(optionId, orderedIds),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.valuesByProduct(productId),
      });
    },
  });
}

export function useDeleteProductOptionValue(productId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ProductOptionsService.deleteValue(id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productOptions.valuesByProduct(productId),
      });
      // Cascading: a deleted value invalidates any modifier rule that
      // referenced it as a trigger.
      queryClient.invalidateQueries({
        queryKey: queryKeys.productPricingModifiers.byProduct(productId),
      });
    },
  });
}
