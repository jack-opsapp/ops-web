"use client";

/**
 * Books — EXPENSES segment (P3.1). Mounts the expense review hub
 * (capability inventory A5) — previously reachable only via
 * /accounting?tab=expenses — as a first-class Books segment.
 * Behavior unchanged; only the surrounding chrome is Books'.
 *
 * P6-2: hosts the unified TableShell so the pinned LedgerStrip metrics +
 * segment-control workbar stay fixed while the review dashboard scrolls inside
 * the shell body — identical chrome to every other Books segment.
 */

import { TableShell, Workbar } from "@/components/ui/table-shell";
import { ExpenseReviewDashboard } from "@/components/expenses/expense-review-dashboard";

export function ExpensesSegment({
  metrics,
  segmentControl,
}: {
  /** The shared LedgerStrip node, pinned in this segment's TableShell metrics slot. */
  metrics: React.ReactNode;
  segmentControl: React.ReactNode;
}) {
  return (
    <TableShell
      metrics={metrics}
      toolbar={<Workbar tabStrip={segmentControl} />}
      bottomFade={false}
    >
      {/* The review hub is a document-flow block (its own filters + period summary
          + invoice cards / detail panel) — it scrolls inside the shell body. */}
      <div className="p-3">
        <ExpenseReviewDashboard />
      </div>
    </TableShell>
  );
}
