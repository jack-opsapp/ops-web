"use client";

import { useState, useMemo, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Loader2, Flag } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import {
  useBatchExpenses,
  useFlagExpense,
  useUnflagExpense,
  useApproveBatch,
  useRejectWithRevisions,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";
import type { ExpenseBatch } from "@/lib/types/expense-approval";
import {
  getBatchDisplayName,
  formatPeriodDisplay,
  periodKeyFromBatch,
  isBatchReviewable,
  BATCH_STATUS_DISPLAY,
  BATCH_STATUS_COLOR,
} from "@/lib/types/expense-approval";
import { ExpenseLineItemTable } from "./expense-line-item-table";
import { ReceiptLightbox } from "./receipt-lightbox";
import { RejectConfirmationModal } from "./reject-confirmation-modal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceDetailPanelProps {
  batch: ExpenseBatch;
  canReview: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoiceDetailPanel({
  batch,
  canReview,
}: InvoiceDetailPanelProps) {
  const { currentUser } = useAuthStore();
  const userId = currentUser?.id ?? "";
  const { t } = useDictionary("books");

  // Data
  const { data: expenses = [], isLoading } = useBatchExpenses(batch.id);

  // Mutations
  const flagMutation = useFlagExpense();
  const unflagMutation = useUnflagExpense();
  const approveMutation = useApproveBatch();
  const rejectMutation = useRejectWithRevisions();

  // Local state
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [localFlagComments, setLocalFlagComments] = useState<
    Record<string, string>
  >({});

  // Derived
  const flaggedExpenses = useMemo(
    () => expenses.filter((e) => !!e.flagComment),
    [expenses]
  );
  const cleanExpenses = useMemo(
    () => expenses.filter((e) => !e.flagComment),
    [expenses]
  );
  const flagCount = flaggedExpenses.length;
  const reviewable = isBatchReviewable(batch);
  const totalAmount = batch.totalAmount ?? 0;
  const cleanTotal = cleanExpenses.reduce((sum, e) => sum + e.amount, 0);
  const flaggedTotal = flaggedExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Build flag comments map for reject modal
  const flagComments = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of flaggedExpenses) {
      map[e.id] = localFlagComments[e.id] ?? e.flagComment ?? "";
    }
    return map;
  }, [flaggedExpenses, localFlagComments]);

  // Handlers
  const handleFlag = useCallback(
    (expenseId: string, comment: string) => {
      flagMutation.mutate(
        { expenseId, flaggedBy: userId, comment },
        {
          onSuccess: () => toast.success("Expense flagged"),
          onError: () => toast.error("Failed to flag expense"),
        }
      );
    },
    [flagMutation, userId]
  );

  const handleUnflag = useCallback(
    (expenseId: string) => {
      unflagMutation.mutate(expenseId, {
        onSuccess: () => toast.success("Flag removed"),
        onError: () => toast.error("Failed to remove flag"),
      });
    },
    [unflagMutation]
  );

  const handleApprove = useCallback(() => {
    if (!reviewable) return;
    const expenseIds = expenses.map((e) => e.id);
    approveMutation.mutate(
      {
        batchId: batch.id,
        reviewedBy: userId,
        approvedAmount: totalAmount,
        expenseIds,
        submittedBy: batch.submittedBy,
        companyId: batch.companyId,
        batchNumber: batch.batchNumber,
      },
      {
        onSuccess: () => toast.success("Invoice approved"),
        onError: () => toast.error("Failed to approve invoice"),
      }
    );
  }, [approveMutation, batch.id, expenses, reviewable, totalAmount, userId]);

  const handleRejectConfirm = useCallback(() => {
    rejectMutation.mutate(
      {
        batchId: batch.id,
        batch,
        reviewedBy: userId,
        reviewNotes: reviewNotes || null,
        flaggedExpenseIds: flaggedExpenses.map((e) => e.id),
        cleanExpenseIds: cleanExpenses.map((e) => e.id),
        flagComments,
        cleanTotal,
        flaggedTotal,
      },
      {
        onSuccess: () => {
          toast.success("Revisions sent");
          setShowRejectModal(false);
          setReviewNotes("");
          setLocalFlagComments({});
        },
        onError: () => toast.error("Failed to send revisions"),
      }
    );
  }, [
    rejectMutation,
    batch,
    userId,
    reviewNotes,
    flaggedExpenses,
    cleanExpenses,
    flagComments,
    cleanTotal,
    flaggedTotal,
  ]);

  const handleRemoveAllFlags = useCallback(() => {
    for (const e of flaggedExpenses) {
      unflagMutation.mutate(e.id);
    }
  }, [flaggedExpenses, unflagMutation]);

  // Display values
  const displayName = getBatchDisplayName(batch);
  const periodKey = periodKeyFromBatch(batch);
  const periodDisplay = formatPeriodDisplay(periodKey);
  const statusDisplay = BATCH_STATUS_DISPLAY[batch.status];
  const statusColor = BATCH_STATUS_COLOR[batch.status];

  return (
    <div className="relative flex flex-col h-full">
      {/* Header card */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {/* Avatar */}
            <div className="w-[36px] h-[36px] rounded-full bg-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0 overflow-hidden">
              {batch.submitter?.profileImageUrl ? (
                <img
                  src={batch.submitter.profileImageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="font-mohave text-body-sm text-text-2 uppercase">
                  {(batch.submitter?.firstName?.[0] ?? "") +
                    (batch.submitter?.lastName?.[0] ?? "")}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-mohave text-body text-text uppercase">
                {displayName}
              </h3>
              <p className="font-mono text-micro text-text-3 uppercase tracking-wider">
                {batch.batchNumber} · {periodDisplay}
              </p>
            </div>
          </div>

          {/* Status pill */}
          <span
            className="px-1.5 py-0.5 rounded-full font-mono text-micro uppercase tracking-wider"
            style={{
              backgroundColor: `${statusColor}22`,
              color: statusColor,
            }}
          >
            {statusDisplay}
          </span>
        </div>

        {/* Metrics row */}
        <div className="flex gap-4">
          <div>
            <span className="font-mono text-micro text-text-mute uppercase tracking-wider block">
              TOTAL
            </span>
            <span className="font-mono text-data text-text">
              {formatCurrency(totalAmount)}
            </span>
          </div>
          <div>
            <span className="font-mono text-micro text-text-mute uppercase tracking-wider block">
              EXPENSES
            </span>
            <span className="font-mono text-data text-text">
              {expenses.length}
            </span>
          </div>
          {flagCount > 0 && (
            <div>
              <span className="font-mono text-micro text-text-mute uppercase tracking-wider block">
                FLAGGED
              </span>
              <span className="font-mono text-data text-[#C4A868] flex items-center gap-1">
                <Flag className="w-[10px] h-[10px]" />
                {flagCount}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Line items — bottom padding keeps the last row clear of the floating
          approve/reject cluster that floats over the panel's bottom-right. */}
      <div className="flex-1 overflow-y-auto pb-12">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-[20px] h-[20px] text-text-mute animate-spin" />
          </div>
        ) : (
          <ExpenseLineItemTable
            expenses={expenses}
            onFlag={handleFlag}
            onUnflag={handleUnflag}
            onReceiptClick={setReceiptUrl}
            canReview={canReview && reviewable}
          />
        )}
      </div>

      {/* Floating action cluster — compact, bottom-right of the panel, over the
          scroller (content z-tier). Same review logic as before; only the chrome
          changed from a full-width footer to a small floating cluster. */}
      {reviewable && canReview && (
        <div className="absolute bottom-3 right-3 z-[5] flex items-center gap-1.5">
          {flagCount > 0 ? (
            <>
              {/* Remove all flags — text link, left of the buttons */}
              <button
                onClick={handleRemoveAllFlags}
                className="font-mono text-micro text-text-3 hover:text-text-2 uppercase tracking-wider transition-colors"
              >
                REMOVE ALL FLAGS
              </button>
              {/* Reject with revisions */}
              <button
                onClick={() => setShowRejectModal(true)}
                className="flex h-[28px] items-center rounded border border-rose-line bg-rose-soft px-2.5 font-mono text-micro uppercase tracking-wider text-rose transition-colors hover:bg-rose-soft/80"
              >
                REJECT · {flagCount}
              </button>
            </>
          ) : (
            <>
              {/* Reject — disabled until a line item is flagged */}
              <button
                disabled
                title={t("expenses.rejectDisabledHint")}
                className="flex h-[28px] items-center rounded border border-border px-2.5 font-mono text-micro uppercase tracking-wider text-text-mute cursor-not-allowed"
              >
                REJECT
              </button>
              {/* Approve all */}
              <button
                onClick={handleApprove}
                disabled={approveMutation.isPending}
                className="flex h-[28px] items-center gap-1.5 rounded border border-olive-line bg-olive-soft px-2.5 font-mono text-micro uppercase tracking-wider text-olive transition-colors hover:bg-olive-soft/80 disabled:opacity-50"
              >
                {approveMutation.isPending && (
                  <Loader2 className="w-[12px] h-[12px] animate-spin" />
                )}
                APPROVE ALL
              </button>
            </>
          )}
        </div>
      )}

      {/* Receipt lightbox */}
      <AnimatePresence>
        {receiptUrl && (
          <ReceiptLightbox
            imageUrl={receiptUrl}
            onClose={() => setReceiptUrl(null)}
          />
        )}
      </AnimatePresence>

      {/* Reject confirmation modal */}
      <AnimatePresence>
        {showRejectModal && (
          <RejectConfirmationModal
            batch={batch}
            flaggedExpenses={flaggedExpenses}
            flagComments={flagComments}
            cleanCount={cleanExpenses.length}
            cleanTotal={cleanTotal}
            flaggedTotal={flaggedTotal}
            reviewNotes={reviewNotes}
            onReviewNotesChange={setReviewNotes}
            onFlagCommentChange={(id, comment) =>
              setLocalFlagComments((prev) => ({ ...prev, [id]: comment }))
            }
            onUnflag={handleUnflag}
            onConfirm={handleRejectConfirm}
            onCancel={() => setShowRejectModal(false)}
            isSubmitting={rejectMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
