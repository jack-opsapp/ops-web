import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { extractPdfText, parseDeksMartInvoiceText } from "../pdf-extraction";

const DEKSMART_TEXT = `
INVOICE
DeksMart Vinyl Products
Invoice No. 43066
Invoice Date 08/25/2026
PO Number
Ship Via Loomis
Tracking 1Z999AA10123456784
Description Ordered Invoiced UOM Rate Amount
123 Sample Street, Nanaimo BC
VINYL-60-SMOOTH 60 mil Smooth Vinyl 62.50 63.00 SQFT 2.25 141.75
FREIGHT Freight 1 1 EA 95.00 95.00
456 Example Avenue, Victoria BC
VINYL-45-FUZZY 45 mil Fuzzy Vinyl 40.00 40.00 SQFT 2.00 80.00
GLUE Adhesive 2 2 EA 50.00 100.00
Subtotal 416.75
GST 20.84
Total CAD 437.59
`;

const ACTUAL_DEKSMART_TEXT = `
2026-08-25 42995
Canpro Deck & Rail - Victoria Div.
Ace Prepaid
Tracking Number
AA5255032
P.O. No.
Invoice
Ship Via Invoice #
Item Description Invoiced U/M Rate Amount Ordered
VVCB68 Ultra - Cobblestone 68 mil - "1050 Terrace Ave" 66 ft 16.92 1,116.72 66
VVBO68 Ultra - Boardwalk 68 mil - "74 Sims Ave" 35 ft 16.92 592.20 35
VG2510 DekSmart 2510 Contact 2 ea 219.00 438.00 2
VHGC Hazardous Goods Charge 1 ea 10.00 10.00 1
VSC Shipping Charge 1 210.00 210.00 1
GST@5.0% 118.35
Total Tax 118.35
$2,485.27
$2,485.27
$2,366.92
`;

describe("supplier invoice PDF extraction", () => {
  it("extracts searchable text from a real generated PDF", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([612, 792]);
    page.drawText("DeksMart invoice 43066", { x: 48, y: 730, font, size: 12 });

    const result = await extractPdfText(await document.save());

    expect(result.pages).toHaveLength(1);
    expect(result.text).toContain("DeksMart invoice 43066");
  });

  it("extracts DeksMart identity, shipment, job, and line facts conservatively", () => {
    const result = parseDeksMartInvoiceText(DEKSMART_TEXT);

    expect(result).toMatchObject({
      supplierName: "DeksMart Vinyl Products",
      invoiceNumber: "43066",
      invoiceDate: "2026-08-25",
      dueDate: null,
      purchaseOrder: null,
      shippingReference: "Loomis · 1Z999AA10123456784",
      currency: "CAD",
      subtotal: "416.75",
      taxTotal: "20.84",
      total: "437.59",
    });
    expect(result.lines).toEqual([
      {
        position: 1,
        sku: "VINYL-60-SMOOTH",
        description: "60 mil Smooth Vinyl",
        orderedQuantity: "62.50",
        invoicedQuantity: "63.00",
        unitOfMeasure: "SQFT",
        unitPrice: "2.25",
        subtotal: "141.75",
        taxAmount: "0.00",
        total: "141.75",
        jobHint: "123 Sample Street, Nanaimo BC",
      },
      {
        position: 2,
        sku: "FREIGHT",
        description: "Freight",
        orderedQuantity: "1",
        invoicedQuantity: "1",
        unitOfMeasure: "EA",
        unitPrice: "95.00",
        subtotal: "95.00",
        taxAmount: "0.00",
        total: "95.00",
        jobHint: "123 Sample Street, Nanaimo BC",
      },
      {
        position: 3,
        sku: "VINYL-45-FUZZY",
        description: "45 mil Fuzzy Vinyl",
        orderedQuantity: "40.00",
        invoicedQuantity: "40.00",
        unitOfMeasure: "SQFT",
        unitPrice: "2.00",
        subtotal: "80.00",
        taxAmount: "0.00",
        total: "80.00",
        jobHint: "456 Example Avenue, Victoria BC",
      },
      {
        position: 4,
        sku: "GLUE",
        description: "Adhesive",
        orderedQuantity: "2",
        invoicedQuantity: "2",
        unitOfMeasure: "EA",
        unitPrice: "50.00",
        subtotal: "100.00",
        taxAmount: "0.00",
        total: "100.00",
        jobHint: "456 Example Avenue, Victoria BC",
      },
    ]);
    expect(result.confidence).toBe("review_required");
    expect(result.provenance.invoiceNumber).toContain("Invoice No. 43066");
  });

  it("does not invent missing purchase orders, due dates, tracking, or lines", () => {
    const result = parseDeksMartInvoiceText(`
      DeksMart Vinyl Products
      Invoice No. 42995
      Invoice Date 08/20/2026
      Subtotal 100.00
      GST 5.00
      Total CAD 105.00
    `);

    expect(result.purchaseOrder).toBeNull();
    expect(result.dueDate).toBeNull();
    expect(result.shippingReference).toBeNull();
    expect(result.lines).toEqual([]);
  });

  it("understands DeksMart's actual column-ordered PDF text layer", () => {
    const result = parseDeksMartInvoiceText(ACTUAL_DEKSMART_TEXT);

    expect(result).toMatchObject({
      invoiceNumber: "42995",
      invoiceDate: "2026-08-25",
      dueDate: null,
      purchaseOrder: null,
      shippingReference: "Ace Prepaid · AA5255032",
      subtotal: "2366.92",
      taxTotal: "118.35",
      total: "2485.27",
    });
    expect(result.lines).toHaveLength(5);
    expect(result.lines[0]).toMatchObject({
      sku: "VVCB68",
      description: "Ultra - Cobblestone 68 mil",
      invoicedQuantity: "66",
      orderedQuantity: "66",
      unitOfMeasure: "FT",
      unitPrice: "16.92",
      total: "1116.72",
      jobHint: "1050 Terrace Ave",
    });
    expect(result.lines[4]).toMatchObject({
      sku: "VSC",
      description: "Shipping Charge",
      unitOfMeasure: null,
      unitPrice: "210.00",
      total: "210.00",
    });
  });

  it("does not mistake flashing dimensions for a quoted job address", () => {
    const result = parseDeksMartInvoiceText(`
      2026-09-02 43066
      DeksMart Vinyl Products
      VDF05 Inside Flashing - 1-1/2" x 2-1/2" 240 ft 0.88 211.20 240
      Total Tax 10.56
      $221.76
      $221.76
      $211.20
    `);

    expect(result.lines[0]).toMatchObject({
      description: 'Inside Flashing - 1-1/2" x 2-1/2"',
      jobHint: null,
    });
  });
});
