"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import type {
  DataReviewQueue,
  DataReviewItem,
  ReviewItemKind,
  ReviewOwner,
} from "../api/services/lead-data-review-service";

export type { DataReviewQueue, DataReviewItem, ReviewItemKind, ReviewOwner };

/**
 * Authenticated fetch for the admin data-review surface. Mirrors the
 * `getIdToken()` Bearer pattern used by the admin data-setup actions — the API
 * routes verify the Firebase token + gate on the granular pipeline.manage
 * permission server-side.
 */
async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** Load the actionable queue + the muted passive quarantined count. */
export function useDataReviewQueue() {
  return useQuery<DataReviewQueue>({
    queryKey: queryKeys.dataReview.queue(),
    queryFn: async () => {
      const res = await authedFetch("/api/data-review");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load data review queue");
      }
      return (await res.json()) as DataReviewQueue;
    },
    refetchOnWindowFocus: false,
  });
}

/**
 * Re-point a split thread's activities onto an operator-chosen owning
 * opportunity. Goes through the guarded link-resolver service server-side; the
 * single-client + owner-membership guards cannot be bypassed from the client.
 */
export function useResolveLink() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: true; result: { activitiesRepointed: number; targetTitle: string | null } },
    Error,
    { providerThreadId: string; targetOpportunityId: string }
  >({
    mutationFn: async ({ providerThreadId, targetOpportunityId }) => {
      const res = await authedFetch(
        `/api/data-review/${encodeURIComponent(providerThreadId)}/link`,
        { method: "POST", body: JSON.stringify({ targetOpportunityId }) }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to link thread");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dataReview.queue() });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Mark a split thread reviewed-and-left-as-is (synthetic legacy: marker). */
export function useQuarantineItem() {
  const queryClient = useQueryClient();
  return useMutation<
    { ok: true; result: { activitiesQuarantined: number; subject: string | null } },
    Error,
    { providerThreadId: string }
  >({
    mutationFn: async ({ providerThreadId }) => {
      const res = await authedFetch(
        `/api/data-review/${encodeURIComponent(providerThreadId)}/quarantine`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to quarantine thread");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dataReview.queue() });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
