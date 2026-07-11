/**
 * OPS Web - Expense Console Metrics
 *
 * Pure computation for the expense instrument row. Derives everything from the
 * SAME two datasets the console lists (batches + company lines) so the numbers
 * can never disagree with the queue underneath them.
 *
 * Spend counts every line the crew actually submitted (submitted / approved /
 * reimbursed) by expense date — approval state doesn't change what was spent.
 * Rejected lines are disputed and drafts haven't been submitted; both stay out.
 */

import {
  isBatchNeedsReview,
  isBatchAwaitingPayout,
  isBatchPaid,
  batchOwedAmount,
  type ExpenseBatch,
  type ExpenseLineItem,
} from "@/lib/types/expense-approval";
import { monthKey } from "./expense-buckets";

export interface ExpenseMetricsData {
  /** Spend this calendar month (by expense date). */
  spendMtd: number;
  /** Spend last calendar month — the trend base. */
  spendPrevMonth: number;
  /** Month-over-month change in percent; null when last month had no spend. */
  spendTrendPct: number | null;
  /** Monthly spend, oldest → newest, ending with the current month (6 entries). */
  spendByMonth: number[];
  /** This month's spend that is allocated to a job. */
  jobSpendMtd: number;
  /** This month's spend with no job allocation (overhead / shop). */
  overheadSpendMtd: number;

  reviewTotal: number;
  reviewCount: number;
  reviewPeople: number;

  payTotal: number;
  payCount: number;
  payPeople: number;

  paidMtdTotal: number;
  paidMtdCount: number;
}

const SPEND_STATUSES = new Set(["submitted", "approved", "reimbursed"]);
const SPEND_WINDOW_MONTHS = 6;

/** Local-time "YYYY-MM" for a year/month offset from `now`. */
function monthKeyAt(now: Date, monthOffset: number): string {
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function computeExpenseMetrics(
  batches: ExpenseBatch[],
  expenses: ExpenseLineItem[],
  now: Date
): ExpenseMetricsData {
  // ── Spend by month (expense_date is a plain DATE string — slice the month) ──
  const spendByMonthKey = new Map<string, number>();
  let jobSpendMtd = 0;
  let overheadSpendMtd = 0;
  const currentKey = monthKeyAt(now, 0);

  for (const line of expenses) {
    if (!line.status || !SPEND_STATUSES.has(line.status)) continue;
    if (!line.expenseDate) continue;
    const key = line.expenseDate.slice(0, 7);
    spendByMonthKey.set(key, (spendByMonthKey.get(key) ?? 0) + line.amount);
    if (key === currentKey) {
      if (line.projectId) jobSpendMtd += line.amount;
      else overheadSpendMtd += line.amount;
    }
  }

  const spendByMonth: number[] = [];
  for (let offset = -(SPEND_WINDOW_MONTHS - 1); offset <= 0; offset++) {
    spendByMonth.push(spendByMonthKey.get(monthKeyAt(now, offset)) ?? 0);
  }

  const spendMtd = spendByMonth[SPEND_WINDOW_MONTHS - 1];
  const spendPrevMonth = spendByMonth[SPEND_WINDOW_MONTHS - 2];
  const spendTrendPct =
    spendPrevMonth > 0
      ? ((spendMtd - spendPrevMonth) / spendPrevMonth) * 100
      : null;

  // ── Batch buckets ──────────────────────────────────────────────────────────
  let reviewTotal = 0;
  let reviewCount = 0;
  const reviewPeople = new Set<string>();
  let payTotal = 0;
  let payCount = 0;
  const payPeople = new Set<string>();
  let paidMtdTotal = 0;
  let paidMtdCount = 0;

  for (const batch of batches) {
    if (isBatchPaid(batch)) {
      if (batch.paidAt && monthKey(batch.paidAt) === currentKey) {
        paidMtdTotal += batchOwedAmount(batch);
        paidMtdCount += 1;
      }
      continue;
    }
    if (isBatchNeedsReview(batch.status)) {
      reviewTotal += batch.totalAmount ?? 0;
      reviewCount += 1;
      if (batch.submittedBy) reviewPeople.add(batch.submittedBy);
      continue;
    }
    if (isBatchAwaitingPayout(batch)) {
      payTotal += batchOwedAmount(batch);
      payCount += 1;
      if (batch.submittedBy) payPeople.add(batch.submittedBy);
    }
  }

  return {
    spendMtd,
    spendPrevMonth,
    spendTrendPct,
    spendByMonth,
    jobSpendMtd,
    overheadSpendMtd,
    reviewTotal,
    reviewCount,
    reviewPeople: reviewPeople.size,
    payTotal,
    payCount,
    payPeople: payPeople.size,
    paidMtdTotal,
    paidMtdCount,
  };
}
