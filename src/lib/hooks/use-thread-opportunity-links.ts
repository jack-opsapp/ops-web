"use client";

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";

/**
 * Returns the opportunity ids linked to the given email thread via the
 * `opportunity_email_threads` junction. Empty array when no links exist.
 *
 * Used by the inbox right-rail Pipeline tab to flip the "This thread"
 * indicator on the opportunities that share a thread with the open detail.
 */
export function useThreadOpportunityLinks(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["inbox", "thread-opp-links", threadId ?? ""] as const,
    queryFn: async (): Promise<string[]> => {
      if (!threadId) return [];
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("opportunity_email_threads")
        .select("opportunity_id")
        .eq("thread_id", threadId);
      if (error) {
        throw new Error(`Failed to fetch opp links: ${error.message}`);
      }
      return (data ?? [])
        .map((r) => (r as { opportunity_id: string }).opportunity_id)
        .filter(Boolean);
    },
    enabled: !!threadId,
    staleTime: 30_000,
  });
}
