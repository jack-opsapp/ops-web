"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { FileText } from "lucide-react";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { ExpenseBatch } from "@/lib/types/expense-approval";
import {
  ExpenseBatchStatus,
  isBatchNeedsReview,
} from "@/lib/types/expense-approval";
import { RegisterEmpty } from "@/components/ui/register-table";
import { InvoiceCard } from "./invoice-card";
import { InvoiceDetailPanel } from "./invoice-detail-panel";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExpenseReviewDashboardProps {
  /** Batches for the active period. Period state (chips + count) lives up in
   *  ExpensesSegment so it can pin in the Workbar Row 1 alongside the tab strip. */
  periodBatches: ExpenseBatch[];
  /** The active period key — selection clears when it changes. */
  effectivePeriod: string;
  /** Query loading state, owned by the segment. */
  isLoading: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpenseReviewDashboard({
  periodBatches,
  effectivePeriod,
  isLoading,
}: ExpenseReviewDashboardProps) {
  const can = usePermissionStore((s) => s.can);
  const canReview = can("expenses.approve");

  // Selection — cleared whenever the active period changes.
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedBatchId(null);
  }, [effectivePeriod]);

  // Split into review vs history
  const reviewBatches = useMemo(
    () => periodBatches.filter((b) => isBatchNeedsReview(b.status)),
    [periodBatches]
  );
  const autoApprovedBatches = useMemo(
    () =>
      periodBatches.filter(
        (b) => b.status === ExpenseBatchStatus.AutoApproved
      ),
    [periodBatches]
  );
  const approvedBatches = useMemo(
    () =>
      periodBatches.filter(
        (b) =>
          b.status === ExpenseBatchStatus.Approved ||
          b.status === ExpenseBatchStatus.PartiallyApproved
      ),
    [periodBatches]
  );
  const rejectedBatches = useMemo(
    () =>
      periodBatches.filter(
        (b) => b.status === ExpenseBatchStatus.Rejected
      ),
    [periodBatches]
  );

  // Keyboard-nav list — arrow-key order mirrors the visual order (review
  // sections above history), so ↑/↓ walk straight across section boundaries.
  const displayBatches = [
    ...reviewBatches,
    ...autoApprovedBatches,
    ...approvedBatches,
    ...rejectedBatches,
  ];

  // Selected batch object — always within the active period.
  const selectedBatch =
    periodBatches.find((b) => b.id === selectedBatchId) ?? null;

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedBatchId(null);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (displayBatches.length === 0) return;
        const currentIndex = selectedBatchId
          ? displayBatches.findIndex((b) => b.id === selectedBatchId)
          : -1;
        let nextIndex: number;
        if (e.key === "ArrowDown") {
          nextIndex =
            currentIndex < displayBatches.length - 1 ? currentIndex + 1 : 0;
        } else {
          nextIndex =
            currentIndex > 0 ? currentIndex - 1 : displayBatches.length - 1;
        }
        setSelectedBatchId(displayBatches[nextIndex].id);
        return;
      }
    },
    [displayBatches, selectedBatchId]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="space-y-3">
      {/* Loading */}
      {isLoading && (
        <div className="animate-pulse space-y-[2px] motion-reduce:animate-none">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-surface h-[48px]" />
          ))}
        </div>
      )}

      {/* Split panel layout */}
      {!isLoading && (
        <div className="lg:grid lg:grid-cols-[380px_1fr] lg:gap-0 lg:border lg:border-border lg:rounded lg:overflow-hidden">
          {/* Left panel — invoice list */}
          <div className="lg:border-r lg:border-border lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            {/* One list — review sections above history, all statuses in a
                single scroll (NEED REVIEW → AUTO-APPROVED → APPROVED → REJECTED). */}
            {reviewBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                    {reviewBatches.length} NEED REVIEW
                  </span>
                </div>
                {reviewBatches.map((b) => (
                  <InvoiceCard
                    key={b.id}
                    batch={b}
                    isSelected={selectedBatchId === b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                  />
                ))}
              </div>
            )}

            {autoApprovedBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                    {autoApprovedBatches.length} AUTO-APPROVED
                  </span>
                </div>
                {autoApprovedBatches.map((b) => (
                  <InvoiceCard
                    key={b.id}
                    batch={b}
                    isSelected={selectedBatchId === b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                  />
                ))}
              </div>
            )}

            {approvedBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                    APPROVED
                  </span>
                </div>
                {approvedBatches.map((b) => (
                  <InvoiceCard
                    key={b.id}
                    batch={b}
                    isSelected={selectedBatchId === b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                  />
                ))}
              </div>
            )}

            {rejectedBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                    REJECTED
                  </span>
                </div>
                {rejectedBatches.map((b) => (
                  <InvoiceCard
                    key={b.id}
                    batch={b}
                    isSelected={selectedBatchId === b.id}
                    onClick={() => setSelectedBatchId(b.id)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {displayBatches.length === 0 && !isLoading && (
              <RegisterEmpty noun="Expense invoices" />
            )}
          </div>

          {/* Right panel — invoice detail */}
          <div className="hidden lg:block lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            {selectedBatch ? (
              <InvoiceDetailPanel
                batch={selectedBatch}
                canReview={canReview}
              />
            ) : (
              <div className="flex flex-col items-start justify-center h-full px-6 py-12 gap-2">
                <FileText className="w-[24px] h-[24px] text-text-mute" />
                <p className="font-mono text-caption-sm text-text-mute">
                  Select an invoice to review
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile: show detail below on small screens */}
      {selectedBatch && (
        <div className="lg:hidden border border-border rounded overflow-hidden">
          <InvoiceDetailPanel
            batch={selectedBatch}
            canReview={canReview}
          />
        </div>
      )}
    </div>
  );
}
