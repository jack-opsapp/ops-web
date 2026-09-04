import { describe, expect, it } from "vitest";
import {
  normalizeSageContact,
  normalizeSageDocument,
  normalizeSagePayment,
} from "../sage-normalize";

describe("Sage inbound normalization", () => {
  it("normalizes a complete financial document without dropping lines", () => {
    expect(
      normalizeSageDocument("sales_quote", {
        id: "quote-1",
        contact: { id: "contact-1" },
        date: "2026-09-03",
        expiry_date: "2026-10-03",
        status: { id: "DRAFT" },
        total_amount: 210,
        outstanding_amount: 210,
        updated_at: "2026-09-03T12:00:00Z",
        quote_lines: [
          {
            id: "line-1",
            description: "Labour",
            quantity: 2,
            unit_price: 100,
            total_amount: 200,
            ledger_account: { id: "ledger-1" },
            tax_rate: { id: "gst", percentage: 5 },
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        id: "quote-1",
        kind: "sales_quote",
        contactId: "contact-1",
        status: "draft",
        outstandingAmount: 210,
        tombstone: false,
        lines: [
          expect.objectContaining({
            id: "line-1",
            quantity: 2,
            unitPrice: 100,
            ledgerAccountId: "ledger-1",
            taxRateId: "gst",
            taxRatePercent: 5,
          }),
        ],
      })
    );
  });

  it("preserves estimate versus quote identity and tombstones", () => {
    expect(
      normalizeSageDocument("sales_estimate", {
        id: "estimate-1",
        contact_id: "contact-1",
        status: "VOID",
        estimate_lines: [],
        updated_at: "2026-09-03T12:00:00Z",
      })
    ).toEqual(
      expect.objectContaining({ kind: "sales_estimate", tombstone: true })
    );
  });

  it("normalizes contacts and raw external payment allocations", () => {
    expect(
      normalizeSageContact({
        id: "contact-1",
        name: "Acme",
        contact_type_ids: ["CUSTOMER"],
        deleted: false,
        updated_at: "2026-09-03T12:00:00Z",
      })
    ).toEqual(expect.objectContaining({ id: "contact-1", kind: "customer" }));
    expect(
      normalizeSagePayment({
        id: "payment-raw-77",
        contact: { id: "contact-1" },
        transaction_type: { id: "CUSTOMER_RECEIPT" },
        total_amount: 125.25,
        status: "VOID",
        allocated_artefacts: [
          { artefact: { id: "invoice-raw-9" }, amount: 125.25 },
        ],
        updated_at: "2026-09-03T12:00:00Z",
      })
    ).toEqual(
      expect.objectContaining({
        id: "payment-raw-77",
        tombstone: true,
        allocations: [{ artefactId: "invoice-raw-9", amount: 125.25 }],
      })
    );
  });
});
