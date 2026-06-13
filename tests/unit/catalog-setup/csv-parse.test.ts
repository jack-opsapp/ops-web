import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";

// The iOS mapper receives already-parsed `[[String:String]]`. On web we parse
// the raw file first. `parseCsv` is the pure, dependency-light tokenizer that
// produces the SAME `{ headers, rows, lineNumbers }` shape the xlsx adapter
// will (rows keyed by header; 1-based physical line numbers parallel to rows;
// header is line 1, first data row is line 2). RFC-4180-ish: quoted fields,
// embedded commas, escaped `""` quotes, CR/LF/CRLF.

describe("parseCsv", () => {
  it("parses headers + rows keyed by header", () => {
    const r = parseCsv("Name,Price\nWidget,10\nGadget,20");
    expect(r.headers).toEqual(["Name", "Price"]);
    expect(r.rows).toEqual([
      { Name: "Widget", Price: "10" },
      { Name: "Gadget", Price: "20" },
    ]);
    expect(r.lineNumbers).toEqual([2, 3]);
  });

  it("handles quoted fields with commas + escaped quotes + CRLF", () => {
    const r = parseCsv('Name,Desc\r\n"Bolt, hex","1/2""-13"\r\n');
    expect(r.rows[0]).toEqual({ Name: "Bolt, hex", Desc: '1/2"-13' });
    expect(r.lineNumbers).toEqual([2]);
  });

  it("preserves a quoted field that contains a newline (line numbers stay honest)", () => {
    const r = parseCsv('Name,Note\n"A","line1\nline2"\nB,plain');
    expect(r.rows).toEqual([
      { Name: "A", Note: "line1\nline2" },
      { Name: "B", Note: "plain" },
    ]);
    // The embedded newline consumes physical line 3, so "B,plain" is line 4.
    expect(r.lineNumbers).toEqual([2, 4]);
  });

  it("skips fully-blank lines but keeps line numbers honest", () => {
    const r = parseCsv("Name,Price\nWidget,10\n\nGadget,20");
    expect(r.rows.map((x) => x.Name)).toEqual(["Widget", "Gadget"]);
    expect(r.lineNumbers).toEqual([2, 4]);
  });

  it("trims header names and maps each cell to its header", () => {
    const r = parseCsv(" Name , Unit Cost \nWidget,3.50");
    expect(r.headers).toEqual(["Name", "Unit Cost"]);
    expect(r.rows[0]).toEqual({ Name: "Widget", "Unit Cost": "3.50" });
  });

  it("pads short rows and ignores cells past the header count", () => {
    const r = parseCsv("A,B,C\n1,2\n4,5,6,7");
    expect(r.rows[0]).toEqual({ A: "1", B: "2", C: "" });
    expect(r.rows[1]).toEqual({ A: "4", B: "5", C: "6" });
  });

  it("returns empty rows for a header-only file", () => {
    const r = parseCsv("Name,Price");
    expect(r.headers).toEqual(["Name", "Price"]);
    expect(r.rows).toEqual([]);
    expect(r.lineNumbers).toEqual([]);
  });

  it("returns empty everything for an empty string", () => {
    const r = parseCsv("");
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.lineNumbers).toEqual([]);
  });

  it("strips a UTF-8 BOM from the first header", () => {
    const r = parseCsv("﻿Name,Price\nWidget,10");
    expect(r.headers).toEqual(["Name", "Price"]);
  });
});
