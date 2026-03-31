"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth-store";
import { queryKeys } from "../api/query-client";
import type {
  DuplicateReview,
  DuplicateEntityType,
  DuplicateConfidence,
  DuplicateSignal,
} from "../api/services/duplicate-detection-service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EnrichedDuplicateReview extends DuplicateReview {
  entityA: Record<string, unknown> | null;
  entityB: Record<string, unknown> | null;
}

export interface EnrichedEntity {
  id: string;
  data: Record<string, unknown>;
}

export interface DuplicateCluster {
  id: string;
  entityType: DuplicateEntityType;
  entities: EnrichedEntity[];
  reviewIds: string[];
  confidence: DuplicateConfidence;
  signals: DuplicateSignal[];
}

export interface GroupedClusters {
  client: DuplicateCluster[];
  opportunity: DuplicateCluster[];
  project: DuplicateCluster[];
  task: DuplicateCluster[];
  total: number;
}

// Keep old type for backward compatibility if needed elsewhere
export interface GroupedReviews {
  client: EnrichedDuplicateReview[];
  opportunity: EnrichedDuplicateReview[];
  project: EnrichedDuplicateReview[];
  task: EnrichedDuplicateReview[];
  total: number;
}

// ─── Union-Find ─────────────────────────────────────────────────────────────

class UnionFind {
  private parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }

  getComponents(): Map<string, string[]> {
    const components = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push(key);
    }
    return components;
  }
}

// ─── Clustering Logic ───────────────────────────────────────────────────────

function buildClusters(reviews: EnrichedDuplicateReview[]): DuplicateCluster[] {
  if (reviews.length === 0) return [];

  // Group reviews by entity type
  const byType = new Map<DuplicateEntityType, EnrichedDuplicateReview[]>();
  for (const r of reviews) {
    const list = byType.get(r.entityType) ?? [];
    list.push(r);
    byType.set(r.entityType, list);
  }

  const clusters: DuplicateCluster[] = [];

  for (const [entityType, typeReviews] of byType) {
    const uf = new UnionFind();

    // Union all entity pairs
    for (const r of typeReviews) {
      uf.union(r.entityAId, r.entityBId);
    }

    // Group reviews by their cluster root
    const components = uf.getComponents();

    // Build entity ID -> entity data map
    const entityMap = new Map<string, Record<string, unknown>>();
    for (const r of typeReviews) {
      if (r.entityA) entityMap.set(r.entityAId, r.entityA);
      if (r.entityB) entityMap.set(r.entityBId, r.entityB);
    }

    // Build review membership: which reviews belong to which component
    const reviewsByRoot = new Map<string, EnrichedDuplicateReview[]>();
    for (const r of typeReviews) {
      const root = uf.find(r.entityAId);
      const list = reviewsByRoot.get(root) ?? [];
      list.push(r);
      reviewsByRoot.set(root, list);
    }

    for (const [root, entityIds] of components) {
      const clusterReviews = reviewsByRoot.get(root) ?? [];
      if (clusterReviews.length === 0) continue;

      // Collect unique entities
      const entities: EnrichedEntity[] = [];
      for (const entityId of entityIds) {
        const data = entityMap.get(entityId);
        if (data) {
          entities.push({ id: entityId, data });
        }
      }

      // Skip clusters with fewer than 2 entities (data integrity issue)
      if (entities.length < 2) continue;

      // Aggregate confidence: highest wins
      const hasHigh = clusterReviews.some((r) => r.confidence === "high");

      // Aggregate signals: dedupe by type
      const signalMap = new Map<string, DuplicateSignal>();
      for (const r of clusterReviews) {
        for (const s of r.signals) {
          if (!signalMap.has(s.type)) {
            signalMap.set(s.type, s);
          }
        }
      }

      clusters.push({
        id: `cluster-${root}`,
        entityType,
        entities,
        reviewIds: clusterReviews.map((r) => r.id),
        confidence: hasHigh ? "high" : "medium",
        signals: Array.from(signalMap.values()),
      });
    }
  }

  return clusters;
}

// ─── Query Hook ─────────────────────────────────────────────────────────────

export function useDuplicateReviews() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery<GroupedClusters>({
    queryKey: queryKeys.duplicateReviews.pending(companyId),
    queryFn: async () => {
      const res = await fetch("/api/duplicates");
      if (!res.ok) throw new Error("Failed to fetch duplicate reviews");
      const { reviews } = (await res.json()) as {
        reviews: EnrichedDuplicateReview[];
      };

      const clusters = buildClusters(reviews);

      const grouped: GroupedClusters = {
        client: [],
        opportunity: [],
        project: [],
        task: [],
        total: 0,
      };

      for (const c of clusters) {
        grouped[c.entityType].push(c);
      }

      grouped.total =
        grouped.client.length +
        grouped.opportunity.length +
        grouped.project.length +
        grouped.task.length;

      return grouped;
    },
    enabled: !!companyId,
  });
}

// ─── Merge Mutation (cluster-aware) ─────────────────────────────────────────

export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      reviewIds,
      winnerId,
      fieldOverrides,
    }: {
      reviewIds: string[];
      winnerId: string;
      fieldOverrides?: Record<string, unknown>;
    }) => {
      const primaryReviewId = reviewIds[0];
      const additionalReviewIds = reviewIds.slice(1);

      const res = await fetch(`/api/duplicates/${primaryReviewId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          winnerId,
          fieldOverrides,
          additionalReviewIds:
            additionalReviewIds.length > 0 ? additionalReviewIds : undefined,
        }),
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

// ─── Dismiss Mutation (cluster-aware) ───────────────────────────────────────

export function useDismissDuplicate() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: async ({ reviewIds }: { reviewIds: string[] }) => {
      const primaryReviewId = reviewIds[0];
      const additionalReviewIds = reviewIds.slice(1);

      const res = await fetch(`/api/duplicates/${primaryReviewId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          additionalReviewIds.length > 0
            ? { additionalReviewIds }
            : {}
        ),
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
