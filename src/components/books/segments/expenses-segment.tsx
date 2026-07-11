"use client";

/**
 * Books — EXPENSES segment (P3.1). Mounts the expense review hub
 * (capability inventory A5) — previously reachable only via
 * /accounting?tab=expenses — as a first-class Books segment.
 *
 * P6-2: hosts the unified TableShell so the pinned LedgerStrip metrics +
 * segment-control workbar stay fixed while the review dashboard scrolls inside
 * the shell body — identical chrome to every other Books segment.
 *
 * WEB POLISH 2026-07-09: period state (month chips + the period count/total)
 * lives HERE so it can pin in the Workbar's Row 1 (filters + meta) — giving the
 * expenses segment a real two-row workbar, so all four Books segments carry the
 * same chrome height and the pinned header no longer jumps on segment switch.
 * The review dashboard is now a pure body: it receives the active period's
 * batches and renders the list + detail only.
 */

import { useMemo, useState } from "react";
import { TableShell, Workbar, WorkbarCount } from "@/components/ui/table-shell";
import { ExpenseFilters } from "@/components/expenses/expense-filters";
import { ExpenseReviewDashboard } from "@/components/expenses/expense-review-dashboard";
import { useExpenseBatches } from "@/lib/hooks";
import { periodKeyFromBatch } from "@/lib/types/expense-approval";
import { formatCurrency } from "@/lib/types/pipeline";

export function ExpensesSegment({
  metrics,
  segmentControl,
}: {
  /** The shared LedgerStrip node, pinned in this segment's TableShell metrics slot. */
  metrics: React.ReactNode;
  segmentControl: React.ReactNode;
}) {
  const { data: batches = [], isLoading } = useExpenseBatches();

  const [activePeriod, setActivePeriod] = useState<string>("");

  // Period keys, deduplicated, oldest→newest — the chip strip runs left→right
  // in this order and docks the newest month at the far right (WEB POLISH).
  const periods = useMemo(() => {
    const keys = new Set<string>();
    for (const b of batches) {
      const key = periodKeyFromBatch(b);
      if (key && key !== "unknown") keys.add(key);
    }
    return [...keys].sort();
  }, [batches]);

  // Default = newest period = the last chip (rightmost).
  const effectivePeriod = activePeriod || periods[periods.length - 1] || "";

  const periodBatches = useMemo(
    () => batches.filter((b) => periodKeyFromBatch(b) === effectivePeriod),
    [batches, effectivePeriod],
  );

  const periodTotal = periodBatches.reduce(
    (sum, b) => sum + (b.totalAmount ?? 0),
    0,
  );

  return (
    <TableShell
      metrics={metrics}
      toolbar={
        <Workbar
          filters={
            <ExpenseFilters
              periods={periods}
              activePeriod={effectivePeriod}
              onPeriodChange={setActivePeriod}
            />
          }
          meta={
            effectivePeriod ? (
              <WorkbarCount>
                {`${periodBatches.length} INVOICE${
                  periodBatches.length !== 1 ? "S" : ""
                } · ${formatCurrency(periodTotal)}`}
              </WorkbarCount>
            ) : undefined
          }
          tabStrip={segmentControl}
        />
      }
      bottomFade={false}
    >
      {/* The review hub is a document-flow block (list + detail panel) — it
          scrolls inside the shell body under the pinned metrics + workbar. */}
      <div className="p-3">
        <ExpenseReviewDashboard
          periodBatches={periodBatches}
          effectivePeriod={effectivePeriod}
          isLoading={isLoading}
        />
      </div>
    </TableShell>
  );
}
