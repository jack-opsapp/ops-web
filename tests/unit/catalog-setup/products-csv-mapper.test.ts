import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";
import { suggestProductsMapping } from "@/lib/catalog-setup/column-mapping";
import { mapProductsCsv } from "@/lib/catalog-setup/products-csv-mapper";

// Ports ProductsCSVMapper.map: one row = one product; name + base_price
// required; typed category/unit text → FK id via case-insensitive company-vocab
// match (unmatched = hard MapError); kind enum; type enum; is_taxable
// truthy/falsy; permissive numbers. Output is real Phase-1 StagingCards
// (module:"sell", source:"import"). Payload-or-nil contract: cards only when
// errors is empty.

const cats = [
  { id: "c-labor", name: "Labor" },
  { id: "c-mat", name: "Materials" },
];
const units = [
  { id: "u-each", display: "each" },
  { id: "u-bundle", display: "bundle" },
];

function load(name: string) {
  const csv = readFileSync(
    join(process.cwd(), "tests/fixtures/catalog-setup", name),
    "utf8",
  );
  const parsed = parseCsv(csv);
  return { parsed, mapping: suggestProductsMapping(parsed.headers) };
}

describe("mapProductsCsv — clean", () => {
  it("produces sell StagingCards with resolved FK ids + permissive numbers", () => {
    const { parsed, mapping } = load("products-clean.csv");
    const r = mapProductsCsv({
      rows: parsed.rows,
      lineNumbers: parsed.lineNumbers,
      mapping,
      categories: cats,
      units,
    });
    expect(r.errors).toEqual([]);
    expect(r.cards).toHaveLength(2);

    const shingle = r.cards[1];
    expect(shingle.module).toBe("sell");
    expect(shingle.source).toBe("import");
    expect(shingle.state).toBe("proposed");
    if (shingle.module !== "sell") throw new Error("expected sell card");
    expect(shingle.fields.name).toBe("Asphalt Shingle Bundle");
    expect(shingle.fields.defaultPrice).toBe(38.5);
    expect(shingle.fields.unitCost).toBe(22000); // "$22,000" stripped
    expect(shingle.fields.isTaxable).toBe(true);
    expect(shingle.fields.kind).toBe("material"); // CSV "good" → material
  });

  it("resolves category + unit FK ids onto the resolution sidecar", () => {
    const { parsed, mapping } = load("products-clean.csv");
    const r = mapProductsCsv({
      rows: parsed.rows,
      lineNumbers: parsed.lineNumbers,
      mapping,
      categories: cats,
      units,
    });
    expect(r.resolutions).toHaveLength(2);
    expect(r.resolutions[1].categoryId).toBe("c-mat");
    expect(r.resolutions[1].unitId).toBe("u-bundle");
    expect(r.resolutions[1].sourceLine).toBe(3);
    // each resolution points at its card by id
    expect(r.resolutions[1].cardId).toBe(r.cards[1].id);
  });

  it("maps the service row's kind + zero cost + taxable=yes", () => {
    const { parsed, mapping } = load("products-clean.csv");
    const r = mapProductsCsv({
      rows: parsed.rows,
      lineNumbers: parsed.lineNumbers,
      mapping,
      categories: cats,
      units,
    });
    const svc = r.cards[0];
    if (svc.module !== "sell") throw new Error("expected sell card");
    expect(svc.fields.name).toBe("Service Call");
    expect(svc.fields.defaultPrice).toBe(95);
    expect(svc.fields.unitCost).toBe(0);
    expect(svc.fields.kind).toBe("service");
    expect(svc.fields.isTaxable).toBe(true); // "yes"
    expect(r.resolutions[0].categoryId).toBe("c-labor");
    expect(r.resolutions[0].unitId).toBe("u-each");
  });

  it("stamps unique client ids on every card", () => {
    const { parsed, mapping } = load("products-clean.csv");
    const r = mapProductsCsv({
      rows: parsed.rows,
      lineNumbers: parsed.lineNumbers,
      mapping,
      categories: cats,
      units,
    });
    const ids = r.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mapProductsCsv — messy", () => {
  it("surfaces blank name, bad number, unknown category as MapErrors and yields no cards", () => {
    const { parsed, mapping } = load("products-messy.csv");
    const r = mapProductsCsv({
      rows: parsed.rows,
      lineNumbers: parsed.lineNumbers,
      mapping,
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]); // payload-or-nil contract
    const fields = r.errors.map((e) => e.field);
    expect(fields).toContain("name"); // blank name row
    expect(fields).toContain("base_price"); // "abc"
    expect(fields).toContain("category"); // "Nonexistent"
  });

  it("base_price errors distinguish 'required' (blank) from 'not a number'", () => {
    const p = parseCsv("Name,Price\nNoPrice,\nBadPrice,abc");
    const r = mapProductsCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestProductsMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]);
    const priceErrors = r.errors.filter((e) => e.field === "base_price");
    expect(priceErrors).toHaveLength(2);
  });
});

describe("mapProductsCsv — guards", () => {
  it("file-level error when name column is not mapped", () => {
    const r = mapProductsCsv({
      rows: [{ Foo: "x" }],
      lineNumbers: [2],
      mapping: suggestProductsMapping(["Foo", "Bar"]),
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]);
    expect(r.errors[0]).toMatchObject({ field: "name", rowIndex: -1 });
  });

  it("file-level error when there are zero data rows", () => {
    const p = parseCsv("Name,Price");
    const r = mapProductsCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestProductsMapping(p.headers),
      categories: cats,
      units,
    });
    expect(r.cards).toEqual([]);
    expect(r.errors.some((e) => e.field === "rows")).toBe(true);
  });

  it("validates kind + type + is_taxable enums", () => {
    const p = parseCsv(
      "Name,Price,Kind,Line Item Type,Taxable\nX,1,frobnicate,SIDEWAYS,maybe",
    );
    const r = mapProductsCsv({
      rows: p.rows,
      lineNumbers: p.lineNumbers,
      mapping: suggestProductsMapping(p.headers),
      categories: cats,
      units,
    });
    const fields = r.errors.map((e) => e.field).sort();
    expect(fields).toEqual(["is_taxable", "kind", "type"]);
  });
});
