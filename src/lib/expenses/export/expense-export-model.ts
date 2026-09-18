/**
 * The expense export document model.
 *
 * Turns one batch — its lines, their job allocations, the company and the
 * person being paid — into a flat, presentation-ready document. Pure: no I/O,
 * no ExcelJS, no i18n imports. Every money and eligibility rule lives here so
 * it can be tested on its own, and the workbook writer stays a dumb renderer.
 *
 * Two figures matter and they are not the same number:
 *
 *   linesTotal    every live line summed — what the console header calls TOTAL,
 *                 and what `recalculate_expense_batch_total` stores. Rejected
 *                 lines stay in it, because the database keeps them in it.
 *   payableTotal  what the office actually owes this person — `batchOwedAmount`,
 *                 the same figure behind MARK PAID.
 *
 * When they differ the document shows both and names the gap, rather than
 * printing one where the reader would assume the other.
 */

import {
  batchOwedAmount,
  batchStatusDisplay,
  type ExpenseBatchStatus,
} from "@/lib/types/expense-approval";

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface ExportAllocationInput {
  projectId: string;
  /** Resolved from `projects.title`; null when the id no longer resolves. */
  projectTitle: string | null;
  percentage: number;
}

export interface ExportLineInput {
  id: string;
  /** `YYYY-MM-DD` from a Postgres `date` column. */
  expenseDate: string | null;
  merchantName: string | null;
  description: string | null;
  amount: number;
  taxAmount: number | null;
  currency: string | null;
  status: string | null;
  paymentMethod: string | null;
  isRecurring: boolean;
  receiptMissingReason: string | null;
  receiptMissingNote: string | null;
  rejectionReason: string | null;
  allocations: ExportAllocationInput[];
}

export interface ExportBatchInput {
  batchNumber: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  totalAmount: number | null;
  approvedAmount: number | null;
  reimbursementAmount: number | null;
}

export interface ExportCompanyInput {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
}

export interface ExportPersonInput {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  homeAddress: string | null;
}

/**
 * Every string the document prints. Injected so the model stays pure — the
 * route fills these from the books dictionary in the reader's locale.
 */
export interface ExportLabels {
  title: string;
  payableTo: string;
  submittedBy: string;
  period: string;
  batch: string;
  status: string;
  colDate: string;
  colJob: string;
  colItem: string;
  colStore: string;
  colNote: string;
  colCost: string;
  total: string;
  notReimbursed: string;
  payable: string;
  companyFunded: string;
  includesTax: string;
  noteRecurring: string;
  noteCompanyCard: string;
  noteRejected: string;
  noteReceiptLost: string;
  noteReceiptCash: string;
  noteReceiptDigital: string;
  noteReceiptOther: string;
}

export const DEFAULT_EXPORT_LABELS: ExportLabels = {
  title: "EXPENSES",
  payableTo: "PAYABLE TO",
  submittedBy: "SUBMITTED BY",
  period: "PERIOD",
  batch: "BATCH",
  status: "STATUS",
  colDate: "DATE",
  colJob: "JOB",
  colItem: "ITEM",
  colStore: "STORE",
  colNote: "NOTE",
  colCost: "COST",
  total: "TOTAL",
  notReimbursed: "NOT REIMBURSED",
  payable: "PAYABLE",
  companyFunded: "COMPANY-FUNDED — NO REIMBURSEMENT DUE",
  includesTax: "INCLUDES TAX",
  noteRecurring: "Recurring — no receipt",
  noteCompanyCard: "Company card",
  noteRejected: "Rejected",
  noteReceiptLost: "Receipt lost",
  noteReceiptCash: "Paid cash — no receipt",
  noteReceiptDigital: "Digital receipt",
  noteReceiptOther: "No receipt",
};

