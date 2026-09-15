import { describe, expect, it, vi } from "vitest";
import {
  ExpenseBatchStatus,
  batchOwedAmount,
  isBatchAwaitingPayout,
  isBatchPaid,
  type ExpenseBatch,
  type ExpenseLineItem,
} from "@/lib/types/expense-approval";
import { bucketForBatch, groupPaidByMonth } from "@/lib/utils/expense-buckets";
import { computeExpenseMetrics } from "@/lib/utils/expense-metrics";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/helpers", () => ({ requireSupabase: () => ({ from }) }));
import { ExpenseApprovalService } from "@/lib/api/services/expense-approval-service";

function batch(overrides: Partial<ExpenseBatch> = {}): ExpenseBatch {
  return {
    id: "batch-a", companyId: "company-a", batchNumber: "EXP-001",
    periodStart: "2026-07-01", periodEnd: "2026-07-07",
    status: ExpenseBatchStatus.Approved, submittedBy: null,
    reviewedBy: "reviewer-a", reviewedAt: "2026-07-08T12:00:00Z",
    totalAmount: 145, approvedAmount: 145, reimbursementAmount: 105,
    parentBatchId: null, amendmentNumber: 0, reviewNotes: null,
    paidAt: null, paidBy: null, createdAt: "2026-07-02T12:00:00Z",
    ...overrides,
  };
}

describe("server reimbursement amount", () => {
  it.each([ExpenseBatchStatus.Approved, ExpenseBatchStatus.AutoApproved, ExpenseBatchStatus.PartiallyApproved])(
    "uses gross crew money instead of the whole %s envelope", (status) => {
      const row = batch({ status });
      expect(batchOwedAmount(row)).toBe(105);
      expect(isBatchAwaitingPayout(row)).toBe(true);
      expect(bucketForBatch(row)).toBe("pay");
      const paid = { ...row, paidAt: "2026-07-09T12:00:00Z" };
      expect(batchOwedAmount(paid)).toBe(105);
      expect(bucketForBatch(paid)).toBe("paid");
    },
  );

  it.each([null, "2026-07-09T12:00:00Z"])(
    "keeps zero reimbursement discoverable without payout actions, paidAt=%s", (paidAt) => {
      const row = batch({ reimbursementAmount: 0, paidAt });
      expect(batchOwedAmount(row)).toBe(0);
      expect(isBatchAwaitingPayout(row)).toBe(false);
      expect(isBatchPaid(row)).toBe(false);
      expect(bucketForBatch(row)).toBe("paid");
      expect(groupPaidByMonth([row])).toEqual([{ key: "2026-07", batches: [row], total: 145 }]);
      const metrics = computeExpenseMetrics([row], [], new Date(2026, 6, 10));
      expect([metrics.payTotal, metrics.payCount, metrics.payPeople, metrics.paidMtdTotal, metrics.paidMtdCount]).toEqual([0, 0, 0, 0, 0]);
    },
  );

  it("preserves legacy null/missing fallbacks, including the partial approval zero", () => {
    expect(batchOwedAmount(batch({ reimbursementAmount: null, approvedAmount: 0 }))).toBe(145);
    expect(batchOwedAmount(batch({ reimbursementAmount: undefined, approvedAmount: null }))).toBe(145);
    expect(batchOwedAmount(batch({ reimbursementAmount: null, approvedAmount: 60 }))).toBe(60);
    expect(batchOwedAmount(batch({ status: ExpenseBatchStatus.PartiallyApproved, reimbursementAmount: null, approvedAmount: 0 }))).toBe(0);
    expect(isBatchAwaitingPayout(batch({ reimbursementAmount: null, approvedAmount: 0 }))).toBe(true);
    expect(isBatchPaid(batch({ reimbursementAmount: null, paidAt: "2026-07-09T12:00:00Z" }))).toBe(true);
  });

  it("leaves pending review and filling batches in their original queues", () => {
    expect(bucketForBatch(batch({ status: ExpenseBatchStatus.PendingReview, reimbursementAmount: 0 }))).toBe("review");
    expect(bucketForBatch(batch({ status: ExpenseBatchStatus.Open, reimbursementAmount: 0 }))).toBe("crew");
  });

  it("files company-funded history by approval date and crew payments by payout date", () => {
    const company = batch({ reimbursementAmount: 0, reviewedAt: "2026-06-30T12:00:00Z", paidAt: "2026-07-09T12:00:00Z" });
    const crew = batch({ id: "crew", paidAt: "2026-07-09T12:00:00Z" });
    expect(groupPaidByMonth([company, crew])).toEqual([
      { key: "2026-07", batches: [crew], total: 105 },
      { key: "2026-06", batches: [company], total: 145 },
    ]);
  });

  it("does not add tax to gross spend or the server reimbursement principal", () => {
    const lines = [
      { amount: 105, taxAmount: 5, status: "approved", paymentMethod: "personal_card", expenseDate: "2026-07-02", projectId: null },
      { amount: 40, taxAmount: 2, status: "approved", paymentMethod: "company_card", expenseDate: "2026-07-02", projectId: null },
    ] as ExpenseLineItem[];
    const unpaid = computeExpenseMetrics([batch()], lines, new Date(2026, 6, 10));
    expect(unpaid.spendMtd).toBe(145);
    expect(unpaid.payTotal).toBe(105);
    const paid = computeExpenseMetrics([batch({ paidAt: "2026-07-09T12:00:00Z" })], lines, new Date(2026, 6, 10));
    expect(paid.paidMtdTotal).toBe(105);
    expect(paid.payTotal).toBe(0);
  });

  it.each([[105, 105], ["105.00", 105], [0, 0], ["0.00", 0], [null, null], [undefined, null]] as const)(
    "maps the nullable database value %s through the actual batch service", async (reimbursement, expected) => {
      const row = {
        id: "batch-a", company_id: "company-a", batch_number: "EXP-001",
        period_start: "2026-07-01", period_end: "2026-07-07", status: "approved",
        submitted_by: null, reviewed_by: "reviewer-a", reviewed_at: "2026-07-08T12:00:00Z",
        total_amount: 145, approved_amount: 145, reimbursement_amount: reimbursement,
        parent_batch_id: null, amendment_number: 0, review_notes: null,
        paid_at: null, paid_by: null, created_at: "2026-07-02T12:00:00Z",
      };
      const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.order.mockResolvedValue({ data: [row], error: null });
      from.mockReturnValue(query);
      const [mapped] = await ExpenseApprovalService.fetchBatches("company-a");
      expect(mapped.reimbursementAmount).toBe(expected);
      expect(batchOwedAmount(mapped)).toBe(expected ?? 145);
      expect(query.eq).toHaveBeenCalledWith("company_id", "company-a");
    },
  );
});
