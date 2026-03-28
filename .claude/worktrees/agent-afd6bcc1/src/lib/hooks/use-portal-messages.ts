/**
 * OPS Web - Portal Message Hooks
 *
 * TanStack Query hooks for fetching and sending messages
 * from the client portal. Uses session cookies for authentication.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { portalKeys, portalFetch } from "./use-portal-data";
import type { PortalMessage } from "../types/portal";

// ─── Options ──────────────────────────────────────────────────────────────────

interface PortalMessagesOptions {
  limit?: number;
  offset?: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch paginated messages for the portal client.
 * Defaults to limit=50, offset=0.
 */
export function usePortalMessages(options?: PortalMessagesOptions) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery<PortalMessage[]>({
    queryKey: portalKeys.messages(options as Record<string, unknown>),
    queryFn: () =>
      portalFetch<PortalMessage[]>(
        `/api/portal/messages?limit=${limit}&offset=${offset}`
      ),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

interface SendMessageInput {
  content: string;
  projectId?: string;
  estimateId?: string;
  invoiceId?: string;
}

/**
 * Send a message from the client.
 * Invalidates the messages list and portal data (unread count may change
 * if the server auto-reads company messages on the same thread).
 */
export function useSendPortalMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      portalFetch<PortalMessage>("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      // Invalidate all message queries (any pagination variant)
      queryClient.invalidateQueries({
        queryKey: [...portalKeys.all, "messages"],
      });
      // Invalidate portal data — unread count may have changed
      queryClient.invalidateQueries({ queryKey: portalKeys.data() });
    },
  });
}
