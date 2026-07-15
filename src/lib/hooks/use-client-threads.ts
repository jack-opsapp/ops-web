"use client";

/**
 * useClientThreads — feeds <ThreadPicker> with the OTHER non-archived
 * email_threads tied to the same client as the thread currently open.
 *
 * Query guarantees from listEmailThreadSiblings (the underlying service
 * function we wrap):
 *   - filtered by company_id + client_id
 *   - excludes the current thread (excludingThreadId)
 *   - excludes archived (snoozed are kept on purpose — snooze is deferral,
 *     not closure, and the picker should still surface them as live context)
 *   - ordered by last_message_at DESC
 * No client-side filter / sort needed.
 *
 * The default service limit is 5 (sized for the right-rail context strip);
 * the detail-header picker should show all sibling threads, so we override
 * with a generous safety cap.
 */

import { useQuery } from "@tanstack/react-query";
import { listEmailThreadSiblings } from "@/lib/api/services/email-thread-sibling-service";
import { useAuthStore, selectCompanyId } from "@/lib/store/auth-store";
import type { EmailThread } from "@/lib/types/email-thread";

interface UseClientThreadsOpts {
  /** The currently-open thread id; passed through to listSiblings as the
   *  excludingThreadId. The query is disabled when this is null — without
   *  a thread to exclude there's nothing for the picker to show. */
  excludeId: string | null;
}

const PICKER_THREAD_LIMIT = 50;

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
  return useQuery<EmailThread[]>({
    queryKey: [
      "inbox",
      "client-threads",
      companyId ?? "",
      clientId ?? "",
      excludeId ?? "",
    ] as const,
    queryFn: async () => {
      // Defensive — TanStack Query won't run queryFn while `enabled` is false,
      // but typed-narrowing for the service call below requires the explicit
      // null-check anyway.
      if (!clientId || !companyId || !excludeId) return [];
      return listEmailThreadSiblings(
        companyId,
        clientId,
        excludeId,
        PICKER_THREAD_LIMIT
      );
    },
    enabled: !!clientId && !!companyId && !!excludeId,
    staleTime: 30_000,
  });
}
