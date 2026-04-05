"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, X, Send } from "lucide-react";
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
import {
  useExpenseBatches,
  useApproveBatch,
  useAllExpenses,
  useQuickRejectBatch,
} from "@/lib/hooks/use-expense-approval";
import { useExpenseSettings } from "@/lib/hooks/use-expense-settings";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useExpenseBatchPopoverStore } from "@/stores/expense-batch-popover-store";
import { isBatchNeedsReview, isBatchApproved, ExpenseBatchStatus, type ExpenseBatch } from "@/lib/types/expense-approval";
import {
  computeBatchUrgency,
  computeAllBatchCompliance,
  type BatchUrgency,
  type BatchCompliance,
  receiptComplianceColor,
} from "@/lib/utils/expense-urgency";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ── Urgency color helpers ──
function urgencyDotColor(urgency: BatchUrgency): string | null {
  if (urgency === "due") return WT.warning;
  if (urgency === "overdue") return WT.error;
  return null;
}

// ── Props ──
interface ExpenseReviewWidgetProps {
  size: WidgetSize;
  isLoading: boolean;
  onNavigate: (path: string) => void;
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

  // Data
  const { data: batchesData } = useExpenseBatches();
  const { data: teamData } = useTeamMembers();
  const { data: allExpensesData } = useAllExpenses();
  const { data: settings } = useExpenseSettings();
  const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
  const approveBatch = useApproveBatch();
  const quickReject = useQuickRejectBatch();
  const { currentUser, company } = useAuthStore();

