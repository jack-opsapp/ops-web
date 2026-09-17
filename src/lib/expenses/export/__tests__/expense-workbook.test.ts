import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { writeExpenseWorkbook, contrastTextFor, currencyNumberFormat } from "../expense-workbook";
import {
  buildExpenseExportDocument,
  DEFAULT_EXPORT_LABELS,
  type ExportLineInput,
} from "../expense-export-model";

// Invented data only — ops-web is a PUBLIC repo.

function line(over: Partial<ExportLineInput> = {}): ExportLineInput {
  return {
    id: "l1",
    expenseDate: "2026-08-07",
    merchantName: "Harbour Supply",
    description: "Sanding pads",
    amount: 78.34,
    taxAmount: null,
    currency: "CAD",
    status: "approved",
    paymentMethod: "personal_card",
    isRecurring: false,
    receiptMissingReason: null,
    receiptMissingNote: null,
    rejectionReason: null,
    allocations: [{ projectId: "p1", projectTitle: "Deck 1 - 200 Alder St", percentage: 100 }],
    ...over,
  };
}

function doc(over: { lines?: ExportLineInput[]; batch?: Record<string, unknown> } = {}) {
  const lines = over.lines ?? [line()];
  return buildExpenseExportDocument({
    batch: {
      batchNumber: "EXP-BATCH-0042",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "approved",
      totalAmount: 78.34,
      approvedAmount: 0,
      reimbursementAmount: 78.34,
      ...over.batch,
    },
    lines,
    company: {
      name: "Northgate Decking",
      address: "88 Harbour Rd, Springfield, ST A1B 2C3",
      phone: "(555) 010-4477",
      email: "office@northgatedecking.example",
      website: "https://northgatedecking.example",
      logoUrl: "https://cdn.example/logo.png",
    },
    person: {
      firstName: "Dana",
      lastName: "Whitfield",
      email: "dana@northgatedecking.example",
      phone: "(555) 010-9922",
      homeAddress: "14 Cedar Lane, Springfield, ST A1B 9Z9",
    },
    accentColor: "#417394",
    labels: DEFAULT_EXPORT_LABELS,
    locale: "en-CA",
  });
}

/** A real 1x1 PNG — enough to prove an image survives the round trip. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function reopen(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function findRow(ws: ExcelJS.Worksheet, text: string): ExcelJS.Row | null {
  let hit: ExcelJS.Row | null = null;
  ws.eachRow((row) => {
    if (hit) return;
    row.eachCell((cell) => {
      if (!hit && String(cell.value ?? "").trim() === text) hit = row;
    });
  });
  return hit;
}

/** The value of the last non-empty cell in a row — where money sits. */
function lastValue(row: ExcelJS.Row): unknown {
  let last: unknown = null;
  row.eachCell((cell) => {
    if (cell.value !== null && cell.value !== undefined && cell.value !== "") last = cell.value;
  });
  return last;
}

describe("contrast", () => {
  it("puts white on a dark brand colour", () => {
    expect(contrastTextFor("#417394")).toBe("FFFFFFFF");
    expect(contrastTextFor("#004070")).toBe("FFFFFFFF");
  });

  it("puts dark text on a light brand colour so the header stays readable", () => {
    expect(contrastTextFor("#F2C94C")).toBe("FF1A1A1A");
    expect(contrastTextFor("#FFFFFF")).toBe("FF1A1A1A");
  });
});

describe("currency formats", () => {
  it("uses the right symbol per currency", () => {
    expect(currencyNumberFormat("CAD")).toBe('"$"#,##0.00');
    expect(currencyNumberFormat("USD")).toBe('"$"#,##0.00');
    expect(currencyNumberFormat("EUR")).toBe('"€"#,##0.00');
    expect(currencyNumberFormat("GBP")).toBe('"£"#,##0.00');
  });

  it("falls back to the code rather than guessing a symbol", () => {
    expect(currencyNumberFormat("JPY")).toBe('#,##0.00" JPY"');
  });
});

