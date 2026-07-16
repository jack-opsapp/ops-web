"use client";

/**
 * useClientThreads — feeds <ThreadPicker> with the OTHER non-archived
 * email_threads tied to the same client as the thread currently open.
 *
 * Query guarantees from the authenticated anchor-thread endpoint:
 *   - requires the same opportunity + inbox read intersection as detail
 *   - filtered by company_id + client_id
 *   - excludes the current thread (excludingThreadId)
 *   - excludes archived (snoozed are kept on purpose — snooze is deferral,
 *     not closure, and the picker should still surface them as live context)
 *   - ordered by last_message_at DESC
 * No client-side filter / sort needed.
 *
 * The server applies a 50-row safety cap after authorization.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthStore, selectCompanyId } from "@/lib/store/auth-store";
import type { EmailThreadLabel } from "@/lib/types/email-thread";

interface UseClientThreadsOpts {
  /** The currently-open thread id; used as the authorization anchor and
   *  excluded sibling. The query is disabled when this is null — without
   *  a thread to exclude there's nothing for the picker to show. */
  excludeId: string | null;
}

export interface ClientThreadSummary {
  id: string;
  subject: string;
  labels: EmailThreadLabel[];
  unreadCount: number;
  lastMessageAt: Date;
  latestDirection: "inbound" | "outbound" | null;
  archivedAt: Date | null;
}

interface ClientThreadSummaryDto {
  id: string;
  subject: string;
  labels: EmailThreadLabel[];
  unreadCount: number;
  lastMessageAt: string;
  latestDirection: "inbound" | "outbound" | null;
  archivedAt: string | null;
}

async function fetchAuthorizedSiblingThreads(
  anchorThreadId: string
): Promise<ClientThreadSummary[]> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  if (!token) return [];

  const response = await fetch(
    `/api/inbox/threads/${encodeURIComponent(anchorThreadId)}/siblings`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return [];
  const body = (await response.json()) as {
    threads?: ClientThreadSummaryDto[];
  };
  return (body.threads ?? []).map((thread) => ({
    ...thread,
    lastMessageAt: new Date(thread.lastMessageAt),
    archivedAt: thread.archivedAt ? new Date(thread.archivedAt) : null,
  }));
}

/**
 * Fetch all OTHER non-archived email threads belonging to the same client,
 * sorted last_message_at DESC. The query is disabled until clientId,
 * companyId, and excludeId are all present. 30s staleTime matches the rest
 * of the inbox hooks.
 */
export function useClientThreads(
  clientId: string | null | undefined,
  opts: UseClientThreadsOpts
) {
  const companyId = useAuthStore(selectCompanyId);
  const excludeId = opts.excludeId;
  return useQuery<ClientThreadSummary[]>({
    queryKey: [
      "inbox",
      "client-threads",
      companyId ?? "",
      clientId ?? "",
      excludeId ?? "",
    ] as const,
    queryFn: async () => {
      // Defensive — TanStack Query won't run queryFn while `enabled` is false,
      // but typed-narrowing for the route call below requires the explicit
      // null-check anyway.
      if (!clientId || !companyId || !excludeId) return [];
      return fetchAuthorizedSiblingThreads(excludeId);
    },
    enabled: !!clientId && !!companyId && !!excludeId,
    staleTime: 30_000,
  });
}
