"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RejectConfirmationModal({
  batch,
  flaggedExpenses,
  flagComments,
  cleanCount,
  cleanTotal,
  flaggedTotal,
  reviewNotes,
  onReviewNotesChange,
  onFlagCommentChange,
  onUnflag,
  onConfirm,
  onCancel,
  isSubmitting,
}: RejectConfirmationModalProps) {
  // Escape key closes modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const displayName = getBatchDisplayName(batch);
  const periodKey = periodKeyFromBatch(batch);
  const periodDisplay = formatPeriodDisplay(periodKey);
  const flaggedCount = flaggedExpenses.length;
  const allUnflagged = flaggedCount === 0;

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onCancel}
      >
        {/* Modal card */}
        <motion.div
          className="w-full max-w-lg mx-4 bg-[#141414] border border-border rounded p-5 flex flex-col gap-4"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <h2 className="font-mohave text-body text-text-primary uppercase text-left">
              {displayName}
            </h2>
            <span className="font-kosugi text-caption-sm text-text-tertiary text-left">
              {periodDisplay}
            </span>
            {flaggedCount > 0 && (
              <span className="font-kosugi text-caption-sm text-[#C4A868] text-left">
                {flaggedCount} item{flaggedCount !== 1 ? "s" : ""} flagged for
                revision
              </span>
            )}
          </div>

          {/* ── Flagged items list ──────────────────────────────────────── */}
          {flaggedCount > 0 && (
            <div className="max-h-[300px] overflow-y-auto flex flex-col gap-3 pr-1">
              {flaggedExpenses.map((expense) => (
                <div key={expense.id} className="flex flex-col gap-1.5">
                  {/* Row: date + merchant | amount */}
                  <div className="flex items-center justify-between">
                    <span className="font-kosugi text-caption-sm text-text-secondary text-left">
                      {expense.expenseDate
                        ? formatDate(expense.expenseDate)
                        : "No date"}
                      {expense.merchantName
                        ? ` \u2014 ${expense.merchantName}`
                        : ""}
                    </span>
                    <span className="font-mono text-data-sm text-text-primary shrink-0 ml-3">
                      {formatCurrency(expense.amount)}
                    </span>
                  </div>

                  {/* Comment textarea */}
                  <textarea
                    className={cn(
                      "w-full bg-[rgba(255,255,255,0.04)] border border-border rounded p-2",
                      "font-kosugi text-caption-sm text-text-secondary text-left",
                      "placeholder:text-text-tertiary resize-none",
                      "focus:outline-none focus:border-[rgba(255,255,255,0.30)]"
                    )}
                    rows={2}
                    placeholder="Reason for flagging..."
                    value={flagComments[expense.id] ?? ""}
                    onChange={(e) =>
                      onFlagCommentChange(expense.id, e.target.value)
                    }
                  />

                  {/* Unflag button */}
                  <button
                    type="button"
                    className="font-kosugi text-[10px] text-text-tertiary hover:text-text-secondary uppercase text-left self-start transition-colors duration-150"
                    onClick={() => onUnflag(expense.id)}
                  >
                    UNFLAG
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Review notes ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase text-left">
              REVIEW NOTES (OPTIONAL)
            </label>
            <textarea
              className={cn(
                "w-full bg-[rgba(255,255,255,0.04)] border border-border rounded p-2",
                "font-kosugi text-caption-sm text-text-secondary text-left",
                "placeholder:text-text-tertiary resize-none",
                "focus:outline-none focus:border-[rgba(255,255,255,0.30)]"
              )}
              rows={2}
              placeholder="Optional notes for the submitter..."
              value={reviewNotes}
              onChange={(e) => onReviewNotesChange(e.target.value)}
            />
          </div>

          {/* ── Context line ────────────────────────────────────────────── */}
          <p className="font-kosugi text-caption-sm text-text-tertiary text-left">
            {cleanCount} expense{cleanCount !== 1 ? "s" : ""} will be approved.{" "}
            {flaggedCount} will be returned for revision.
          </p>

          {/* ── Footer buttons ──────────────────────────────────────────── */}
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              className={cn(
                "bg-transparent border border-border text-text-tertiary hover:text-text-secondary",
                "font-kosugi text-caption-sm uppercase px-4 py-2 rounded",
                "transition-colors duration-150"
              )}
              onClick={onCancel}
              disabled={isSubmitting}
            >
              CANCEL
            </button>

            {allUnflagged ? (
              <button
                type="button"
                className={cn(
                  "bg-[rgba(157,181,130,0.2)] text-[#9DB582]",
                  "font-kosugi text-caption-sm uppercase px-4 py-2 rounded",
                  "transition-colors duration-150",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                onClick={onConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    APPROVING...
                  </span>
                ) : (
                  "APPROVE ALL"
                )}
              </button>
            ) : (
              <button
                type="button"
                className={cn(
                  "bg-[#93321A] hover:bg-[#a83d20] text-white",
                  "font-kosugi text-caption-sm uppercase px-4 py-2 rounded",
                  "transition-colors duration-150",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                onClick={onConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    SENDING...
                  </span>
                ) : (
                  `SEND ${flaggedCount} REVISION${flaggedCount !== 1 ? "S" : ""}`
                )}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
