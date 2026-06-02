import { describe, it, expect } from "vitest";
import customers from "../../../../../tests/fixtures/qbo/customer.json";
import invoices from "../../../../../tests/fixtures/qbo/invoice.json";
import estimates from "../../../../../tests/fixtures/qbo/estimate.json";
import payments from "../../../../../tests/fixtures/qbo/payment.json";
import {
  normalizeCustomer,
  normalizeInvoice,
  normalizeEstimate,
  flattenSalesLines,
  splitPaymentLines,
  deriveInvoiceStatus,
  mapEstimateStatus,
  joinBillAddr,
} from "../qbo-normalize";

const TODAY = new Date("2026-04-20T00:00:00Z");

describe("normalizeCustomer", () => {
  it("maps id/name/email/phone/joined address/active", () => {
    const c = normalizeCustomer(customers[0]);
    expect(c.qb_id).toBe("58");
    expect(c.display_name).toBe("Cool Cars");
    expect(c.email).toBe("cool_cars@intuit.com");
    expect(c.phone).toBe("(415) 555-9933");
    expect(c.address).toBe("65 Ocean Dr., Half Moon Bay, CA 94213");
    expect(c.active).toBe(true);
  });

  it("handles name-only inactive customer", () => {
    const c = normalizeCustomer(customers[1]);
    expect(c.qb_id).toBe("12");
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.address).toBeNull();
    expect(c.active).toBe(false);
  });
});

describe("joinBillAddr", () => {
  it("joins present parts, comma-separating line/city and space-separating region/postal", () => {
    expect(
      joinBillAddr({ Line1: "1 A St", City: "Townsville", CountrySubDivisionCode: "BC", PostalCode: "V1V 1V1" })
    ).toBe("1 A St, Townsville, BC V1V 1V1");
  });
  it("returns null for empty/absent address", () => {
    expect(joinBillAddr(undefined)).toBeNull();
    expect(joinBillAddr({})).toBeNull();
  });
});

describe("flattenSalesLines", () => {
  it("keeps only SalesItemLineDetail, skips SubTotal, flattens GroupLineDetail", () => {
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.name)).toEqual(["Rock Fountain", "Pump Hours"]);

    const estLines = flattenSalesLines((estimates[0] as { Line: unknown[] }).Line);
    expect(estLines).toHaveLength(1);
    expect(estLines[0].name).toBe("Garden Install");
    expect(estLines[0].quantity).toBe(3.5);
  });

  it("derives is_taxable from TaxCodeRef and sort_order from LineNum", () => {
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line);
    expect(lines[0].is_taxable).toBe(true); // TAX
    expect(lines[1].is_taxable).toBe(false); // NON
    expect(lines[0].sort_order).toBe(1);
    expect(lines[1].sort_order).toBe(2);
  });

  it("defaults quantity to 1 and amount equals qty*unitPrice", () => {
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line);
    expect(lines[1].quantity).toBe(9.5);
    expect(lines[1].unit_price).toBe(5);
    expect(lines[1].amount).toBe(47.5);
  });
});

describe("normalizeInvoice", () => {
  it("maps headers, txn-level tax, estimate linkage; flags zero-total skip", () => {
    const open = normalizeInvoice(invoices[0], TODAY);
    expect(open.staging.qb_id).toBe("130");
    expect(open.staging.doc_number).toBe("1037");
    expect(open.staging.customer_qb_id).toBe("58");
    expect(open.staging.estimate_qb_id).toBe("98");
    expect(open.staging.total).toBe(362.07);
    expect(open.staging.subtotal).toBe(335.25);
    expect(open.staging.tax_amount).toBe(26.82);
    expect(open.staging.tax_rate).toBe(8);
    expect(open.staging.balance).toBe(362.07);
    expect(open.staging.derived_status).toBe("past_due"); // DueDate 2026-05-01 > TODAY → not past; check next
    expect(open.skipped).toBe(false);

    const zero = normalizeInvoice(invoices[1], TODAY);
    expect(zero.skipped).toBe(true); // zero-total → skipped+flagged
  });

  it("emits one staged line per SalesItemLineDetail with parent linkage", () => {
    const open = normalizeInvoice(invoices[0], TODAY);
    expect(open.lines).toHaveLength(2);
    expect(open.lines[0].parent_type).toBe("invoice");
    expect(open.lines[0].parent_qb_id).toBe("130");
  });
});

describe("deriveInvoiceStatus", () => {
  it("paid when balance 0", () => {
    expect(deriveInvoiceStatus(0, 100, "2026-05-01", TODAY)).toBe("paid");
  });
  it("partially_paid when 0 < balance < total", () => {
    expect(deriveInvoiceStatus(40, 100, "2026-05-01", TODAY)).toBe("partially_paid");
  });
  it("past_due when full balance and due date passed", () => {
    expect(deriveInvoiceStatus(100, 100, "2026-04-01", TODAY)).toBe("past_due");
  });
  it("awaiting_payment when full balance and not yet due", () => {
    expect(deriveInvoiceStatus(100, 100, "2026-05-01", TODAY)).toBe("awaiting_payment");
  });
});

describe("mapEstimateStatus", () => {
  it("maps QB TxnStatus to OPS estimate status enum", () => {
    expect(mapEstimateStatus("Accepted", null, TODAY)).toBe("approved");
    expect(mapEstimateStatus("Closed", null, TODAY)).toBe("converted");
    expect(mapEstimateStatus("Rejected", null, TODAY)).toBe("declined");
    expect(mapEstimateStatus("Pending", "2026-05-01", TODAY)).toBe("sent");
    expect(mapEstimateStatus("Pending", "2026-04-01", TODAY)).toBe("expired");
  });
});

describe("normalizeEstimate", () => {
  it("maps headers and flattened lines", () => {
    const e = normalizeEstimate(estimates[0], TODAY);
    expect(e.staging.qb_id).toBe("98");
    expect(e.staging.estimate_number).toBe("1001");
    expect(e.staging.txn_status).toBe("approved");
    expect(e.staging.expiration_date).toBe("2026-04-10");
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0].parent_type).toBe("estimate");
    expect(e.lines[0].parent_qb_id).toBe("98");
  });
});

describe("splitPaymentLines", () => {
  it("emits one row per LinkedTxn[Invoice] line; reports unapplied", () => {
    const rows = splitPaymentLines(payments[0]);
    expect(rows.applied).toHaveLength(2);
    expect(rows.applied[0].invoice_qb_id).toBe("130");
    expect(rows.applied[0].amount).toBe(362.07);
    expect(rows.applied[0].reference_number).toBe("CHK-8841");
    expect(rows.applied[1].invoice_qb_id).toBe("131");
    expect(rows.unappliedAmt).toBe(137.93);
    expect(rows.payment_method).toBe("Check");
    expect(rows.total_amt).toBe(500);
    expect(rows.customer_qb_id).toBe("58");
  });
});
