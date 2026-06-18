"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import { useExpenseBatches, useAllExpenses } from "@/lib/hooks/use-expense-approval";
import { useExpenseSettings } from "@/lib/hooks/use-expense-settings";
import { useAuthStore } from "@/lib/store/auth-store";
import { useExpenseBatchPopoverStore } from "@/stores/expense-batch-popover-store";
import {
  isBatchNeedsReview,
  isBatchApproved,
  ExpenseBatchStatus,
  formatPeriodDisplay,
  periodKeyFromBatch,
  type ExpenseBatch,
} from "@/lib/types/expense-approval";
import {
  computeSubmitterUrgency,
  computeAllBatchCompliance,
  type BatchCompliance,
  receiptComplianceColor,
} from "@/lib/utils/expense-urgency";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ── Status helpers ──
function getBatchStatusColor(status: ExpenseBatchStatus): string {
  switch (status) {
    case ExpenseBatchStatus.Approved:
    case ExpenseBatchStatus.AutoApproved:
      return WT.success;
    case ExpenseBatchStatus.PendingReview:
    case ExpenseBatchStatus.Submitted:
      return WT.accent;
    case ExpenseBatchStatus.PartiallyApproved:
      return WT.warning;
    case ExpenseBatchStatus.Rejected:
      return WT.error;
    default:
      return WT.muted;
  }
}

function getBatchStatusLabel(status: ExpenseBatchStatus): string {
  switch (status) {
    case ExpenseBatchStatus.Approved: return "APPROVED";
    case ExpenseBatchStatus.AutoApproved: return "AUTO";
    case ExpenseBatchStatus.PendingReview:
    case ExpenseBatchStatus.Submitted: return "PENDING";
    case ExpenseBatchStatus.PartiallyApproved: return "REVISION";
    case ExpenseBatchStatus.Rejected: return "REJECTED";
    default: return status;
  }
}

function getBadgeClasses(status: ExpenseBatchStatus): string {
  switch (status) {
    case ExpenseBatchStatus.Approved:
    case ExpenseBatchStatus.AutoApproved:
      return "text-status-success bg-status-success/15 border-status-success/30";
    case ExpenseBatchStatus.PendingReview:
    case ExpenseBatchStatus.Submitted:
      return "text-text-2 bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.15)]";
    case ExpenseBatchStatus.PartiallyApproved:
      return "text-ops-amber bg-ops-amber/15 border-ops-amber/30";
    case ExpenseBatchStatus.Rejected:
      return "text-ops-error bg-ops-error/15 border-ops-error/30";
    default:
      return "text-text-mute bg-text-disabled/15 border-text-disabled/30";
  }
}

// ── Period filter ──
function isInPeriod(batch: ExpenseBatch, period: string): boolean {
  const now = new Date();
  const created = new Date(batch.createdAt);
  switch (period) {
    case "last-month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return created >= start && created <= end;
    }
    case "ytd":
      return created >= new Date(now.getFullYear(), 0, 1) && created <= now;
    case "this-month":
    default:
      return created >= new Date(now.getFullYear(), now.getMonth(), 1) && created <= now;
  }
}

