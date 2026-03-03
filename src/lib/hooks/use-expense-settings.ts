/**
 * OPS Web - Expense Settings Hooks
 *
 * TanStack Query hooks for per-company expense configuration.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ExpenseSettingsService } from "../api/services/expense-settings-service";
import type { UpdateExpenseSettings } from "../api/services/expense-settings-service";
import { useAuthStore } from "../store/auth-store";

export function useExpenseSettings() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.expenseSettings.detail(companyId),
    queryFn: () => ExpenseSettingsService.getSettings(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateExpenseSettings() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: (updates: UpdateExpenseSettings) =>
      ExpenseSettingsService.updateSettings(company?.id ?? "", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.expenseSettings.all,
      });
    },
  });
}
