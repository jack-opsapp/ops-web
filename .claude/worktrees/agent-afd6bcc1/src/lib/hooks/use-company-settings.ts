/**
 * OPS Web - Company Settings Hooks
 *
 * TanStack Query hooks for per-company feature configuration.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { CompanySettingsService } from "../api/services/company-settings-service";
import type { UpdateCompanySettings } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

export function useCompanySettings() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.companySettings.detail(companyId),
    queryFn: () => CompanySettingsService.getSettings(companyId),
    enabled: !!companyId,
    // Settings rarely change — keep longer stale time
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateCompanySettings() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (updates: UpdateCompanySettings) =>
      CompanySettingsService.updateSettings(company?.id ?? "", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.companySettings.all,
      });
    },
  });
}
