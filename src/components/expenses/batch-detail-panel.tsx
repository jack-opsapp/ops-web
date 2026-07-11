"use client";

/**
 * Batch detail panel — the working column of the expense console.
 *
 * Header: who + which period + where the batch sits in its lifecycle
 * (SUBMITTED → APPROVED → PAID stamps). Body: the line table (expand, flag,
 * early-clear, receipts). Footer is a state machine on the batch's bucket:
 *
 *   review  → REJECT (flag-driven) · APPROVE ALL
 *   pay     → MARK PAID
 *   paid    → paid stamp · UNDO PAID (mis-click recovery)
 *   filling → auto-send foresight line (no verbs — it's the crew's turn)
 *   returned→ review notes (waiting on fixes)
 */

import { useState, useMemo, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Loader2, Flag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import {
  useBatchExpenses,
  useFlagExpense,
  useUnflagExpense,
  useEarlyClearLine,
  useRejectWithRevisions,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  ExpenseBatchStatus,
  batchStatusDisplay,
  batchStatusTone,
  getBatchDisplayName,
  formatPeriodDisplay,
  periodKeyFromBatch,
  isBatchReviewable,
  isBatchAwaitingPayout,
  isBatchPaid,
  isBatchFilling,
  batchOwedAmount,
  type ExpenseBatch,
} from "@/lib/types/expense-approval";
import { BatchLineTable } from "./batch-line-table";
import { ReceiptLightbox } from "./receipt-lightbox";
import { RejectConfirmationModal } from "./reject-confirmation-modal";
import { SubmitterAvatar } from "./batch-list";

// ─── Component ────────────────────────────────────────────────────────────────

export function BatchDetailPanel({
  batch,
  canReview,
  onApprove,
  onMarkPaid,
  onUndoPaid,
  busy,
  autoSendsOn,
}: {
  batch: ExpenseBatch;
  canReview: boolean;
  onApprove: (batch: ExpenseBatch) => void;
  onMarkPaid: (batch: ExpenseBatch) => void;
  onUndoPaid: (batch: ExpenseBatch) => void;
  /** True while a mutation for THIS batch is in flight. */
  busy: boolean;
  /** Precomputed auto-send date label for filling envelopes (null = unknown). */
  autoSendsOn: string | null;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const { currentUser } = useAuthStore();
  const userId = currentUser?.id ?? "";

  const { data: expenses = [], isLoading } = useBatchExpenses(batch.id);

  const flagMutation = useFlagExpense();
  const unflagMutation = useUnflagExpense();
  const earlyClearMutation = useEarlyClearLine();
  const rejectMutation = useRejectWithRevisions();

  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [localFlagComments, setLocalFlagComments] = useState<Record<string, string>>({});

  const fmtMoney = (value: number) =>
    new Intl.NumberFormat(numLocale, { style: "currency", currency: "USD" }).format(value);

  const fmtStampDate = (iso: string) =>
    new Intl.DateTimeFormat(numLocale, { month: "short", day: "numeric" })
      .format(new Date(iso))
      .toUpperCase();

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
  const awaitingPayout = isBatchAwaitingPayout(batch);
  const paid = isBatchPaid(batch);
  const filling = isBatchFilling(batch.status);
  const returned = batch.status === ExpenseBatchStatus.Rejected;
  const totalAmount = batch.totalAmount ?? 0;
  const owed = batchOwedAmount(batch);
  const cleanTotal = cleanExpenses.reduce((sum, e) => sum + e.amount, 0);
  const flaggedTotal = flaggedExpenses.reduce((sum, e) => sum + e.amount, 0);

  const flagComments = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of flaggedExpenses) {
      map[e.id] = localFlagComments[e.id] ?? e.flagComment ?? "";
    }
    return map;
  }, [flaggedExpenses, localFlagComments]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFlag = useCallback(
    (expenseId: string, comment: string) => {
      flagMutation.mutate(
        { expenseId, flaggedBy: userId, comment },
        {
          onSuccess: () => toast.success(t("expenses.toast.flagged")),
          onError: () => toast.error(t("expenses.toast.flagFailed")),
        }
      );
    },
    [flagMutation, userId, t]
  );

  const handleUnflag = useCallback(
    (expenseId: string) => {
      unflagMutation.mutate(expenseId, {
        onSuccess: () => toast.success(t("expenses.toast.unflagged")),
        onError: () => toast.error(t("expenses.toast.unflagFailed")),
      });
    },
    [unflagMutation, t]
  );

  const handleEarlyClear = useCallback(
    (expenseId: string) => {
      earlyClearMutation.mutate(expenseId, {
        onSuccess: () => toast.success(t("expenses.toast.cleared")),
        onError: () => toast.error(t("expenses.toast.clearFailed")),
      });
    },
    [earlyClearMutation, t]
  );

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
          toast.success(t("expenses.toast.revisionsSent"));
          setShowRejectModal(false);
          setReviewNotes("");
          setLocalFlagComments({});
        },
        onError: () => toast.error(t("expenses.toast.revisionsFailed")),
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
    t,
  ]);

  const handleRemoveAllFlags = useCallback(() => {
    for (const e of flaggedExpenses) {
      unflagMutation.mutate(e.id);
    }
  }, [flaggedExpenses, unflagMutation]);

  // ── Display ─────────────────────────────────────────────────────────────────

  const displayName = getBatchDisplayName(batch);
  const periodDisplay = formatPeriodDisplay(periodKeyFromBatch(batch));

  // Lifecycle stamps — only render what happened, in order.
  const stamps: { key: string; label: string; tone?: "olive" }[] = [];
  stamps.push({
    key: "submitted",
    label: t("expenses.detail.submitted", { date: fmtStampDate(batch.createdAt) }),
  });
  if (batch.reviewedAt && batch.status !== ExpenseBatchStatus.Rejected) {
    stamps.push({
      key: "approved",
      label: t(
        batch.status === ExpenseBatchStatus.AutoApproved
          ? "expenses.detail.autoApproved"
          : "expenses.detail.approved",
        { date: fmtStampDate(batch.reviewedAt) }
      ),
    });
  } else if (batch.status === ExpenseBatchStatus.AutoApproved) {
    stamps.push({
      key: "approved",
      label: t("expenses.detail.autoApproved", { date: fmtStampDate(batch.createdAt) }),
    });
  }
  if (returned && batch.reviewedAt) {
    stamps.push({
      key: "returned",
      label: t("expenses.detail.returnedOn", { date: fmtStampDate(batch.reviewedAt) }),
    });
  }
  if (batch.paidAt) {
    stamps.push({
      key: "paid",
      label: t("expenses.detail.paid", { date: fmtStampDate(batch.paidAt) }),
      tone: "olive",
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SubmitterAvatar user={batch.submitter} name={displayName} size={36} />
            <div className="min-w-0">
              <h3 className="truncate font-mohave text-body text-text">{displayName}</h3>
              <p
                className="font-mono text-micro uppercase tracking-wider text-text-3"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {batch.batchNumber} · {periodDisplay}
              </p>
            </div>
          </div>

          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-chip border px-1 py-[1px]",
              "font-mono text-micro font-medium uppercase tracking-[0.12em]",
              batchStatusTone(batch.status)
            )}
          >
            {batchStatusDisplay(batch.status)}
          </span>
        </div>

        {/* Lifecycle stamps */}
        <div
          className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-micro uppercase tracking-wider"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {stamps.map((stamp, i) => (
            <span key={stamp.key} className="inline-flex items-baseline gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-text-mute">
                  →
                </span>
              )}
              <span className={stamp.tone === "olive" ? "text-olive" : "text-text-3"}>
                {stamp.label}
              </span>
            </span>
          ))}
        </div>

        {/* Totals */}
        <div className="flex gap-4">
          <div>
            <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
              {t("expenses.detail.total")}
            </span>
            <span
              className="font-mono text-data text-text"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {fmtMoney(totalAmount)}
            </span>
          </div>
          {batch.approvedAmount != null && batch.approvedAmount !== totalAmount && (
            <div>
              <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                {t("expenses.detail.approvedAmount")}
              </span>
              <span
                className="font-mono text-data text-olive"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {fmtMoney(batch.approvedAmount)}
              </span>
            </div>
          )}
          <div>
            <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
              {t("expenses.detail.items")}
            </span>
            <span
              className="font-mono text-data text-text"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {expenses.length}
            </span>
          </div>
          {flagCount > 0 && (
            <div>
              <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                {t("expenses.detail.flagged")}
              </span>
              <span
                className="flex items-center gap-1 font-mono text-data text-tan"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                <Flag className="h-[10px] w-[10px]" />
                {flagCount}
              </span>
            </div>
          )}
        </div>

        {/* Returned batches carry the office's note back to the crew */}
        {returned && batch.reviewNotes && (
          <div>
            <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
              {t("expenses.detail.reviewNotes")}
            </span>
            <span className="font-mono text-caption-sm text-text-2">{batch.reviewNotes}</span>
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-[20px] w-[20px] animate-spin text-text-mute motion-reduce:animate-none" />
          </div>
        ) : (
          <BatchLineTable
            expenses={expenses}
            onFlag={handleFlag}
            onUnflag={handleUnflag}
            onEarlyClear={handleEarlyClear}
            onReceiptClick={setReceiptUrl}
            canReview={canReview && reviewable}
            canEarlyClear={canReview}
            isClearing={earlyClearMutation.isPending}
          />
        )}
      </div>

      {/* Footer — lifecycle state machine */}
      {canReview && reviewable && (
        <div className="space-y-2 border-t border-line p-3">
          {flagCount > 0 ? (
            <>
              <button
                type="button"
                onClick={handleRemoveAllFlags}
                className="font-mono text-micro uppercase tracking-wider text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2"
              >
                {t("expenses.detail.removeAllFlags")}
              </button>
              <button
                type="button"
                onClick={() => setShowRejectModal(true)}
                className="w-full rounded border border-rose-line bg-rose-soft px-4 py-2 font-cakemono text-button-sm font-light uppercase text-rose transition-colors duration-150 ease-smooth hover:border-rose focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {t(flagCount === 1 ? "expenses.detail.rejectWithOne" : "expenses.detail.rejectWith", {
                  n: flagCount,
                })}
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                disabled
                className="flex-1 cursor-not-allowed rounded border border-line px-4 py-2 font-cakemono text-button-sm font-light uppercase text-text-mute"
              >
                {t("expenses.detail.reject")}
              </button>
              <button
                type="button"
                onClick={() => onApprove(batch)}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded border border-olive-line bg-olive-soft px-4 py-2 font-cakemono text-button-sm font-light uppercase text-olive transition-colors duration-150 ease-smooth hover:border-olive focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50"
              >
                {busy && (
                  <Loader2 className="h-[12px] w-[12px] animate-spin motion-reduce:animate-none" />
                )}
                {t("expenses.detail.approveAll", { total: fmtMoney(totalAmount) })}
              </button>
            </div>
          )}
        </div>
      )}

      {canReview && awaitingPayout && (
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={() => onMarkPaid(batch)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-olive-line bg-olive-soft px-4 py-2 font-cakemono text-button-sm font-light uppercase text-olive transition-colors duration-150 ease-smooth hover:border-olive focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50"
          >
            {busy && (
              <Loader2 className="h-[12px] w-[12px] animate-spin motion-reduce:animate-none" />
            )}
            {t("expenses.detail.markPaid", { total: fmtMoney(owed) })}
          </button>
        </div>
      )}

      {paid && batch.paidAt && (
        <div className="flex items-center justify-between gap-2 border-t border-line p-3">
          <span
            className="font-mono text-micro uppercase tracking-wider text-olive"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {t("expenses.detail.paid", { date: fmtStampDate(batch.paidAt) })} ·{" "}
            {fmtMoney(owed)}
          </span>
          {canReview && (
            <button
              type="button"
              onClick={() => onUndoPaid(batch)}
              disabled={busy}
              className="font-mono text-micro uppercase tracking-wider text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2 disabled:opacity-40"
            >
              {t("expenses.detail.undoPaid")}
            </button>
          )}
        </div>
      )}

      {filling && (
        <div className="border-t border-line p-3">
          <span className="font-mono text-micro tracking-wider text-text-3">
            {"[ "}
            {autoSendsOn
              ? t("expenses.detail.autoSends", { date: autoSendsOn })
              : t("expenses.detail.stillFilling")}
            {" ]"}
          </span>
        </div>
      )}

      {/* Receipt lightbox */}
      <AnimatePresence>
        {receiptUrl && (
          <ReceiptLightbox imageUrl={receiptUrl} onClose={() => setReceiptUrl(null)} />
        )}
      </AnimatePresence>

      {/* Reject confirmation */}
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
