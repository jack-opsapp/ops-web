"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Flag,
  FlagOff,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExpenseLineItemTableProps {
  expenses: ExpenseLineItem[];
  onFlag: (expenseId: string, comment: string) => void;
  onUnflag: (expenseId: string) => void;
  onReceiptClick: (imageUrl: string) => void;
  /** Whether the current user can flag/unflag (has approve permission) */
  canReview: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpenseLineItemTable({
  expenses,
  onFlag,
  onUnflag,
  onReceiptClick,
  canReview,
}: ExpenseLineItemTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [flagInput, setFlagInput] = useState<Record<string, string>>({});

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleFlag = (expenseId: string) => {
    const comment = flagInput[expenseId]?.trim();
    if (!comment) return;
    onFlag(expenseId, comment);
    setFlagInput((prev) => ({ ...prev, [expenseId]: "" }));
  };

  return (
    <div className="w-full">
      {/* Table header */}
      <div className="grid grid-cols-[32px_80px_1fr_100px_80px_90px_60px] gap-2 px-3 py-1.5 border-b border-border">
        <span /> {/* Expand chevron */}
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
          DATE
        </span>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
          MERCHANT
        </span>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
          CATEGORY
        </span>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider text-right">
          AMOUNT
        </span>
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
          STATUS
        </span>
        <span /> {/* Receipt thumb */}
      </div>

      {/* Rows */}
      {expenses.map((expense) => {
        const isFlagged = !!expense.flagComment;
        const isExpanded = expandedId === expense.id;

        return (
          <div key={expense.id}>
            {/* Collapsed row */}
            <button
              onClick={() => toggleExpand(expense.id)}
              className={cn(
                "w-full grid grid-cols-[32px_80px_1fr_100px_80px_90px_60px] gap-2 px-3 py-2 items-center",
                "border-b border-border transition-colors text-left",
                isFlagged
                  ? "border-l-2 border-l-[#C4A868] bg-[rgba(196,168,104,0.04)]"
                  : "hover:bg-[rgba(255,255,255,0.02)]"
              )}
            >
              {/* Chevron */}
              <span className="text-text-disabled">
                {isExpanded ? (
                  <ChevronDown className="w-[14px] h-[14px]" />
                ) : (
                  <ChevronRight className="w-[14px] h-[14px]" />
                )}
              </span>

              {/* Date */}
              <span className="font-kosugi text-caption-sm text-text-secondary">
                {formatDate(expense.expenseDate)}
              </span>

              {/* Merchant */}
              <span className="font-mohave text-body-sm text-text-primary truncate">
                {expense.merchantName || "—"}
              </span>

              {/* Category */}
              <span className="font-kosugi text-caption-sm text-text-tertiary truncate">
                {expense.categoryName || "—"}
              </span>

              {/* Amount */}
              <span className="font-mono text-data-sm text-text-primary text-right">
                {formatCurrency(expense.amount)}
              </span>

              {/* Status */}
              <span>
                {isFlagged ? (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[rgba(196,168,104,0.15)] text-[#C4A868] font-kosugi text-[10px] uppercase tracking-wider">
                    <Flag className="w-[8px] h-[8px]" />
                    FLAGGED
                  </span>
                ) : expense.status === "approved" ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[rgba(157,181,130,0.15)] text-[#9DB582] font-kosugi text-[10px] uppercase tracking-wider">
                    APPROVED
                  </span>
                ) : expense.status === "rejected" ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[rgba(147,50,26,0.15)] text-[#93321A] font-kosugi text-[10px] uppercase tracking-wider">
                    REJECTED
                  </span>
                ) : null}
              </span>

              {/* Receipt thumbnail */}
              <span className="flex justify-end">
                {expense.receiptThumbnailUrl || expense.receiptImageUrl ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReceiptClick(
                        expense.receiptImageUrl || expense.receiptThumbnailUrl!
                      );
                    }}
                    className="w-[32px] h-[32px] rounded overflow-hidden border border-border hover:border-[rgba(255,255,255,0.25)] transition-colors"
                  >
                    <img
                      src={expense.receiptThumbnailUrl || expense.receiptImageUrl!}
                      alt="Receipt"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ) : (
                  <span className="w-[32px] h-[32px] rounded border border-border flex items-center justify-center">
                    <ImageIcon className="w-[12px] h-[12px] text-text-disabled" />
                  </span>
                )}
              </span>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="bg-[rgba(255,255,255,0.02)] border-b border-border px-3 py-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                  {/* Category */}
                  <div>
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
                      CATEGORY
                    </span>
                    <span className="font-kosugi text-caption-sm text-text-secondary">
                      {expense.categoryName || "—"}
                    </span>
                  </div>

                  {/* Project */}
                  <div>
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
                      PROJECT
                    </span>
                    <span className="font-kosugi text-caption-sm text-text-secondary">
                      {expense.projectId || "—"}
                    </span>
                  </div>

                  {/* Payment Method */}
                  <div>
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
                      PAYMENT METHOD
                    </span>
                    <span className="font-kosugi text-caption-sm text-text-secondary">
                      {expense.paymentMethod || "—"}
                    </span>
                  </div>

                  {/* Tax */}
                  <div>
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
                      TAX
                    </span>
                    <span className="font-mono text-data-sm text-text-secondary">
                      {expense.taxAmount != null
                        ? formatCurrency(expense.taxAmount)
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                {expense.description && (
                  <div className="mb-3">
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block">
                      NOTES
                    </span>
                    <span className="font-kosugi text-caption-sm text-text-tertiary">
                      {expense.description}
                    </span>
                  </div>
                )}

                {/* Receipt image (larger) */}
                {(expense.receiptImageUrl || expense.receiptThumbnailUrl) && (
                  <div className="mb-3">
                    <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider block mb-1">
                      RECEIPT
                    </span>
                    <button
                      onClick={() =>
                        onReceiptClick(
                          expense.receiptImageUrl || expense.receiptThumbnailUrl!
                        )
                      }
                      className="w-[120px] h-[80px] rounded border border-border hover:border-[rgba(255,255,255,0.25)] transition-colors overflow-hidden"
                    >
                      <img
                        src={expense.receiptThumbnailUrl || expense.receiptImageUrl!}
                        alt="Receipt"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  </div>
                )}

                {/* Flag section */}
                {canReview && (
                  <div className="pt-2 border-t border-border">
                    {isFlagged ? (
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2">
                          <Flag className="w-[12px] h-[12px] text-[#C4A868] mt-0.5 shrink-0" />
                          <span className="font-kosugi text-caption-sm text-[#C4A868]">
                            {expense.flagComment}
                          </span>
                        </div>
                        <button
                          onClick={() => onUnflag(expense.id)}
                          className="flex items-center gap-1 font-kosugi text-[10px] text-text-tertiary hover:text-text-secondary uppercase tracking-wider transition-colors"
                        >
                          <FlagOff className="w-[10px] h-[10px]" />
                          UNFLAG
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <textarea
                          value={flagInput[expense.id] ?? ""}
                          onChange={(e) =>
                            setFlagInput((prev) => ({
                              ...prev,
                              [expense.id]: e.target.value,
                            }))
                          }
                          placeholder="Flag comment (required)"
                          rows={2}
                          className="w-full bg-[rgba(255,255,255,0.04)] border border-border rounded p-2 font-kosugi text-caption-sm text-text-secondary placeholder:text-text-disabled resize-none focus:outline-none focus:border-[rgba(255,255,255,0.20)]"
                        />
                        <button
                          onClick={() => handleFlag(expense.id)}
                          disabled={!flagInput[expense.id]?.trim()}
                          className={cn(
                            "flex items-center gap-1 font-kosugi text-[10px] uppercase tracking-wider transition-colors",
                            flagInput[expense.id]?.trim()
                              ? "text-[#C4A868] hover:text-[#d4b878]"
                              : "text-text-disabled cursor-not-allowed"
                          )}
                        >
                          <Flag className="w-[10px] h-[10px]" />
                          FLAG THIS EXPENSE
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

      {/* Empty state */}
      {expenses.length === 0 && (
        <div className="px-3 py-8">
          <p className="font-kosugi text-caption-sm text-text-disabled">
            No expenses in this invoice
          </p>
        </div>
      )}
    </div>
  );
}
