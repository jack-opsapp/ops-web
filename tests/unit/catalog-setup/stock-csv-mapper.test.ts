import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";
import { suggestStockMapping } from "@/lib/catalog-setup/column-mapping";
import { mapStockCsv } from "@/lib/catalog-setup/stock-csv-mapper";

// Ports CatalogCSVMapper.map: family_name + quantity required; family grouping
// by case-insensitive trimmed family_name (first occurrence carries family-level
// fields, later rows add variants); category/defaultUnit/variantUnit text → FK
// id (unmatched = error); permissive numbers; one CSV row = one variant.
//
// Reconciled to the FLAT canvas contract: the real `StockFields` has no nested
// variants[], so the mapper emits ONE stock StagingCard per variant row
// (fields.name = family name), and preserves the grouping via a `families[]`
// sidecar (family key → ordered card ids + family-level FK resolution).
// Payload-or-nil: cards only when errors is empty.

const cats = [
  { id: "c-pipe", name: "Pipe" },
  { id: "c-fit", name: "Fittings" },
];
const units = [
  { id: "u-ft", display: "ft" },
  { id: "u-each", display: "each" },
];

function loadStock() {
  const csv = readFileSync(
    join(process.cwd(), "tests/fixtures/catalog-setup/stock-families.csv"),
    "utf8",
  );
  return parseCsv(csv);
}

describe("mapStockCsv — family grouping", () => {
  it("groups variants under one family (first row wins family fields)", () => {
    const p = loadStock();
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.errors).toEqual([]);
    // one stock card per variant row
    expect(r.cards).toHaveLength(3);
    // two families
    expect(r.families).toHaveLength(2);

    const copper = r.families[0];
    expect(copper.familyName).toBe("Copper Pipe");
    expect(copper.categoryId).toBe("c-pipe");
    expect(copper.cardIds).toHaveLength(2);

    // the two copper variant cards
    const copperCards = copper.cardIds.map(
      (id) => r.cards.find((c) => c.id === id)!,
    );
    expect(copperCards.every((c) => c.module === "stock")).toBe(true);
    // Narrow the union to stock cards before reading StockFields (house
    // pattern — mirrors the products test's `module` guard).
    for (const c of copperCards) {
      if (c.module !== "stock") throw new Error("expected stock card");
    }
    const copperStock = copperCards.filter((c) => c.module === "stock");
    expect(copperStock.map((c) => c.fields.sku)).toEqual(["CP-12", "CP-34"]);
    expect(copperStock.every((c) => c.fields.name === "Copper Pipe")).toBe(true);
    expect(copperStock[0].fields.quantity).toBe(40);
    expect(copperStock[1].fields.unitCost).toBe(5);
  });

  it("is case-insensitive on family name", () => {
    const p = parseCsv("Family Name,Quantity\nWidget,1\nwidget,2");
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.errors).toEqual([]);
    expect(r.families).toHaveLength(1);
    expect(r.families[0].cardIds).toHaveLength(2);
    expect(r.cards).toHaveLength(2);
  });

  it("stamps source=import, state=proposed, and unique card ids", () => {
    const p = loadStock();
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.cards.every((c) => c.source === "import")).toBe(true);
    expect(r.cards.every((c) => c.state === "proposed")).toBe(true);
    const ids = r.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records per-variant source line numbers", () => {
    const p = loadStock();
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.resolutions.map((res) => res.sourceLine)).toEqual([2, 3, 4]);
  });

  it("errors on blank family name and unknown unit", () => {
    const p = parseCsv("Family Name,Quantity,Unit\n,5,ft\nBolt,3,furlong");
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]);
    expect(r.families).toEqual([]);
    const fields = r.errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining(["family_name", "variant_unit"]),
    );
  });

  it("file-level error when family_name column is not mapped", () => {
    const r = mapStockCsv({
      rows: [{ Foo: "x" }],
      lineNumbers: [2],
      mapping: suggestStockMapping(["Foo", "Bar"]),
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]);
    expect(r.errors[0]).toMatchObject({ field: "family_name", rowIndex: -1 });
  });

  it("file-level error on zero data rows", () => {
    const p = parseCsv("Family Name,Quantity");
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]);
    expect(r.errors.some((e) => e.field === "rows")).toBe(true);
  });

  it("defaults missing/blank quantity to 0 (mirrors Swift ?? 0)", () => {
    const p = parseCsv("Family Name,Quantity\nNoQty,");
    const r = mapStockCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestStockMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.errors).toEqual([]);
    const card = r.cards[0];
    if (card.module !== "stock") throw new Error("expected stock card");
    expect(card.fields.quantity).toBe(0);
  });
});
