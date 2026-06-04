import { describe, it, expect } from "vitest";
import { buildReconciliation, buildMatchCounts, buildStagedCounts } from "../qbo-reconcile";
import type { QboStagedInvoice, QboStagedPayment, QboCustomerMatch } from "@/lib/types/qbo-import";

const invoices = [
  { qb_id: "130", balance: 362.07, total: 362.07, derived_status: "awaiting_payment" },
  { qb_id: "140", balance: 0, total: 100, derived_status: "paid" },
  { qb_id: "150", balance: 0, total: 0, derived_status: "skipped" }, // skipped (zero total)
] as unknown as QboStagedInvoice[];

const payments = [
  { qb_id: "200", applied_lines: [{ invoice_qb_id: "130", amount: 200 }, { invoice_qb_id: "140", amount: 100 }] },
  { qb_id: "201", applied_lines: [] }, // orphan deposit
] as unknown as QboStagedPayment[];

const matches = [
  { proposed_action: "link" },
  { proposed_action: "create" },
  { proposed_action: "needs_review" },
  { proposed_action: "skip" },
] as unknown as QboCustomerMatch[];

describe("buildMatchCounts", () => {
  it("tallies per action", () => {
    expect(buildMatchCounts(matches)).toEqual({ link: 1, create: 1, skip: 1, needs_review: 1 });
  });
});

describe("buildReconciliation", () => {
  it("open A/R sums non-skipped positive balances; collected sums applied lines", () => {
    const r = buildReconciliation(invoices, payments, 5);
    expect(r.qbOpenAr).toBe(362.07);
    expect(r.opsToBeOpenAr).toBe(362.07);
    expect(r.openInvoiceCount).toBe(1);
    expect(r.collectedInWindow).toBe(300);
    expect(r.customerCount).toBe(5);
    expect(r.arMatched).toBe(true);
  });
});

describe("buildStagedCounts", () => {
  it("counts entities, orphan payments, and skipped invoices", () => {
    const c = buildStagedCounts({
      customers: 5, estimates: 2, invoices, lineItems: 7, payments, customerRows: [],
    });
    expect(c.invoices).toBe(3);
    expect(c.skippedInvoices).toBe(1);
    expect(c.orphanPayments).toBe(1);
    expect(c.lineItems).toBe(7);
  });

  it("counts sub-clients to create (excluding jobs) and jobs detected", () => {
    const c = buildStagedCounts({
      customers: 4, estimates: 0, invoices: [], lineItems: 0, payments: [],
      customerRows: [
        { qb_id: "42", company_name: "Acme", contact_name: "John Smith", is_job: false },
        { qb_id: "7", company_name: "Globex", contact_name: null, is_job: false },
        { qb_id: "9", company_name: null, contact_name: "Jane Doe", is_job: false },
        { qb_id: "100", company_name: "Acme", contact_name: "Bob", is_job: true },
      ],
    });
    expect(c.subClientsToCreate).toBe(1); // only 42 (7 no contact, 9 individual, 100 is a Job)
    expect(c.jobsDetected).toBe(1); // 100
  });
});
