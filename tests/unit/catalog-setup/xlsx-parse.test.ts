import { describe, it, expect } from "vitest";
import {
  parseXlsx,
  rowsFromSheetMatrix,
  XLSX_PARSE_DEFERRED,
} from "@/lib/catalog-setup/xlsx-parse";
import type { ParsedSheet } from "@/lib/catalog-setup/csv-parse";

// XLSX binary parsing depends on SheetJS (`xlsx`), which is a wave-2 dependency
// (NOT installed in this wave — see // DEFERRED(wave-2) in xlsx-parse.ts). What
// IS pure and testable now is the matrix→ParsedSheet projection that runs AFTER
// SheetJS hands back a rows-as-arrays matrix. We test that projection directly
// (`rowsFromSheetMatrix`) so the only deferred surface is the binary read, and
// we pin the seam: `parseXlsx` throws an explicit deferral error until the
// adapter lands, so callers never silently get an empty sheet.

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

describe("parseXlsx (DEFERRED wave-2 seam)", () => {
  it("is flagged deferred", () => {
    expect(XLSX_PARSE_DEFERRED).toBe(true);
  });

  it("throws an explicit deferral error rather than silently returning nothing", async () => {
    await expect(parseXlsx(new Uint8Array([0, 0]))).rejects.toThrow(
      /DEFERRED\(wave-2\)/,
    );
  });
});
