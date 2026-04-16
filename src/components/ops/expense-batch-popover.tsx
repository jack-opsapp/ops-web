"use client";

import { useCallback, useRef, useState, memo, useMemo, type MouseEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Minus, X, Flag, Check, Send, ArrowUpRight, Camera } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  useExpenseBatchPopoverStore,
  type ExpenseBatchPopoverTab,
  type ExpenseBatchPopoverState,
} from "@/stores/expense-batch-popover-store";
import {
  useExpenseBatches,
  useBatchExpenses,
  useApproveBatch,
  useRejectWithRevisions,
  useFlagExpense,
  useUnflagExpense,
} from "@/lib/hooks/use-expense-approval";
import { useExpenseSettings } from "@/lib/hooks/use-expense-settings";
import { useTeamMembers } from "@/lib/hooks";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  isBatchReviewable,
  BATCH_STATUS_DISPLAY,
  BATCH_STATUS_COLOR,
  type ExpenseBatch,
  type ExpenseLineItem,
  ExpenseBatchStatus,
} from "@/lib/types/expense-approval";
import { formatCompactCurrency } from "@/components/dashboard/widgets/shared/widget-utils";
import {
  computeBatchUrgency,
  computeBatchCompliance,
  receiptComplianceColor,
  formatPeriodRange,
  type BatchUrgency,
  type BatchCompliance,
} from "@/lib/utils/expense-urgency";
import { ReceiptLightbox } from "@/components/expenses/receipt-lightbox";
import { useDictionary } from "@/i18n/client";
import { WT } from "@/lib/widget-tokens";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Tab definitions ──
const TABS: { id: ExpenseBatchPopoverTab; label: string; labelKey: string }[] = [
  { id: "expenses", label: "Expenses", labelKey: "batchPopover.expenses" },
  { id: "summary", label: "Summary", labelKey: "batchPopover.summary" },
];

// ── Helpers ──
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ── Expense Row ──

interface ExpenseRowProps {
  expense: ExpenseLineItem;
  canApprove: boolean;
  isReviewable: boolean;
  requireReceipt: boolean;
  flaggingId: string | null;
  flagComment: string;
  onFlagToggle: (expenseId: string) => void;
  onFlagCommentChange: (comment: string) => void;
  onFlagSubmit: (expenseId: string, comment: string) => void;
  onUnflag: (expenseId: string) => void;
  onReceiptClick: (url: string) => void;
  t: (key: string) => string | undefined;
}

