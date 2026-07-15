"use client";

/**
 * Reject confirmation — the flag-driven return flow for an expense batch.
 * Clean lines approve; flagged lines move to an amendment batch and go back
 * to the crew member with per-line comments. Editing a comment or unflagging
 * is still possible right here before committing.
 */

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import {
  type ExpenseBatch,
  type ExpenseLineItem,
  getBatchDisplayName,
  formatPeriodDisplay,
  periodKeyFromBatch,
} from "@/lib/types/expense-approval";

// ─── Props ───────────────────────────────────────────────────────────────────

interface RejectConfirmationModalProps {
  batch: ExpenseBatch;
  flaggedExpenses: ExpenseLineItem[];
  flagComments: Record<string, string>;
  cleanCount: number;
  cleanTotal: number;
  flaggedTotal: number;
  reviewNotes: string;
  onReviewNotesChange: (notes: string) => void;
  onFlagCommentChange: (expenseId: string, comment: string) => void;
  onUnflag: (expenseId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RejectConfirmationModal({
  batch,
  flaggedExpenses,
  flagComments,
  cleanCount,
  reviewNotes,
  onReviewNotesChange,
  onFlagCommentChange,
  onUnflag,
  onConfirm,
  onCancel,
  isSubmitting,
}: RejectConfirmationModalProps) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);

  const fmtMoney = (value: number) =>
    new Intl.NumberFormat(numLocale, { style: "currency", currency: "USD" }).format(value);

  const fmtDate = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(numLocale, { month: "short", day: "numeric" }).format(
      new Date(y, (m ?? 1) - 1, d ?? 1)
    );
  };

  // Escape closes
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const displayName = getBatchDisplayName(batch);
  const periodDisplay = formatPeriodDisplay(periodKeyFromBatch(batch));
  const flaggedCount = flaggedExpenses.length;
  const allUnflagged = flaggedCount === 0;

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        onClick={onCancel}
      >
        {/* Modal card */}
        <motion.div
          className="glass-dense mx-4 flex w-full max-w-lg flex-col gap-4 rounded-modal border border-glass-border p-5"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h2 className="text-left font-mohave text-body text-text">{displayName}</h2>
            <span className="text-left font-mono text-caption-sm text-text-3">
              {periodDisplay}
            </span>
            {flaggedCount > 0 && (
              <span className="text-left font-mono text-caption-sm text-tan">
                {t(
                  flaggedCount === 1
                    ? "expenses.reject.flaggedCountOne"
                    : "expenses.reject.flaggedCount",
                  { n: flaggedCount }
                )}
              </span>
            )}
          </div>

          {/* Flagged lines */}
          {flaggedCount > 0 && (
            <div className="flex max-h-[300px] flex-col gap-3 overflow-y-auto pr-1">
              {flaggedExpenses.map((expense) => (
                <div key={expense.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-left font-mono text-caption-sm text-text-2">
                      {expense.expenseDate
                        ? fmtDate(expense.expenseDate)
                        : t("expenses.reject.noDate")}
                      {expense.merchantName ? ` — ${expense.merchantName}` : ""}
                    </span>
                    <span
                      className="ml-3 shrink-0 font-mono text-data-sm text-text"
                      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                    >
                      {fmtMoney(expense.amount)}
                    </span>
                  </div>

                  <textarea
                    className={cn(
                      "w-full rounded border border-line bg-surface-input p-2",
                      "text-left font-mono text-caption-sm text-text-2",
                      "resize-none placeholder:text-text-3",
                      "focus:border-border-medium focus:outline-none"
                    )}
                    rows={2}
                    placeholder={t("expenses.reject.reasonPlaceholder")}
                    value={flagComments[expense.id] ?? ""}
                    onChange={(e) => onFlagCommentChange(expense.id, e.target.value)}
                  />

                  <button
                    type="button"
                    className="self-start text-left font-mono text-micro uppercase text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2"
                    onClick={() => onUnflag(expense.id)}
                  >
                    {t("expenses.line.unflag")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Review notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-left font-mono text-caption-sm uppercase text-text-3">
              {t("expenses.reject.notesLabel")}
            </label>
            <textarea
              className={cn(
                "w-full rounded border border-line bg-surface-input p-2",
                "text-left font-mono text-caption-sm text-text-2",
                "resize-none placeholder:text-text-3",
                "focus:border-border-medium focus:outline-none"
              )}
              rows={2}
              placeholder={t("expenses.reject.notesPlaceholder")}
              value={reviewNotes}
              onChange={(e) => onReviewNotesChange(e.target.value)}
            />
          </div>

          {/* Context line */}
          <p className="text-left font-mono text-caption-sm text-text-3">
            {t(
              cleanCount === 1 ? "expenses.reject.contextOneClean" : "expenses.reject.context",
              { clean: cleanCount, flagged: flaggedCount }
            )}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className={cn(
                "border border-line bg-transparent text-text-3 hover:text-text-2",
                "rounded px-4 py-2 font-cakemono text-button-sm font-light uppercase",
                "transition-colors duration-150 ease-smooth"
              )}
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {t("expenses.bulk.cancel")}
            </button>

            {allUnflagged ? (
              <button
                type="button"
                className={cn(
                  "border border-olive-line bg-olive-soft text-olive hover:border-olive",
                  "rounded px-4 py-2 font-cakemono text-button-sm font-light uppercase",
                  "transition-colors duration-150 ease-smooth",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
                onClick={onConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    {t("expenses.reject.approving")}
                  </span>
                ) : (
                  t("expenses.reject.approveAll")
                )}
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "border border-rose-line bg-rose-soft text-rose hover:border-rose",
                  "rounded px-4 py-2 font-cakemono text-button-sm font-light uppercase",
                  "transition-colors duration-150 ease-smooth",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
                onClick={onConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    {t("expenses.reject.sending")}
                  </span>
                ) : (
                  t(flaggedCount === 1 ? "expenses.reject.sendOne" : "expenses.reject.send", {
                    n: flaggedCount,
                  })
                )}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
