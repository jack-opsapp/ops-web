import { describe, expect, it } from "vitest";
import {
  SageMappingError,
  buildSageContact,
  buildSageContactPayment,
  buildSagePurchaseInvoice,
  buildSageSalesDocument,
} from "../sage-push-mappers";

const lines = [
  {
    description: "Labour",
    quantity: "2.50",
    unitPrice: "80.00",
    subtotal: "200.00",
    ledgerAccountId: "sales-labour",
    taxRateId: "gst",
  },
  {
    description: "Membrane",
    quantity: "3",
    unitPrice: "33.335",
    subtotal: "100.01",
    ledgerAccountId: "sales-materials",
    taxRateId: "gst",
  },
];

describe("canonical Sage push mappers", () => {
  it("maps customer and supplier contacts with an explicit type", () => {
    expect(
      buildSageContact({
        name: "Acme",
        kind: "customer",
        email: "ops@acme.test",
        phone: "250-555-0100",
      })
    ).toEqual({
      name: "Acme",
      contact_type_ids: ["CUSTOMER"],
      email: "ops@acme.test",
      telephone: "250-555-0100",
    });
    expect(buildSageContact({ name: "Supply Co", kind: "supplier" })).toEqual({
      name: "Supply Co",
      contact_type_ids: ["VENDOR"],
    });
  });

  it.each([
    ["sales_estimates", "estimate_lines"],
    ["sales_quotes", "quote_lines"],
    ["sales_invoices", "invoice_lines"],
  ] as const)("preserves every mapped line in %s", (resource, lineKey) => {
    const payload = buildSageSalesDocument(resource, {
      contactId: "customer-1",
      date: "2026-09-03",
      dueOrExpiryDate: "2026-10-03",
      reference: "OPS-100",
      lines,
    });
    expect(payload.contact_id).toBe("customer-1");
    expect(payload[lineKey]).toEqual([
      {
        description: "Labour",
        quantity: 2.5,
        unit_price: 80,
        ledger_account_id: "sales-labour",
        tax_rate_id: "gst",
      },
      {
        description: "Membrane",
        quantity: 3,
        unit_price: 33.335,
        ledger_account_id: "sales-materials",
        tax_rate_id: "gst",
      },
    ]);
  });

  it("fails before I/O on empty lines, missing mappings, non-positive quantities, or inconsistent totals", () => {
    expect(() =>
      buildSageSalesDocument("sales_invoices", {
        contactId: "customer-1",
        date: "2026-09-03",
        dueOrExpiryDate: "2026-10-03",
        reference: "OPS-100",
        lines: [],
      })
    ).toThrowError(SageMappingError);
    expect(() =>
      buildSageSalesDocument("sales_invoices", {
        contactId: "customer-1",
        date: "2026-09-03",
        dueOrExpiryDate: "2026-10-03",
        reference: "OPS-100",
        lines: [{ ...lines[0], ledgerAccountId: null }],
      })
    ).toThrow(/ledger account/i);
    expect(() =>
      buildSageSalesDocument("sales_invoices", {
        contactId: "customer-1",
        date: "2026-09-03",
        dueOrExpiryDate: "2026-10-03",
        reference: "OPS-100",
        lines: [{ ...lines[0], quantity: "0" }],
      })
    ).toThrow(/quantity/i);
    expect(() =>
      buildSageSalesDocument("sales_invoices", {
        contactId: "customer-1",
        date: "2026-09-03",
        dueOrExpiryDate: "2026-10-03",
        reference: "OPS-100",
        lines: [{ ...lines[0], subtotal: "199.99" }],
      })
    ).toThrow(/subtotal/i);
  });

  it("maps purchase invoices with full line mappings and mandatory due date", () => {
    expect(
      buildSagePurchaseInvoice({
        contactId: "supplier-1",
        date: "2026-09-03",
        dueDate: "2026-10-03",
        reference: "SUP-12",
        lines,
      })
    ).toEqual({
      contact_id: "supplier-1",
      date: "2026-09-03",
      due_date: "2026-10-03",
      vendor_reference: "SUP-12",
      invoice_lines: expect.arrayContaining([
        expect.objectContaining({
          ledger_account_id: "sales-labour",
          tax_rate_id: "gst",
        }),
        expect.objectContaining({
          ledger_account_id: "sales-materials",
          tax_rate_id: "gst",
        }),
      ]),
    });
  });

  it.each(["CUSTOMER_RECEIPT", "VENDOR_PAYMENT"] as const)(
    "maps %s with exact account and allocation dependencies",
    (transactionType) => {
      expect(
        buildSageContactPayment({
          transactionType,
          contactId: "contact-1",
          bankAccountId: "bank-1",
          paymentMethodId: "method-1",
          date: "2026-09-03",
          amount: "125.25",
          allocations: [{ artefactId: "invoice-1", amount: "125.25" }],
          reference: "PAY-1",
        })
      ).toEqual(
        expect.objectContaining({
          transaction_type_id: transactionType,
          contact_id: "contact-1",
          bank_account_id: "bank-1",
          total_amount: 125.25,
          allocated_artefacts: [{ artefact_id: "invoice-1", amount: 125.25 }],
        })
      );
    }
  );

  it("rejects missing payment accounts and over-allocation", () => {
    expect(() =>
      buildSageContactPayment({
        transactionType: "CUSTOMER_RECEIPT",
        contactId: "contact-1",
        bankAccountId: null,
        paymentMethodId: null,
        date: "2026-09-03",
        amount: "100.00",
        allocations: [{ artefactId: "invoice-1", amount: "100.01" }],
        reference: null,
      })
    ).toThrow(/bank account/i);
    expect(() =>
      buildSageContactPayment({
        transactionType: "CUSTOMER_RECEIPT",
        contactId: "contact-1",
        bankAccountId: "bank-1",
        paymentMethodId: null,
        date: "2026-09-03",
        amount: "100.00",
        allocations: [{ artefactId: "invoice-1", amount: "100.01" }],
        reference: null,
      })
    ).toThrow(/exceed/i);
  });
});
