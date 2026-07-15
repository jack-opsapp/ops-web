/**
 * OPS Web - Email Connection Hooks
 *
 * Provider-agnostic TanStack Query hooks for managing email connections.
 * Replaces use-gmail-connections.ts (which now re-exports from here).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { queryKeys } from "../api/query-client";
import { EmailService } from "../api/services/email-service";
import { useAuthStore } from "../store/auth-store";
import type { UpdateEmailConnection } from "../types/email-connection";

/**
 * Fetch all email connections for the current company.
 */
export function useEmailConnections() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.emailConnections.list(companyId),
    queryFn: () => EmailService.getConnections(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

/**
 * Update an email connection (e.g., toggle sync, update filters).
 */
export function useUpdateEmailConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEmailConnection }) =>
      EmailService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailConnections.all,
      });
      // Also invalidate legacy query key for backward compat
      queryClient.invalidateQueries({
        queryKey: queryKeys.gmailConnections.all,
      });
    },
  });
}

/**
 * Delete (disconnect) an email connection.
 */
export function useDeleteEmailConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => EmailService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailConnections.all,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.gmailConnections.all,
      });
    },
  });
}

/**
 * Trigger a manual email sync for a connection.
 */
export function useTriggerEmailSync() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch("/api/integrations/email/manual-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Sync failed");
      }
      return response.json();
    },
    onSuccess: (data: {
      ok: boolean;
      results: Array<{
        matched?: number;
        needsReview?: number;
        newLeads?: number;
      }>;
    }) => {
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", company?.id] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({
        queryKey: queryKeys.emailConnections.all,
      });

      const results = data.results ?? [];
      const totalMatched = results.reduce((sum, r) => sum + (r.matched ?? 0), 0);
      const totalReview = results.reduce(
        (sum, r) => sum + (r.needsReview ?? 0),
        0
      );
      const totalNew = results.reduce((sum, r) => sum + (r.newLeads ?? 0), 0);
      toast.success(
        `Synced — ${totalMatched} matched, ${totalReview} need review, ${totalNew} new leads`
      );
    },
  });
}
