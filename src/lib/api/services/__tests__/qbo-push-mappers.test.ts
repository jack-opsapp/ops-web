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
        GivenName: "Alex",
        FamilyName: "Maverick",
        PrimaryEmailAddr: { Address: "alex@maverick.test" },
        PrimaryPhone: { FreeFormNumber: "778-555-0199" },
        BillAddr: { Line1: "12 Yard Rd" },
      }),
    );
  });

  it("derives GivenName and FamilyName from the client name when no contact exists", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Charlie Blackwood",
        email: "cblackwood@email.com",
        phoneNumber: null,
        address: null,
        qbId: null,
        syncToken: null,
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({
        DisplayName: "Charlie Blackwood",
        GivenName: "Charlie",
        FamilyName: "Blackwood",
      }),
    );
  });

  it("prefers the primary contact name over the client name for GivenName/FamilyName", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Maverick Projects",
        qbId: null,
        syncToken: null,
      },
      primaryContact: {
        firstName: "Dana",
        lastName: "Cole",
        email: null,
        phoneNumber: null,
      },
    });

    expect(payload).toEqual(
      expect.objectContaining({ GivenName: "Dana", FamilyName: "Cole" }),
    );
  });

  it("emits GivenName only for a single-token client name", () => {
    const payload = mapClientToQboCustomer({
      client: { id: "client-1", name: "Cher", qbId: null, syncToken: null },
    });

    expect(payload.GivenName).toBe("Cher");
    expect(payload).not.toHaveProperty("FamilyName");
  });

  it("parses a comma-separated US address into structured BillAddr fields", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Charlie Blackwood",
        address: "10452 Scripps Ranch Blvd, San Diego, CA, United States",
        qbId: null,
        syncToken: null,
      },
    });

    expect(payload.BillAddr).toEqual({
      Line1: "10452 Scripps Ranch Blvd",
      City: "San Diego",
      CountrySubDivisionCode: "CA",
      Country: "United States",
    });
  });

  it("parses a Canadian address, classifying the trailing token as a postal code", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Saanich Client",
        address: "3912 Lancaster Rd, Saanich, BC, V8X 2B3",
        qbId: null,
        syncToken: null,
      },
    });

    expect(payload.BillAddr).toEqual({
      Line1: "3912 Lancaster Rd",
      City: "Saanich",
      CountrySubDivisionCode: "BC",
      PostalCode: "V8X 2B3",
    });
  });

  it("splits a combined 'STATE ZIP' trailing token into state and postal code", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Springfield Client",
        address: "742 Evergreen Terrace, Springfield, IL 62704",
        qbId: null,
        syncToken: null,
      },
    });

    expect(payload.BillAddr).toEqual({
      Line1: "742 Evergreen Terrace",
      City: "Springfield",
      CountrySubDivisionCode: "IL",
      PostalCode: "62704",
    });
  });

  it("keeps a single-line street address as BillAddr.Line1 only", () => {
    const payload = mapClientToQboCustomer({
      client: {
        id: "client-1",
        name: "Test Client",
        address: "123 OPS Test St",
        qbId: null,
        syncToken: null,
      },
    });

    expect(payload.BillAddr).toEqual({ Line1: "123 OPS Test St" });
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

  it("synthesizes one non-taxable fallback line from the total when an invoice has no line items", () => {
    const payload = mapInvoiceToQboInvoice({
      invoice: {
        id: "inv-legacy",
        qbId: null,
        docNumber: "INV-2025-00009",
        total: 8500,
        issueDate: "2025-10-12",
        dueDate: "2025-11-12",
      },
      client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
      lineItems: [],
      fallbackServiceItem,
      taxCodeRefs: { nonTaxable: "NON" },
    });

    expect(payload.Line).toEqual([
      expect.objectContaining({
        DetailType: "SalesItemLineDetail",
        Amount: 8500,
        SalesItemLineDetail: expect.objectContaining({
          ItemRef: { value: "1", name: "OPS Service" },
          Qty: 1,
          UnitPrice: 8500,
          TaxCodeRef: { value: "NON" },
        }),
      }),
    ]);
  });

  it("synthesizes one fallback line from the total when an estimate has no line items", () => {
    const payload = mapEstimateToQboEstimate({
      estimate: {
        id: "est-legacy",
        qbId: null,
        docNumber: "EST-1",
        total: 250,
        issueDate: "2026-06-05",
        expirationDate: "2026-07-05",
      },
      client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
      lineItems: [],
      fallbackServiceItem,
    });

    expect(payload.Line).toEqual([
      expect.objectContaining({
        Amount: 250,
        SalesItemLineDetail: expect.objectContaining({ ItemRef: { value: "1", name: "OPS Service" } }),
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

  it("adds a configured QuickBooks tax code to taxable sales lines", () => {
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
      lineItems: [{ ...invoiceLineItems[0], isTaxable: true }],
      fallbackServiceItem,
      taxCodeRefs: { taxable: "5" },
    });

    expect(payload.Line).toEqual([
      expect.objectContaining({
        SalesItemLineDetail: expect.objectContaining({
          TaxCodeRef: { value: "5" },
        }),
      }),
    ]);
  });

  it("adds a configured QuickBooks non-tax code to non-taxable sales lines", () => {
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
      lineItems: [{ ...invoiceLineItems[0], isTaxable: false }],
      fallbackServiceItem,
      taxCodeRefs: { nonTaxable: "NON" },
    });

    expect(payload.Line).toEqual([
      expect.objectContaining({
        SalesItemLineDetail: expect.objectContaining({
          TaxCodeRef: { value: "NON" },
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

  it("caps invoice document numbers at QuickBooks' doc_num limit", () => {
    const payload = mapInvoiceToQboInvoice({
      invoice: {
        id: "inv-1",
        qbId: null,
        docNumber: "OPS-QB-INV-123456789012",
        total: 125,
        issueDate: "2026-06-05",
        dueDate: "2026-06-20",
      },
      client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
      lineItems: invoiceLineItems,
      fallbackServiceItem,
    });

    expect(payload.DocNumber).toBe("OPS-QB-INV-1234567890");
    expect(String(payload.DocNumber)).toHaveLength(21);
  });

  it("caps estimate document numbers at QuickBooks' doc_num limit", () => {
    const payload = mapEstimateToQboEstimate({
      estimate: {
        id: "est-1",
        qbId: null,
        docNumber: "OPS-QB-EST-123456789012",
        total: 125,
        issueDate: "2026-06-05",
        expirationDate: "2026-07-05",
      },
      client: { id: "client-1", qbId: "44", name: "Maverick Projects" },
      lineItems: invoiceLineItems,
      fallbackServiceItem,
    });

    expect(payload.DocNumber).toBe("OPS-QB-EST-1234567890");
    expect(String(payload.DocNumber)).toHaveLength(21);
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
