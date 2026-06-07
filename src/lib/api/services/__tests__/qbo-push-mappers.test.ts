import { describe, expect, it } from "vitest";

import fallbackServiceItem from "../../../../../tests/fixtures/qbo/push/fallback-service-item.json";
import invoiceLineItems from "../../../../../tests/fixtures/qbo/push/invoice-line-items.json";
import {
  assertQboRef,
  mapClientToQboCustomer,
  mapEstimateToQboEstimate,
  mapInvoiceToQboInvoice,
  mapPaymentToQboPayment,
} from "../qbo-push-mappers";

describe("QBO push mappers", () => {
  it("maps a parent client to a QuickBooks Customer create payload", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Maverick Projects",
        email: "office@maverick.test",
        phoneNumber: "778-555-0100",
        address: "12 Yard Rd",
        qbId: null,
        syncToken: null,
      },
      primaryContact: {
        firstName: "Alex",
        lastName: "Maverick",
        email: "alex@maverick.test",
        phoneNumber: "778-555-0199",
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        CompanyName: "Maverick Projects",
        DisplayName: "Maverick Projects",
        PrimaryEmailAddr: { Address: "alex@maverick.test" },
        PrimaryPhone: { FreeFormNumber: "778-555-0199" },
        BillAddr: { Line1: "12 Yard Rd" },
      }),
    );
  });

  it("omits optional empty email and phone fields instead of emitting empty strings", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Maverick Projects",
        email: "",
        phoneNumber: " ",
        address: null,
        qbId: null,
        syncToken: null,
      },
      primaryContact: {
        firstName: "Alex",
        lastName: "Maverick",
        email: "",
        phoneNumber: null,
      },
    });

    expect(payload).not.toHaveProperty("PrimaryEmailAddr");
    expect(payload).not.toHaveProperty("PrimaryPhone");
    expect(payload).not.toHaveProperty("BillAddr");
  });

  it("blocks invoice payloads without a linked QuickBooks customer", () => {
    expect(() =>
      mapInvoiceToQboInvoice({
        invoice: {
          id: "inv-1",
          qbId: null,
          docNumber: "INV-1",
          total: 125,
          issueDate: "2026-06-05",
          dueDate: "2026-06-20",
        },
        client: { id: "client-1", qbId: null, name: "Maverick Projects" },
        lineItems: [],
      }),
    ).toThrow("QuickBooks customer link required");
  });

  it("blocks estimate payloads without a linked QuickBooks customer", () => {
    expect(() =>
      mapEstimateToQboEstimate({
        estimate: {
          id: "est-1",
          qbId: null,
          docNumber: "EST-1",
          total: 250,
          issueDate: "2026-06-05",
          expirationDate: "2026-07-05",
        },
        client: { id: "client-1", qbId: null, name: "Maverick Projects" },
        lineItems: [],
      }),
    ).toThrow("QuickBooks customer link required");
  });

  it("rejects missing and non-numeric QuickBooks refs", () => {
    expect(() => assertQboRef(null, "QuickBooks customer link")).toThrow(
      "QuickBooks customer link required",
    );
    expect(() => assertQboRef("abc-123", "QuickBooks customer link")).toThrow(
      "Invalid QuickBooks customer link",
    );
  });

  it("emits a service fallback line item when the OPS line has no product ref", () => {
    const payload = mapInvoiceToQboInvoice({
      invoice: {
        id: "inv-1",
        qbId: null,
        docNumber: "INV-1",
        total: 125,
        issueDate: "2026-06-05",
        dueDate: "2026-06-20",
      },
      client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
      lineItems: invoiceLineItems,
      fallbackServiceItem,
    });

    expect(payload.Line).toEqual([
      expect.objectContaining({
        DetailType: "SalesItemLineDetail",
        Description: "Field work",
        Amount: 125,
        SalesItemLineDetail: expect.objectContaining({
          ItemRef: { value: "1", name: "OPS Service" },
          Qty: 2,
          UnitPrice: 62.5,
        }),
      }),
    ]);
  });

  it("blocks invoice fallback lines when no concrete service item ref is available", () => {
    expect(() =>
      mapInvoiceToQboInvoice({
        invoice: {
          id: "inv-1",
          qbId: null,
          docNumber: "INV-1",
          total: 125,
          issueDate: "2026-06-05",
          dueDate: "2026-06-20",
        },
        client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
        lineItems: invoiceLineItems,
      }),
    ).toThrow("QuickBooks fallback service item link required");
  });

  it("uses the concrete fallback service item ref for estimate lines", () => {
    const payload = mapEstimateToQboEstimate({
      estimate: {
        id: "est-1",
        qbId: null,
        docNumber: "EST-1",
        total: 125,
        issueDate: "2026-06-05",
        expirationDate: "2026-07-05",
      },
      client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
      lineItems: invoiceLineItems,
      fallbackServiceItem,
    });

    expect(payload.Line).toEqual([
      expect.objectContaining({
        SalesItemLineDetail: expect.objectContaining({
          ItemRef: { value: "1", name: "OPS Service" },
        }),
      }),
    ]);
  });

  it("requires SyncToken when mapping a linked customer update", () => {
    expect(() =>
      mapClientToQboCustomer({
        client: {
          id: "client-1",
          name: "Maverick Projects",
          qbId: "44",
          syncToken: "",
        },
      }),
    ).toThrow("QuickBooks entity SyncToken required");

    expect(
      mapClientToQboCustomer({
        client: {
          id: "client-1",
          name: "Maverick Projects",
          qbId: "44",
          syncToken: "3",
        },
      }),
    ).toEqual(expect.objectContaining({ Id: "44", SyncToken: "3" }));
  });

  it("requires and includes SyncToken when mapping a linked invoice update", () => {
    expect(() =>
      mapInvoiceToQboInvoice({
        invoice: {
          id: "inv-1",
          qbId: "90",
          syncToken: null,
          docNumber: "INV-1",
          total: 125,
          issueDate: "2026-06-05",
          dueDate: "2026-06-20",
        },
        client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
        lineItems: invoiceLineItems,
        fallbackServiceItem,
      }),
    ).toThrow("QuickBooks entity SyncToken required");

    expect(
      mapInvoiceToQboInvoice({
        invoice: {
          id: "inv-1",
          qbId: "90",
          syncToken: "5",
          docNumber: "INV-1",
          total: 125,
          issueDate: "2026-06-05",
          dueDate: "2026-06-20",
        },
        client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
        lineItems: invoiceLineItems,
        fallbackServiceItem,
      }),
    ).toEqual(expect.objectContaining({ Id: "90", SyncToken: "5" }));
  });

  it("maps a payment to a linked QuickBooks invoice", () => {
    const payload = mapPaymentToQboPayment({
      payment: {
        id: "pay-1",
        amount: 125,
        paymentDate: "2026-06-05",
        referenceNumber: "PMT-1",
        qbId: null,
      },
      client: { id: "client-1", qbId: "44" },
      invoice: { id: "inv-1", qbId: "90", balanceDue: 125 },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        CustomerRef: { value: "44" },
        TotalAmt: 125,
        TxnDate: "2026-06-05",
        PaymentRefNum: "PMT-1",
        Line: [
          expect.objectContaining({
            Amount: 125,
            LinkedTxn: [{ TxnId: "90", TxnType: "Invoice" }],
          }),
        ],
      }),
    );
  });

  it("caps payment reference numbers at QuickBooks' doc_num limit", () => {
    const payload = mapPaymentToQboPayment({
      payment: {
        id: "pay-1",
        amount: 125,
        paymentDate: "2026-06-05",
        referenceNumber: "OPS-QB-PAY-123456789012",
        qbId: null,
      },
      client: { id: "client-1", qbId: "44" },
      invoice: { id: "inv-1", qbId: "90", balanceDue: 125 },
    });

    expect(payload.PaymentRefNum).toBe("OPS-QB-PAY-1234567890");
    expect(String(payload.PaymentRefNum)).toHaveLength(21);
  });
});
