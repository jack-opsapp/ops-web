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
  buildItemTypeMap,
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

describe("buildItemTypeMap", () => {
  it("maps QB Item.Id → Item.Type, skipping records missing Id or Type", () => {
    const map = buildItemTypeMap([
      { Id: "5", Type: "Inventory", Name: "Rock Fountain" },
      { Id: "11", Type: "NonInventory", Name: "Pump" },
      { Id: "19", Type: "Service", Name: "Installation" },
      { Id: "20" }, // no Type → skipped
      { Type: "Inventory" }, // no Id → skipped
    ]);
    expect(map.get("5")).toBe("Inventory");
    expect(map.get("11")).toBe("NonInventory");
    expect(map.get("19")).toBe("Service");
    expect(map.has("20")).toBe(false);
    expect(map.size).toBe(3);
  });

  it("returns an empty map for non-array / empty input", () => {
    expect(buildItemTypeMap(undefined).size).toBe(0);
    expect(buildItemTypeMap([]).size).toBe(0);
  });
});

describe("flattenSalesLines item-type resolution", () => {
  it("resolves each line's ItemRef.value → QB Item.Type via the catalog map", () => {
    // Invoice 130: line 1 ItemRef.value "5", line 2 ItemRef.value "11".
    const itemTypes = buildItemTypeMap([
      { Id: "5", Type: "Inventory" },
      { Id: "11", Type: "Service" },
    ]);
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line, itemTypes);
    expect(lines[0].qb_item_type).toBe("Inventory"); // Rock Fountain → ItemRef 5
    expect(lines[1].qb_item_type).toBe("Service"); // Pump → ItemRef 11
  });

  it("resolves ItemRef.value inside a nested GroupLineDetail line", () => {
    // Estimate 98: the single sales line lives under GroupLineDetail, ItemRef.value "19".
    const itemTypes = buildItemTypeMap([{ Id: "19", Type: "NonInventory" }]);
    const lines = flattenSalesLines((estimates[0] as { Line: unknown[] }).Line, itemTypes);
    expect(lines).toHaveLength(1);
    expect(lines[0].qb_item_type).toBe("NonInventory");
  });

  it("yields null qb_item_type when the item is unknown or no map is supplied", () => {
    expect(flattenSalesLines((invoices[0] as { Line: unknown[] }).Line)[0].qb_item_type).toBeNull();
    const partial = buildItemTypeMap([{ Id: "5", Type: "Inventory" }]);
    const lines = flattenSalesLines((invoices[0] as { Line: unknown[] }).Line, partial);
    expect(lines[0].qb_item_type).toBe("Inventory"); // known
    expect(lines[1].qb_item_type).toBeNull(); // ItemRef 11 not in map
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
    expect(open.staging.derived_status).toBe("awaiting_payment"); // full balance, DueDate 2026-05-01 > TODAY 2026-04-20 → not past due
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
    expect(e.staging.doc_number).toBe("1001");
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
