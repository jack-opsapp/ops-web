/**
 * OPS Web - Gmail Connection Hooks
 *
 * TanStack Query hooks for managing Gmail OAuth connections.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { queryKeys } from "../api/query-client";
import { EmailConnectionBrowserService } from "../api/services/email-connection-browser-service";
import { useAuthStore } from "../store/auth-store";
import type { BrowserUpdateEmailConnection } from "../types/email-connection";
import { authedFetch } from "../utils/authed-fetch";

export interface GmailManualSyncResponse {
  ok: boolean;
  state: "complete" | "continuing" | "partial" | "failed";
  retryable: boolean;
  connectionsProcessed: number;
  failedConnections: number;
  pendingConnections: number;
  totalActivitiesCreated: number;
  results: Array<{
    matched?: number;
    needsReview?: number;
    newLeads?: number;
  }>;
}

/**
 * Fetch all Gmail connections for the current company.
 */
export function useGmailConnections() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.gmailConnections.list(companyId),
    queryFn: () => EmailConnectionBrowserService.getConnections(),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

/**
 * Update a Gmail connection (e.g., toggle sync_enabled).
 */
export function useUpdateGmailConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: BrowserUpdateEmailConnection;
    }) => EmailConnectionBrowserService.updateConnection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.gmailConnections.all,
      });
    },
  });
}

/**
 * Delete (disconnect) a Gmail connection.
 */
export function useDeleteGmailConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      EmailConnectionBrowserService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.gmailConnections.all,
      });
    },
  });
}

/**
 * Trigger a manual Gmail sync for the current company.
 * Calls the manual-sync route (no cron secret needed).
 */
export function useTriggerGmailSync() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async () => {
      if (!company?.id) throw new Error("No company");
      const response = await authedFetch(
        "/api/integrations/gmail/manual-sync",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: company.id }),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Sync failed");
      }
      return (await response.json()) as GmailManualSyncResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inboxLeads", company?.id] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });

      if (data.state !== "complete") return;

      const results = data.results ?? [];
      const totalMatched = results.reduce(
        (sum, r) => sum + (r.matched ?? 0),
        0
      );
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
