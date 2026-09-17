/**
 * OPS Web - Recurring Reimbursement Helpers
 *
 * Pure presentation logic for recurring reimbursements: a fixed monthly amount
 * the office pays a crew member with their expenses. The database decides
 * where each month's line lands (see migration
 * 20260917030000_expense_recurring_reimbursements.sql); these helpers only let
 * the console describe that decision truthfully before and after it happens.
 *
 * Months are always `YYYY-MM-01` strings. All functions are pure.
 */

import {
  ExpenseBatchStatus,
  type ExpenseBatch,
} from "@/lib/types/expense-approval";

/** The database accepts a first month within this many months of today. */
export const RECURRING_MONTH_RANGE = 12;

const MONTH_ABBREVS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

// ─── Month arithmetic ─────────────────────────────────────────────────────────

function parts(value: string): { year: number; month: number } {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function format(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** First day of the month containing `value` (`YYYY-MM-DD` or `YYYY-MM`). */
export function monthStart(value: string): string {
  const { year, month } = parts(value);
  return format(year, month);
}

export function addMonths(period: string, n: number): string {
  const { year, month } = parts(period);
  const index = year * 12 + (month - 1) + n;
  return format(Math.floor(index / 12), (index % 12) + 1);
}

/** Months from `first` through `last`, inclusive. Empty when inverted. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let cursor = monthStart(first);
  const end = monthStart(last);
  while (cursor <= end) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/** First-month choices the database will accept, oldest first. */
export function monthOptions(
  current: string,
  back = RECURRING_MONTH_RANGE,
  ahead = RECURRING_MONTH_RANGE
): string[] {
  return monthsBetween(addMonths(current, -back), addMonths(current, ahead));
}

/**
 * This month in the company's time zone. Reimbursement months follow the
 * company's calendar, not the viewer's browser. Unknown zones fall back to UTC.
 */
export function currentMonthIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  let zone = "UTC";
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      zone = timeZone;
    } catch {
      zone = "UTC";
    }
  }
  const fields = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(fields.find((f) => f.type === "year")?.value);
  const month = Number(fields.find((f) => f.type === "month")?.value);
  return format(year, month);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** `AUG 2026` — the console's uppercase month register. */
export function formatRecurringMonth(period: string): string {
  const { year, month } = parts(period);
  return `${MONTH_ABBREVS[month - 1] ?? "—"} ${year}`;
}

/** Money Rendering Canon: en-US with the record's own ISO currency. */
export function formatRecurringMoney(amount: number, currency: string | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

// ─── Placement preview ────────────────────────────────────────────────────────

export interface PlacementPreview {
  /** Months the database files the moment the reimbursement is saved. */
  filedNow: string[];
  /** Of those, months already paid out — their line lands on the next batch. */
  paidOut: string[];
  /** The first month has not arrived; nothing is filed yet. */
  startsLater: boolean;
}

const APPROVED_STATES: string[] = [
  ExpenseBatchStatus.Approved,
  ExpenseBatchStatus.AutoApproved,
  ExpenseBatchStatus.PartiallyApproved,
];

const TAKING_STATES: string[] = [
  ExpenseBatchStatus.Open,
  ExpenseBatchStatus.PendingReview,
  ExpenseBatchStatus.Submitted,
];

export function placementPreview({
  firstPeriod,
  currentMonth,
  userId,
  batches,
}: {
  firstPeriod: string;
  currentMonth: string;
  userId: string;
  batches: ExpenseBatch[];
}): PlacementPreview {
  const first = monthStart(firstPeriod);
  const current = monthStart(currentMonth);
  if (first > current) return { filedNow: [], paidOut: [], startsLater: true };

  const own = batches.filter(
    (b) =>
      b.submittedBy === userId &&
      (b.amendmentNumber ?? 0) === 0 &&
      !b.scopeProjectId &&
      b.periodStart != null &&
      b.periodEnd != null
  );

  const filedNow = monthsBetween(first, current);
  const paidOut = filedNow.filter((month) => {
    const covering = own.filter(
      (b) => (b.periodStart as string) <= month && month <= (b.periodEnd as string)
    );
    const canTake = covering.some(
      (b) =>
        TAKING_STATES.includes(b.status) ||
        (APPROVED_STATES.includes(b.status) && b.paidAt == null)
    );
    const paid = covering.some((b) => APPROVED_STATES.includes(b.status) && b.paidAt != null);
    return paid && !canTake;
  });

  return { filedNow, paidOut, startsLater: false };
}

// ─── Lifecycle guards ─────────────────────────────────────────────────────────

/** One month's line as returned by the recurring reimbursement commands. */
export interface RecurringLineSummary {
  expenseId: string;
  period: string;
  batchId: string | null;
  status: string;
  amount: number;
  deleted: boolean;
}

/** Delete is for a setup made in error — refused once any month is paid. */
export function canDeleteRecurring(lines: RecurringLineSummary[]): boolean {
  return !lines.some((l) => !l.deleted && l.status === "reimbursed");
}

/** The latest month still on a batch. Ending never removes a filed month. */
export function latestFiledPeriod(lines: RecurringLineSummary[]): string | null {
  let latest: string | null = null;
  for (const l of lines) {
    if (l.deleted) continue;
    if (latest == null || l.period > latest) latest = l.period;
  }
  return latest;
}

/** Last-month choices: from the latest filed month (or the first) to a year out. */
export function endMonthOptions({
  firstPeriod,
  latestFiled,
  currentMonth,
}: {
  firstPeriod: string;
  latestFiled: string | null;
  currentMonth: string;
}): string[] {
  const floor = latestFiled && latestFiled > firstPeriod ? latestFiled : monthStart(firstPeriod);
  const ceiling = addMonths(monthStart(currentMonth), RECURRING_MONTH_RANGE);
  return monthsBetween(floor, ceiling > floor ? ceiling : floor);
}

// ─── Server errors ────────────────────────────────────────────────────────────

export type RecurringErrorKey =
  | "duplicate"
  | "changed"
  | "busy"
  | "permission"
  | "self"
  | "paid"
  | "endBefore"
  | "removed"
  | "name"
  | "amount"
  | "start"
  | "category"
  | "person"
  | "endBeforeStart"
  | "afterEnd"
  | "failed";

const ERROR_PATTERNS: [RegExp, RecurringErrorKey][] = [
  [/already has a recurring reimbursement with that name/i, "duplicate"],
  [/changed\. Reload and try again/i, "changed"],
  [/Expenses are being updated/i, "busy"],
  [/do not have permission/i, "permission"],
  [/Only an admin can set up a recurring reimbursement for themselves/i, "self"],
  [/already been paid/i, "paid"],
  [/is already on a batch/i, "endBefore"],
  [/no longer available|was removed/i, "removed"],
  [/Name it in 80 characters/i, "name"],
  [/Enter an amount/i, "amount"],
  [/Start within 12 months/i, "start"],
  [/category is unavailable/i, "category"],
  [/not an active member/i, "person"],
  [/End on or after the first month/i, "endBeforeStart"],
  [/after this reimbursement ends/i, "afterEnd"],
];

export function recurringErrorKey(message: string | null | undefined): RecurringErrorKey {
  if (!message) return "failed";
  for (const [pattern, key] of ERROR_PATTERNS) {
    if (pattern.test(message)) return key;
  }
  return "failed";
}
