/**
 * RecurringReimbursementDialog — the add / change / end / delete surface for a
 * fixed monthly amount paid with a crew member's expenses.
 *
 * Contract under test:
 *  - create from a batch: person fixed, first month = the batch's month, ADD
 *    disabled until a name and a valid amount exist, commits the exact input,
 *    and states which months are filed now and which were already paid out;
 *  - edit: SAVE disabled until something changes, sends the concurrency token;
 *    END commits the chosen last month; DELETE appears only while no month has
 *    been paid and needs a second, explicit confirmation;
 *  - refusals surface mapped copy, not raw server text.
 */

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

import {
  ExpenseBatchStatus,
  type ExpenseBatch,
  type ExpenseRecurringReimbursement,
} from "@/lib/types/expense-approval";

// Echo dictionary: key plus params, so copy choices are assertable.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params === "object" ? `${key} ${JSON.stringify(params)}` : key,
    dict: {},
  }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type Callbacks = { onSuccess?: (value: unknown) => void; onError?: (error: Error) => void };
const createMutate = vi.fn();
const updateMutate = vi.fn();
const endMutate = vi.fn();
const deleteMutate = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useCreateRecurringReimbursement: () => ({ mutate: createMutate, isPending: false }),
  useUpdateRecurringReimbursement: () => ({ mutate: updateMutate, isPending: false }),
  useEndRecurringReimbursement: () => ({ mutate: endMutate, isPending: false }),
  useDeleteRecurringReimbursement: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { RecurringReimbursementDialog } from "@/components/expenses/recurring-reimbursement-dialog";

const onClose = vi.fn();

