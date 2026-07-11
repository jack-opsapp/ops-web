import { describe, it, expect } from "vitest";
import { computeExpenseMetrics } from "@/lib/utils/expense-metrics";
import {
  ExpenseBatchStatus,
  type ExpenseBatch,
  type ExpenseLineItem,
} from "@/lib/types/expense-approval";

// Fixed "today" for determinism: July 10, 2026 (local).
const NOW = new Date(2026, 6, 10, 12, 0, 0);

let seq = 0;
function makeBatch(overrides: Partial<ExpenseBatch> = {}): ExpenseBatch {
  seq += 1;
  return {
    id: `batch-${seq}`,
    companyId: "co-1",
    batchNumber: `EXP-BATCH-${String(seq).padStart(4, "0")}`,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-07",
    status: ExpenseBatchStatus.PendingReview,
    submittedBy: "user-a",
    reviewedBy: null,
    reviewedAt: null,
    totalAmount: 100,
    approvedAmount: null,
    parentBatchId: null,
    amendmentNumber: 0,
    reviewNotes: null,
    paidAt: null,
    paidBy: null,
    createdAt: "2026-07-01T10:00:00Z",
    ...overrides,
  };
}

function makeLine(overrides: Partial<ExpenseLineItem> = {}): ExpenseLineItem {
  seq += 1;
  return {
    id: `exp-${seq}`,
    companyId: "co-1",
    submittedBy: "user-a",
    batchId: "batch-1",
    status: "submitted",
    categoryId: null,
    merchantName: null,
    description: null,
    amount: 25,
    taxAmount: null,
    currency: "USD",
    expenseDate: "2026-07-02",
    paymentMethod: null,
    receiptImageUrl: null,
    receiptThumbnailUrl: null,
    receiptMissingReason: null,
    receiptMissingNote: null,
    projectMissingReason: null,
    projectMissingNote: null,
    ocrRawData: null,
    ocrConfidence: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    accountingSyncStatus: null,
    accountingSyncId: null,
    accountingSyncedAt: null,
    flagComment: null,
    flaggedBy: null,
    flaggedAt: null,
    createdAt: "2026-07-02T10:00:00Z",
    updatedAt: "2026-07-02T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("computeExpenseMetrics", () => {
  it("sums month-to-date spend from submitted/approved/reimbursed lines only", () => {
    const lines = [
      makeLine({ amount: 100, expenseDate: "2026-07-03", status: "submitted" }),
      makeLine({ amount: 50, expenseDate: "2026-07-05", status: "approved" }),
      makeLine({ amount: 25, expenseDate: "2026-07-06", status: "reimbursed" }),
      makeLine({ amount: 999, expenseDate: "2026-07-04", status: "rejected" }),
      makeLine({ amount: 500, expenseDate: "2026-07-04", status: "draft" }),
      makeLine({ amount: 77, expenseDate: "2026-06-20", status: "approved" }),
    ];
    const m = computeExpenseMetrics([], lines, NOW);
    expect(m.spendMtd).toBe(175);
    expect(m.spendPrevMonth).toBe(77);
  });

  it("computes the month-over-month trend and 6-month series oldest to newest", () => {
    const lines = [
      makeLine({ amount: 200, expenseDate: "2026-07-01" }),
      makeLine({ amount: 100, expenseDate: "2026-06-15" }),
      makeLine({ amount: 400, expenseDate: "2026-02-10" }),
      // Older than the 6-month window (Feb–Jul) — excluded from the series.
      makeLine({ amount: 999, expenseDate: "2026-01-10" }),
    ];
    const m = computeExpenseMetrics([], lines, NOW);
    expect(m.spendByMonth).toEqual([400, 0, 0, 0, 100, 200]);
    expect(m.spendTrendPct).toBe(100); // 200 vs 100
  });

  it("returns a null trend when the previous month had no spend", () => {
    const lines = [makeLine({ amount: 10, expenseDate: "2026-07-02" })];
    const m = computeExpenseMetrics([], lines, NOW);
    expect(m.spendTrendPct).toBeNull();
  });

  it("splits month-to-date spend into job and overhead by project allocation", () => {
    const lines = [
      makeLine({ amount: 60, expenseDate: "2026-07-02", projectId: "proj-1" }),
      makeLine({ amount: 40, expenseDate: "2026-07-03", projectId: null }),
    ];
    const m = computeExpenseMetrics([], lines, NOW);
    expect(m.jobSpendMtd).toBe(60);
    expect(m.overheadSpendMtd).toBe(40);
  });

  it("totals the review queue, payout liability, and month-to-date payouts from batches", () => {
    const batches = [
      makeBatch({ status: ExpenseBatchStatus.PendingReview, totalAmount: 120, submittedBy: "user-a" }),
      makeBatch({ status: ExpenseBatchStatus.Submitted, totalAmount: 80, submittedBy: "user-b" }),
      makeBatch({
        status: ExpenseBatchStatus.PartiallyApproved,
        totalAmount: 300,
        approvedAmount: 250,
        submittedBy: "user-a",
      }),
      makeBatch({
        status: ExpenseBatchStatus.AutoApproved,
        totalAmount: 90,
        submittedBy: "user-c",
      }),
      makeBatch({
        status: ExpenseBatchStatus.Approved,
        totalAmount: 55,
        approvedAmount: 55,
        paidAt: "2026-07-04T10:00:00Z",
        submittedBy: "user-b",
      }),
      // Paid in a previous month — not in the MTD payout figure.
      makeBatch({
        status: ExpenseBatchStatus.Approved,
        totalAmount: 44,
        approvedAmount: 44,
        paidAt: "2026-06-04T10:00:00Z",
        submittedBy: "user-b",
      }),
    ];
    const m = computeExpenseMetrics(batches, [], NOW);
    expect(m.reviewTotal).toBe(200);
    expect(m.reviewCount).toBe(2);
    expect(m.reviewPeople).toBe(2);
    expect(m.payTotal).toBe(340); // 250 + 90
    expect(m.payCount).toBe(2);
    expect(m.payPeople).toBe(2);
    expect(m.paidMtdTotal).toBe(55);
    expect(m.paidMtdCount).toBe(1);
  });
});
