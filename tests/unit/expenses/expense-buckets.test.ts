import { describe, it, expect } from "vitest";
import {
  bucketForBatch,
  batchLineStats,
  groupForReview,
  groupForPay,
  groupPaidByMonth,
  sortCrewBatches,
  bucketOfBatch,
} from "@/lib/utils/expense-buckets";
import {
  ExpenseBatchStatus,
  type ExpenseBatch,
  type ExpenseLineItem,
} from "@/lib/types/expense-approval";

// ─── Factories ────────────────────────────────────────────────────────────────

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

// ─── bucketForBatch ───────────────────────────────────────────────────────────

describe("bucketForBatch", () => {
  it("puts pending_review and legacy submitted batches in review", () => {
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.PendingReview }))).toBe("review");
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.Submitted }))).toBe("review");
  });

  it("puts approved, partially approved, and auto-approved unpaid batches in pay", () => {
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.Approved }))).toBe("pay");
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.PartiallyApproved }))).toBe("pay");
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.AutoApproved }))).toBe("pay");
  });

  it("moves any paid-out batch to paid regardless of approved flavor", () => {
    const paidAt = "2026-07-08T12:00:00Z";
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.Approved, paidAt }))).toBe("paid");
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.AutoApproved, paidAt }))).toBe("paid");
  });

  it("puts filling envelopes in crew", () => {
    expect(bucketForBatch(makeBatch({ status: ExpenseBatchStatus.Open }))).toBe("crew");
  });

  it("keeps a rejected batch in crew while lines remain, hides it once drained", () => {
    const rejected = makeBatch({ status: ExpenseBatchStatus.Rejected });
    expect(bucketForBatch(rejected, 2)).toBe("crew");
    expect(bucketForBatch(rejected, 0)).toBeNull();
    // Unknown line count (stats not loaded yet) keeps it visible.
    expect(bucketForBatch(rejected)).toBe("crew");
  });
});

// ─── batchLineStats ───────────────────────────────────────────────────────────

describe("batchLineStats", () => {
  it("counts lines and flags per batch, ignoring unbatched lines", () => {
    const lines = [
      makeLine({ batchId: "b1" }),
      makeLine({ batchId: "b1", flagComment: "receipt unreadable" }),
      makeLine({ batchId: "b2" }),
      makeLine({ batchId: null }),
    ];
    const stats = batchLineStats(lines);
    expect(stats.get("b1")).toEqual({ count: 2, flagged: 1 });
    expect(stats.get("b2")).toEqual({ count: 1, flagged: 0 });
    expect(stats.has("unbatched")).toBe(false);
  });
});

// ─── groupForReview ───────────────────────────────────────────────────────────

describe("groupForReview", () => {
  it("groups by submitter, oldest outstanding period first, oldest batch first within a person", () => {
    const a1 = makeBatch({ submittedBy: "user-a", periodStart: "2026-06-01", totalAmount: 50 });
    const a2 = makeBatch({ submittedBy: "user-a", periodStart: "2026-07-01", totalAmount: 30 });
    const b1 = makeBatch({ submittedBy: "user-b", periodStart: "2026-05-01", totalAmount: 200 });
    const groups = groupForReview([a2, b1, a1]);

    // user-b has the older outstanding period (May) → leads the queue
    expect(groups.map((g) => g.userId)).toEqual(["user-b", "user-a"]);
    expect(groups[1].batches.map((b) => b.periodStart)).toEqual(["2026-06-01", "2026-07-01"]);
    expect(groups[1].total).toBe(80);
    expect(groups[0].total).toBe(200);
  });
});

// ─── groupForPay ──────────────────────────────────────────────────────────────

describe("groupForPay", () => {
  it("orders people by owed total descending and uses approved amounts when present", () => {
    const a = makeBatch({
      submittedBy: "user-a",
      status: ExpenseBatchStatus.PartiallyApproved,
      totalAmount: 500,
      approvedAmount: 120,
    });
    const b = makeBatch({
      submittedBy: "user-b",
      status: ExpenseBatchStatus.Approved,
      totalAmount: 300,
      approvedAmount: null,
    });
    const groups = groupForPay([a, b]);
    expect(groups.map((g) => g.userId)).toEqual(["user-b", "user-a"]);
    expect(groups[0].total).toBe(300); // falls back to totalAmount
    expect(groups[1].total).toBe(120); // approvedAmount wins
  });
});

// ─── groupPaidByMonth ─────────────────────────────────────────────────────────

describe("groupPaidByMonth", () => {
  it("buckets by paid month, newest month and newest payout first", () => {
    const june = makeBatch({ paidAt: "2026-06-15T10:00:00Z", approvedAmount: 40 });
    const julyEarly = makeBatch({ paidAt: "2026-07-02T10:00:00Z", approvedAmount: 10 });
    const julyLate = makeBatch({ paidAt: "2026-07-08T10:00:00Z", approvedAmount: 20 });
    const groups = groupPaidByMonth([june, julyEarly, julyLate]);

    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06"]);
    expect(groups[0].batches.map((b) => b.paidAt)).toEqual([
      "2026-07-08T10:00:00Z",
      "2026-07-02T10:00:00Z",
    ]);
    expect(groups[0].total).toBe(30);
    expect(groups[1].total).toBe(40);
  });
});

// ─── sortCrewBatches ──────────────────────────────────────────────────────────

describe("sortCrewBatches", () => {
  it("lists filling envelopes (newest period first) before returned batches", () => {
    const filling = makeBatch({ status: ExpenseBatchStatus.Open, periodStart: "2026-07-01" });
    const fillingOlder = makeBatch({ status: ExpenseBatchStatus.Open, periodStart: "2026-06-01" });
    const returned = makeBatch({ status: ExpenseBatchStatus.Rejected, createdAt: "2026-07-05T00:00:00Z" });
    const sorted = sortCrewBatches([returned, fillingOlder, filling]);
    expect(sorted.map((b) => b.id)).toEqual([filling.id, fillingOlder.id, returned.id]);
  });
});

// ─── bucketOfBatch (deep link) ────────────────────────────────────────────────

describe("bucketOfBatch", () => {
  it("resolves the visible bucket for a deep-linked batch", () => {
    const paid = makeBatch({ status: ExpenseBatchStatus.Approved, paidAt: "2026-07-01T00:00:00Z" });
    expect(bucketOfBatch(paid)).toBe("paid");
    const drained = makeBatch({ status: ExpenseBatchStatus.Rejected });
    expect(bucketOfBatch(drained, 0)).toBeNull();
  });
});
