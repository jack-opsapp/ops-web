/**
 * Expense urgency computation and compliance helpers.
 * Used by expense-review widget, my-expenses widget, and batch popover.
 */

import type { ExpenseBatch, ExpenseLineItem } from "@/lib/types/expense-approval";
import type { ExpenseSettings } from "@/lib/api/services/expense-settings-service";
import { isBatchNeedsReview } from "@/lib/types/expense-approval";

// ── Urgency ─────────────────────────────────────────────────────────

export type BatchUrgency = "fresh" | "due" | "overdue";

const CYCLE_DAYS: Record<ExpenseSettings["reviewFrequency"], number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

/**
 * Compute reviewer urgency for a batch based on review cadence.
 *
 * Timeline from periodEnd:
 *   fresh:   < 1 cycle  (crew still submitting)
 *   due:     1–2 cycles (review window — act now)
 *   overdue: >= 2 cycles (past review window)
 *
 * Returns "fresh" if periodEnd is null or batch doesn't need review.
 */
export function computeBatchUrgency(
  batch: Pick<ExpenseBatch, "periodEnd" | "status">,
  reviewFrequency: ExpenseSettings["reviewFrequency"],
): BatchUrgency {
  if (!isBatchNeedsReview(batch.status)) return "fresh";
  if (!batch.periodEnd) return "fresh";

  const cycleDays = CYCLE_DAYS[reviewFrequency];
  const periodEnd = new Date(batch.periodEnd + "T00:00:00");
  const now = new Date();
  const daysPast = Math.floor((now.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));

  if (daysPast < cycleDays) return "fresh";
  if (daysPast < cycleDays * 2) return "due";
  return "overdue";
}

/**
 * Compute submitter urgency — has the manager missed the review window?
 * Only applicable to pending batches. Returns null for non-pending.
 */
export function computeSubmitterUrgency(
  batch: Pick<ExpenseBatch, "periodEnd" | "status">,
  reviewFrequency: ExpenseSettings["reviewFrequency"],
): "overdue-review" | null {
  if (!isBatchNeedsReview(batch.status)) return null;
  if (!batch.periodEnd) return null;

  const cycleDays = CYCLE_DAYS[reviewFrequency];
  const periodEnd = new Date(batch.periodEnd + "T00:00:00");
  const now = new Date();
  const daysPast = Math.floor((now.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));

  if (daysPast >= cycleDays * 2) return "overdue-review";
  return null;
}

// ── Compliance ──────────────────────────────────────────────────────

export interface BatchCompliance {
  receiptsMissing: number;
  receiptsTotal: number;
  projectsMissing: number;
  projectsTotal: number;
}

/**
 * Compute receipt and project compliance for a batch's expenses.
 */
export function computeBatchCompliance(
  expenses: ExpenseLineItem[],
): BatchCompliance {
  let receiptsMissing = 0;
  let projectsMissing = 0;
  const total = expenses.length;

  for (const e of expenses) {
    if (!e.receiptImageUrl) receiptsMissing++;
    if (!e.projectId) projectsMissing++;
  }

  return {
    receiptsMissing,
    receiptsTotal: total,
    projectsMissing,
    projectsTotal: total,
  };
}

/**
 * Group expenses by batchId and compute compliance for each batch.
 * Returns a Map<batchId, BatchCompliance>.
 */
export function computeAllBatchCompliance(
  allExpenses: ExpenseLineItem[],
): Map<string, BatchCompliance> {
  const byBatch = new Map<string, ExpenseLineItem[]>();
  for (const e of allExpenses) {
    if (!e.batchId) continue;
    const list = byBatch.get(e.batchId) ?? [];
    list.push(e);
    byBatch.set(e.batchId, list);
  }

  const result = new Map<string, BatchCompliance>();
  for (const [batchId, expenses] of byBatch) {
    result.set(batchId, computeBatchCompliance(expenses));
  }
  return result;
}

// ── Display helpers ─────────────────────────────────────────────────

/**
 * Format a batch's period range for display.
 * "2026-04-01" / "2026-04-30" → "APR 1–30, 2026"
 * "2026-03-01" / "2026-03-31" → "MAR 1–31, 2026"
 */
export function formatPeriodRange(
  periodStart: string | null,
  periodEnd: string | null,
): string {
  if (!periodStart) return "—";
  const start = new Date(periodStart + "T00:00:00");
  const end = periodEnd ? new Date(periodEnd + "T00:00:00") : null;

  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = MONTHS[start.getMonth()];
  const year = start.getFullYear();
  const startDay = start.getDate();

  if (!end || start.getMonth() === end.getMonth()) {
    const endDay = end ? end.getDate() : startDay;
    return `${month} ${startDay}–${endDay}, ${year}`;
  }

  const endMonth = MONTHS[end.getMonth()];
  return `${month} ${startDay} – ${endMonth} ${end.getDate()}, ${year}`;
}
