/**
 * BatchLineTable — recurring reimbursement lines.
 *
 * A recurring line is office-owned: it shows a neutral repeat mark (never the
 * tan missing-receipt alarm), its record describes the arrangement, and its
 * verbs are EDIT (the setup) and SKIP (this unpaid month). Flagging and CLEAR
 * never appear on it; ordinary receipts keep every existing control.
 */

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

import type { ExpenseLineItem, ExpenseRecurringReimbursement } from "@/lib/types/expense-approval";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params === "object" ? `${key} ${JSON.stringify(params)}` : key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/i18n/date-utils", () => ({ getDateLocale: () => "en-US" }));

import { BatchLineTable } from "@/components/expenses/batch-line-table";

function lineItem(overrides: Partial<ExpenseLineItem> = {}): ExpenseLineItem {
  return {
    id: "receipt-1",
    companyId: "co-1",
    submittedBy: "matt",
    batchId: "b-aug",
    status: "submitted",
    categoryId: null,
    merchantName: "Slegg",
    description: "Roller sleeves",
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

const recurringLine = lineItem({
  id: "vehicle-aug",
  status: "approved",
  merchantName: "Vehicle advertising",
  description: "Monthly · August 2026",
  amount: 350,
  expenseDate: "2026-08-01",
  paymentMethod: null,
  receiptMissingReason: "other",
  receiptMissingNote: "Recurring reimbursement. No receipt needed.",
  recurringReimbursementId: "setup-1",
  recurringPeriod: "2026-08-01",
});

const setup: ExpenseRecurringReimbursement = {
  id: "setup-1",
  companyId: "co-1",
  userId: "matt",
  name: "Vehicle advertising",
  amount: 350,
  currency: "CAD",
  categoryId: null,
  firstPeriod: "2026-08-01",
  lastPeriod: null,
  nextPeriod: "2026-10-01",
  createdBy: "jackson",
  updatedBy: "jackson",
  createdAt: "2026-09-17T02:41:12Z",
  updatedAt: "2026-09-17T02:41:12Z",
  deletedAt: null,
  lines: [],
};

const onEditRecurring = vi.fn();
const onSkipRecurring = vi.fn();

function renderTable(expenses: ExpenseLineItem[], overrides: Partial<React.ComponentProps<typeof BatchLineTable>> = {}) {
  return render(
    <BatchLineTable
      expenses={expenses}
      onFlag={vi.fn()}
      onUnflag={vi.fn()}
      onEarlyClear={vi.fn()}
      onReceiptClick={vi.fn()}
      canReview
      canEarlyClear
      isClearing={false}
      recurringById={new Map([["setup-1", setup]])}
      canEditRecurring
      canSkipRecurring
      onEditRecurring={onEditRecurring}
      onSkipRecurring={onSkipRecurring}
      {...overrides}
    />
  );
}

beforeEach(() => {
  onEditRecurring.mockReset();
  onSkipRecurring.mockReset();
});

describe("recurring line", () => {
  it("marks the row as recurring instead of raising a missing-receipt alarm", () => {
    renderTable([recurringLine]);
    expect(screen.getByLabelText("expenses.recurring.tag")).toBeInTheDocument();
    expect(screen.queryByTitle(/expenses\.line\.noReceiptReason/)).not.toBeInTheDocument();
  });

  it("opens to the arrangement with EDIT and SKIP, and no flag or CLEAR", () => {
    renderTable([recurringLine]);
    fireEvent.click(screen.getByText("Vehicle advertising"));

    expect(screen.getByText(/expenses\.recurring\.every .*"amount":"\$350\.00".*"since":"AUG 2026"/)).toBeInTheDocument();
    expect(screen.getByText(/expenses\.recurring\.covers .*"month":"AUG 2026"/)).toBeInTheDocument();
    expect(screen.queryByText("expenses.line.noReceipt")).not.toBeInTheDocument();
    expect(screen.queryByText("expenses.line.flagThis")).not.toBeInTheDocument();
    expect(screen.queryByText("expenses.line.clear")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.edit" }));
    expect(onEditRecurring).toHaveBeenCalledWith(setup);

    fireEvent.click(screen.getByRole("button", { name: /expenses\.recurring\.skip/ }));
    expect(onSkipRecurring).toHaveBeenCalledWith(recurringLine);
  });

  it("shows the end month when the arrangement has one", () => {
    renderTable([recurringLine], {
      recurringById: new Map([["setup-1", { ...setup, lastPeriod: "2026-12-01" }]]),
    });
    fireEvent.click(screen.getByText("Vehicle advertising"));
    expect(screen.getByText(/expenses\.recurring\.everyUntil .*"until":"DEC 2026"/)).toBeInTheDocument();
  });

  it("never offers SKIP on a paid month or a paid batch", () => {
    const { unmount } = renderTable([{ ...recurringLine, status: "reimbursed" }]);
    fireEvent.click(screen.getByText("Vehicle advertising"));
    expect(screen.queryByRole("button", { name: /expenses\.recurring\.skip/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "expenses.recurring.edit" })).toBeInTheDocument();
    unmount();

    renderTable([recurringLine], { canSkipRecurring: false });
    fireEvent.click(screen.getByText("Vehicle advertising"));
    expect(screen.queryByRole("button", { name: /expenses\.recurring\.skip/ })).not.toBeInTheDocument();
  });
});

describe("ordinary receipts are unchanged", () => {
  it("keeps flagging and CLEAR on a submitted receipt", () => {
    renderTable([lineItem()]);
    fireEvent.click(screen.getByText("Slegg"));
    expect(screen.getByText("expenses.line.flagThis")).toBeInTheDocument();
    expect(screen.getByText("expenses.line.clear")).toBeInTheDocument();
    expect(screen.queryByLabelText("expenses.recurring.tag")).not.toBeInTheDocument();
  });
});
