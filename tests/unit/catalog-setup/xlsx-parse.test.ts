import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseXlsx,
  rowsFromSheetMatrix,
} from "@/lib/catalog-setup/xlsx-parse";
import type { ParsedSheet } from "@/lib/catalog-setup/csv-parse";

// XLSX binary parsing reads the first worksheet via SheetJS (`xlsx`) and projects
// it into the SAME `ParsedSheet` shape `parseCsv` emits, so the deterministic
// mappers are source-agnostic. Two layers: the pure matrix→ParsedSheet projection
// (`rowsFromSheetMatrix`) and the binary read (`parseXlsx`, lazy-loads SheetJS).

describe("rowsFromSheetMatrix (pure projection — the part SheetJS hands off to)", () => {
  it("projects a stringified cell matrix into the shared ParsedSheet shape", () => {
    const matrix: string[][] = [
      ["Family Name", "SKU", "Qty", "Unit Cost"],
      ["Copper Pipe", "CP-12", "40", "3.5"],
      ["Copper Pipe", "CP-34", "25", "5"],
      ["PVC Elbow", "PVC-E", "100", "0.4"],
    ];
    const r: ParsedSheet = rowsFromSheetMatrix(matrix);
    expect(r.headers).toEqual(["Family Name", "SKU", "Qty", "Unit Cost"]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({
      "Family Name": "Copper Pipe",
      SKU: "CP-12",
      Qty: "40",
      "Unit Cost": "3.5",
    });
    expect(r.lineNumbers).toEqual([2, 3, 4]);
  });

  it("trims headers, pads short rows, and skips fully-blank rows (parity with parseCsv)", () => {
    const matrix: string[][] = [
      [" Name ", " Price "],
      ["Widget", "10"],
      ["", ""],
      ["Gadget"],
    ];
    const r = rowsFromSheetMatrix(matrix);
    expect(r.headers).toEqual(["Name", "Price"]);
    expect(r.rows).toEqual([
      { Name: "Widget", Price: "10" },
      { Name: "Gadget", Price: "" },
    ]);
    // blank row at physical line 3 is skipped; "Gadget" is physical line 4
    expect(r.lineNumbers).toEqual([2, 4]);
  });

  it("returns empty everything for an empty matrix or header-only matrix", () => {
    expect(rowsFromSheetMatrix([])).toEqual({
      headers: [],
      rows: [],
      lineNumbers: [],
    });
    expect(rowsFromSheetMatrix([["A", "B"]])).toEqual({
      headers: ["A", "B"],
      rows: [],
      lineNumbers: [],
    });
  });
});

/** Build a valid .xlsx binary (ArrayBuffer) from a rows-as-arrays matrix. */
function xlsxBufferFrom(aoa: (string | number)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseXlsx (SheetJS binary read → ParsedSheet)", () => {
  it("parses the first worksheet of an .xlsx binary into the shared ParsedSheet", async () => {
    const buf = xlsxBufferFrom([
      ["Name", "Price", "SKU"],
      ["Vehicle wrap", 1200, "WRAP-001"],
      ["Decal install", 150, "DECAL-002"],
    ]);

    const r = await parseXlsx(buf);
    expect(r.headers).toEqual(["Name", "Price", "SKU"]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      Name: "Vehicle wrap",
      Price: "1200",
      SKU: "WRAP-001",
    });
    expect(r.lineNumbers).toEqual([2, 3]);
  });

  it("accepts a Uint8Array as well as an ArrayBuffer", async () => {
    const buf = xlsxBufferFrom([
      ["Name", "Price"],
      ["Widget", 10],
    ]);
    const r = await parseXlsx(new Uint8Array(buf));
    expect(r.rows).toEqual([{ Name: "Widget", Price: "10" }]);
  });

  it("returns an empty sheet for a workbook with no data rows", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Price"]]), "Empty");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const r = await parseXlsx(buf);
    expect(r.headers).toEqual(["Name", "Price"]);
    expect(r.rows).toHaveLength(0);
  });
});
