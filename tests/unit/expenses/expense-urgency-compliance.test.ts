/**
 * Receipt and project compliance for the review widgets and batch popover.
 *
 * A recurring reimbursement line is filed by the office with no receipt and no
 * job, by design. It must never read as a missing receipt: the review widget
 * would otherwise tell the owner "1/8 missing receipts" on a batch whose every
 * real receipt is in.
 */

import { describe, expect, it } from "vitest";
import {
  computeAllBatchCompliance,
  computeBatchCompliance,
  receiptComplianceColor,
} from "@/lib/utils/expense-urgency";
import type { ExpenseLineItem } from "@/lib/types/expense-approval";

let seq = 0;
function line(overrides: Partial<ExpenseLineItem> = {}): ExpenseLineItem {
  seq += 1;
  return {
    id: `line-${seq}`,
    companyId: "co-1",
    submittedBy: "matt",
    batchId: "b-aug",
    status: "submitted",
    categoryId: null,
    merchantName: "Slegg",
    description: null,
    amount: 11.19,
    taxAmount: null,
    currency: "CAD",
    expenseDate: "2026-08-19",
    paymentMethod: "personal_card",
    receiptImageUrl: "https://example.com/receipt.jpg",
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
    recurringReimbursementId: null,
    recurringPeriod: null,
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
    deletedAt: null,
    projectId: "job-1",
    ...overrides,
  };
}

const vehicle = (overrides: Partial<ExpenseLineItem> = {}) =>
  line({
    merchantName: "Vehicle advertising",
    status: "approved",
    amount: 350,
    receiptImageUrl: null,
    receiptMissingReason: "other",
    receiptMissingNote: "Recurring reimbursement. No receipt needed.",
    recurringReimbursementId: "setup-1",
    recurringPeriod: "2026-08-01",
    projectId: null,
    ...overrides,
  });

describe("computeBatchCompliance", () => {
  it("leaves a recurring reimbursement out of the receipt and job counts", () => {
    const compliance = computeBatchCompliance([line(), line(), vehicle()]);
    expect(compliance).toEqual({
      receiptsMissing: 0,
      receiptsTotal: 2,
      projectsMissing: 0,
      projectsTotal: 2,
    });
    expect(receiptComplianceColor(compliance.receiptsMissing, compliance.receiptsTotal)).toBe("success");
  });

  it("still counts a real receipt that is missing", () => {
    const compliance = computeBatchCompliance([
      line({ receiptImageUrl: null, projectId: null }),
      line(),
      vehicle(),
    ]);
    expect(compliance).toEqual({
      receiptsMissing: 1,
      receiptsTotal: 2,
      projectsMissing: 1,
      projectsTotal: 2,
    });
  });

  it("reports nothing to check for a batch that holds only a recurring reimbursement", () => {
    expect(computeBatchCompliance([vehicle()])).toEqual({
      receiptsMissing: 0,
      receiptsTotal: 0,
      projectsMissing: 0,
      projectsTotal: 0,
    });
  });
});

describe("computeAllBatchCompliance", () => {
  it("applies the same rule per batch", () => {
    const map = computeAllBatchCompliance([
      line({ batchId: "b-aug", receiptImageUrl: null }),
      vehicle({ batchId: "b-aug" }),
      vehicle({ batchId: "b-sep", recurringPeriod: "2026-09-01" }),
      line({ batchId: null }),
    ]);
    expect(map.get("b-aug")).toEqual({ receiptsMissing: 1, receiptsTotal: 1, projectsMissing: 0, projectsTotal: 1 });
    expect(map.get("b-sep")).toEqual({ receiptsMissing: 0, receiptsTotal: 0, projectsMissing: 0, projectsTotal: 0 });
    expect(map.size).toBe(2);
  });
});
