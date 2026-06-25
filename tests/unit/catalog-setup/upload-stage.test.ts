import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCsv } from "@/lib/catalog-setup/csv-parse";
import { parseXlsx } from "@/lib/catalog-setup/xlsx-parse";
import { buildUploadCards } from "@/lib/catalog-setup/upload-stage";
import type { LiveCatalogRow } from "@/lib/catalog-setup/commit/dedupe-matcher.types";

/**
 * buildUploadCards — the pure orchestrator behind the file-upload source lane.
 * Composes the already-built primitives: parseCsv → routeUpload → the products /
 * stock CSV mappers → the show-diff dedupe matcher. PURE (no DB, no IO): the
 * route reads the file + live rows and passes them in. Spec §8 (sources auto-
 * route), §11 (dedupe — a re-import re-syncs, never doubles).
 */

const PRODUCTS_CSV = `Name,Price,Cost,SKU
Vehicle wrap,1200,650,WRAP-001
Decal install,150,40,DECAL-002
`;

describe("buildUploadCards", () => {
  it("routes a clean products sheet to the deterministic mapper and stages proposed cards", () => {
    const sheet = parseCsv(PRODUCTS_CSV);
    const res = buildUploadCards({
      filename: "pricelist.csv",
      mime: "text/csv",
      sheet,
      categories: [],
      units: [],
      liveProductRows: [],
    });

    expect(res.lane).toBe("deterministic");
    if (res.lane !== "deterministic") return;
    expect(res.kind).toBe("products");
    expect(res.cards).toHaveLength(2);
    expect(res.errors).toHaveLength(0);
    expect(res.rowsRead).toBe(2);
    expect(res.mergedCount).toBe(0);
    expect(res.cards.every((c) => c.state === "proposed")).toBe(true);
    expect(res.cards.every((c) => c.source === "import")).toBe(true);
    const names = res.cards.map((c) => (c.module === "sell" ? c.fields.name : ""));
    expect(names).toContain("Vehicle wrap");
    expect(names).toContain("Decal install");
  });

  it("discloses the columns it read and flags a dropped inventory column (products lane)", () => {
    // name + price map cleanly; "On Hand" is a quantity column products can't hold.
    const sheet = parseCsv(`Name,Price,On Hand\nWidget,10,5\nGizmo,20,3\n`);
    const res = buildUploadCards({
      filename: "list.csv",
      mime: "text/csv",
      sheet,
      categories: [],
      units: [],
      liveProductRows: [],
    });
    expect(res.lane).toBe("deterministic");
    if (res.lane !== "deterministic") return;
    expect(res.kind).toBe("products"); // products wins the tie
    expect(res.read.name).toBe("Name");
    expect(res.read.price).toBe("Price");
    // the on-hand column is surfaced as dropped, not silently lost
    expect(res.read.dropped).toContain("On Hand");
  });

  it("binds a product card whose SKU matches a live row to merge state (re-import re-syncs, never doubles)", () => {
    const sheet = parseCsv(PRODUCTS_CSV);
    const live: LiveCatalogRow[] = [
      {
        id: "prod-existing-1",
        sku: "wrap-001",
        name: "Vehicle wrap",
        base_price: 1000,
        unit_cost: 600,
      },
    ];
    const res = buildUploadCards({
      filename: "pricelist.csv",
      mime: "text/csv",
      sheet,
      categories: [],
      units: [],
      liveProductRows: live,
    });

    expect(res.lane).toBe("deterministic");
    if (res.lane !== "deterministic") return;
    expect(res.mergedCount).toBe(1);

    const wrap = res.cards.find(
      (c) => c.module === "sell" && c.fields.name === "Vehicle wrap",
    );
    expect(wrap?.state).toBe("merge");
    expect(wrap?.matchedExistingId).toBe("prod-existing-1");

    const decal = res.cards.find(
      (c) => c.module === "sell" && c.fields.name === "Decal install",
    );
    expect(decal?.state).toBe("proposed");
    expect(decal?.matchedExistingId).toBeUndefined();
  });

  it("matches by name (case-insensitive) when neither the card nor the live row carries a SKU", () => {
    const sheet = parseCsv(`Name,Price\nVehicle Wrap,1200\n`);
    const live: LiveCatalogRow[] = [
      { id: "p1", sku: null, name: "vehicle wrap", base_price: 999 },
    ];
    const res = buildUploadCards({
      filename: "p.csv",
      mime: "text/csv",
      sheet,
      categories: [],
      units: [],
      liveProductRows: live,
    });

    if (res.lane !== "deterministic") throw new Error("expected deterministic lane");
    expect(res.cards[0].state).toBe("merge");
    expect(res.cards[0].matchedExistingId).toBe("p1");
    expect(res.mergedCount).toBe(1);
  });

  it("surfaces mapper errors and stages nothing when a typed value can't resolve", () => {
    const sheet = parseCsv(`Name,Price,Category\nWidget,10,Nonexistent\n`);
    const res = buildUploadCards({
      filename: "p.csv",
      mime: "text/csv",
      sheet,
      categories: [{ id: "c1", name: "Tools" }],
      units: [],
      liveProductRows: [],
    });

    if (res.lane !== "deterministic") throw new Error("expected deterministic lane");
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.cards).toHaveLength(0);
    expect(res.mergedCount).toBe(0);
  });

  it("routes a clean stock sheet to the stock mapper and never cross-module-binds to a product row", () => {
    const sheet = parseCsv(`Family Name,Quantity,SKU\nPipe,10,WRAP-001\n`);
    // A PRODUCT carries the same SKU — a STOCK card must NOT bind to it (v1
    // dedupes products only; stock variant dedupe is a separate lane).
    const live: LiveCatalogRow[] = [
      { id: "prod-1", sku: "wrap-001", name: "Pipe", base_price: 5 },
    ];
    const res = buildUploadCards({
      filename: "stock.csv",
      mime: "text/csv",
      sheet,
      categories: [],
      units: [],
      liveProductRows: live,
    });

    if (res.lane !== "deterministic") throw new Error("expected deterministic lane");
    expect(res.kind).toBe("stock");
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].state).toBe("proposed");
    expect(res.cards[0].matchedExistingId).toBeUndefined();
    expect(res.mergedCount).toBe(0);
  });

  it("stages products from a parsed XLSX sheet exactly like CSV (source-agnostic)", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Price", "SKU"],
      ["Vehicle wrap", 1200, "WRAP-001"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const sheet = await parseXlsx(buf);

    const res = buildUploadCards({
      filename: "pricelist.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sheet,
      categories: [],
      units: [],
      liveProductRows: [],
    });

    expect(res.lane).toBe("deterministic");
    if (res.lane !== "deterministic") return;
    expect(res.kind).toBe("products");
    expect(res.cards).toHaveLength(1);
    const card = res.cards[0];
    expect(card.module).toBe("sell");
    expect(card.module === "sell" && card.fields.name).toBe("Vehicle wrap");
    expect(card.module === "sell" && card.fields.defaultPrice).toBe(1200);
  });

  it("sends a non-spreadsheet (no parsed sheet) to the agent lane", () => {
    const res = buildUploadCards({
      filename: "pricelist.pdf",
      mime: "application/pdf",
      sheet: null,
      categories: [],
      units: [],
      liveProductRows: [],
    });

    expect(res.lane).toBe("agent");
    if (res.lane !== "agent") return;
    expect(res.reason).toBe("unsupported_for_deterministic");
    expect(res.rowsRead).toBe(0);
  });

  it("sends a spreadsheet whose headers map no required set to the agent lane", () => {
    const sheet = parseCsv(`Foo,Bar\na,b\n`);
    const res = buildUploadCards({
      filename: "weird.csv",
      mime: "text/csv",
      sheet,
      categories: [],
      units: [],
      liveProductRows: [],
    });

    expect(res.lane).toBe("agent");
    if (res.lane !== "agent") return;
    expect(res.reason).toBe("no_required_columns");
    expect(res.rowsRead).toBe(1);
  });
});
