import { describe, expect, it } from "vitest";

import {
  ProviderMappingError,
  buildQuickBooksBillPayload,
  buildQuickBooksBillPaymentPayload,
  buildQuickBooksSupplierPayload,
  buildSageContactPaymentPayload,
  buildSagePurchaseInvoicePayload,
  buildSageSupplierPayload,
} from "../provider-mappers";

const bill = {
  supplier: {
    displayName: "Example Vinyl Products",
    email: "ap@example.test",
    phone: "250-555-0100",
    taxNumber: "GST-TEST",
  },
  invoiceNumber: "INV-42995",
  invoiceDate: "2026-08-25",
  dueDate: "2026-09-24",
  currency: "CAD",
  subtotal: "2366.92",
  taxTotal: "118.35",
  total: "2485.27",
  lines: [
    {
      id: "10000000-0000-4000-8000-000000000011",
      description: "Vinyl membrane",
      quantity: "66",
      unitPrice: "16.92",
      subtotal: "1116.72",
      taxAmount: "55.84",
      total: "1172.56",
      externalAccountId: "82",
      externalTaxCodeId: "GST",
      projectAllocations: [{ externalProjectId: "91", amount: "1172.56" }],
    },
    {
      id: "10000000-0000-4000-8000-000000000012",
      description: "Freight",
      quantity: "1",
      unitPrice: "1250.20",
      subtotal: "1250.20",
      taxAmount: "62.51",
      total: "1312.71",
      externalAccountId: "82",
      externalTaxCodeId: "GST",
      projectAllocations: [{ externalProjectId: "92", amount: "1312.71" }],
    },
  ],
};

describe("supplier bill provider mappers", () => {
  it("maps the canonical supplier to QuickBooks Vendor", () => {
    expect(buildQuickBooksSupplierPayload(bill.supplier)).toEqual({
      DisplayName: "Example Vinyl Products",
      CompanyName: "Example Vinyl Products",
      PrimaryEmailAddr: { Address: "ap@example.test" },
      PrimaryPhone: { FreeFormNumber: "250-555-0100" },
      TaxIdentifier: "GST-TEST",
    });
  });

  it("maps an unpaid document to a QuickBooks Bill with account and tax refs", () => {
    expect(buildQuickBooksBillPayload(bill, "501")).toEqual({
      VendorRef: { value: "501" },
      DocNumber: "INV-42995",
      TxnDate: "2026-08-25",
      DueDate: "2026-09-24",
      CurrencyRef: { value: "CAD" },
      Line: [
        {
          Amount: 1116.72,
          Description: "Vinyl membrane",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "82" },
            TaxCodeRef: { value: "GST" },
            CustomerRef: { value: "91" },
          },
        },
        {
          Amount: 1250.2,
          Description: "Freight",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "82" },
            TaxCodeRef: { value: "GST" },
            CustomerRef: { value: "92" },
          },
        },
      ],
    });
  });

  it("splits one OPS line across QuickBooks jobs without losing a cent", () => {
    const split = {
      ...bill,
      lines: [
        {
          ...bill.lines[0],
          projectAllocations: [
            { externalProjectId: "91", amount: "781.71" },
            { externalProjectId: "92", amount: "390.85" },
          ],
        },
      ],
    };
    const payload = buildQuickBooksBillPayload(split, "501");
    const lines = payload.Line as Array<{ Amount: number }>;
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, line) => sum + line.Amount, 0)).toBe(1116.72);
    expect(lines.map((line) => line.Amount)).toEqual([744.48, 372.24]);
  });

  it("maps supplier settlement to QuickBooks BillPayment", () => {
    expect(
      buildQuickBooksBillPaymentPayload({
        vendorId: "501",
        billId: "701",
        amount: "400.00",
        paymentDate: "2026-09-03",
        paymentMethod: "check",
        bankAccountId: "35",
        reference: "CHK-100",
      })
    ).toEqual({
      VendorRef: { value: "501" },
      TxnDate: "2026-09-03",
      TotalAmt: 400,
      PayType: "Check",
      CheckPayment: { BankAccountRef: { value: "35" } },
      DocNumber: "CHK-100",
      Line: [
        {
          Amount: 400,
          LinkedTxn: [{ TxnId: "701", TxnType: "Bill" }],
        },
      ],
    });
  });

  it("maps the canonical supplier and bill to Sage vendor purchase contracts", () => {
    expect(buildSageSupplierPayload(bill.supplier)).toEqual({
      name: "Example Vinyl Products",
      contact_type_ids: ["VENDOR"],
      email: "ap@example.test",
      telephone: "250-555-0100",
      tax_number: "GST-TEST",
    });
    expect(buildSagePurchaseInvoicePayload(bill, "sage-vendor-1")).toEqual({
      contact_id: "sage-vendor-1",
      date: "2026-08-25",
      due_date: "2026-09-24",
      vendor_reference: "INV-42995",
      invoice_lines: [
        {
          description: "Vinyl membrane",
          quantity: 66,
          unit_price: 16.92,
          ledger_account_id: "82",
          tax_rate_id: "GST",
        },
        {
          description: "Freight",
          quantity: 1,
          unit_price: 1250.2,
          ledger_account_id: "82",
          tax_rate_id: "GST",
        },
      ],
    });
  });

  it("fails closed when Sage-required dates or payment mappings are missing", () => {
    expect(() =>
      buildSagePurchaseInvoicePayload({ ...bill, dueDate: null }, "vendor")
    ).toThrowError(
      new ProviderMappingError(
        "sage_due_date_required",
        "Sage requires a due date before this bill can sync."
      )
    );
    expect(() =>
      buildSageContactPaymentPayload({
        vendorId: "vendor",
        billId: "bill",
        amount: "100.00",
        paymentDate: "2026-09-03",
        bankAccountId: null,
        paymentMethodId: null,
        reference: null,
      })
    ).toThrowError(
      new ProviderMappingError(
        "sage_bank_account_required",
        "Sage requires a bank account mapping before this payment can sync."
      )
    );
  });

  it("maps supplier settlement to Sage ContactPayment", () => {
    expect(
      buildSageContactPaymentPayload({
        vendorId: "vendor",
        billId: "bill",
        amount: "100.00",
        paymentDate: "2026-09-03",
        bankAccountId: "bank",
        paymentMethodId: "method",
        reference: "PAY-1",
      })
    ).toEqual({
      transaction_type_id: "VENDOR_PAYMENT",
      contact_id: "vendor",
      bank_account_id: "bank",
      date: "2026-09-03",
      total_amount: 100,
      payment_method_id: "method",
      reference: "PAY-1",
      allocated_artefacts: [{ artefact_id: "bill", amount: 100 }],
    });
  });
});
