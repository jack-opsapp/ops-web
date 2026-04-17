"use client";

import { useCallback, useRef, useState, useMemo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Minus, X, Check, Send } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useExpenseReviewListPopoverStore,
  type ExpenseReviewListTab,
} from "@/stores/expense-review-list-popover-store";
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
import {
  isBatchNeedsReview,
  isBatchApproved,
  ExpenseBatchStatus,
  BATCH_STATUS_DISPLAY,
  type ExpenseBatch,
} from "@/lib/types/expense-approval";
import {
  computeBatchUrgency,
  computeAllBatchCompliance,
  receiptComplianceColor,
  formatPeriodRange,
  type BatchUrgency,
  type BatchCompliance,
} from "@/lib/utils/expense-urgency";
import { formatCompactCurrency } from "@/components/dashboard/widgets/shared/widget-utils";
import { showWidgetActionToast } from "@/components/dashboard/widgets/shared/widget-action-toast";
import { WT } from "@/lib/widget-tokens";
import { useDictionary } from "@/i18n/client";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Tab definitions ──
const TABS: { id: ExpenseReviewListTab; label: string }[] = [
  { id: "needs-review", label: "NEEDS REVIEW" },
  { id: "history", label: "HISTORY" },
];

function urgencyDotColor(urgency: BatchUrgency): string | null {
  if (urgency === "due") return WT.warning;
  if (urgency === "overdue") return WT.error;
  return null;
}

// ── Period pill helpers ──
function getPeriodKey(batch: ExpenseBatch): string {
  if (!batch.periodStart) return "unknown";
  return batch.periodStart.slice(0, 7);
}

function getPeriodLabel(key: string): string {
  const parts = key.split("-");
  if (parts.length < 2) return key.toUpperCase();
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = MONTHS[parseInt(parts[1], 10) - 1];
  return month ? `${month} ${parts[0]}` : key.toUpperCase();
}