// ── Props ──
interface MyExpensesWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ── Component ──
export function MyExpensesWidget({
  size,
  config,
  isLoading,
  onNavigate,
}: MyExpensesWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const compact = isCompact(size);

  // Data
  const { data: batchesData } = useExpenseBatches();
  const { data: allExpensesData } = useAllExpenses();
  const { data: settings } = useExpenseSettings();
  const { currentUser } = useAuthStore();
  const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
  const period = (config.period as string) ?? "this-month";

  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const requireReceipt = settings?.requireReceiptPhoto ?? false;

  // Compliance map
  const complianceMap = useMemo(() => {
    if (!allExpensesData) return new Map<string, BatchCompliance>();
    return computeAllBatchCompliance(allExpensesData);
  }, [allExpensesData]);

  // Filter to current user's batches within period
  const myBatches = useMemo(() => {
    if (!batchesData || !currentUser) return [];
    return batchesData
      .filter((b) => b.submittedBy === currentUser.id)
      .filter((b) => isInPeriod(b, period))
      .sort((a, b) => {
        const statusOrder = (s: ExpenseBatchStatus) => {
          if (s === ExpenseBatchStatus.Rejected || s === ExpenseBatchStatus.PartiallyApproved) return 0;
          if (isBatchNeedsReview(s)) return 1;
          return 2;
        };
        const diff = statusOrder(a.status) - statusOrder(b.status);
        if (diff !== 0) return diff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [batchesData, currentUser, period]);

  // Stats
  const stats = useMemo(() => {
    const total = myBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0);
    const approved = myBatches.filter((b) => isBatchApproved(b.status)).length;
    const pending = myBatches.filter((b) => isBatchNeedsReview(b.status)).length;
    const revision = myBatches.filter((b) =>
      b.status === ExpenseBatchStatus.Rejected || b.status === ExpenseBatchStatus.PartiallyApproved
    ).length;
    return { total, approved, pending, revision };
  }, [myBatches]);

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

  const batchCount = myBatches.length;

  // ── XS ──
  if (size === "xs") {
    const heroVal = stats.revision > 0 ? stats.revision : stats.pending;
    return (
      <Card className="h-full" ref={ref}>
        <div className="h-full flex flex-col pt-3 cursor-pointer" onClick={() => onNavigate("/books?segment=expenses")}>
          <span className={`font-mono ${heroVal.toString().length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none ${heroVal > 0 ? "text-text" : "text-text-mute"}`}>
            {heroVal}
          </span>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("myExpenses.title") ?? "My Expenses"}
          </span>
          {stats.revision > 0 && (
            <WidgetTrendContext variant="health" color={WT.warning} label={`${stats.revision} ${t("myExpenses.needsRevision") ?? "need revision"}`} />
          )}
        </div>
      </Card>
    );
  }

  // ── SM ──
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3 cursor-pointer" onClick={() => onNavigate("/books?segment=expenses")}>
          <div className="flex items-baseline justify-between">
            <span className={`font-mono text-data-lg font-bold leading-none ${batchCount > 0 ? "text-text" : "text-text-mute"}`}>
              {formatCompactCurrency(stats.total)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/books?segment=expenses"); }}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("myExpenses.title") ?? "My Expenses"}
          </span>
          {stats.revision > 0 ? (
            <span className="font-mohave text-caption-sm mt-0.5 truncate" style={{ color: WT.warning }}>
              {stats.revision} {t("myExpenses.needsRevision") ?? "need revision"}
            </span>
          ) : batchCount > 0 ? (
            <span className="font-mohave text-caption-sm text-text-2 mt-0.5 truncate">
              {stats.approved} {t("myExpenses.approved") ?? "approved"} · {stats.pending} {t("myExpenses.pending") ?? "pending"}
            </span>
          ) : (
            <span className="font-mohave text-caption-sm text-text-mute mt-0.5 truncate">
              {t("myExpenses.noExpenses") ?? "No expenses submitted"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG ──
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("myExpenses.title") ?? "My Expenses"}
          </span>
        </div>

        {/* Hero */}
        <div className="mb-2">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-display font-bold leading-none ${batchCount > 0 ? "text-text" : "text-text-mute"}`}>
              {formatCompactCurrency(stats.total)}
            </span>
            {batchCount > 0 && (
              <span className="font-mono text-micro text-text-mute">
                {batchCount} {batchCount === 1 ? "batch" : "batches"}
              </span>
            )}
          </div>
        </div>

        {/* Detail zone */}
        {showDetail(size) && (
          batchCount > 0 ? (
            <ScrollFade className="mt-1">
              {myBatches.map((batch, i) => {
                const statusColor = getBatchStatusColor(batch.status);
                const statusLabel = getBatchStatusLabel(batch.status);
                const badgeClasses = getBadgeClasses(batch.status);
                const periodDisplay = formatPeriodDisplay(periodKeyFromBatch(batch));
                const isRevision = batch.status === ExpenseBatchStatus.Rejected || batch.status === ExpenseBatchStatus.PartiallyApproved;
                const overdueReview = computeSubmitterUrgency(batch, reviewFrequency);
                const compliance = complianceMap.get(batch.id);
                const missingReceipts = compliance?.receiptsMissing ?? 0;
                const totalExpenses = compliance?.receiptsTotal ?? 0;

                // Build secondary — ReactNode when compliance color needed
                const hasComplianceIssue = requireReceipt && missingReceipts > 0;
                const complianceColorKey = hasComplianceIssue ? receiptComplianceColor(missingReceipts, totalExpenses) : null;
                const complianceColor = complianceColorKey === "error" ? WT.error : complianceColorKey === "warning" ? WT.warning : null;

                let secondaryParts = periodDisplay;
                if (isRevision && showActions(size) && batch.reviewNotes) {
                  secondaryParts += ` · ${batch.reviewNotes}`;
                }
                if (overdueReview) {
                  secondaryParts += ` · ${t("myExpenses.overdueReview") ?? "overdue review"}`;
                }

                const secondary = hasComplianceIssue ? (
                  <span className="font-mono text-micro text-text-mute truncate">
                    {secondaryParts} · <span style={{ color: complianceColor ?? undefined }}>{missingReceipts}/{totalExpenses} {t("expenseReview.missingReceipts") ?? "missing receipts"}</span>
                  </span>
                ) : (overdueReview ? (
                  <span className="font-mono text-micro text-text-mute truncate">
                    {secondaryParts}
                  </span>
                ) : secondaryParts);

                return (
                  <WidgetLineItem
                    key={batch.id}
                    indicator={{
                      type: "bar",
                      color: statusColor,
                      label: statusLabel,
                    }}
                    primary={batch.batchNumber}
                    secondary={secondary}
                    metric={
                      <span className="flex items-center gap-1">
                        <span
                          className={`font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap ${badgeClasses}`}
                          style={{ fontSize: "9px", lineHeight: "1.3" }}
                        >
                          {statusLabel}
                        </span>
                        <span className="font-mono text-micro text-text-2">
                          {formatCompactCurrency(batch.totalAmount ?? 0)}
                        </span>
                      </span>
                    }
                    onClick={(e) => {
                      if (e) {
                        openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, statusColor);
                      }
                    }}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
            </ScrollFade>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <WidgetEmptyState message={t("myExpenses.noExpensesPeriod") ?? "No expenses submitted this period"} />
            </div>
          )
        )}

        {/* Action zone — LG summary strip */}
        {showActions(size) && batchCount > 0 && (
          <div className="mt-2 pt-2 border-t border-border-subtle shrink-0 flex items-center gap-2">
            <span className="font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap text-status-success bg-status-success/15 border-status-success/30" style={{ fontSize: "9px", lineHeight: "1.3" }}>
              {stats.approved} {t("myExpenses.approved") ?? "approved"}
            </span>
            <span className="font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap text-text-2 bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.15)]" style={{ fontSize: "9px", lineHeight: "1.3" }}>
              {stats.pending} {t("myExpenses.pending") ?? "pending"}
            </span>
            {stats.revision > 0 && (
              <span className="font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap text-ops-amber bg-ops-amber/15 border-ops-amber/30" style={{ fontSize: "9px", lineHeight: "1.3" }}>
                {stats.revision} {t("myExpenses.needsRevision") ?? "need revision"}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <button
          onClick={() => onNavigate("/books?segment=expenses")}
          className="mt-auto pt-2 font-mono text-micro text-text-3 uppercase tracking-wider hover:text-text-2 transition-colors text-left"
        >
          {t("myExpenses.viewAll") ?? "View All"}
        </button>
      </div>
    </Card>
  );
}
