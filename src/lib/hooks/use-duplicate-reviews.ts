"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth-store";
import { queryKeys } from "../api/query-client";
import type {
  DuplicateReview,
  DuplicateEntityType,
  DuplicateConfidence,
  DuplicateSignal,
  FieldConflict,
  MergeReconciliation,
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

/** Shape returned by POST /api/duplicates/conflicts. */
export interface MergeConflictsResult {
  entityType: DuplicateEntityType;
  perLoser: Array<{ loserId: string; reconciliation: MergeReconciliation }>;
}

export type { FieldConflict };

/**
 * Per-loser operator selections for the RESOLVE step. For each loser, a map of
 * field → which side the operator chose to keep.
 */
export type ConflictSelections = Record<
  string,
  Record<string, "winner" | "loser">
>;

/**
 * The shape forwarded to the merge route as `confirmedOverrides`.
 *  - Single-loser clusters: a flat field→value map (the `mergeEntities` path).
 *  - Multi-loser clusters: keyed per loser id (the `mergeCluster` path).
 */
export type ConfirmedOverrides =
  | Record<string, unknown>
  | Record<string, Record<string, unknown>>;

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

// ─── Conflict-Detection Mutation ────────────────────────────────────────────

/**
 * Fetch the per-loser merge conflicts for a chosen winner. Implemented as a
 * mutation rather than a query: it runs on demand (operator presses
 * RESOLVE & MERGE), takes the winner as input, and must not auto-refetch on
 * focus/mount. Returns `{ entityType, perLoser }`; `perLoser` is empty for
 * project/task (no conflict gate) and for opportunity/client clusters that
 * differ only by fill-blank fields.
 */
export function useMergeConflicts() {
  return useMutation<MergeConflictsResult, Error, { reviewIds: string[]; winnerId: string }>({
    mutationFn: async ({ reviewIds, winnerId }) => {
      const res = await fetch("/api/duplicates/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewIds, winnerId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to detect merge conflicts");
      }
      return (await res.json()) as MergeConflictsResult;
    },
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
      confirmedOverrides,
      entityEdits,
      entityType,
      winnerTitle,
      absorbedCount,
      resolvedCount,
      notificationActionUrl,
    }: {
      reviewIds: string[];
      winnerId: string;
      /**
       * Operator-confirmed per-field overrides (Q2). Flat (field→value) for a
       * single-loser cluster, or keyed per loser id for a multi-loser cluster —
       * the merge RPC accepts both shapes. Omitted/empty means the merge applies
       * only the server-side fill-blank set.
       */
      confirmedOverrides?: ConfirmedOverrides;
      entityEdits?: Record<string, Record<string, unknown>>;
      entityType?: DuplicateEntityType;
      /** Display-only fields for the success rail notification (resolved here,
       * on the client, which holds the cluster + selection state). */
      winnerTitle?: string;
      absorbedCount?: number;
      resolvedCount?: number;
      notificationActionUrl?: string;
    }) => {
      const primaryReviewId = reviewIds[0];
      const additionalReviewIds = reviewIds.slice(1);

      const hasOverrides =
        confirmedOverrides && Object.keys(confirmedOverrides).length > 0;

      const res = await fetch(`/api/duplicates/${primaryReviewId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          winnerId,
          confirmedOverrides: hasOverrides ? confirmedOverrides : undefined,
          additionalReviewIds:
            additionalReviewIds.length > 0 ? additionalReviewIds : undefined,
          entityEdits:
            entityEdits && Object.keys(entityEdits).length > 0
              ? entityEdits
              : undefined,
          entityType: entityEdits && Object.keys(entityEdits).length > 0 ? entityType : undefined,
          winnerTitle,
          absorbedCount,
          resolvedCount,
          notificationActionUrl,
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
    mutationFn: async ({
      reviewIds,
      entityEdits,
      entityType,
    }: {
      reviewIds: string[];
      entityEdits?: Record<string, Record<string, unknown>>;
      entityType?: DuplicateEntityType;
    }) => {
      const primaryReviewId = reviewIds[0];
      const additionalReviewIds = reviewIds.slice(1);

      const bodyPayload: Record<string, unknown> = {};
      if (additionalReviewIds.length > 0) {
        bodyPayload.additionalReviewIds = additionalReviewIds;
      }
      if (entityEdits && Object.keys(entityEdits).length > 0) {
        bodyPayload.entityEdits = entityEdits;
        bodyPayload.entityType = entityType;
      }

      const res = await fetch(`/api/duplicates/${primaryReviewId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
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