// ── Batch Row ──
function BatchRow({
  batch,
  submitterName,
  urgency,
  compliance,
  requireReceipt,
  showActions,
  onApprove,
  onReject,
  rejectingBatchId,
  rejectNote,
  setRejectingBatchId,
  setRejectNote,
  onQuickReject,
  onRowClick,
  index,
  isVisible,
  reducedMotion,
  t,
}: {
  batch: ExpenseBatch;
  submitterName: string;
  urgency: BatchUrgency;
  compliance: BatchCompliance | undefined;
  requireReceipt: boolean;
  showActions: boolean;
  onApprove: (batch: ExpenseBatch) => void;
  onReject: () => void;
  rejectingBatchId: string | null;
  rejectNote: string;
  setRejectingBatchId: (id: string | null) => void;
  setRejectNote: (note: string) => void;
  onQuickReject: (batchId: string) => void;
  onRowClick: (batch: ExpenseBatch, e: React.MouseEvent) => void;
  index: number;
  isVisible: boolean;
  reducedMotion: boolean | null;
  t: (key: string) => string | undefined;
}) {
  const dotColor = urgencyDotColor(urgency);
  const missingReceipts = compliance?.receiptsMissing ?? 0;
  const totalExpenses = compliance?.receiptsTotal ?? 0;
  const isNeedsReview = isBatchNeedsReview(batch.status);

  // Status display for history rows
  const statusColor = (() => {
    if (isBatchApproved(batch.status)) return WT.success;
    if (batch.status === ExpenseBatchStatus.Rejected) return WT.error;
    return WT.accent;
  })();

  // Secondary text
  const periodRange = formatPeriodRange(batch.periodStart, batch.periodEnd);
  const hasComplianceIssue = requireReceipt && missingReceipts > 0;
  const complianceColorKey = hasComplianceIssue ? receiptComplianceColor(missingReceipts, totalExpenses) : null;
  const complianceColor = complianceColorKey === "error" ? WT.error : complianceColorKey === "warning" ? WT.warning : null;

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-sm transition-colors cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
        onClick={(e) => onRowClick(batch, e)}
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(4px)",
          transition: reducedMotion
            ? "opacity 200ms ease"
            : `opacity 300ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 30}ms, transform 300ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 30}ms`,
        }}
      >
        {/* Indicator */}
        {isNeedsReview ? (
          dotColor ? (
            <div className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
          ) : (
            <div className="w-[20px] h-[20px] rounded-full shrink-0 bg-fill-neutral-dim flex items-center justify-center">
              <span className="font-kosugi text-micro text-text-3 uppercase">
                {submitterName.slice(0, 2)}
              </span>
            </div>
          )
        ) : (
          <div className="w-[3px] rounded-full shrink-0 self-stretch" style={{ backgroundColor: statusColor, minHeight: "16px" }} />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="font-mohave text-caption-sm text-text truncate">
            {submitterName || batch.batchNumber}
          </p>
          <span className="font-kosugi text-micro text-text-mute truncate block">
            {batch.batchNumber} · {periodRange}
            {hasComplianceIssue && (
              <> · <span style={{ color: complianceColor ?? undefined }}>{missingReceipts}/{totalExpenses} {t("expenseReview.missingReceipts") ?? "missing receipts"}</span></>
            )}
          </span>
        </div>

        {/* Amount */}
        <span className="font-mono text-micro text-text-2 shrink-0">
          {formatCompactCurrency(batch.totalAmount ?? 0)}
        </span>

        {/* Status badge (history) */}
        {!isNeedsReview && (
          <span
            className={cn(
              "font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap",
              isBatchApproved(batch.status) && "text-status-success bg-status-success/15 border-status-success/30",
              batch.status === ExpenseBatchStatus.Rejected && "text-ops-error bg-ops-error/15 border-ops-error/30",
            )}
            style={{ fontSize: "9px", lineHeight: "1.3" }}
          >
            {BATCH_STATUS_DISPLAY[batch.status]}
          </span>
        )}

        {/* Actions (needs review only) */}
        {isNeedsReview && showActions && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onApprove(batch); }}
              className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors text-text-mute hover:text-text-2"
              title={t("expenseReview.approve") ?? "Approve"}
            >
              <Check className="w-[14px] h-[14px]" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors text-text-mute hover:text-text-2"
              title="Reject"
            >
              <X className="w-[14px] h-[14px]" />
            </button>
          </div>
        )}
      </div>

      {/* Inline reject input */}
      {rejectingBatchId === batch.id && (
        <div className="flex items-center gap-1 px-3 py-1 ml-6">
          <input
            type="text"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rejectNote.trim()) onQuickReject(batch.id);
              if (e.key === "Escape") { setRejectingBatchId(null); setRejectNote(""); }
            }}
            placeholder={t("expenseReview.rejectNote") ?? "What needs fixing?"}
            className="flex-1 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-[2px] px-2 py-1 font-mohave text-[11px] text-text placeholder:text-text-mute outline-none focus:border-[rgba(255,255,255,0.20)] transition-colors"
            autoFocus
          />
          <button
            onClick={() => onQuickReject(batch.id)}
            disabled={!rejectNote.trim()}
            className="w-5 h-5 flex items-center justify-center rounded-[2px] text-text-mute hover:text-ops-accent disabled:opacity-30 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main popover ──
