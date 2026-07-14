/**
 * Tests for the reviewable-state footer of `BatchDetailPanel` — the compact
 * floating approve/reject cluster (founder ask, 2026-07-09: "reject/approve too
 * big — small floating buttons, bottom right of the review panel").
 *
 * The seed company's TO REVIEW bucket is empty, so the reviewable footer can't
 * be shown in the live preview. This suite is the sanctioned proof that the
 * reviewable state renders correctly and preserves every handler + disabled /
 * loading state after the full-width bar became a floating puck.
 *
 * Contract under test:
 *  - reviewable + canReview → a floating cluster (`review-action-cluster`) that
 *    is sticky bottom-right, pointer-events-none at the wrapper (click-through
 *    gutter) with a pointer-events-auto puck,
 *  - no flags → a disabled REJECT + an active APPROVE ALL (28px, olive); approve
 *    fires `onApprove`; `busy` disables it,
 *  - flags present → REMOVE ALL FLAGS (clears every flag) + REJECT WITH N (rose)
 *    that opens the reject confirmation modal,
 *  - non-reviewable buckets never render the cluster.
 */

import * as React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

import {
  ExpenseBatchStatus,
  type ExpenseBatch,
  type ExpenseLineItem,
} from "@/lib/types/expense-approval";

// Echo dictionary — `t(key)` returns the key so buttons are findable by name.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key, dict: {} }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/i18n/date-utils", () => ({ getDateLocale: () => "en-US" }));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ currentUser: { id: "user-1" } }),
}));

// Line-item source + review mutations (the network boundary).
const flagMutate = vi.fn();
const unflagMutate = vi.fn();
const earlyClearMutate = vi.fn();
const rejectMutate = vi.fn();
let batchExpenses: ExpenseLineItem[] = [];

vi.mock("@/lib/hooks", () => ({
  useBatchExpenses: () => ({ data: batchExpenses, isLoading: false }),
  useFlagExpense: () => ({ mutate: flagMutate, isPending: false }),
  useUnflagExpense: () => ({ mutate: unflagMutate, isPending: false }),
  useEarlyClearLine: () => ({ mutate: earlyClearMutate, isPending: false }),
  useRejectWithRevisions: () => ({ mutate: rejectMutate, isPending: false }),
}));

// Heavy children — stub to inert markers so this is a footer/state-machine test.
vi.mock("@/components/expenses/batch-line-table", () => ({
  BatchLineTable: () => <div data-testid="batch-line-table" />,
}));
vi.mock("@/components/expenses/receipt-lightbox", () => ({
  ReceiptLightbox: () => <div data-testid="receipt-lightbox" />,
}));
vi.mock("@/components/expenses/reject-confirmation-modal", () => ({
  RejectConfirmationModal: () => <div data-testid="reject-confirmation-modal" />,
}));
vi.mock("@/components/expenses/batch-list", () => ({
  SubmitterAvatar: () => <div data-testid="submitter-avatar" />,
}));

import { BatchDetailPanel } from "@/components/expenses/batch-detail-panel";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<ExpenseBatch> = {}): ExpenseBatch {
  return {
    id: "batch-1",
    companyId: "co-1",
    batchNumber: "EXP-2026-0001",
    periodStart: "2026-02-02",
    periodEnd: "2026-02-08",
    status: ExpenseBatchStatus.Submitted, // reviewable
    submittedBy: "user-crew",
    reviewedBy: null,
    reviewedAt: null,
    totalAmount: 960,
    approvedAmount: null,
    parentBatchId: null,
    amendmentNumber: 0,
    reviewNotes: null,
    paidAt: null,
    paidBy: null,
    createdAt: "2026-02-09T12:00:00.000Z",
    submitter: null,
    ...overrides,
  };
}

function makeLine(overrides: Partial<ExpenseLineItem> = {}): ExpenseLineItem {
  return {
    id: "line-1",
    companyId: "co-1",
    submittedBy: "user-crew",
    batchId: "batch-1",
    status: "submitted",
    categoryId: null,
    merchantName: "Home Depot",
    description: null,
    amount: 480,
    taxAmount: null,
    currency: "USD",
    expenseDate: "2026-02-03",
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
    createdAt: "2026-02-03T12:00:00.000Z",
    updatedAt: "2026-02-03T12:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  batchExpenses = [];
});

// ─── No flags → disabled reject + active approve ──────────────────────────────

