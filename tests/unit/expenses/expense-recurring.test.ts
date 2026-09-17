import { describe, it, expect } from "vitest";
import {
  addMonths,
  canDeleteRecurring,
  currentMonthIn,
  endMonthOptions,
  formatRecurringMoney,
  formatRecurringMonth,
  latestFiledPeriod,
  monthOptions,
  monthStart,
  monthsBetween,
  placementPreview,
  recurringErrorKey,
  type RecurringLineSummary,
} from "@/lib/utils/expense-recurring";
import { ExpenseBatchStatus, type ExpenseBatch } from "@/lib/types/expense-approval";

let seq = 0;
function batch(overrides: Partial<ExpenseBatch> = {}): ExpenseBatch {
  seq += 1;
  return {
    id: `batch-${seq}`,
    companyId: "co-1",
    batchNumber: `EXP-BATCH-${String(seq).padStart(4, "0")}`,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    status: ExpenseBatchStatus.Open,
    submittedBy: "matt",
    reviewedBy: null,
    reviewedAt: null,
    totalAmount: 0,
    approvedAmount: 0,
    reimbursementAmount: 0,
    parentBatchId: null,
    amendmentNumber: 0,
    reviewNotes: null,
    paidAt: null,
    paidBy: null,
    scopeProjectId: null,
    createdAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

function line(overrides: Partial<RecurringLineSummary> = {}): RecurringLineSummary {
  return {
    expenseId: "e-1",
    period: "2026-08-01",
    batchId: "batch-x",
    status: "approved",
    amount: 350,
    deleted: false,
    ...overrides,
  };
}

describe("month arithmetic", () => {
  it("normalises any date in a month to its first day", () => {
    expect(monthStart("2026-08-17")).toBe("2026-08-01");
    expect(monthStart("2026-12-31")).toBe("2026-12-01");
    expect(monthStart("2026-02")).toBe("2026-02-01");
  });

  it("adds and subtracts months across year boundaries", () => {
    expect(addMonths("2026-11-01", 2)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-08-01", 0)).toBe("2026-08-01");
    expect(addMonths("2026-08-01", -12)).toBe("2025-08-01");
  });

  it("lists months inclusively and returns nothing for an inverted range", () => {
    expect(monthsBetween("2026-11-01", "2027-02-01")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]);
    expect(monthsBetween("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
    expect(monthsBetween("2026-09-01", "2026-08-01")).toEqual([]);
  });

  it("offers twelve months back and ahead of this month, oldest first", () => {
    const options = monthOptions("2026-09-01");
    expect(options).toHaveLength(25);
    expect(options[0]).toBe("2025-09-01");
    expect(options[12]).toBe("2026-09-01");
    expect(options[24]).toBe("2027-09-01");
  });

  it("resolves this month in the company's time zone, not the browser's", () => {
    // 2026-09-01 03:00 UTC is still August 31 in Vancouver.
    const now = new Date("2026-09-01T03:00:00Z");
    expect(currentMonthIn("America/Vancouver", now)).toBe("2026-08-01");
    expect(currentMonthIn("UTC", now)).toBe("2026-09-01");
    expect(currentMonthIn(null, now)).toBe("2026-09-01");
    expect(currentMonthIn("Not/AZone", now)).toBe("2026-09-01");
  });
});

describe("formatting", () => {
  it("names a month in the console's uppercase register", () => {
    expect(formatRecurringMonth("2026-08-01")).toBe("AUG 2026");
    expect(formatRecurringMonth("2027-01-01")).toBe("JAN 2027");
  });

  it("renders money en-US in the record's currency, reading like the console", () => {
    expect(formatRecurringMoney(350, "CAD")).toBe("$350.00");
    expect(formatRecurringMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatRecurringMoney(85, null)).toBe("$85.00");
    expect(formatRecurringMoney(40, "EUR")).toBe("€40.00");
  });
});

describe("placement preview", () => {
  it("files every month from the start through this month", () => {
    const preview = placementPreview({
      firstPeriod: "2026-08-01",
      currentMonth: "2026-09-01",
      userId: "matt",
      batches: [],
    });
    expect(preview).toEqual({ filedNow: ["2026-08-01", "2026-09-01"], paidOut: [], startsLater: false });
  });

  it("treats an approved but unpaid month as owed, not paid out", () => {
    const preview = placementPreview({
      firstPeriod: "2026-08-01",
      currentMonth: "2026-09-01",
      userId: "matt",
      batches: [batch({ status: ExpenseBatchStatus.Approved, reimbursementAmount: 307.6 })],
    });
    expect(preview.paidOut).toEqual([]);
  });

  it("flags a month whose only envelope was paid out", () => {
    const preview = placementPreview({
      firstPeriod: "2026-07-01",
      currentMonth: "2026-09-01",
      userId: "matt",
      batches: [
        batch({
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          status: ExpenseBatchStatus.Approved,
          paidAt: "2026-08-05T10:00:00Z",
        }),
        batch({ status: ExpenseBatchStatus.Approved }),
      ],
    });
    expect(preview.filedNow).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(preview.paidOut).toEqual(["2026-07-01"]);
  });

  it("ignores other people, amendments and job-scoped envelopes", () => {
    const paid = { status: ExpenseBatchStatus.Approved, paidAt: "2026-09-02T00:00:00Z" };
    const preview = placementPreview({
      firstPeriod: "2026-08-01",
      currentMonth: "2026-08-01",
      userId: "matt",
      batches: [
        batch({ ...paid, submittedBy: "casey" }),
        batch({ ...paid, amendmentNumber: 1 }),
        batch({ ...paid, scopeProjectId: "job-1" }),
      ],
    });
    expect(preview.paidOut).toEqual([]);
  });

  it("is not paid out while another envelope for the month can still take the line", () => {
    const preview = placementPreview({
      firstPeriod: "2026-08-01",
      currentMonth: "2026-08-01",
      userId: "matt",
      batches: [
        batch({ status: ExpenseBatchStatus.Approved, paidAt: "2026-09-02T00:00:00Z" }),
        batch({ status: ExpenseBatchStatus.PendingReview }),
      ],
    });
    expect(preview.paidOut).toEqual([]);
  });

  it("covers weekly envelopes by the month's first day", () => {
    const preview = placementPreview({
      firstPeriod: "2026-06-01",
      currentMonth: "2026-06-01",
      userId: "matt",
      batches: [
        batch({
          periodStart: "2026-06-01",
          periodEnd: "2026-06-07",
          status: ExpenseBatchStatus.AutoApproved,
          paidAt: "2026-06-20T00:00:00Z",
        }),
      ],
    });
    expect(preview.paidOut).toEqual(["2026-06-01"]);
  });

  it("files nothing yet when the first month is in the future", () => {
    expect(
      placementPreview({ firstPeriod: "2026-11-01", currentMonth: "2026-09-01", userId: "matt", batches: [] })
    ).toEqual({ filedNow: [], paidOut: [], startsLater: true });
  });
});

describe("lifecycle guards", () => {
  it("allows delete only while no month has been paid", () => {
    expect(canDeleteRecurring([line(), line({ period: "2026-09-01" })])).toBe(true);
    expect(canDeleteRecurring([line({ status: "reimbursed" })])).toBe(false);
    expect(canDeleteRecurring([line({ status: "reimbursed", deleted: true })])).toBe(true);
    expect(canDeleteRecurring([])).toBe(true);
  });

  it("finds the latest month still on a batch", () => {
    expect(
      latestFiledPeriod([
        line({ period: "2026-08-01" }),
        line({ period: "2026-10-01", deleted: true }),
        line({ period: "2026-09-01" }),
      ])
    ).toBe("2026-09-01");
    expect(latestFiledPeriod([line({ deleted: true })])).toBeNull();
    expect(latestFiledPeriod([])).toBeNull();
  });

  it("offers end months from the latest filed month to a year ahead", () => {
    expect(
      endMonthOptions({ firstPeriod: "2026-08-01", latestFiled: "2026-09-01", currentMonth: "2026-09-01" })
    ).toEqual(monthsBetween("2026-09-01", "2027-09-01"));
    expect(
      endMonthOptions({ firstPeriod: "2026-11-01", latestFiled: null, currentMonth: "2026-09-01" })
    ).toEqual(monthsBetween("2026-11-01", "2027-09-01"));
  });
});

describe("server error mapping", () => {
  it.each([
    ["This person already has a recurring reimbursement with that name.", "duplicate"],
    ["This recurring reimbursement changed. Reload and try again.", "changed"],
    ["Your access changed. Reload and try again.", "changed"],
    ["Expenses are being updated. Try again.", "busy"],
    ["You do not have permission to manage recurring reimbursements.", "permission"],
    ["You do not have permission to approve expenses.", "permission"],
    ["Only an admin can set up a recurring reimbursement for themselves.", "self"],
    ["That month has already been paid.", "paid"],
    ["A month has already been paid. End it instead.", "paid"],
    ["Sep 2026 is already on a batch. Skip that month first, or end after it.", "endBefore"],
    ["This recurring reimbursement is no longer available.", "removed"],
    ["This recurring reimbursement was removed.", "removed"],
    ["Name it in 80 characters or fewer.", "name"],
    ["Enter an amount from 0.01 to 10,000.00.", "amount"],
    ["Start within 12 months of this month.", "start"],
    ["That category is unavailable.", "category"],
    ["That person is not an active member of your company.", "person"],
    ["End on or after the first month, or delete it instead.", "endBeforeStart"],
    ["That month is after this reimbursement ends.", "afterEnd"],
    ["network down", "failed"],
    [undefined, "failed"],
  ])("maps %s to %s", (message, key) => {
    expect(recurringErrorKey(message)).toBe(key);
  });
});
