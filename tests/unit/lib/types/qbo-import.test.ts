import { describe, expect, it } from "vitest";
import {
  MATCH_ACTIONS,
  type MatchAction,
  type QboImportRun,
  type QboStagedCustomer,
  type QboStagedEstimate,
  type QboStagedInvoice,
  type QboStagedLineItem,
  type QboStagedPayment,
  type QboCustomerMatch,
  type QboImportReview,
} from "@/lib/types/qbo-import";
// Re-export surface must also resolve from pipeline.ts.
import type { QboImportReview as QboImportReviewViaPipeline } from "@/lib/types/pipeline";

function expectType<T>(_value: T): void {
  /* compile-time assertion only */
}

describe("qbo-import types", () => {
  it("exposes the four match actions as a runtime tuple", () => {
    expect(MATCH_ACTIONS).toEqual(["link", "create", "skip", "needs_review"]);
  });

  it("MatchAction is the union of the runtime tuple", () => {
    const a: MatchAction = "link";
    const b: MatchAction = "needs_review";
    expect([a, b]).toEqual(["link", "needs_review"]);
  });

  it("QboImportRun carries run metadata, the zero-write counter, and reconciliation totals", () => {
    const run: QboImportRun = {
      id: "r1",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      provider: "quickbooks",
      status: "staged",
      historyCutoff: "2024-06-01",
      qbWriteCalls: 0,
      totals: { customers: 12 },
      error: null,
      createdBy: "1746a0c1-be43-45d6-ab4d-584e82594b1b",
      createdAt: new Date(),
      finishedAt: null,
    };
    expectType<QboImportRun>(run);
    expect(run.qbWriteCalls).toBe(0);
  });

  it("staging types map the verified QB columns", () => {
    const customer: QboStagedCustomer = {
      id: "c1", runId: "r1", companyId: "co", qbId: "1",
      displayName: "Acme", email: null, phone: null, address: null,
      active: true, raw: {}, createdAt: new Date(),
    };
    const estimate: QboStagedEstimate = {
      id: "e1", runId: "r1", companyId: "co", qbId: "10",
      docNumber: "E-10", customerQbId: "1", txnDate: "2025-01-01",
      expirationDate: null, txnStatus: "Pending",
      subtotal: 100, taxAmount: 8, taxRate: 0.08, total: 108, raw: {},
    };
    const invoice: QboStagedInvoice = {
      id: "i1", runId: "r1", companyId: "co", qbId: "20",
      docNumber: "INV-20", customerQbId: "1", estimateQbId: "10",
      txnDate: "2025-02-01", dueDate: "2025-03-01",
      subtotal: 100, taxAmount: 8, taxRate: 0.08, total: 108,
      balance: 108, derivedStatus: "awaiting_payment", raw: {},
    };
    const line: QboStagedLineItem = {
      id: "l1", runId: "r1", companyId: "co", parentType: "invoice",
      parentQbId: "20", qbLineId: "1", name: "Decking", description: "Cedar",
      quantity: 3.5, unitPrice: 9.5, amount: 33.25, isTaxable: true,
      qbItemType: "Service", sortOrder: 0,
    };
    const payment: QboStagedPayment = {
      id: "p1", runId: "r1", companyId: "co", qbId: "30",
      customerQbId: "1", txnDate: "2025-03-15", totalAmt: 108,
      unappliedAmt: 0,
      appliedLines: [{ invoiceQbId: "20", amount: 108, referenceNumber: "CHK-1" }],
      raw: {},
    };
    expectType<QboStagedCustomer>(customer);
    expectType<QboStagedEstimate>(estimate);
    expectType<QboStagedInvoice>(invoice);
    expectType<QboStagedLineItem>(line);
    expectType<QboStagedPayment>(payment);
    expect(line.parentType).toBe("invoice");
    expect(payment.appliedLines[0].invoiceQbId).toBe("20");
  });

  it("QboCustomerMatch carries proposal + owner decision fields", () => {
    const match: QboCustomerMatch = {
      id: "m1", runId: "r1", companyId: "co", customerQbId: "1",
      proposedAction: "link", matchedClientId: "client-1",
      matchBasis: "email", confidence: "high",
      candidates: [{ clientId: "client-1", name: "Acme", basis: "email", score: 1 }],
      decidedAction: null, decidedClientId: null,
    };
    expectType<QboCustomerMatch>(match);
    expect(match.proposedAction).toBe("link");
  });

  it("QboImportReview aggregates the run, matches, counts, and reconciliation totals", () => {
    const review: QboImportReview = {
      run: {
        id: "r1", companyId: "co", provider: "quickbooks", status: "staged",
        historyCutoff: "2024-06-01", qbWriteCalls: 0, totals: {}, error: null,
        createdBy: null, createdAt: new Date(), finishedAt: null,
      },
      matches: [],
      counts: {
        customers: 12, customersLink: 8, customersCreate: 3, customersSkip: 0,
        customersNeedsReview: 1, estimates: 5, invoices: 20, lineItems: 60,
        payments: 18, orphanPayments: 1, skippedInvoices: 2,
      },
      reconciliation: {
        quickbooks: { openArTotal: 12345.67, openInvoiceCount: 9, collected24mo: 89000, customerCount: 12 },
        ops: { openArTotal: 12345.67, openInvoiceCount: 9, collected24mo: 89000, customerCount: 12 },
      },
    };
    expectType<QboImportReview>(review);
    expectType<QboImportReviewViaPipeline>(review);
    expect(review.reconciliation.quickbooks.openArTotal).toBe(review.reconciliation.ops.openArTotal);
  });
});