function paidBatch(overrides: Partial<ExpenseBatch> = {}): ExpenseBatch {
  return {
    id: "b-jul",
    companyId: "co-1",
    batchNumber: "EXP-BATCH-0004",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: ExpenseBatchStatus.Approved,
    submittedBy: "matt",
    reviewedBy: "jackson",
    reviewedAt: "2026-08-02T00:00:00Z",
    totalAmount: 120,
    approvedAmount: 0,
    reimbursementAmount: 120,
    parentBatchId: null,
    amendmentNumber: 0,
    scopeProjectId: null,
    reviewNotes: null,
    paidAt: "2026-08-05T00:00:00Z",
    paidBy: "jackson",
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function setup(overrides: Partial<ExpenseRecurringReimbursement> = {}): ExpenseRecurringReimbursement {
  return {
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
    createdAt: "2026-09-17T02:41:12.123456+00:00",
    updatedAt: "2026-09-17T02:41:12.123456+00:00",
    deletedAt: null,
    lines: [
      { expenseId: "l-aug", period: "2026-08-01", batchId: "b-aug", status: "approved", amount: 350, deleted: false },
      { expenseId: "l-sep", period: "2026-09-01", batchId: "b-sep", status: "approved", amount: 350, deleted: false },
    ],
    person: { id: "matt", firstName: "Dana", lastName: "Kerr", email: null, profileImageUrl: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Mid-September in Vancouver.
  vi.setSystemTime(new Date("2026-09-16T20:00:00Z"));
  [createMutate, updateMutate, endMutate, deleteMutate, toastSuccess, toastError, onClose].forEach((fn) => fn.mockReset());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("create from a person's batch", () => {
  function renderCreate(batches: ExpenseBatch[] = [], firstPeriod = "2026-08-01") {
    return render(
      <RecurringReimbursementDialog
        open
        mode={{ kind: "create", person: { id: "matt", name: "Dana Kerr" }, firstPeriod }}
        currency="CAD"
        timeZone="America/Vancouver"
        batches={batches}
        people={[]}
        onClose={onClose}
      />
    );
  }

  it("fixes the person, starts at the batch's month and waits for a name and a valid amount", () => {
    renderCreate();
    expect(screen.getByText(/expenses\.recurring\.for .*Dana Kerr/)).toBeInTheDocument();
    expect(screen.queryByText("expenses.recurring.field.person")).not.toBeInTheDocument();
    expect(screen.getByText("AUG 2026")).toBeInTheDocument();

    const add = screen.getByRole("button", { name: "expenses.recurring.action.add" });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("expenses.recurring.field.name"), {
      target: { value: "Vehicle advertising" },
    });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "0" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "350.005" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "350" } });
    expect(add).toBeEnabled();
  });

  it("states the months filed now before committing", () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "350" } });
    expect(
      screen.getByText(/expenses\.recurring\.preview\.now .*"amount":"CA\$350\.00".*"months":"AUG 2026, SEP 2026"/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/expenses\.recurring\.preview\.paidOut/)).not.toBeInTheDocument();
  });

  it("warns when a month was already paid out", () => {
    renderCreate([paidBatch()], "2026-07-01");
    expect(screen.getByText(/expenses\.recurring\.preview\.paidOut .*"months":"JUL 2026"/)).toBeInTheDocument();
  });

  it("commits the exact input and closes on success", () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.name"), {
      target: { value: "  Vehicle advertising " },
    });
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "$350" } });
    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.action.add" }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [input, callbacks] = createMutate.mock.calls[0] as [unknown, Callbacks];
    expect(input).toEqual({
      userId: "matt",
      name: "Vehicle advertising",
      amount: 350,
      firstPeriod: "2026-08-01",
      categoryId: null,
    });

    callbacks.onSuccess?.(setup());
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("expenses.recurring.toast.added"));
    expect(onClose).toHaveBeenCalled();
  });

  it("maps a refusal to copy", () => {
    renderCreate();
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.name"), { target: { value: "Vehicle advertising" } });
    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "350" } });
    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.action.add" }));
    const [, callbacks] = createMutate.mock.calls[0] as [unknown, Callbacks];
    callbacks.onError?.(new Error("This person already has a recurring reimbursement with that name."));
    expect(toastError).toHaveBeenCalledWith("expenses.recurring.error.duplicate");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  function renderEdit(value = setup()) {
    return render(
      <RecurringReimbursementDialog
        open
        mode={{ kind: "edit", setup: value }}
        currency="CAD"
        timeZone="America/Vancouver"
        batches={[]}
        people={[]}
        onClose={onClose}
      />
    );
  }

  it("saves only a real change and sends the concurrency token", () => {
    renderEdit();
    const save = screen.getByRole("button", { name: "expenses.recurring.action.save" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/expenses\.recurring\.preview\.update/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("expenses.recurring.field.amount"), { target: { value: "400" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      id: "setup-1",
      name: "Vehicle advertising",
      amount: 400,
      categoryId: null,
      expectedUpdatedAt: "2026-09-17T02:41:12.123456+00:00",
    });
  });

  it("ends after this month by default", () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.action.end" }));
    const confirm = screen.getByRole("button", { name: /expenses\.recurring\.action\.endAfter .*SEP 2026/ });
    fireEvent.click(confirm);
    expect(endMutate.mock.calls[0][0]).toEqual({
      id: "setup-1",
      lastPeriod: "2026-09-01",
      expectedUpdatedAt: "2026-09-17T02:41:12.123456+00:00",
    });
  });

  it("offers REMOVE END when an end is set", () => {
    renderEdit(setup({ lastPeriod: "2026-12-01" }));
    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.action.removeEnd" }));
    expect(endMutate.mock.calls[0][0]).toMatchObject({ id: "setup-1", lastPeriod: null });
  });

  it("allows delete only while nothing is paid, behind a second confirmation", () => {
    const { unmount } = renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.action.delete" }));
    expect(screen.getByText("expenses.recurring.deleteWarning")).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "expenses.recurring.action.deleteConfirm" }));
    expect(deleteMutate.mock.calls[0][0]).toEqual({
      id: "setup-1",
      expectedUpdatedAt: "2026-09-17T02:41:12.123456+00:00",
    });
    unmount();

    renderEdit(
      setup({
        lines: [{ expenseId: "l-aug", period: "2026-08-01", batchId: "b-aug", status: "reimbursed", amount: 350, deleted: false }],
      })
    );
    expect(screen.queryByRole("button", { name: "expenses.recurring.action.delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "expenses.recurring.action.end" })).toBeInTheDocument();
  });
});
