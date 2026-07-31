"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/query-client";
import { TaxRateService } from "@/lib/api/services/tax-rate-service";
import { useAuthStore } from "@/lib/store/auth-store";

export function useTaxRates() {
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  return useQuery({
    queryKey: queryKeys.taxRates.list(companyId),
    queryFn: () => TaxRateService.fetchActive(companyId),
    enabled: Boolean(companyId),
  });
}

export function useDefaultTaxRate() {
  const query = useTaxRates();
  return {
    ...query,
    data: query.data?.find((rate) => rate.isDefault) ?? null,
  };
}