function ExpenseRow({
  expense,
  canApprove,
  isReviewable,
  requireReceipt,
  flaggingId,
  flagComment,
  onFlagToggle,
  onFlagCommentChange,
  onFlagSubmit,
  onUnflag,
  onReceiptClick,
  t,
}: ExpenseRowProps) {
  const isFlagged = !!expense.flaggedBy;
  const isFlaggingThis = flaggingId === expense.id;
  const hasReceipt = !!expense.receiptImageUrl;

  return (
    <div className="py-1.5 border-b border-[rgba(255,255,255,0.04)] last:border-b-0">
      <div className="flex items-start gap-2">
        {/* Receipt thumbnail */}
        {(hasReceipt || requireReceipt) && (
          <div
            className={cn(
              "shrink-0 w-[40px] h-[50px] rounded-[2px] overflow-hidden",
              hasReceipt && "cursor-pointer",
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (expense.receiptImageUrl) onReceiptClick(expense.receiptImageUrl);
            }}
          >
            {hasReceipt ? (
              <img
                src={expense.receiptImageUrl!}
                alt="Receipt"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center border border-dashed rounded-[2px]"
                style={{ borderColor: WT.warning }}
              >
                <Camera className="w-4 h-4" style={{ color: WT.warning }} />
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <span className="font-mohave text-body-sm text-text truncate block">
            {expense.merchantName ?? expense.description ?? t("batchPopover.untitled") ?? "Untitled"}
          </span>
          <span className="font-kosugi text-[10px] text-text-mute truncate block">
            {expense.categoryName ?? ""}
            {expense.categoryName && expense.expenseDate ? " · " : ""}
            {expense.expenseDate ? formatDate(expense.expenseDate) : ""}
          </span>
        </div>

        {/* Amount */}
        <span className="font-mono text-[12px] text-text shrink-0">
          {formatCompactCurrency(expense.amount)}
        </span>

        {/* Flag toggle — reviewer mode only */}
        {canApprove && isReviewable && (
          <button
            onClick={() => {
              if (isFlagged) {
                onUnflag(expense.id);
              } else {
                onFlagToggle(expense.id);
              }
            }}
            className={cn(
              "w-5 h-5 flex items-center justify-center rounded-[2px] shrink-0 transition-colors",
              isFlagged
                ? "text-status-warning hover:text-text-2"
                : "text-text-mute hover:text-status-warning"
            )}
            title={isFlagged ? (t("batchPopover.unflag") ?? "Remove flag") : (t("batchPopover.flagExpense") ?? "Flag for revision")}
          >
            <Flag className="w-[14px] h-[14px]" />
          </button>
        )}
      </div>

      {/* Flag comment input */}
      {canApprove && isReviewable && isFlaggingThis && !isFlagged && (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            type="text"
            value={flagComment}
            onChange={(e) => onFlagCommentChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && flagComment.trim()) {
                onFlagSubmit(expense.id, flagComment.trim());
              }
              if (e.key === "Escape") {
                onFlagToggle("");
              }
            }}
            placeholder={t("batchPopover.flagComment") ?? "What needs fixing?"}
            className="flex-1 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-[2px] px-2 py-1 font-mohave text-[11px] text-text placeholder:text-text-mute outline-none focus:border-ops-accent transition-colors"
            autoFocus
          />
          <button
            onClick={() => {
              if (flagComment.trim()) onFlagSubmit(expense.id, flagComment.trim());
            }}
            disabled={!flagComment.trim()}
            className="w-5 h-5 flex items-center justify-center rounded-[2px] text-text-mute hover:text-ops-accent disabled:opacity-30 transition-colors"
          >
            <Check className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Flag comment display */}
      {isFlagged && expense.flagComment && (
        <div className="mt-1 flex items-center gap-1">
          <Flag className="w-3 h-3 shrink-0" style={{ color: WT.warning }} />
          <span className="font-mohave text-[11px] truncate" style={{ color: WT.warning }}>
            {expense.flagComment}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Summary Tab ──

function SummaryTab({
  expenses,
  requireReceipt,
  t,
}: {
  expenses: ExpenseLineItem[];
  requireReceipt: boolean;
  t: (key: string) => string | undefined;
}) {
  const categoryData = useMemo(() => {
    const catMap = new Map<string, number>();
    let total = 0;
    let withReceipt = 0;

    for (const e of expenses) {
      const cat = e.categoryName ?? "Other";
      catMap.set(cat, (catMap.get(cat) ?? 0) + e.amount);
      total += e.amount;
      if (e.receiptImageUrl) withReceipt++;
    }

    const entries = Array.from(catMap.entries())
      .map(([name, amount]) => ({ name, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);

    return { categories: entries, total, receiptCount: withReceipt, expenseCount: expenses.length };
  }, [expenses]);

  const maxAmount = categoryData.categories[0]?.amount ?? 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Category breakdown */}
      <div>
        <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
          {t("batchPopover.summary") ?? "Summary"}
        </span>
        <div className="flex flex-col gap-2 mt-2">
          {categoryData.categories.map((cat) => (
            <div key={cat.name} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="font-mohave text-body-sm text-text-2">{cat.name}</span>
                <span className="font-mono text-[12px] text-text">
                  {formatCompactCurrency(cat.amount)}
                </span>
              </div>
              <div className="w-full h-[4px] rounded-sm" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(cat.amount / maxAmount) * 100}%`,
                    backgroundColor: WT.accent,
                    transition: "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Receipt coverage */}
      {requireReceipt && (() => {
        const missing = categoryData.expenseCount - categoryData.receiptCount;
        const rcColor = receiptComplianceColor(missing, categoryData.expenseCount);
        const colorToken = rcColor === "error" ? WT.error : rcColor === "warning" ? WT.warning : WT.success;
        return (
          <div>
            <span className="font-kosugi text-micro text-text-mute uppercase tracking-widest">
              {t("batchPopover.receiptCoverage") ?? "Receipt coverage"}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-[4px] rounded-sm" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: categoryData.expenseCount > 0
                      ? `${(categoryData.receiptCount / categoryData.expenseCount) * 100}%`
                      : "0%",
                    backgroundColor: colorToken,
                    transition: "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
              <span className="font-mono text-[11px] shrink-0" style={{ color: colorToken }}>
                {categoryData.receiptCount}/{categoryData.expenseCount}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Instance component ──

interface ExpenseBatchPopoverInstanceProps {
  state: ExpenseBatchPopoverState;
}

const ExpenseBatchPopoverInstance = memo(function ExpenseBatchPopoverInstance({
  state,
}: ExpenseBatchPopoverInstanceProps) {
  const reduced = useReducedMotion();
  const { t } = useDictionary("dashboard");

  const {
    closePopover,
    focusPopover,
    minimizePopover,
    updatePosition,
    updateSize,
    setActiveTab,
  } = useExpenseBatchPopoverStore();

  // Data
  const { data: batchesData } = useExpenseBatches();
  const batch = batchesData?.find((b) => b.id === state.id);
  const { data: batchExpenses } = useBatchExpenses(state.id);
  const { data: teamData } = useTeamMembers();
  const { data: settings } = useExpenseSettings();
  const canApprove = usePermissionStore((s) => s.can("expenses.approve"));
  const { currentUser } = useAuthStore();

  // Mutations
  const approveBatch = useApproveBatch();
  const rejectWithRevisions = useRejectWithRevisions();
  const flagExpense = useFlagExpense();
  const unflagExpense = useUnflagExpense();

  // Local state
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flagComment, setFlagComment] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Settings
  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const requireReceipt = settings?.requireReceiptPhoto ?? false;

  // Derived
  const statusColor = batch
    ? BATCH_STATUS_COLOR[batch.status]
    : state.color;

  const isReviewable = batch ? isBatchReviewable(batch) : false;
  const expenses = batchExpenses ?? [];
  const flaggedExpenses = expenses.filter((e) => !!e.flaggedBy);
  const flaggedCount = flaggedExpenses.length;

  // Urgency
  const urgency: BatchUrgency = batch
    ? computeBatchUrgency(batch, reviewFrequency)
    : "fresh";

  // Compliance
  const compliance: BatchCompliance | null = useMemo(() => {
    if (expenses.length === 0) return null;
    return computeBatchCompliance(expenses);
  }, [expenses]);

  // Resolve submitter name
  const submitterName = useMemo(() => {
    if (!batch?.submittedBy || !teamData?.users) return "";
    const user = teamData.users.find((u) => u.id === batch.submittedBy);
    if (!user) return "";
    return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "";
  }, [batch?.submittedBy, teamData]);

  // ── Drag handling ──
  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focusPopover(state.id);
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - state.position.x,
        y: e.clientY - state.position.y,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newX = Math.max(0, Math.min(moveEvent.clientX - dragOffset.current.x, globalThis.innerWidth - state.size.width));
        const newY = Math.max(0, Math.min(moveEvent.clientY - dragOffset.current.y, globalThis.innerHeight - state.size.height));
        updatePosition(state.id, { x: newX, y: newY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [state.id, state.position, state.size.width, state.size.height, focusPopover, updatePosition]
  );

  // ── Resize handling ──
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusPopover(state.id);
      setIsResizing(true);
      resizeStart.current = { x: e.clientX, y: e.clientY, w: state.size.width, h: state.size.height };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const dw = moveEvent.clientX - resizeStart.current.x;
        const dh = moveEvent.clientY - resizeStart.current.y;
        updateSize(state.id, { width: resizeStart.current.w + dw, height: resizeStart.current.h + dh });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [state.id, state.size, focusPopover, updateSize]
  );

  // ── Actions ──
  const handleApprove = async () => {
    if (!batch || !batchExpenses) return;
    const expenseIds = batchExpenses.map((e) => e.id);
    await approveBatch.mutateAsync({
      batchId: state.id,
      reviewedBy: currentUser?.id ?? "",
      approvedAmount: batch.totalAmount ?? 0,
      expenseIds,
      submittedBy: batch.submittedBy,
      companyId: batch.companyId,
      batchNumber: batch.batchNumber,
    });
    toast.success(t("expenseReview.approved") ?? "Batch approved");
    closePopover(state.id);
  };

  const handleSendRevisions = async () => {
    if (!batch || !batchExpenses) return;
    const flagged = batchExpenses.filter((e) => !!e.flaggedBy);
    const clean = batchExpenses.filter((e) => !e.flaggedBy);
    const flagComments: Record<string, string> = {};
    for (const e of flagged) {
      if (e.flagComment) flagComments[e.id] = e.flagComment;
    }
    const cleanTotal = clean.reduce((s, e) => s + e.amount, 0);
    const flaggedTotal = flagged.reduce((s, e) => s + e.amount, 0);

    await rejectWithRevisions.mutateAsync({
      batchId: state.id,
      batch,
      reviewedBy: currentUser?.id ?? "",
      reviewNotes: null,
      flaggedExpenseIds: flagged.map((e) => e.id),
      cleanExpenseIds: clean.map((e) => e.id),
      flagComments,
      cleanTotal,
      flaggedTotal,
    });
    toast.success(t("batchPopover.sendRevisions") ?? "Revisions sent");
    closePopover(state.id);
  };

  const handleFlag = (expenseId: string, comment: string) => {
    flagExpense.mutate({ expenseId, flaggedBy: currentUser?.id ?? "", comment });
    setFlaggingId(null);
    setFlagComment("");
  };

  const handleUnflag = (expenseId: string) => {
    unflagExpense.mutate(expenseId);
  };

  if (state.isMinimized) return null;

  return (
    <motion.div
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
      style={{
        left: state.position.x,
        top: state.position.y,
        width: state.size.width,
        height: state.size.height,
        zIndex: state.zIndex,
      }}
      onMouseDown={() => focusPopover(state.id)}
    >
      {/* ── Title bar ── */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)] cursor-grab shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="w-1.5 h-1.5 rounded-[1px] shrink-0"
            style={{ backgroundColor: statusColor }}
          />
          <span className="font-mohave text-[13px] font-semibold text-text truncate">
            {state.title}
          </span>
          {/* Urgency badge */}
          {urgency !== "fresh" && (
            <span
              className={cn(
                "font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap",
                urgency === "overdue"
                  ? "text-ops-error bg-ops-error/15 border-ops-error/30"
                  : "text-ops-amber bg-ops-amber/15 border-ops-amber/30"
              )}
              style={{ fontSize: "9px", lineHeight: "1.3" }}
            >
              {urgency === "overdue"
                ? (t("batchPopover.overdue") ?? "OVERDUE")
                : (t("batchPopover.due") ?? "DUE")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-[2px] shrink-0 ml-2">
          <button
            onClick={() => minimizePopover(state.id)}
            className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            onClick={() => closePopover(state.id)}
            className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-3 hover:text-ops-error hover:bg-ops-error-muted transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Info strip ── */}
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0 space-y-1">
        {/* Row 1: Submitter name */}
        <div className="flex items-center gap-2 min-w-0">
          {submitterName ? (
            <span className="font-kosugi text-[10px] text-text-3 truncate">
              {submitterName}
            </span>
          ) : (
            <span className="font-kosugi text-[10px] text-text-mute">—</span>
          )}
        </div>

        {/* Row 2: Status + period range + items + total */}
        <div className="flex items-center gap-1.5">
          <span className="font-kosugi text-[9px] uppercase tracking-wide" style={{ color: statusColor }}>
            {batch ? BATCH_STATUS_DISPLAY[batch.status] : ""}
          </span>
          {batch && (
            <>
              <span className="font-kosugi text-[9px] text-text-mute">
                · {formatPeriodRange(batch.periodStart, batch.periodEnd)}
              </span>
              <span className="font-kosugi text-[9px] text-text-mute">
                · {expenses.length} {expenses.length === 1 ? "item" : "items"} · {formatCompactCurrency(batch.totalAmount ?? 0)}
              </span>
            </>
          )}
        </div>

        {/* Row 3: Receipt compliance bar — only when requireReceiptPhoto */}
        {requireReceipt && compliance && (() => {
          const rcColor = receiptComplianceColor(compliance.receiptsMissing, compliance.receiptsTotal);
          const colorToken = rcColor === "error" ? WT.error : rcColor === "warning" ? WT.warning : WT.success;
          return (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-[4px] rounded-sm" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: compliance.receiptsTotal > 0
                      ? `${((compliance.receiptsTotal - compliance.receiptsMissing) / compliance.receiptsTotal) * 100}%`
                      : "0%",
                    backgroundColor: colorToken,
                    transition: "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
              <span className="font-kosugi text-[10px] shrink-0" style={{ color: colorToken }}>
                {compliance.receiptsTotal - compliance.receiptsMissing}/{compliance.receiptsTotal} {t("batchPopover.haveReceipts") ?? "have receipts"}
              </span>
            </div>
          );
        })()}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex items-center border-b border-[rgba(255,255,255,0.06)] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(state.id, tab.id)}
            className={cn(
              "px-3 py-2 font-mohave text-[11px] uppercase tracking-[0.5px] transition-colors relative",
              tab.id === state.activeTab
                ? "text-text"
                : "text-text-mute hover:text-text-2"
            )}
          >
            {t(tab.labelKey) ?? tab.label}
            {tab.id === state.activeTab && (
              <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-ops-accent" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-3">
        {state.activeTab === "expenses" && (
          expenses.length > 0 ? (
            <div className="flex flex-col">
              {expenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  canApprove={canApprove}
                  isReviewable={isReviewable}
                  requireReceipt={requireReceipt}
                  flaggingId={flaggingId}
                  flagComment={flagComment}
                  onFlagToggle={(id) => {
                    setFlaggingId(id === flaggingId ? null : id);
                    setFlagComment("");
                  }}
                  onFlagCommentChange={setFlagComment}
                  onFlagSubmit={handleFlag}
                  onUnflag={handleUnflag}
                  onReceiptClick={setLightboxUrl}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-kosugi text-micro text-text-mute uppercase">
                {t("batchPopover.noExpenses") ?? "No expenses in batch"}
              </span>
            </div>
          )
        )}
        {state.activeTab === "summary" && (
          <SummaryTab expenses={expenses} requireReceipt={requireReceipt} t={t} />
        )}
      </div>

      {/* ── Footer actions — reviewer mode only ── */}
      {canApprove && isReviewable && (
        <div className="px-3 py-2 border-t border-[rgba(255,255,255,0.06)] shrink-0 flex items-center gap-2">
          <button
            onClick={handleApprove}
            disabled={approveBatch.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[2px] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.08)] font-mohave text-[11px] uppercase tracking-[0.5px] text-text transition-colors disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            {t("batchPopover.approveAll") ?? "Approve All"}
          </button>
          <button
            onClick={handleSendRevisions}
            disabled={flaggedCount === 0 || rejectWithRevisions.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[2px] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.08)] font-mohave text-[11px] uppercase tracking-[0.5px] text-text transition-colors disabled:opacity-30"
          >
            <Send className="w-3 h-3" />
            {t("batchPopover.sendRevisions") ?? "Send Revisions"}
            {flaggedCount > 0 && (
              <span className="font-mono text-[10px]" style={{ color: WT.warning }}>({flaggedCount})</span>
            )}
          </button>
        </div>
      )}

      {/* ── Submitter mode footer ── */}
      {!canApprove && (
        <div className="px-3 py-2 border-t border-[rgba(255,255,255,0.06)] shrink-0">
          <button
            onClick={() => closePopover(state.id)}
            className="flex items-center gap-1 font-kosugi text-micro text-text-3 uppercase tracking-wider hover:text-text-2 transition-colors"
          >
            {t("batchPopover.viewInAccounting") ?? "View in Accounting"}
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Resize handle ── */}
      <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" onMouseDown={handleResizeStart}>
        <svg width="14" height="14" viewBox="0 0 14 14" className="opacity-15 hover:opacity-30 transition-opacity absolute bottom-[2px] right-[2px]">
          <line x1="12" y1="4" x2="4" y2="12" stroke="white" strokeWidth="1" />
          <line x1="12" y1="8" x2="8" y2="12" stroke="white" strokeWidth="1" />
        </svg>
      </div>

      {/* ── Receipt lightbox ── */}
      <AnimatePresence>
        {lightboxUrl && (
          <ReceiptLightbox imageUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ── Root renderer ──

export function ExpenseBatchPopover() {
  const popovers = useExpenseBatchPopoverStore((s) => s.popovers);

  return (
    <AnimatePresence>
      {Array.from(popovers.values()).map((state) => (
        <ExpenseBatchPopoverInstance key={state.id} state={state} />
      ))}
    </AnimatePresence>
  );
}
