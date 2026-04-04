"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { showWidgetActionToast } from "./shared/widget-action-toast";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import { useExpenseBatches, useApproveBatch, useAllExpenses } from "@/lib/hooks/use-expense-approval";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useExpenseBatchPopoverStore } from "@/stores/expense-batch-popover-store";
import { isBatchNeedsReview, type ExpenseBatch } from "@/lib/types/expense-approval";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ── Props ──
interface ExpenseReviewWidgetProps {
  size: WidgetSize;
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ── Helpers ──
function getBatchAge(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  return `${days}d`;
}

// ── Component ──
export function ExpenseReviewWidget({
  size,
  isLoading,
  onNavigate,
}: ExpenseReviewWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const compact = isCompact(size);
  const heroClass = compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded;

  // Data
  const { data: batchesData } = useExpenseBatches();
  const { data: teamData } = useTeamMembers();
  const { data: allExpensesData } = useAllExpenses();
  const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
  const approveBatch = useApproveBatch();
  const { currentUser, company } = useAuthStore();

  // Filter to pending batches, sorted oldest first
  const pendingBatches = useMemo(() => {
    if (!batchesData) return [];
    return batchesData
      .filter((b) => isBatchNeedsReview(b.status))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [batchesData]);

  // Resolve submitter names
  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teamData?.users) {
      for (const u of teamData.users) {
        map.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id);
      }
    }
    return map;
  }, [teamData]);

  // Totals
  const totalPending = useMemo(() => {
    return pendingBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0);
  }, [pendingBatches]);

  const oldestAge = pendingBatches.length > 0 ? getBatchAge(pendingBatches[0].createdAt) : null;

  // Inline approve handler (LG)
  const handleInlineApprove = async (batch: ExpenseBatch) => {
    if (!allExpensesData) return;
    const expenseIds = allExpensesData
      .filter((e) => e.batchId === batch.id)
      .map((e) => e.id);

    await approveBatch.mutateAsync({
      batchId: batch.id,
      reviewedBy: currentUser?.id ?? "",
      approvedAmount: batch.totalAmount ?? 0,
      expenseIds,
      submittedBy: batch.submittedBy,
      companyId: batch.companyId ?? company?.id,
      batchNumber: batch.batchNumber,
    });

    showWidgetActionToast({
      label: t("expenseReview.approved") ?? "Batch approved",
      onUndo: () => {},
    });
  };

  // ── Loading ──
  if (isLoading) {
    return (
      <Card className={compact ? (size === "xs" ? "h-full" : "h-full p-0") : "h-full p-0"}>
        <div className={compact ? (size === "xs" ? "p-2" : "p-3") : "p-3"}>
          <WidgetSkeleton variant="list" />
        </div>
      </Card>
    );
  }

  const count = pendingBatches.length;

  // ── XS: Hero-first ──
  if (size === "xs") {
    return (
      <Card className="h-full" ref={ref}>
        <div
          className="h-full flex flex-col pt-3 cursor-pointer"
          onClick={() => onNavigate("/accounting")}
        >
          <span className={`font-mono ${count.toString().length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none ${count > 0 ? "text-text-primary" : "text-text-disabled"}`}>
            {count}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseReview.pendingReview") ?? "Pending Review"}
          </span>
          {count > 0 && (
            <WidgetTrendContext
              variant="snapshot"
              label={`${count} ${t("expenseReview.batchesPending") ?? "batches pending"} · ${formatCompactCurrency(totalPending)}`}
            />
          )}
        </div>
      </Card>
    );
  }

  // ── SM: Hero-first ──
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div
          className="h-full flex flex-col p-3 cursor-pointer"
          onClick={() => onNavigate("/accounting")}
        >
          <div className="flex items-baseline justify-between">
            <span className={`font-mono text-data-lg font-bold leading-none ${count > 0 ? "text-text-primary" : "text-text-disabled"}`}>
              {formatCompactCurrency(totalPending)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/accounting"); }}
              className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseReview.title") ?? "Expense Review"}
          </span>
          {count > 0 ? (
            <>
              <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
                {count} {t("expenseReview.batchesPending") ?? "batches pending"}
              </span>
              {oldestAge && (
                <span className="font-mono text-micro-sm text-text-disabled">
                  {t("expenseReview.oldest") ?? "oldest"}: {oldestAge}
                </span>
              )}
            </>
          ) : (
            <span className="font-mohave text-caption-sm text-text-disabled mt-0.5 truncate">
              {t("expenseReview.noBatches") ?? "No batches pending"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Standard zones ──
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("expenseReview.title") ?? "Expense Review"}
          </span>
        </div>

        {/* Hero */}
        <div className="mb-2">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-display font-bold leading-none ${count > 0 ? "text-text-primary" : "text-text-disabled"}`}>
              {formatCompactCurrency(totalPending)}
            </span>
            {count > 0 && (
              <span className="font-mono text-micro-sm text-text-disabled">
                {count} {t("expenseReview.batchesPending") ?? "batches pending"}
              </span>
            )}
          </div>
        </div>

        {/* Detail zone */}
        {showDetail(size) && (
          count > 0 ? (
            <ScrollFade className="mt-1">
              {pendingBatches.map((batch, i) => {
                const submitterName = userNameMap.get(batch.submittedBy ?? "") ?? "";
                const age = getBatchAge(batch.createdAt);

                return (
                  <WidgetLineItem
                    key={batch.id}
                    indicator={{
                      type: "avatar",
                      color: WT.accent,
                      initials: submitterName.slice(0, 2).toUpperCase(),
                    }}
                    primary={submitterName || batch.batchNumber}
                    secondary={`${batch.batchNumber} · ${age}`}
                    metric={formatCompactCurrency(batch.totalAmount ?? 0)}
                    onClick={(e) => {
                      if (e) {
                        openBatchPopover(
                          batch.id,
                          { x: e.clientX, y: e.clientY },
                          batch.batchNumber,
                          WT.accent,
                        );
                      }
                    }}
                    action={
                      showActions(size) ? (
                        <WidgetInlineAction
                          icon={Check}
                          label={t("expenseReview.approve") ?? "Approve"}
                          onAction={() => handleInlineApprove(batch)}
                        />
                      ) : undefined
                    }
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
            </ScrollFade>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <WidgetEmptyState
                icon={Check}
                message={t("expenseReview.allCaughtUp") ?? "All caught up"}
              />
            </div>
          )
        )}

        {/* Footer */}
        <button
          onClick={() => onNavigate("/accounting")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("expenseReview.viewAll") ?? "View All"}
        </button>
      </div>
    </Card>
  );
}