export function ExpenseReviewListPopover() {
  const reduced = useReducedMotion();
  const { t } = useDictionary("dashboard");

  const {
    isOpen,
    position,
    size,
    zIndex,
    isMinimized,
    activeTab,
    close,
    focus,
    minimize,
    updatePosition,
    updateSize,
    setActiveTab,
  } = useExpenseReviewListPopoverStore();

  // Data
  const { data: batchesData } = useExpenseBatches();
  const { data: teamData } = useTeamMembers();
  const { data: allExpensesData } = useAllExpenses();
  const { data: settings } = useExpenseSettings();
  const approveBatch = useApproveBatch();
  const quickReject = useQuickRejectBatch();
  const { currentUser, company } = useAuthStore();
  const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);

  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const requireReceipt = settings?.requireReceiptPhoto ?? false;

  // Local state
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("all");
  const [rejectingBatchId, setRejectingBatchId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [isVisible, setIsVisible] = useState(true);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // User name map
  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teamData?.users) {
      for (const u of teamData.users) {
        map.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id);
      }
    }
    return map;
  }, [teamData]);

  // Compliance map
  const complianceMap = useMemo(() => {
    if (!allExpensesData) return new Map<string, BatchCompliance>();
    return computeAllBatchCompliance(allExpensesData);
  }, [allExpensesData]);

  // Available period pills
  const availablePeriods = useMemo(() => {
    if (!batchesData) return [];
    const keys = new Set<string>();
    for (const b of batchesData) {
      const k = getPeriodKey(b);
      if (k !== "unknown") keys.add(k);
    }
    return Array.from(keys).sort().reverse();
  }, [batchesData]);

  // Filter batches by period
  const filteredBatches = useMemo(() => {
    if (!batchesData) return [];
    if (selectedPeriod === "all") return batchesData;
    return batchesData.filter((b) => getPeriodKey(b) === selectedPeriod);
  }, [batchesData, selectedPeriod]);

  // Needs review batches
  const needsReviewBatches = useMemo(() => {
    return filteredBatches
      .filter((b) => isBatchNeedsReview(b.status))
      .map((b) => ({ ...b, urgency: computeBatchUrgency(b, reviewFrequency) }))
      .sort((a, b) => {
        const urgencyOrder: Record<BatchUrgency, number> = { overdue: 0, due: 1, fresh: 2 };
        const diff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [filteredBatches, reviewFrequency]);

  // History batches
  const historyBatches = useMemo(() => {
    return filteredBatches
      .filter((b) => !isBatchNeedsReview(b.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [filteredBatches]);

  // Hero summary
  const totalPending = useMemo(
    () => needsReviewBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0),
    [needsReviewBatches],
  );
  const totalApproved = useMemo(
    () => filteredBatches
      .filter((b) => isBatchApproved(b.status))
      .reduce((s, b) => s + (b.approvedAmount ?? b.totalAmount ?? 0), 0),
    [filteredBatches],
  );

  const displayBatches = activeTab === "needs-review" ? needsReviewBatches : historyBatches;

  // ── Actions ──
  const handleApprove = async (batch: ExpenseBatch) => {
    if (!allExpensesData) return;
    const expenseIds = allExpensesData.filter((e) => e.batchId === batch.id).map((e) => e.id);
    await approveBatch.mutateAsync({
      batchId: batch.id,
      reviewedBy: currentUser?.id ?? "",
      approvedAmount: batch.totalAmount ?? 0,
      expenseIds,
      submittedBy: batch.submittedBy,
      companyId: batch.companyId ?? company?.id,
      batchNumber: batch.batchNumber,
    });
    showWidgetActionToast({ label: t("expenseReview.approved") ?? "Batch approved", onUndo: () => {} });
  };

  const handleQuickReject = async (batchId: string) => {
    if (!rejectNote.trim()) return;
    await quickReject.mutateAsync({ batchId, reviewedBy: currentUser?.id ?? "", reviewNotes: rejectNote.trim() });
    showWidgetActionToast({ label: t("expenseReview.returnedForRevision") ?? "Returned for revision", onUndo: () => {} });
    setRejectingBatchId(null);
    setRejectNote("");
  };

  const handleRowClick = (batch: ExpenseBatch, e: React.MouseEvent) => {
    const urgency = computeBatchUrgency(batch, reviewFrequency);
    const dotColor = urgencyDotColor(urgency);
    openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, dotColor ?? WT.accent);
  };

  // ── Drag ──
  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focus();
      setIsDragging(true);
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newX = Math.max(0, Math.min(moveEvent.clientX - dragOffset.current.x, globalThis.innerWidth - size.width));
        const newY = Math.max(0, Math.min(moveEvent.clientY - dragOffset.current.y, globalThis.innerHeight - size.height));
        updatePosition({ x: newX, y: newY });
      };
      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [position, size, focus, updatePosition]
  );

  // ── Resize ──
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focus();
      setIsResizing(true);
      resizeStart.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        updateSize({
          width: resizeStart.current.w + (moveEvent.clientX - resizeStart.current.x),
          height: resizeStart.current.h + (moveEvent.clientY - resizeStart.current.y),
        });
      };
      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [size, focus, updateSize]
  );

  if (!isOpen || isMinimized) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="expense-review-list"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.2, ease: EASE_SMOOTH }}
        className={cn(
          "fixed flex flex-col overflow-hidden",
          "bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2]",
          "border border-[rgba(255,255,255,0.08)] rounded-[4px]",
          (isDragging || isResizing) && "select-none"
        )}
        style={{ left: position.x, top: position.y, width: size.width, height: size.height, zIndex }}
        onMouseDown={() => focus()}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)] cursor-grab shrink-0"
          onMouseDown={handleDragStart}
        >
          <span className="font-mohave text-[13px] font-semibold text-text">
            {t("expenseReview.title") ?? "Expense Review"}
          </span>
          <div className="flex items-center gap-[2px] shrink-0 ml-2">
            <button
              onClick={() => minimize()}
              className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={() => close()}
              className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-ops-error hover:bg-ops-error-muted transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Hero summary */}
        <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)] shrink-0">
          <div className="flex items-baseline gap-3">
            <div>
              <span className="font-mono text-[20px] font-bold text-text leading-none">
                {formatCompactCurrency(totalPending)}
              </span>
              <span className="font-kosugi text-micro text-text-mute uppercase tracking-wider ml-1">
                pending
              </span>
            </div>
            <div>
              <span className="font-mono text-[14px] font-bold leading-none" style={{ color: WT.success }}>
                {formatCompactCurrency(totalApproved)}
              </span>
              <span className="font-kosugi text-micro text-text-mute uppercase tracking-wider ml-1">
                approved
              </span>
            </div>
          </div>
        </div>

        {/* Period filter pills */}
        {availablePeriods.length > 1 && (
          <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0 flex items-center gap-1 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setSelectedPeriod("all")}
              className={cn(
                "px-2 py-0.5 rounded-sm font-kosugi text-micro uppercase tracking-wider transition-colors shrink-0",
                selectedPeriod === "all"
                  ? "bg-ops-accent/15 text-ops-accent border border-ops-accent/30"
                  : "text-text-mute hover:text-text-2 border border-transparent"
              )}
            >
              ALL
            </button>
            {availablePeriods.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedPeriod(key)}
                className={cn(
                  "px-2 py-0.5 rounded-sm font-kosugi text-micro uppercase tracking-wider transition-colors shrink-0",
                  selectedPeriod === key
                    ? "bg-ops-accent/15 text-ops-accent border border-ops-accent/30"
                    : "text-text-mute hover:text-text-2 border border-transparent"
                )}
              >
                {getPeriodLabel(key)}
              </button>
            ))}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center border-b border-[rgba(255,255,255,0.06)] shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-2 font-mohave text-[11px] uppercase tracking-[0.5px] transition-colors relative",
                tab.id === activeTab
                  ? "text-text"
                  : "text-text-mute hover:text-text-2"
              )}
            >
              {tab.label}
              {tab.id === activeTab && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-ops-accent" />
              )}
            </button>
          ))}
          <span className="ml-auto pr-3 font-mono text-micro text-text-mute">
            {displayBatches.length} {displayBatches.length === 1 ? "batch" : "batches"}
          </span>
        </div>

        {/* Batch list */}
        <div className="flex-1 overflow-y-auto scrollbar-hide py-1">
          {displayBatches.length > 0 ? (
            displayBatches.map((batch, i) => {
              const submitterName = userNameMap.get(batch.submittedBy ?? "") ?? "";
              const urgency = "urgency" in batch ? (batch as { urgency: BatchUrgency }).urgency : computeBatchUrgency(batch, reviewFrequency);

              return (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  submitterName={submitterName}
                  urgency={urgency}
                  compliance={complianceMap.get(batch.id)}
                  requireReceipt={requireReceipt}
                  showActions={activeTab === "needs-review"}
                  onApprove={handleApprove}
                  onReject={() => {
                    setRejectingBatchId(rejectingBatchId === batch.id ? null : batch.id);
                    setRejectNote("");
                  }}
                  rejectingBatchId={rejectingBatchId}
                  rejectNote={rejectNote}
                  setRejectingBatchId={setRejectingBatchId}
                  setRejectNote={setRejectNote}
                  onQuickReject={handleQuickReject}
                  onRowClick={handleRowClick}
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reduced}
                  t={t}
                />
              );
            })
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-kosugi text-micro text-text-mute uppercase">
                {activeTab === "needs-review"
                  ? (t("expenseReview.allCaughtUp") ?? "All caught up")
                  : "No history"}
              </span>
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" onMouseDown={handleResizeStart}>
          <svg width="14" height="14" viewBox="0 0 14 14" className="opacity-15 hover:opacity-30 transition-opacity absolute bottom-[2px] right-[2px]">
            <line x1="12" y1="4" x2="4" y2="12" stroke="white" strokeWidth="1" />
            <line x1="12" y1="8" x2="8" y2="12" stroke="white" strokeWidth="1" />
          </svg>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
