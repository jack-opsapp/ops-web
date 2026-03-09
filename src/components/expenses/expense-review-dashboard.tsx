"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useExpenseBatches } from "@/lib/hooks";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { ExpenseBatch } from "@/lib/types/expense-approval";
import {
  ExpenseBatchStatus,
  isBatchNeedsReview,
  isBatchApproved,
  periodKeyFromBatch,
  formatPeriodDisplay,
} from "@/lib/types/expense-approval";
import { formatCurrency } from "@/lib/types/pipeline";
import { ExpenseFilters, type ExpenseFilterTab } from "./expense-filters";
import { InvoiceCard } from "./invoice-card";
import { InvoiceDetailPanel } from "./invoice-detail-panel";

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpenseReviewDashboard() {
  const { data: batches = [], isLoading } = useExpenseBatches();
  const can = usePermissionStore((s) => s.can);
  const canReview = can("expenses.approve");

  // State
  const [activeTab, setActiveTab] = useState<ExpenseFilterTab>("review");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<string>("");

  // Derive period list from all batches (deduplicated, sorted descending)
  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const b of batches) {
      const key = periodKeyFromBatch(b);
      if (key && key !== "unknown") keys.add(key);
    }
    return [...keys].sort().reverse();
  }, [batches]);

  // Auto-select latest period if none selected
  const effectivePeriod = activePeriod || periods[0] || "";

  // Filter batches by period
  const periodBatches = useMemo(
    () =>
      batches.filter((b) => {
        const key = periodKeyFromBatch(b);
        return key === effectivePeriod;
      }),
    [batches, effectivePeriod]
  );

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

  // Which batches to display based on active tab
  const displayBatches =
    activeTab === "review"
      ? [...reviewBatches, ...autoApprovedBatches]
      : [...approvedBatches, ...rejectedBatches];

  // Total for the period
  const periodTotal = periodBatches.reduce(
    (sum, b) => sum + (b.totalAmount ?? 0),
    0
  );

  // Selected batch object
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) ?? null;

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
      {/* Filters */}
      <ExpenseFilters
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedBatchId(null);
        }}
        periods={periods}
        activePeriod={effectivePeriod}
        onPeriodChange={(p) => {
          setActivePeriod(p);
          setSelectedBatchId(null);
        }}
        reviewCount={reviewBatches.length}
      />

      {/* Period summary */}
      {effectivePeriod && (
        <div className="flex items-baseline gap-3">
          <span className="font-mohave text-body text-text-primary uppercase">
            {formatPeriodDisplay(effectivePeriod)}
          </span>
          <span className="font-mono text-data text-text-secondary">
            {formatCurrency(periodTotal)}
          </span>
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            {periodBatches.length} INVOICE{periodBatches.length !== 1 ? "S" : ""}
          </span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-[20px] h-[20px] text-text-disabled animate-spin" />
        </div>
      )}

      {/* Split panel layout */}
      {!isLoading && (
        <div className="lg:grid lg:grid-cols-[380px_1fr] lg:gap-0 lg:border lg:border-border lg:rounded lg:overflow-hidden">
          {/* Left panel — invoice list */}
          <div className="lg:border-r lg:border-border lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            {activeTab === "review" && reviewBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
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

            {activeTab === "review" && autoApprovedBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
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

            {activeTab === "history" && approvedBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
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

            {activeTab === "history" && rejectedBatches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
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
              <div className="px-3 py-12 flex flex-col items-start gap-2">
                <FileText className="w-[24px] h-[24px] text-text-disabled" />
                <p className="font-kosugi text-caption-sm text-text-disabled">
                  No expense invoices for this period
                </p>
              </div>
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
                <FileText className="w-[24px] h-[24px] text-text-disabled" />
                <p className="font-kosugi text-caption-sm text-text-disabled">
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
