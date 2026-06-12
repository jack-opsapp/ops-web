"use client";

/**
 * Books — EXPENSES segment (P3.1). Mounts the expense review hub
 * (capability inventory A5) — previously reachable only via
 * /accounting?tab=expenses — as a first-class Books segment.
 * Behavior unchanged; only the surrounding chrome is Books'.
 */

import { ExpenseReviewDashboard } from "@/components/expenses/expense-review-dashboard";

export function ExpensesSegment({ segmentControl }: { segmentControl: React.ReactNode }) {
  return (
    <div className="space-y-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-2">{segmentControl}</div>
      <ExpenseReviewDashboard />
    </div>
  );
}
