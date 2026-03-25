/**
 * OPS Web - Inbox TanStack Query Hooks
 *
 * Pipeline tab: queries Supabase via InboxService (client-side).
 * All Mail tab: queries the API route which proxies to Gmail/M365.
 * Thread messages: Supabase for pipeline threads, API for all-mail threads.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { queryKeys } from "@/lib/api/query-client";
import { InboxService } from "@/lib/api/services/inbox-service";
import type {
  AllMailResponse,
  AllMailThreadResponse,
  AllMailMessage,
} from "@/lib/types/inbox";

// ─── Pipeline Threads ─────────────────────────────────────────────────────────

/** Fetch grouped pipeline email threads (Supabase, client-side) */
export function usePipelineThreads() {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: queryKeys.inbox.pipelineThreads(companyId ?? ""),
    queryFn: () => InboxService.getPipelineThreads(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000, // Poll every 30s for new emails
  });
}

// ─── Pipeline Thread Messages ─────────────────────────────────────────────────

/** Fetch all messages in a pipeline thread (Supabase, client-side) */
export function usePipelineThreadMessages(emailThreadId: string | null) {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: queryKeys.inbox.threadMessages(companyId ?? "", emailThreadId ?? ""),
    queryFn: () => InboxService.getThreadMessages(companyId!, emailThreadId!),
    enabled: !!companyId && !!emailThreadId,
  });
}

// ─── All Mail ─────────────────────────────────────────────────────────────────

async function fetchAllMail(
  companyId: string,
  query: string,
  maxResults: number
): Promise<AllMailResponse> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not authenticated");

  const params = new URLSearchParams({
    companyId,
    maxResults: String(maxResults),
  });
  if (query) params.set("q", query);

  const res = await fetch(`/api/integrations/email/inbox?${params}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.error === "no_connection") {
      return { messages: [], nextPageToken: null, hasMore: false };
    }
    throw new Error(body.error || "Failed to fetch inbox");
  }

  const data = await res.json();
  return {
    messages: (data.messages ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      date: new Date(m.date as string),
    })) as AllMailMessage[],
    nextPageToken: data.nextPageToken ?? null,
    hasMore: data.hasMore ?? false,
  };
}

/** Fetch all-mail inbox from the provider API route */
export function useAllMail(query: string = "", maxResults: number = 50) {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: [...queryKeys.inbox.allMail(companyId ?? "", query), maxResults],
    queryFn: () => fetchAllMail(companyId!, query, maxResults),
    enabled: !!companyId,
    refetchInterval: 60_000, // Poll every 60s (live API, be gentle)
    staleTime: 30_000,
    placeholderData: keepPreviousData, // Keep showing current results while loading more
  });
}

// ─── All Mail Thread Messages ─────────────────────────────────────────────────

async function fetchAllMailThread(
  companyId: string,
  threadId: string
): Promise<AllMailThreadResponse> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Not authenticated");

  const params = new URLSearchParams({ companyId, threadId });
  const res = await fetch(`/api/integrations/email/inbox?${params}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch thread");
  }

  const data = await res.json();
  return {
    messages: (data.messages ?? []).map((m: Record<string, unknown>) => ({
      ...m,
      date: new Date(m.date as string),
    })),
  };
}

/** Fetch full thread from the provider API (for All Mail tab threads) */
export function useAllMailThread(threadId: string | null) {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: queryKeys.inbox.threadMessages(companyId ?? "", `allmail-${threadId ?? ""}`),
    queryFn: () => fetchAllMailThread(companyId!, threadId!),
    enabled: !!companyId && !!threadId,
  });
}

// ─── Read/Unread Mutations ────────────────────────────────────────────────────

/** Mark a thread as read (pipeline threads — updates activities in Supabase) */
export function useMarkThreadRead() {
  const companyId = useAuthStore((s) => s.company?.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (emailThreadId: string) =>
      InboxService.markThreadRead(companyId!, emailThreadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
    },
  });
}

/** Mark a thread as unread (pipeline threads) */
export function useMarkThreadUnread() {
  const companyId = useAuthStore((s) => s.company?.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (emailThreadId: string) =>
      InboxService.markThreadUnread(companyId!, emailThreadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
    },
  });
}

// ─── Unread Count ─────────────────────────────────────────────────────────────

/** Get unread pipeline email count (for sidebar badge) */
export function useInboxUnreadCount() {
  const companyId = useAuthStore((s) => s.company?.id);

  return useQuery({
    queryKey: queryKeys.inbox.unreadCount(companyId ?? ""),
    queryFn: () => InboxService.getUnreadCount(companyId!),
    enabled: !!companyId,
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}
