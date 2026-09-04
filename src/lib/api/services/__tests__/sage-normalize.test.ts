import { describe, expect, it } from "vitest";

import { normalizeSageRecord, SageNormalizeError } from "../sage-normalize";

const UPDATED = "2026-09-04T08:00:00.000Z";

describe("normalizeSageRecord", () => {
  it("preserves the exact customer identity and lifecycle", () => {
    expect(
      normalizeSageRecord("customer", "contacts", {
        id: "contact-1",
        updated_at: UPDATED,
        displayed_as: "North Shore Electric",
        email: "ops@example.test",
        telephone: "604-555-0101",
        active: false,
      })
    ).toEqual({
      externalId: "contact-1",
      updatedAt: UPDATED,
      deletedAt: UPDATED,
      payload: {
        name: "North Shore Electric",
        email: "ops@example.test",
        phone: "604-555-0101",
        taxNumber: null,
      },
    });
  });

  it.each([
    ["invoice", "sales_invoices", "invoice_lines", "awaiting_payment"],
    ["estimate", "sales_quotes", "quote_lines", "sent"],
    ["estimate", "sales_estimates", "estimate_lines", "sent"],
  ] as const)(
    "preserves full %s lines from %s",
    (entityType, resource, lineKey, expectedStatus) => {
      const normalized = normalizeSageRecord(entityType, resource, {
        id: `${resource}-1`,
        updated_at: UPDATED,
        contact: { id: "contact-1" },
        date: "2026-09-01",
        due_date: "2026-09-30",
        expiry_date: "2026-09-30",
        reference: "OPS-100",
        status: { id: "SENT" },
        net_amount: 200,
        tax_amount: 24,
        total_amount: 224,
        outstanding_amount: 224,
        [lineKey]: [
          {
            description: "Panel upgrade",
            quantity: 2,
            unit_price: 100,
            net_amount: 200,
            tax_amount: 24,
            total_amount: 224,
            ledger_account: { id: "ledger-1" },
            tax_rate: { id: "tax-1", percentage: 12 },
          },
        ],
      });

      expect(normalized.payload).toEqual(
        expect.objectContaining({
          contactId: "contact-1",
          status: expectedStatus,
          subtotal: 200,
          taxAmount: 24,
          total: 224,
          lines: [
            expect.objectContaining({
              description: "Panel upgrade",
              quantity: 2,
              unitPrice: 100,
              subtotal: 200,
              taxAmount: 24,
              total: 224,
              ledgerAccountId: "ledger-1",
              taxRateId: "tax-1",
              taxRate: 12,
            }),
          ],
        })
      );
    }
  );

  it("requires exactly one payment allocation", () => {
    expect(() =>
      normalizeSageRecord("payment", "contact_payments", {
        id: "payment-1",
        updated_at: UPDATED,
        contact: { id: "contact-1" },
        date: "2026-09-01",
        total_amount: 100,
        allocated_artefacts: [],
      })
    ).toThrowError(SageNormalizeError);
  });

  it("preserves supplier-bill lines and accounting identities", () => {
    const normalized = normalizeSageRecord(
      "supplier_bill",
      "purchase_invoices",
      {
        id: "purchase-1",
        updated_at: UPDATED,
        contact: { id: "supplier-1" },
        date: "2026-09-01",
        due_date: "2026-09-30",
        vendor_reference: "V-100",
        currency: { id: "CAD" },
        net_amount: 80,
        tax_amount: 9.6,
        total_amount: 89.6,
        outstanding_amount: 89.6,
        invoice_lines: [
          {
            description: "Electrical materials",
            quantity: 4,
            unit_price: 20,
            net_amount: 80,
            tax_amount: 9.6,
            total_amount: 89.6,
            ledger_account: { id: "purchase-ledger-1" },
            tax_rate: { id: "gst-pst", percentage: 12 },
          },
        ],
      }
    );

    expect(normalized.payload).toEqual(
      expect.objectContaining({
        contactId: "supplier-1",
        reference: "V-100",
        balance: 89.6,
        lines: [
          expect.objectContaining({
            ledgerAccountId: "purchase-ledger-1",
            taxRateId: "gst-pst",
            taxRate: 12,
          }),
        ],
      })
    );
  });

  it("preserves payment linkage, method, and bank identity", () => {
    const normalized = normalizeSageRecord(
      "supplier_bill_payment",
      "contact_payments",
      {
        id: "payment-1",
        updated_at: UPDATED,
        contact: { id: "supplier-1" },
        date: "2026-09-02",
        total_amount: 89.6,
        reference: "EFT-1",
        bank_account: { id: "bank-1" },
        payment_method: { id: "eft" },
        allocated_artefacts: [{ artefact: { id: "purchase-1" }, amount: 89.6 }],
      }
    );

    expect(normalized.payload).toEqual(
      expect.objectContaining({
        contactId: "supplier-1",
        amount: 89.6,
        bankAccountId: "bank-1",
        paymentMethodId: "eft",
        allocations: [{ artefactId: "purchase-1", amount: 89.6 }],
      })
    );
  });

  it("rejects a resource substitution", () => {
    expect(() =>
      normalizeSageRecord("invoice", "purchase_invoices", {
        id: "invoice-1",
      })
    ).toThrowError(/does not match invoice/);
  });
});
