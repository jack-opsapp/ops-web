"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import {
  useDuplicateReviews,
  useMergeDuplicate,
  useMergeConflicts,
  useDismissDuplicate,
} from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";
import { DuplicateClusterCard } from "./duplicate-cluster-card";
import { MergeConflictStep } from "./merge-conflict-step";
import type {
  DuplicateCluster,
  ConfirmedOverrides,
} from "@/lib/hooks/use-duplicate-reviews";
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";

type Step = "compare" | "resolve";

/** Snapshot of the merge the operator initiated from the COMPARE step. */
interface PendingMerge {
  reviewIds: string[];
  winnerId: string;
  entityEdits: Record<string, Record<string, unknown>>;
  entityType: DuplicateEntityType;
}

/** First non-blank title-ish field on the winner entity (for the rail copy). */
const TITLE_FIELDS = ["title", "name", "contact_name", "custom_title"] as const;
function winnerDisplayTitle(cluster: DuplicateCluster, winnerId: string): string {
  const entity = cluster.entities.find((e) => e.id === winnerId);
  if (entity) {
    for (const f of TITLE_FIELDS) {
      const v = entity.data[f];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "record";
}

/** Deep-link to the surviving record, by entity type (project→workspace). */
function winnerActionUrl(
  entityType: DuplicateEntityType,
  winnerId: string
): string | undefined {
  if (entityType === "project") {
    return `/dashboard?openProject=${winnerId}&mode=view`;
  }
  return undefined;
}

export function DuplicateReviewSheet() {
  const { open, closeSheet } = useDuplicateReviewStore();
  const { data, isLoading } = useDuplicateReviews();
  const mergeMutation = useMergeDuplicate();
  const conflictsMutation = useMergeConflicts();
  const dismissMutation = useDismissDuplicate();
  const { t } = useDictionary("duplicates");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<Step>("compare");
  const [pending, setPending] = useState<PendingMerge | null>(null);

  // Flatten all clusters into a single ordered list
  const allClusters = useMemo(() => {
    if (!data) return [];
    const clusters: (DuplicateCluster & { _entityType: string })[] = [];
    for (const type of ["client", "opportunity", "project", "task"] as const) {
      for (const c of data[type]) {
        clusters.push({ ...c, _entityType: type });
      }
    }
    return clusters;
  }, [data]);

  // Reset index when data changes (e.g., after a merge/dismiss)
  useEffect(() => {
    if (currentIndex >= allClusters.length && allClusters.length > 0) {
      setCurrentIndex(allClusters.length - 1);
    }
  }, [allClusters.length, currentIndex]);

  // Reset to 0 + COMPARE when sheet opens
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setStep("compare");
      setPending(null);
    }
  }, [open]);

  const current = allClusters[currentIndex] ?? null;
  const total = allClusters.length;

  // Return to COMPARE whenever the active cluster changes.
  const resetToCompare = useCallback(() => {
    setStep("compare");
    setPending(null);
    conflictsMutation.reset();
    mergeMutation.reset();
  }, [conflictsMutation, mergeMutation]);

  /** Fire the actual merge with operator-confirmed overrides (if any). */
  const submitMerge = useCallback(
    (
      merge: PendingMerge,
      confirmedOverrides: ConfirmedOverrides,
      resolvedCount: number,
      cluster: DuplicateCluster | null
    ) => {
      // Display-only data for the success rail notification (fired server-side).
      const winnerTitle = cluster
        ? winnerDisplayTitle(cluster, merge.winnerId)
        : "record";
      const absorbedCount = cluster
        ? Math.max(cluster.entities.length - 1, 1)
        : 1;

      mergeMutation.mutate(
        {
          reviewIds: merge.reviewIds,
          winnerId: merge.winnerId,
          confirmedOverrides,
          entityEdits:
            Object.keys(merge.entityEdits).length > 0 ? merge.entityEdits : undefined,
          entityType:
            Object.keys(merge.entityEdits).length > 0 ? merge.entityType : undefined,
          winnerTitle,
          absorbedCount,
          resolvedCount,
          notificationActionUrl: winnerActionUrl(merge.entityType, merge.winnerId),
        },
        {
          onSuccess: () => {
            // Advance: the list re-fetches; reset back to COMPARE for the next.
            resetToCompare();
          },
        }
      );
    },
    [mergeMutation, resetToCompare]
  );

  // COMPARE → operator pressed // RESOLVE & MERGE. Detect conflicts, then either
  // open the RESOLVE step or merge straight through (zero-conflict path).
  const handleResolveAndMerge = useCallback(
    (
      reviewIds: string[],
      winnerId: string,
      entityEdits: Record<string, Record<string, unknown>>,
      entityType: DuplicateEntityType
    ) => {
      const merge: PendingMerge = { reviewIds, winnerId, entityEdits, entityType };
      setPending(merge);
      conflictsMutation.mutate(
        { reviewIds, winnerId },
        {
          onSuccess: (result) => {
            const hasConflicts = result.perLoser.some(
              (l) => l.reconciliation.conflicts.length > 0
            );
            if (hasConflicts) {
              setStep("resolve");
            } else {
              // No conflicts to reconcile — merge immediately, no empty screen.
              // Zero conflicts → zero fields reconciled.
              submitMerge(merge, {}, 0, current);
            }
          },
          onError: () => {
            // Surface the failure on the RESOLVE step (it renders conflictsError).
            setStep("resolve");
          },
        }
      );
    },
    [conflictsMutation, submitMerge, current]
  );

  const handleConfirmFromResolve = useCallback(
    ({
      confirmedOverrides,
      resolvedCount,
    }: {
      confirmedOverrides: ConfirmedOverrides;
      resolvedCount: number;
    }) => {
      if (!pending) return;
      submitMerge(pending, confirmedOverrides, resolvedCount, current);
    },
    [pending, submitMerge, current]
  );

  const handleDismiss = useCallback(
    (
      reviewIds: string[],
      entityEdits: Record<string, Record<string, unknown>>,
      entityType: string
    ) => {
      dismissMutation.mutate({
        reviewIds,
        entityEdits: Object.keys(entityEdits).length > 0 ? entityEdits : undefined,
        entityType: Object.keys(entityEdits).length > 0
          ? (entityType as DuplicateEntityType)
          : undefined,
      });
    },
    [dismissMutation]
  );

  // Entity type counts for the subtitle
  const counts = useMemo(() => {
    if (!data) return null;
    const parts: string[] = [];
    if (data.client.length > 0) parts.push(`${data.client.length} ${t("tabs.clients")}`);
    if (data.opportunity.length > 0) parts.push(`${data.opportunity.length} ${t("tabs.opportunities")}`);
    if (data.project.length > 0) parts.push(`${data.project.length} ${t("tabs.projects")}`);
    if (data.task.length > 0) parts.push(`${data.task.length} ${t("tabs.tasks")}`);
    return parts.join(" · ");
  }, [data, t]);

  // Pressing RESOLVE & MERGE on a zero-conflict cluster keeps us in COMPARE while
  // conflicts resolve, then merges — the card shows its merging state via this.
  const isDetecting = conflictsMutation.isPending;
  const isPending = mergeMutation.isPending || dismissMutation.isPending || isDetecting;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && closeSheet()}>
      <SheetContent side="right" className="w-full max-w-[min(90vw,960px)]">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="sr-only">
            Review and resolve duplicate records
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-0 overflow-y-auto overflow-x-hidden scrollbar-hide">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <span className="font-mohave text-[13px] text-white/40">Loading...</span>
            </div>
          ) : total === 0 || !current ? (
            <div className="flex items-center justify-center py-16">
              <span className="font-mohave text-[13px] text-white/40">{t("empty")}</span>
            </div>
          ) : step === "resolve" && pending ? (
            <MergeConflictStep
              cluster={current}
              winnerId={pending.winnerId}
              conflicts={conflictsMutation.data}
              isLoadingConflicts={conflictsMutation.isPending}
              conflictsError={conflictsMutation.error}
              isMerging={mergeMutation.isPending}
              mergeError={mergeMutation.error}
              onConfirm={handleConfirmFromResolve}
              onBack={resetToCompare}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {/* Progress bar + counter */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-micro uppercase tracking-wider text-white/40">
                    {currentIndex + 1} / {total}
                  </span>
                  <span className="font-mono text-micro uppercase tracking-wider text-white/30">
                    {counts}
                  </span>
                </div>
                <div className="h-[2px] w-full bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-text-2 transition-all duration-300"
                    style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
                  />
                </div>
              </div>

              {/* Entity type label */}
              <span className="font-mono text-micro uppercase tracking-wider text-white/30">
                {t(`tabs.${current.entityType}s` as `tabs.${string}`) || current.entityType}
              </span>

              {/* The current cluster */}
              <DuplicateClusterCard
                cluster={current}
                entityType={current.entityType}
                onResolveAndMerge={handleResolveAndMerge}
                onDismiss={handleDismiss}
                isMerging={isPending}
              />
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
