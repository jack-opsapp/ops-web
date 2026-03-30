"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth-store";
import { queryKeys } from "../api/query-client";
import type {
  DuplicateReview,
  DuplicateEntityType,
} from "../api/services/duplicate-detection-service";

export interface EnrichedDuplicateReview extends DuplicateReview {
  entityA: Record<string, unknown> | null;
  entityB: Record<string, unknown> | null;
}

export interface GroupedReviews {
  client: EnrichedDuplicateReview[];
  opportunity: EnrichedDuplicateReview[];
  project: EnrichedDuplicateReview[];
  task: EnrichedDuplicateReview[];
  total: number;
}

export function useDuplicateReviews() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery<GroupedReviews>({
    queryKey: queryKeys.duplicateReviews.pending(companyId),
    queryFn: async () => {
      const res = await fetch("/api/duplicates");
      if (!res.ok) throw new Error("Failed to fetch duplicate reviews");
      const { reviews } = (await res.json()) as {
        reviews: EnrichedDuplicateReview[];
      };

      const grouped: GroupedReviews = {
        client: [],
        opportunity: [],
        project: [],
        task: [],
        total: reviews.length,
      };

      for (const r of reviews) {
        grouped[r.entityType as DuplicateEntityType].push(r);
      }

      return grouped;
    },
    enabled: !!companyId,
  });
}

export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      reviewId,
      winnerId,
    }: {
      reviewId: string;
      winnerId: string;
    }) => {
      const res = await fetch(`/api/duplicates/${reviewId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Merge failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.duplicateReviews.pending(company?.id ?? ""),
      });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDismissDuplicate() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({ reviewId }: { reviewId: string }) => {
      const res = await fetch(`/api/duplicates/${reviewId}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Dismiss failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.duplicateReviews.pending(company?.id ?? ""),
      });
    },
  });
}