export interface BuildExportInput {
  batch: ExportBatchInput;
  lines: ExportLineInput[];
  company: ExportCompanyInput;
  person: ExportPersonInput;
  accentColor: string;
  labels: ExportLabels;
  locale: string;
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

export interface ExpenseExportRow {
  id: string;
  date: Date | null;
  /** Job titles joined for a split line; `—` when the line is overhead. */
  job: string;
  item: string;
  store: string;
  /** Empty for a clean line — the column only speaks when it has something to say. */
  note: string;
  cost: number;
  currency: string;
  /** False when the person is not owed this line (rejected, or company card). */
  payable: boolean;
  /** Render de-emphasised — the line was rejected. */
  muted: boolean;
}

export interface ExpenseExportDocument {
  company: {
    name: string;
    address: string | null;
    /** Phone · email · website, joined — the ways to reach them, on one line. */
    contactLine: string | null;
    logoUrl: string | null;
  };
  person: { name: string; address: string | null; phone: string | null };
  periodLabel: string;
  batchNumber: string;
  statusLabel: string;
  rows: ExpenseExportRow[];
  linesTotal: number;
  payableTotal: number;
  /** linesTotal − payableTotal, floored at zero. */
  excludedTotal: number;
  companyFunded: boolean;
  taxTotal: number | null;
  currency: string;
  currencies: string[];
  accentColor: string;
  labels: ExportLabels;
  filename: string;
}

// ─── Money ────────────────────────────────────────────────────────────────────

/** Sum in whole cents — 0.1 + 0.2 must be 0.3 on a document about money. */
function sumMoney(values: number[]): number {
  return values.reduce((cents, v) => cents + Math.round(v * 100), 0) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/**
 * Parse a `YYYY-MM-DD` column as a local date. `new Date("2026-08-01")` is UTC
 * midnight, which prints as July 31 anywhere west of Greenwich — the crew's
 * date must survive the trip.
 */
function parseDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWholeCalendarMonth(start: Date, end: Date): boolean {
  if (start.getFullYear() !== end.getFullYear()) return false;
  if (start.getMonth() !== end.getMonth()) return false;
  if (start.getDate() !== 1) return false;
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  return end.getDate() === lastDay;
}

function formatPeriodLabel(
  startRaw: string | null,
  endRaw: string | null,
  locale: string
): string {
  const start = parseDateOnly(startRaw);
  const end = parseDateOnly(endRaw);
  if (!start || !end) return EM_DASH;

  const monthYear = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const monthDay = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" });
  const full = new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (isWholeCalendarMonth(start, end)) return monthYear.format(start);
  if (start.getFullYear() === end.getFullYear()) {
    return `${monthDay.format(start)} ${EN_DASH} ${full.format(end)}`;
  }
  return `${full.format(start)} ${EN_DASH} ${full.format(end)}`;
}

// ─── Text ─────────────────────────────────────────────────────────────────────

const EM_DASH = "—";
const EN_DASH = "–";
const JOB_SEPARATOR = " · ";
const CONTACT_SEPARATOR = " · ";

/** A printed document wants "canprodeckandrail.com", not the full href. */
function displayUrl(value: string | null | undefined): string {
  return clean(value).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Strip what a filesystem rejects, then collapse what that left behind. */
function sanitizeFilenamePart(value: string): string {
  return value
    .replace(/[/\\:*?"<>| -]/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personName(person: ExportPersonInput): string {
  const full = `${clean(person.firstName)} ${clean(person.lastName)}`.trim();
  if (full) return full;
  return clean(person.email) || EM_DASH;
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function jobLabel(line: ExportLineInput): string {
  if (line.allocations.length === 0) return EM_DASH;
  const titles = line.allocations.map((a) => clean(a.projectTitle) || clean(a.projectId));
  const present = titles.filter(Boolean);
  return present.length > 0 ? present.join(JOB_SEPARATOR) : EM_DASH;
}

function receiptNote(line: ExportLineInput, labels: ExportLabels): string {
  const base = {
    lost: labels.noteReceiptLost,
    cash: labels.noteReceiptCash,
    digital: labels.noteReceiptDigital,
    other: labels.noteReceiptOther,
  }[line.receiptMissingReason ?? ""];
  if (!base) return "";
  const detail = clean(line.receiptMissingNote);
  return detail ? `${base} ${EM_DASH} ${detail}` : base;
}

/**
 * What the office needs to know about this line to trust the number — and
 * nothing more. A clean line says nothing.
 */
function noteFor(
  line: ExportLineInput,
  labels: ExportLabels,
  companyFunded: boolean
): string {
  if (line.status === "rejected") {
    const reason = clean(line.rejectionReason);
    return reason ? `${labels.noteRejected} ${EM_DASH} ${reason}` : labels.noteRejected;
  }
  if (line.isRecurring) return labels.noteRecurring;
  // On a company-funded envelope the totals already say nothing is owed, so
  // stamping every row "Company card" would repeat it rather than inform.
  if (line.paymentMethod === "company_card") return companyFunded ? "" : labels.noteCompanyCard;
  return receiptNote(line, labels);
}

function toRow(
  line: ExportLineInput,
  labels: ExportLabels,
  currency: string,
  companyFunded: boolean
): ExpenseExportRow {
  const rejected = line.status === "rejected";
  return {
    id: line.id,
    date: parseDateOnly(line.expenseDate),
    job: jobLabel(line),
    item: clean(line.description),
    store: clean(line.merchantName),
    note: noteFor(line, labels, companyFunded),
    cost: roundMoney(line.amount),
    currency: clean(line.currency) || currency,
    payable: !rejected && line.paymentMethod !== "company_card",
    muted: rejected,
  };
}

/** Oldest first; undated lines sink to the bottom rather than to 1970. */
function byDate(a: ExpenseExportRow, b: ExpenseExportRow): number {
  if (a.date && b.date) return a.date.getTime() - b.date.getTime();
  if (a.date) return -1;
  if (b.date) return 1;
  return 0;
}

// ─── Currency ─────────────────────────────────────────────────────────────────

function resolveCurrencies(lines: ExportLineInput[]): { currency: string; currencies: string[] } {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const code = clean(line.currency);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (counts.size === 0) return { currency: "CAD", currencies: [] };
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { currency: dominant, currencies: [...counts.keys()].sort() };
}

// ─── Build ────────────────────────────────────────────────────────────────────

export function buildExpenseExportDocument(input: BuildExportInput): ExpenseExportDocument {
  const { batch, lines, company, person, accentColor, labels, locale } = input;

  const { currency, currencies } = resolveCurrencies(lines);
  const companyFunded = batch.reimbursementAmount === 0;
  const rows = lines.map((l) => toRow(l, labels, currency, companyFunded)).sort(byDate);

  // Mirrors recalculate_expense_batch_total: every live line, whatever status.
  const linesTotal = sumMoney(rows.map((r) => r.cost));
  const payableTotal = roundMoney(
    batchOwedAmount({
      status: batch.status as ExpenseBatchStatus,
      approvedAmount: batch.approvedAmount,
      totalAmount: batch.totalAmount,
      reimbursementAmount: batch.reimbursementAmount,
    })
  );
  const excludedTotal = Math.max(0, roundMoney(linesTotal - payableTotal));

  const taxes = lines.map((l) => l.taxAmount).filter((t): t is number => t != null);
  const taxTotal = taxes.length > 0 ? sumMoney(taxes) : null;

  const periodLabel = formatPeriodLabel(batch.periodStart, batch.periodEnd, locale);
  const name = personName(person);
  const companyName = clean(company.name);

  const filename = `${[
    sanitizeFilenamePart(companyName),
    sanitizeFilenamePart(titleCase(labels.title)),
    sanitizeFilenamePart(name),
    sanitizeFilenamePart(periodLabel),
  ]
    .filter(Boolean)
    .join(" - ")}.xlsx`;

  return {
    company: {
      name: companyName,
      address: clean(company.address) || null,
      contactLine:
        [company.phone, company.email, displayUrl(company.website)]
          .map(clean)
          .filter(Boolean)
          .join(CONTACT_SEPARATOR) || null,
      logoUrl: clean(company.logoUrl) || null,
    },
    person: {
      name,
      address: clean(person.homeAddress) || null,
      phone: clean(person.phone) || null,
    },
    periodLabel,
    batchNumber: batch.batchNumber,
    statusLabel: batchStatusDisplay(batch.status),
    rows,
    linesTotal,
    payableTotal,
    excludedTotal,
    companyFunded,
    taxTotal,
    currency,
    currencies,
    accentColor,
    labels,
    filename,
  };
}

/** "EXPENSES" reads as shouting in a filename; "Expenses" does not. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
