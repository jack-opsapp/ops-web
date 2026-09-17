/**
 * Dashboard batch popover — recurring reimbursement lines.
 *
 * The popover opens from the expense review widgets. A recurring line is
 * office-filed with no receipt: it shows the neutral repeat mark instead of the
 * tan missing-receipt camera, offers no flag (the database refuses one), and
 * stays out of receipt coverage. Ordinary receipts keep every control.
 */

import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

import type { ExpenseLineItem } from "@/lib/types/expense-approval";

// The popover module wires live data hooks at import time; the row and
// summary under test take everything through props.
vi.mock("@/lib/hooks/use-expense-approval", () => ({
  useExpenseBatches: vi.fn(),
  useBatchExpenses: vi.fn(),
  useApproveBatch: vi.fn(),
  useRejectWithRevisions: vi.fn(),
  useFlagExpense: vi.fn(),
  useUnflagExpense: vi.fn(),
}));
vi.mock("@/lib/hooks/use-expense-settings", () => ({ useExpenseSettings: vi.fn() }));
vi.mock("@/lib/hooks", () => ({ useTeamMembers: vi.fn() }));
vi.mock("@/lib/store/permissions-store", () => ({ usePermissionStore: vi.fn() }));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: vi.fn() }));
vi.mock("@/stores/expense-batch-popover-store", () => ({ useExpenseBatchPopoverStore: vi.fn() }));
vi.mock("@/components/expenses/receipt-lightbox", () => ({ ReceiptLightbox: () => null }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key, dict: {} }),
  useLocale: () => ({ locale: "en" }),
}));

import { ExpenseRow, SummaryTab } from "@/components/ops/expense-batch-popover";

const t = (key: string) => key;

function lineItem(overrides: Partial<ExpenseLineItem> = {}): ExpenseLineItem {
  return {
    id: "receipt-1",
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
    recurringReimbursementId: null,
    recurringPeriod: null,
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

const vehicle = lineItem({
  id: "vehicle-aug",
  status: "approved",
  merchantName: "Vehicle advertising",
  amount: 350,
  expenseDate: "2026-08-01",
  paymentMethod: null,
  receiptMissingReason: "other",
  receiptMissingNote: "Recurring reimbursement. No receipt needed.",
  recurringReimbursementId: "setup-1",
  recurringPeriod: "2026-08-01",
});

function renderRow(expense: ExpenseLineItem) {
  return render(
    <ExpenseRow
      expense={expense}
      canApprove
      isReviewable
      requireReceipt
      flaggingId={null}
      flagComment=""
      onFlagToggle={vi.fn()}
      onFlagCommentChange={vi.fn()}
      onFlagSubmit={vi.fn()}
      onUnflag={vi.fn()}
      onReceiptClick={vi.fn()}
      t={t}
    />
  );
}

describe("ExpenseRow", () => {
  it("marks a recurring line and offers no flag", () => {
    const { container } = renderRow(vehicle);
    expect(screen.getByLabelText("batchPopover.recurring")).toBeInTheDocument();
    expect(screen.queryByTitle("batchPopover.flagExpense")).not.toBeInTheDocument();
    expect(container.querySelector(".border-dashed")).toBeNull();
  });

  it("keeps the missing-receipt camera and the flag on an ordinary receipt", () => {
    const { container } = renderRow(lineItem());
    expect(screen.queryByLabelText("batchPopover.recurring")).not.toBeInTheDocument();
    expect(screen.getByTitle("batchPopover.flagExpense")).toBeInTheDocument();
    expect(container.querySelector(".border-dashed")).not.toBeNull();
  });
});

describe("SummaryTab receipt coverage", () => {
  it("counts only the lines that need a receipt", () => {
    render(
      <SummaryTab
        expenses={[lineItem({ receiptImageUrl: "https://example.com/r.jpg" }), lineItem({ id: "r2" }), vehicle]}
        requireReceipt
        t={t}
      />
    );
    expect(screen.getByText("batchPopover.receiptCoverage")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("shows no coverage when only a recurring reimbursement is in the batch", () => {
    render(<SummaryTab expenses={[vehicle]} requireReceipt t={t} />);
    expect(screen.queryByText("batchPopover.receiptCoverage")).not.toBeInTheDocument();
  });
});