describe("BatchDetailPanel — reviewable footer (no flags)", () => {
  beforeEach(() => {
    batchExpenses = [makeLine(), makeLine({ id: "line-2", amount: 480 })];
  });

  it("renders the floating cluster: sticky, bottom-right, click-through gutter", () => {
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );

    const cluster = screen.getByTestId("review-action-cluster");
    // Floats bottom-right; the wrapper is click-through so the line list stays
    // interactive under the puck.
    expect(cluster.className).toContain("sticky");
    expect(cluster.className).toContain("bottom-0");
    expect(cluster.className).toContain("justify-end");
    expect(cluster.className).toContain("pointer-events-none");
    expect(cluster.querySelector(".pointer-events-auto")).not.toBeNull();
  });

  it("shows a disabled REJECT and an active, compact, olive APPROVE ALL", () => {
    const onApprove = vi.fn();
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview
        onApprove={onApprove}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );

    const cluster = screen.getByTestId("review-action-cluster");
    const reject = within(cluster).getByRole("button", {
      name: "expenses.detail.reject",
    });
    const approve = within(cluster).getByRole("button", {
      name: "expenses.detail.approveAll",
    });

    // Reject is present but disabled (you reject by flagging lines first).
    expect(reject).toBeDisabled();
    // Approve is the active olive verb, compact 28px tier.
    expect(approve).not.toBeDisabled();
    expect(approve.className).toContain("h-[28px]");
    expect(approve.className).toContain("text-olive");
    expect(approve.className).toContain("border-olive-line");

    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("disables APPROVE ALL while a mutation for the batch is in flight (busy)", () => {
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy
        autoSendsOn={null}
      />,
    );
    const cluster = screen.getByTestId("review-action-cluster");
    expect(
      within(cluster).getByRole("button", { name: "expenses.detail.approveAll" }),
    ).toBeDisabled();
  });
});

// ─── Flags present → remove-all-flags + reject-with-N ─────────────────────────

describe("BatchDetailPanel — reviewable footer (flags present)", () => {
  beforeEach(() => {
    batchExpenses = [
      makeLine({ id: "line-1", flagComment: "missing receipt" }),
      makeLine({ id: "line-2", flagComment: "wrong project" }),
      makeLine({ id: "line-3", flagComment: null }),
    ];
  });

  it("renders REMOVE ALL FLAGS + a rose REJECT WITH N (no approve while flagged)", () => {
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );

    const cluster = screen.getByTestId("review-action-cluster");
    expect(
      within(cluster).getByRole("button", {
        name: "expenses.detail.removeAllFlags",
      }),
    ).toBeInTheDocument();
    const reject = within(cluster).getByRole("button", {
      name: "expenses.detail.rejectWith",
    });
    expect(reject.className).toContain("text-rose");
    expect(reject.className).toContain("border-rose-line");
    expect(reject.className).toContain("h-[28px]");
    // No approve verb is offered while lines are flagged.
    expect(
      within(cluster).queryByRole("button", {
        name: "expenses.detail.approveAll",
      }),
    ).toBeNull();
  });

  it("REMOVE ALL FLAGS clears every flagged line", () => {
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );
    fireEvent.click(
      within(screen.getByTestId("review-action-cluster")).getByRole("button", {
        name: "expenses.detail.removeAllFlags",
      }),
    );
    // Two flagged lines → two unflag calls.
    expect(unflagMutate).toHaveBeenCalledTimes(2);
    expect(unflagMutate).toHaveBeenCalledWith("line-1");
    expect(unflagMutate).toHaveBeenCalledWith("line-2");
  });

  it("REJECT WITH N opens the reject confirmation modal", () => {
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );
    expect(screen.queryByTestId("reject-confirmation-modal")).toBeNull();
    fireEvent.click(
      within(screen.getByTestId("review-action-cluster")).getByRole("button", {
        name: "expenses.detail.rejectWith",
      }),
    );
    expect(screen.getByTestId("reject-confirmation-modal")).toBeInTheDocument();
  });
});

// ─── Non-reviewable buckets never render the cluster ──────────────────────────

describe("BatchDetailPanel — non-reviewable buckets", () => {
  it("does not render the review cluster for an awaiting-payout (TO PAY) batch", () => {
    batchExpenses = [makeLine()];
    render(
      <BatchDetailPanel
        batch={makeBatch({ status: ExpenseBatchStatus.Approved })}
        canReview
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );
    expect(screen.queryByTestId("review-action-cluster")).toBeNull();
  });

  it("does not render the review cluster when the user cannot review", () => {
    batchExpenses = [makeLine()];
    render(
      <BatchDetailPanel
        batch={makeBatch()}
        canReview={false}
        onApprove={noop}
        onMarkPaid={noop}
        onUndoPaid={noop}
        busy={false}
        autoSendsOn={null}
      />,
    );
    expect(screen.queryByTestId("review-action-cluster")).toBeNull();
  });
});
