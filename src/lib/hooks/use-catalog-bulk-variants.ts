/**
 * Catalog bulk variant expansion reads and writes. Mutation retries stay
 * operator-driven because a dropped response is ambiguous; the durable
 * idempotency key makes the explicit retry safe.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { CatalogBulkVariantService } from "@/lib/api/services/catalog-bulk-variant-service";
import type { BulkVariantExpansionRequest } from "@/lib/catalog/bulk-variant-expansion";
import { useAuthStore } from "@/lib/store/auth-store";

export function useCatalogBulkVariantFamilies() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.catalog.bulkVariantFamilies(companyId),
    queryFn: () => CatalogBulkVariantService.fetchFamilies(companyId),
    enabled: Boolean(companyId),
  });
}

export function useExpandCatalogVariants() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation({
    mutationFn: (request: BulkVariantExpansionRequest) =>
      CatalogBulkVariantService.expandVariants(request),
    retry: false,
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.catalog.stock(companyId),
        type: "active",
      });
      await queryClient.refetchQueries({
        queryKey: queryKeys.catalog.bulkVariantFamilies(companyId),
        type: "active",
      });
    },
  });
}
