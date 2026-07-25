"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { ProductConfigurationService } from "@/lib/api/services/product-configuration-service";

export function useProductConfiguration(productId: string | null) {
  return useQuery({
    queryKey: queryKeys.products.configuration(productId ?? ""),
    queryFn: () => ProductConfigurationService.fetch(productId as string),
    enabled: Boolean(productId),
  });
}
