"use client";

/**
 * Batch line table — the expense lines inside a batch detail panel.
 *
 * One-line scan rows (date · merchant · category · amount · state · receipt),
 * expanding to the full record: project allocation (resolved title), payment
 * method, tax, notes, receipt (or the crew's no-receipt reason), flagging with
 * a required comment, and the approver's per-line early CLEAR.
 */

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  FlagOff,
  Image as ImageIcon,
  ImageOff,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BatchLineTableProps {
  expenses: ExpenseLineItem[];
  onFlag: (expenseId: string, comment: string) => void;
  onUnflag: (expenseId: string) => void;
  onEarlyClear: (expenseId: string) => void;
  onReceiptClick: (imageUrl: string) => void;
  /** Review controls (flag/unflag) — reviewable batch + approve permission. */
  canReview: boolean;
  /**
   * Per-line CLEAR — any `expenses.approve` holder, independent of batch
   * reviewability so a filling envelope's line can be cleared early.
   */
  canEarlyClear: boolean;
  isClearing: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BatchLineTable({
  expenses,
  onFlag,
  onUnflag,
  onEarlyClear,
  onReceiptClick,
  canReview,
  canEarlyClear,
  isClearing,
}: BatchLineTableProps) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [flagInput, setFlagInput] = useState<Record<string, string>>({});

  const fmtMoney = (value: number) =>
    new Intl.NumberFormat(numLocale, { style: "currency", currency: "USD" }).format(value);

  const fmtDate = (value: string | null) => {
    if (!value) return "—";
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(numLocale, { month: "short", day: "numeric" }).format(
      new Date(y, (m ?? 1) - 1, d ?? 1)
    );
  };

  // Reason codes are DB CHECK-constrained (lost/cash/digital/other,
  // overhead/general/other) — every value has a dictionary key.
  const noReceiptReason = (code: string | null) =>
    t(`expenses.line.noReceiptReason.${code ?? "other"}`);
  const noProjectReason = (code: string | null) =>
    t(`expenses.line.noProjectReason.${code ?? "other"}`);

  const toggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const handleFlag = (expenseId: string) => {
    const comment = flagInput[expenseId]?.trim();
    if (!comment) return;
    onFlag(expenseId, comment);
    setFlagInput((prev) => ({ ...prev, [expenseId]: "" }));
  };

  const grid = "grid grid-cols-[24px_64px_1fr_96px_84px_84px_44px] items-center gap-2";

  return (
    <div className="w-full">
      {/* Header */}
      <div className={cn(grid, "border-b border-line px-3 py-1.5")}>
        <span aria-hidden />
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          {t("expenses.line.date")}
        </span>
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          {t("expenses.line.merchant")}
        </span>
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          {t("expenses.line.category")}
        </span>
        <span className="text-right font-mono text-micro uppercase tracking-wider text-text-3">
          {t("expenses.line.amount")}
        </span>
        <span className="font-mono text-micro uppercase tracking-wider text-text-3">
          {t("expenses.line.status")}
        </span>
        <span aria-hidden />
      </div>

      {/* Rows */}
      {expenses.map((expense) => {
        const isFlagged = !!expense.flagComment;
        const isExpanded = expandedId === expense.id;
        // Clearable only while still submitted — never terminal or draft lines.
        const lineClearable = expense.status === "submitted";

        return (
          <div key={expense.id}>
            <button
              type="button"
              onClick={() => toggleExpand(expense.id)}
              className={cn(
                grid,
                "w-full border-b border-line px-3 py-2 text-left transition-colors duration-150 ease-smooth",
                isFlagged
                  ? "border-l-2 border-l-tan bg-tan-soft/40"
                  : "hover:bg-surface-hover"
              )}
            >
              <span className="text-text-mute">
                {isExpanded ? (
                  <ChevronDown className="h-[14px] w-[14px]" />
                ) : (
                  <ChevronRight className="h-[14px] w-[14px]" />
                )}
              </span>

              <span
                className="font-mono text-caption-sm text-text-2"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {fmtDate(expense.expenseDate)}
              </span>

              <span className="truncate font-mohave text-body-sm text-text">
                {expense.merchantName || "—"}
              </span>

              <span className="truncate font-mono text-caption-sm text-text-3">
                {expense.categoryName || "—"}
              </span>

              <span
                className="text-right font-mono text-data-sm text-text"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {fmtMoney(expense.amount)}
              </span>

              <span>
                {isFlagged ? (
                  <span className="inline-flex items-center gap-[3px] rounded-chip border border-tan-line bg-tan-soft px-1 py-[1px] font-mono text-micro font-medium uppercase tracking-[0.12em] text-tan">
                    <Flag aria-hidden className="h-[9px] w-[9px]" />
                    {t("expenses.line.flaggedTag")}
                  </span>
                ) : expense.status === "approved" ? (
                  <span className="inline-flex items-center rounded-chip border border-olive-line bg-olive-soft px-1 py-[1px] font-mono text-micro font-medium uppercase tracking-[0.12em] text-olive">
                    {t("expenses.line.approved")}
                  </span>
                ) : expense.status === "reimbursed" ? (
                  <span className="inline-flex items-center rounded-chip border border-olive-line bg-olive-soft px-1 py-[1px] font-mono text-micro font-medium uppercase tracking-[0.12em] text-olive">
                    {t("expenses.line.paid")}
                  </span>
                ) : expense.status === "rejected" ? (
                  <span className="inline-flex items-center rounded-chip border border-rose-line bg-rose-soft px-1 py-[1px] font-mono text-micro font-medium uppercase tracking-[0.12em] text-rose">
                    {t("expenses.line.rejected")}
                  </span>
                ) : null}
              </span>

              {/* Receipt thumb / no-receipt reason */}
              <span className="flex justify-end">
                {expense.receiptThumbnailUrl || expense.receiptImageUrl ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReceiptClick(expense.receiptImageUrl || expense.receiptThumbnailUrl!);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onReceiptClick(expense.receiptImageUrl || expense.receiptThumbnailUrl!);
                      }
                    }}
                    className="h-[32px] w-[32px] cursor-zoom-in overflow-hidden rounded border border-line transition-colors duration-150 ease-smooth hover:border-border-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={expense.receiptThumbnailUrl || expense.receiptImageUrl!}
                      alt={t("expenses.line.receipt")}
                      className="h-full w-full object-cover"
                    />
                  </span>
                ) : expense.receiptMissingReason ? (
                  <span
                    title={noReceiptReason(expense.receiptMissingReason)}
                    className="flex h-[32px] w-[32px] items-center justify-center rounded border border-tan-line"
                  >
                    <ImageOff className="h-[12px] w-[12px] text-tan" />
                  </span>
                ) : (
                  <span className="flex h-[32px] w-[32px] items-center justify-center rounded border border-line">
                    <ImageIcon className="h-[12px] w-[12px] text-text-mute" />
                  </span>
                )}
              </span>
            </button>

            {/* Expanded record */}
            {isExpanded && (
              <div className="border-b border-line bg-surface-input px-3 py-3">
                <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div>
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.category")}
                    </span>
                    <span className="font-mono text-caption-sm text-text-2">
                      {expense.categoryName || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.project")}
                    </span>
                    {expense.projectId ? (
                      <span className="font-mono text-caption-sm text-text-2">
                        {expense.projectName ?? expense.projectId}
                      </span>
                    ) : expense.projectMissingReason ? (
                      <span className="font-mono text-caption-sm text-tan">
                        {noProjectReason(expense.projectMissingReason)}
                        {expense.projectMissingNote ? ` · ${expense.projectMissingNote}` : ""}
                      </span>
                    ) : (
                      <span className="font-mono text-caption-sm text-text-2">—</span>
                    )}
                  </div>

                  <div>
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.paymentMethod")}
                    </span>
                    <span className="font-mono text-caption-sm text-text-2">
                      {expense.paymentMethod || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.tax")}
                    </span>
                    <span
                      className="font-mono text-data-sm text-text-2"
                      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                    >
                      {expense.taxAmount != null ? fmtMoney(expense.taxAmount) : "—"}
                    </span>
                  </div>
                </div>

                {expense.description && (
                  <div className="mb-3">
                    <span className="block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.notes")}
                    </span>
                    <span className="font-mono text-caption-sm text-text-3">
                      {expense.description}
                    </span>
                  </div>
                )}

                {expense.receiptImageUrl || expense.receiptThumbnailUrl ? (
                  <div className="mb-3">
                    <span className="mb-1 block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.receipt")}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onReceiptClick(expense.receiptImageUrl || expense.receiptThumbnailUrl!)
                      }
                      className="h-[80px] w-[120px] cursor-zoom-in overflow-hidden rounded border border-line transition-colors duration-150 ease-smooth hover:border-border-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={expense.receiptThumbnailUrl || expense.receiptImageUrl!}
                        alt={t("expenses.line.receipt")}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  </div>
                ) : expense.receiptMissingReason ? (
                  <div className="mb-3">
                    <span className="mb-1 block font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.line.noReceipt")}
                    </span>
                    <span className="block font-mono text-caption-sm text-tan">
                      {noReceiptReason(expense.receiptMissingReason)}
                    </span>
                    {expense.receiptMissingNote && (
                      <span className="mt-0.5 block font-mono text-caption-sm text-text-3">
                        {expense.receiptMissingNote}
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Early CLEAR — approver-only, still-submitted lines */}
                {canEarlyClear && lineClearable && (
                  <div className="border-t border-line pt-2">
                    <button
                      type="button"
                      onClick={() => onEarlyClear(expense.id)}
                      disabled={isClearing}
                      className="flex items-center gap-1 font-mono text-micro uppercase tracking-wider text-olive transition-colors duration-150 ease-smooth hover:text-text disabled:opacity-40"
                    >
                      <Check className="h-[10px] w-[10px]" />
                      {t("expenses.line.clear")}
                    </button>
                  </div>
                )}

                {/* Flagging */}
                {canReview && (
                  <div className={cn("pt-2", !(canEarlyClear && lineClearable) && "border-t border-line")}>
                    {isFlagged ? (
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                          <Flag className="mt-0.5 h-[12px] w-[12px] shrink-0 text-tan" />
                          <span className="font-mono text-caption-sm text-tan">
                            {expense.flagComment}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onUnflag(expense.id)}
                          className="flex items-center gap-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2"
                        >
                          <FlagOff className="h-[10px] w-[10px]" />
                          {t("expenses.line.unflag")}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <textarea
                          value={flagInput[expense.id] ?? ""}
                          onChange={(e) =>
                            setFlagInput((prev) => ({ ...prev, [expense.id]: e.target.value }))
                          }
                          placeholder={t("expenses.line.flagPlaceholder")}
                          rows={2}
                          className="w-full resize-none rounded border border-line bg-surface-input p-2 font-mono text-caption-sm text-text-2 placeholder:text-text-3 focus:border-border-medium focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleFlag(expense.id)}
                          disabled={!flagInput[expense.id]?.trim()}
                          className={cn(
                            "flex items-center gap-1 font-mono text-micro uppercase tracking-wider transition-colors duration-150 ease-smooth",
                            flagInput[expense.id]?.trim()
                              ? "text-tan hover:text-text"
                              : "cursor-not-allowed text-text-mute"
                          )}
                        >
                          <Flag className="h-[10px] w-[10px]" />
                          {t("expenses.line.flagThis")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {expenses.length === 0 && (
        <div className="px-3 py-8">
          <p className="font-mono text-caption-sm text-text-mute">
            {t("expenses.line.empty")}
          </p>
        </div>
      )}
    </div>
  );
}
