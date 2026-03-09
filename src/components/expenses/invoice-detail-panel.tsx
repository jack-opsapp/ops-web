"use client";

import { useState, useMemo, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Loader2, Flag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  useBatchExpenses,
  useFlagExpense,
  useUnflagExpense,
  useApproveBatch,
  useRejectWithRevisions,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
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
    <div className="flex flex-col h-full">
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
                <span className="font-mohave text-body-sm text-text-secondary uppercase">
                  {(batch.submitter?.firstName?.[0] ?? "") +
                    (batch.submitter?.lastName?.[0] ?? "")}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-mohave text-body text-text-primary uppercase">
                {displayName}
              </h3>
              <p className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                {batch.batchNumber} · {periodDisplay}
              </p>
            </div>
          </div>

          {/* Status pill */}
          <span
            className="px-1.5 py-0.5 rounded-full font-kosugi text-[10px] uppercase tracking-wider"
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
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
              TOTAL
            </span>
            <span className="font-mono text-data text-text-primary">
              {formatCurrency(totalAmount)}
            </span>
          </div>
          <div>
            <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
              EXPENSES
            </span>
            <span className="font-mono text-data text-text-primary">
              {expenses.length}
            </span>
          </div>
          {flagCount > 0 && (
            <div>
              <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
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

      {/* Line items */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-[20px] h-[20px] text-text-disabled animate-spin" />
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

      {/* Sticky footer — only for reviewable batches */}
      {reviewable && canReview && (
        <div className="border-t border-border p-3 space-y-2">
          {flagCount > 0 ? (
            <>
              {/* Remove all flags text link */}
              <button
                onClick={handleRemoveAllFlags}
                className="font-kosugi text-[10px] text-text-tertiary hover:text-text-secondary uppercase tracking-wider transition-colors"
              >
                REMOVE ALL FLAGS
              </button>
              {/* Full-width reject button */}
              <button
                onClick={() => setShowRejectModal(true)}
                className="w-full px-4 py-2 rounded bg-[#93321A] hover:bg-[#a83d20] text-white font-kosugi text-caption-sm uppercase tracking-wider transition-colors"
              >
                REJECT WITH {flagCount} REVISION{flagCount !== 1 ? "S" : ""}
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              {/* Reject — dimmed when no flags */}
              <button
                disabled
                className="flex-1 px-4 py-2 rounded border border-border text-text-disabled font-kosugi text-caption-sm uppercase tracking-wider cursor-not-allowed"
              >
                REJECT
              </button>
              {/* Approve */}
              <button
                onClick={handleApprove}
                disabled={approveMutation.isPending}
                className="flex-1 px-4 py-2 rounded bg-[rgba(157,181,130,0.15)] hover:bg-[rgba(157,181,130,0.25)] text-[#9DB582] font-kosugi text-caption-sm uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {approveMutation.isPending && (
                  <Loader2 className="w-[12px] h-[12px] animate-spin" />
                )}
                APPROVE ALL
              </button>
            </div>
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