  // Reject UI state
  const [rejectingBatchId, setRejectingBatchId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const requireReceipt = settings?.requireReceiptPhoto ?? false;

  // Filter to pending batches with urgency
  const pendingBatches = useMemo(() => {
    if (!batchesData) return [];
    return batchesData
      .filter((b) => isBatchNeedsReview(b.status))
      .map((b) => ({
        ...b,
        urgency: computeBatchUrgency(b, reviewFrequency),
      }))
      .sort((a, b) => {
        const urgencyOrder: Record<BatchUrgency, number> = { overdue: 0, due: 1, fresh: 2 };
        const diff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [batchesData, reviewFrequency]);

  // Approved + rejected batches (LG only)
  const approvedBatches = useMemo(() => {
    if (!batchesData) return [];
    return batchesData
      .filter((b) => isBatchApproved(b.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
  }, [batchesData]);

  const rejectedBatches = useMemo(() => {
    if (!batchesData) return [];
    return batchesData
      .filter((b) => b.status === ExpenseBatchStatus.Rejected)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
  }, [batchesData]);

  // Compliance map
  const complianceMap = useMemo(() => {
    if (!allExpensesData) return new Map<string, BatchCompliance>();
    return computeAllBatchCompliance(allExpensesData);
  }, [allExpensesData]);

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
  const totalPending = useMemo(
    () => pendingBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0),
    [pendingBatches],
  );
  const overdueCount = useMemo(
    () => pendingBatches.filter((b) => b.urgency === "overdue").length,
    [pendingBatches],
  );

  // ── Actions ──
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

  const handleQuickReject = async (batchId: string) => {
    if (!rejectNote.trim()) return;
    await quickReject.mutateAsync({
      batchId,
      reviewedBy: currentUser?.id ?? "",
      reviewNotes: rejectNote.trim(),
    });
    showWidgetActionToast({
      label: t("expenseReview.returnedForRevision") ?? "Returned for revision",
      onUndo: () => {},
    });
    setRejectingBatchId(null);
    setRejectNote("");
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

  // ── XS: Awareness signal ──
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
          {overdueCount > 0 && (
            <WidgetTrendContext
              variant="health"
              color={WT.error}
              label={`${overdueCount} ${t("expenseReview.overdue") ?? "overdue"}`}
            />
          )}
        </div>
      </Card>
    );
  }

  // ── SM: Awareness signal ──
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
            <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
              {count} {t("expenseReview.batchesPendingCount") ?? "batches"}
              {overdueCount > 0 && (
                <span style={{ color: WT.error }}> · {overdueCount} {t("expenseReview.overdue") ?? "overdue"}</span>
              )}
            </span>
          ) : (
            <span className="font-mohave text-caption-sm text-text-disabled mt-0.5 truncate">
              {t("expenseReview.noBatches") ?? "No batches pending"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Triage queue + quick actions ──
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
                {count} {t("expenseReview.batchesPendingCount") ?? "batches"}
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
                const dotColor = urgencyDotColor(batch.urgency);
                const compliance = complianceMap.get(batch.id);
                const missingReceipts = compliance?.receiptsMissing ?? 0;
                const totalExpenses = compliance?.receiptsTotal ?? 0;

                // Build secondary — ReactNode when compliance needed for color
                const complianceColorToken = requireReceipt && missingReceipts > 0
                  ? receiptComplianceColor(missingReceipts, totalExpenses)
                  : null;
                const complianceColor = complianceColorToken === "error" ? WT.error : complianceColorToken === "warning" ? WT.warning : null;

                const secondary = requireReceipt && missingReceipts > 0 ? (
                  <span className="font-kosugi text-micro-sm text-text-disabled truncate">
                    {batch.batchNumber} · <span style={{ color: complianceColor ?? undefined }}>{missingReceipts}/{totalExpenses} {t("expenseReview.missingReceipts") ?? "missing receipts"}</span>
                  </span>
                ) : batch.batchNumber;

                return (
                  <div key={batch.id}>
                    <WidgetLineItem
                      indicator={
                        dotColor
                          ? { type: "dot", color: dotColor }
                          : { type: "avatar", color: WT.accent, initials: submitterName.slice(0, 2).toUpperCase() }
                      }
                      primary={submitterName || batch.batchNumber}
                      secondary={secondary}
                      metric={formatCompactCurrency(batch.totalAmount ?? 0)}
                      onClick={(e) => {
                        if (e) {
                          openBatchPopover(
                            batch.id,
                            { x: e.clientX, y: e.clientY },
                            batch.batchNumber,
                            dotColor ?? WT.accent,
                          );
                        }
                      }}
                      action={
                        <div className="flex items-center gap-0.5">
                          <WidgetInlineAction
                            icon={Check}
                            label={t("expenseReview.approve") ?? "Approve"}
                            onAction={() => handleInlineApprove(batch)}
                          />
                          <WidgetInlineAction
                            icon={X}
                            label="Reject"
                            onAction={() => {
                              setRejectingBatchId(rejectingBatchId === batch.id ? null : batch.id);
                              setRejectNote("");
                            }}
                          />
                        </div>
                      }
                      index={i}
                      isVisible={isVisible}
                      reducedMotion={reducedMotion}
                    />

                    {/* Inline reject note input */}
                    {rejectingBatchId === batch.id && (
                      <div className="flex items-center gap-1 px-1 py-1 ml-6">
                        <input
                          type="text"
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && rejectNote.trim()) handleQuickReject(batch.id);
                            if (e.key === "Escape") { setRejectingBatchId(null); setRejectNote(""); }
                          }}
                          placeholder={t("expenseReview.rejectNote") ?? "What needs fixing?"}
                          className="flex-1 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-[2px] px-2 py-1 font-mohave text-[11px] text-text-primary placeholder:text-text-disabled outline-none focus:border-ops-accent transition-colors"
                          autoFocus
                        />
                        <button
                          onClick={() => handleQuickReject(batch.id)}
                          disabled={!rejectNote.trim() || quickReject.isPending}
                          className="w-5 h-5 flex items-center justify-center rounded-[2px] text-text-disabled hover:text-ops-accent disabled:opacity-30 transition-colors"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Approved section — LG only */}
              {showActions(size) && approvedBatches.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border-subtle">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider mb-1 block">
                    Approved
                  </span>
                  {approvedBatches.map((batch, i) => {
                    const submitterName = userNameMap.get(batch.submittedBy ?? "") ?? "";
                    return (
                      <WidgetLineItem
                        key={batch.id}
                        indicator={{ type: "bar", color: WT.success, label: "APPROVED" }}
                        primary={submitterName || batch.batchNumber}
                        secondary={batch.batchNumber}
                        metric={formatCompactCurrency(batch.totalAmount ?? 0)}
                        onClick={(e) => {
                          if (e) openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, WT.success);
                        }}
                        index={i}
                        isVisible={isVisible}
                        reducedMotion={reducedMotion}
                      />
                    );
                  })}
                </div>
              )}

              {/* Rejected section — LG only */}
              {showActions(size) && rejectedBatches.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border-subtle">
                  <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider mb-1 block">
                    Rejected
                  </span>
                  {rejectedBatches.map((batch, i) => {
                    const submitterName = userNameMap.get(batch.submittedBy ?? "") ?? "";
                    return (
                      <WidgetLineItem
                        key={batch.id}
                        indicator={{ type: "bar", color: WT.error, label: "REJECTED" }}
                        primary={submitterName || batch.batchNumber}
                        secondary={batch.reviewNotes ?? batch.batchNumber}
                        metric={formatCompactCurrency(batch.totalAmount ?? 0)}
                        onClick={(e) => {
                          if (e) openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, WT.error);
                        }}
                        index={i}
                        isVisible={isVisible}
                        reducedMotion={reducedMotion}
                      />
                    );
                  })}
                </div>
              )}
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
