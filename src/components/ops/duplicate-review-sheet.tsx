"use client";

import { useState } from "react";
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
import type { DuplicateEntityType } from "@/lib/api/services/duplicate-detection-service";

const ENTITY_TABS: DuplicateEntityType[] = [
  "client",
  "opportunity",
  "project",
  "task",
];

const TAB_KEYS: Record<DuplicateEntityType, string> = {
  client: "tabs.clients",
  opportunity: "tabs.opportunities",
  project: "tabs.projects",
  task: "tabs.tasks",
};

export function DuplicateReviewSheet() {
  const { open, closeSheet } = useDuplicateReviewStore();
  const { data, isLoading } = useDuplicateReviews();
  const mergeMutation = useMergeDuplicate();
  const dismissMutation = useDismissDuplicate();
  const { t } = useDictionary("duplicates");
  const [activeTab, setActiveTab] = useState<DuplicateEntityType>("client");

  const handleMerge = (
    reviewIds: string[],
    winnerId: string,
    fieldOverrides: Record<string, unknown>
  ) => {
    mergeMutation.mutate({ reviewIds, winnerId, fieldOverrides });
  };

  const handleDismiss = (reviewIds: string[]) => {
    dismissMutation.mutate({ reviewIds });
  };

  // Find first tab with items when current tab is empty
  const firstNonEmptyTab =
    data && ENTITY_TABS.find((tab) => (data[tab]?.length ?? 0) > 0);

  const effectiveTab =
    data && data[activeTab]?.length === 0 && firstNonEmptyTab
      ? firstNonEmptyTab
      : activeTab;

  const clusters = data?.[effectiveTab] ?? [];

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && closeSheet()}>
      <SheetContent side="right" className="w-full max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="sr-only">
            Review and resolve duplicate records
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4 overflow-y-auto scrollbar-hide">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-white/8 pb-2">
            {ENTITY_TABS.map((tab) => {
              const count = data?.[tab]?.length ?? 0;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-[2px] px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-wider transition-colors duration-150 ${
                    effectiveTab === tab
                      ? "bg-white/10 text-white/90"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  {t(TAB_KEYS[tab])}
                  {count > 0 && (
                    <span className="ml-1.5 text-[#597794]">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="font-mohave text-[13px] text-white/40">
                Loading...
              </span>
            </div>
          ) : clusters.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="font-mohave text-[13px] text-white/40">
                {t("empty")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {clusters.map((cluster) => (
                <DuplicateClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  entityType={cluster.entityType}
                  onMerge={handleMerge}
                  onDismiss={handleDismiss}
                  isMerging={
                    mergeMutation.isPending || dismissMutation.isPending
                  }
                />
              ))}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