describe("the written workbook", () => {
  it("opens as a real xlsx with one sheet", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    expect(wb.worksheets).toHaveLength(1);
  });

  it("writes costs as numbers with a currency format, not text", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const ws = wb.worksheets[0];
    const row = findRow(ws, "Sanding pads");
    expect(row).not.toBeNull();
    const cost = row!.getCell(6);
    expect(typeof cost.value).toBe("number");
    expect(cost.value).toBe(78.34);
    expect(cost.numFmt).toBe('"$"#,##0.00');
  });

  it("writes dates as real dates, not strings", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const row = findRow(wb.worksheets[0], "Sanding pads");
    const date = row!.getCell(1);
    expect(date.value).toBeInstanceOf(Date);
    expect(date.numFmt).toBe("mm/dd/yyyy");
  });

  it("fills the table header with the brand colour and a readable text colour", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const header = findRow(wb.worksheets[0], "DATE");
    expect(header).not.toBeNull();
    const cell = header!.getCell(1);
    const fill = cell.fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe("FF417394");
    expect((cell.font?.color as { argb: string }).argb).toBe("FFFFFFFF");
  });

  it("prints the brand bar across the top in the brand colour", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const fill = wb.worksheets[0].getCell("A1").fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe("FF417394");
  });

  it("embeds the logo when bytes are supplied", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), { buffer: PNG_1X1, extension: "png" }));
    expect(wb.model.media).toHaveLength(1);
    expect(wb.model.media[0].extension).toBe("png");
  });

  it("embeds no image and leaves no gap when the logo is missing", async () => {
    const buf = await writeExpenseWorkbook(doc(), null);
    const wb = await reopen(buf);
    expect(wb.model.media).toHaveLength(0);
    // The company name must still be the first thing under the brand bar.
    const name = findRow(wb.worksheets[0], "Northgate Decking");
    expect(name!.number).toBeLessThanOrEqual(4);
  });

  it("sets landscape letter, one page wide, with a repeating header row", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const ws = wb.worksheets[0];
    expect(ws.pageSetup.orientation).toBe("landscape");
    expect(ws.pageSetup.paperSize).toBe(1);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(0);
    const header = findRow(ws, "DATE")!;
    expect(ws.pageSetup.printTitlesRow).toBe(`${header.number}:${header.number}`);
  });

  it("gives every column a width so nothing opens as ####", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const ws = wb.worksheets[0];
    for (let c = 1; c <= 6; c += 1) {
      expect(ws.getColumn(c).width).toBeGreaterThan(6);
    }
  });

  it("writes no filler rows after the last line", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const ws = wb.worksheets[0];
    const line = findRow(ws, "Sanding pads")!;
    const total = findRow(ws, "TOTAL")!;
    // One spacer row at most between the last line and the total block.
    expect(total.number - line.number).toBeLessThanOrEqual(2);
  });

  it("states one total when the whole envelope is owed", async () => {
    const wb = await reopen(await writeExpenseWorkbook(doc(), null));
    const ws = wb.worksheets[0];
    expect(lastValue(findRow(ws, "TOTAL")!)).toBe(78.34);
    expect(findRow(ws, "NOT REIMBURSED")).toBeNull();
  });

  it("breaks out what is not reimbursed when the payable figure is lower", async () => {
    const d = doc({
      lines: [line({ id: "a", amount: 350 }), line({ id: "b", amount: 168.94 })],
      batch: { totalAmount: 518.94, reimbursementAmount: 350 },
    });
    const ws = (await reopen(await writeExpenseWorkbook(d, null))).worksheets[0];
    expect(lastValue(findRow(ws, "TOTAL")!)).toBe(518.94);
    expect(lastValue(findRow(ws, "NOT REIMBURSED")!)).toBe(168.94);
    expect(lastValue(findRow(ws, "PAYABLE")!)).toBe(350);
  });

  it("says a company-funded envelope owes nothing, and prints no payable figure", async () => {
    const d = doc({ batch: { reimbursementAmount: 0 } });
    const ws = (await reopen(await writeExpenseWorkbook(d, null))).worksheets[0];
    expect(findRow(ws, "COMPANY-FUNDED — NO REIMBURSEMENT DUE")).not.toBeNull();
    expect(findRow(ws, "PAYABLE")).toBeNull();
  });

  it("adds a tax memo only when a line carries tax", async () => {
    const plain = (await reopen(await writeExpenseWorkbook(doc(), null))).worksheets[0];
    expect(findRow(plain, "INCLUDES TAX")).toBeNull();

    const taxed = doc({ lines: [line({ taxAmount: 8.12 })] });
    const ws = (await reopen(await writeExpenseWorkbook(taxed, null))).worksheets[0];
    expect(lastValue(findRow(ws, "INCLUDES TAX")!)).toBe(8.12);
  });

  it("subtotals each currency separately rather than adding them together", async () => {
    const d = doc({
      lines: [
        line({ id: "a", amount: 10, currency: "CAD" }),
        line({ id: "b", amount: 20, currency: "USD" }),
      ],
      batch: { totalAmount: 30, reimbursementAmount: 30 },
    });
    const ws = (await reopen(await writeExpenseWorkbook(d, null))).worksheets[0];
    expect(lastValue(findRow(ws, "TOTAL (CAD)")!)).toBe(10);
    expect(lastValue(findRow(ws, "TOTAL (USD)")!)).toBe(20);
    expect(findRow(ws, "TOTAL")).toBeNull();
  });

  it("carries the person, period and batch onto the document", async () => {
    const ws = (await reopen(await writeExpenseWorkbook(doc(), null))).worksheets[0];
    expect(findRow(ws, "Dana Whitfield")).not.toBeNull();
    expect(findRow(ws, "August 2026")).not.toBeNull();
    expect(findRow(ws, "EXP-BATCH-0042")).not.toBeNull();
    expect(findRow(ws, "PAYABLE TO")).not.toBeNull();
  });

  it("omits a person detail that is missing instead of leaving a blank cell", async () => {
    const base = doc();
    const stripped = { ...base, person: { ...base.person, address: null, phone: null } };
    const ws = (await reopen(await writeExpenseWorkbook(stripped, null))).worksheets[0];

    // A missing field must produce no cell at all — never an empty string, which
    // is how a stray label or a placeholder row shows up in a spreadsheet.
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string") expect(cell.value.trim()).not.toBe("");
      });
    });
  });

  it("gets shorter when a person has no address or phone to print", async () => {
    const base = doc();
    const stripped = { ...base, person: { ...base.person, address: null, phone: null } };
    const full = (await reopen(await writeExpenseWorkbook(base, null))).worksheets[0];
    const lean = (await reopen(await writeExpenseWorkbook(stripped, null))).worksheets[0];
    // The fact strip is as deep as its deepest column; dropping the person's two
    // extra lines leaves the batch column's status line still needing one row.
    expect(lean.rowCount).toBe(full.rowCount - 1);
  });

  it("gets shorter when a company has fewer contact details", async () => {
    const base = doc();
    const lean = { ...base, company: { ...base.company, contactLines: ["(555) 010-4477"] } };
    const fullWs = (await reopen(await writeExpenseWorkbook(base, null))).worksheets[0];
    const leanWs = (await reopen(await writeExpenseWorkbook(lean, null))).worksheets[0];
    expect(leanWs.rowCount).toBe(fullWs.rowCount - 3);
  });

  it("greys a rejected line and still shows what it cost", async () => {
    const d = doc({
      lines: [line({ status: "rejected", rejectionReason: "Personal purchase" })],
      batch: { totalAmount: 78.34, reimbursementAmount: null, approvedAmount: 0, status: "partially_approved" },
    });
    const ws = (await reopen(await writeExpenseWorkbook(d, null))).worksheets[0];
    const row = findRow(ws, "Sanding pads")!;
    expect(row.getCell(5).value).toBe("Rejected — Personal purchase");
    expect(row.getCell(6).value).toBe(78.34);
    expect((row.getCell(3).font?.color as { argb: string }).argb).toBe("FF8A8A8A");
  });
});
