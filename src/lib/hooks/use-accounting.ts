/**
 * OPS Web - Accounting Hooks
 *
 * TanStack Query hooks for accounting connections and sync.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { AccountingService } from "../api/services";
import type { AccountingProvider } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

export function useAccountingConnections() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.accounting.connections(companyId),
    queryFn: () => AccountingService.getConnections(companyId),
    enabled: !!companyId,
  });
}

export function useInitiateOAuth() {
  return useMutation({
    mutationFn: ({
      companyId,
      provider,
    }: {
      companyId: string;
      provider: AccountingProvider;
    }) => AccountingService.initiateOAuth(companyId, provider),
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
  });
}

export function useDisconnectProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      provider,
    }: {
      companyId: string;
      provider: AccountingProvider;
    }) => AccountingService.disconnectProvider(companyId, provider),
    onSuccess: (_data, { companyId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.connections(companyId),
      });
    },
  });
}

export function useTriggerSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      provider,
    }: {
      companyId: string;
      provider: AccountingProvider;
    }) => AccountingService.triggerSync(companyId, provider),
    onSuccess: (_data, { companyId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.connections(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.syncHistory(companyId),
      });
    },
  });
}

export function useSyncHistory() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.accounting.syncHistory(companyId),
    queryFn: () => AccountingService.getSyncHistory(companyId),
    enabled: !!companyId,
  });
}
