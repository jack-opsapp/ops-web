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
  useDismissDuplicate,
} from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";
import { DuplicateClusterCard } from "./duplicate-cluster-card";
import type { DuplicateCluster } from "@/lib/hooks/use-duplicate-reviews";

export function DuplicateReviewSheet() {
  const { open, closeSheet } = useDuplicateReviewStore();
  const { data, isLoading } = useDuplicateReviews();
  const mergeMutation = useMergeDuplicate();
  const dismissMutation = useDismissDuplicate();
  const { t } = useDictionary("duplicates");
  const [currentIndex, setCurrentIndex] = useState(0);

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

  // Reset to 0 when sheet opens
  useEffect(() => {
    if (open) setCurrentIndex(0);
  }, [open]);

  const current = allClusters[currentIndex] ?? null;
  const total = allClusters.length;

  const handleMerge = useCallback(
    (
      reviewIds: string[],
      winnerId: string,
      fieldOverrides: Record<string, unknown>,
      entityEdits: Record<string, Record<string, unknown>>,
      entityType: string
    ) => {
      mergeMutation.mutate({
        reviewIds,
        winnerId,
        fieldOverrides,
        entityEdits: Object.keys(entityEdits).length > 0 ? entityEdits : undefined,
        entityType: Object.keys(entityEdits).length > 0
          ? (entityType as import("@/lib/api/services/duplicate-detection-service").DuplicateEntityType)
          : undefined,
      });
    },
    [mergeMutation]
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
          ? (entityType as import("@/lib/api/services/duplicate-detection-service").DuplicateEntityType)
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

  const isPending = mergeMutation.isPending || dismissMutation.isPending;

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
          ) : total === 0 ? (
            <div className="flex items-center justify-center py-16">
              <span className="font-mohave text-[13px] text-white/40">{t("empty")}</span>
            </div>
          ) : !current ? (
            <div className="flex items-center justify-center py-16">
              <span className="font-mohave text-[13px] text-white/40">{t("empty")}</span>
            </div>
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
                onMerge={handleMerge}
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
