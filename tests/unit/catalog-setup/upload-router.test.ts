import { describe, it, expect } from "vitest";
import { routeUpload } from "@/lib/catalog-setup/upload-router";

// Pure clean-vs-messy auto-route heuristic (spec §8): a parseable CSV/XLSX
// whose headers alias-map the required columns (name+price OR
// family_name+quantity) → `deterministic`; everything else (PDF / image /
// unparseable / no mappable required columns) → `agent`. Phase 4 owns the
// agent side — this only decides the lane and explains why.
//
// `RouteDecision` is a discriminated union on `lane`; tests narrow with a
// `lane` guard before reading `kind` / `reason` (house pattern, mirrors the
// products-csv-mapper test's `module` guards).

describe("routeUpload", () => {
  it("routes a clean products spreadsheet to deterministic", () => {
    const r = routeUpload({
      filename: "items.csv",
      mime: "text/csv",
      headers: ["Name", "Price"],
    });
    expect(r.lane).toBe("deterministic");
    if (r.lane !== "deterministic") throw new Error("expected deterministic");
    expect(r.kind).toBe("products");
  });

  it("routes a clean stock spreadsheet to deterministic", () => {
    const r = routeUpload({
      filename: "stock.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: ["Family Name", "Quantity"],
    });
    expect(r.lane).toBe("deterministic");
    if (r.lane !== "deterministic") throw new Error("expected deterministic");
    expect(r.kind).toBe("stock");
  });

  it("prefers products when a sheet maps BOTH required sets", () => {
    // Name + Price (products) AND Family Name + Qty (stock) both ready.
    const r = routeUpload({
      filename: "both.csv",
      mime: "text/csv",
      headers: ["Name", "Price", "Family Name", "Qty"],
    });
    expect(r.lane).toBe("deterministic");
    if (r.lane !== "deterministic") throw new Error("expected deterministic");
    expect(r.kind).toBe("products");
  });

  it("routes a PDF to the agent", () => {
    const r = routeUpload({
      filename: "pricelist.pdf",
      mime: "application/pdf",
      headers: null,
    });
    expect(r.lane).toBe("agent");
    if (r.lane !== "agent") throw new Error("expected agent");
    expect(r.reason).toBe("unsupported_for_deterministic");
  });

  it("routes an image to the agent", () => {
    const r = routeUpload({
      filename: "parts.jpg",
      mime: "image/jpeg",
      headers: null,
    });
    expect(r.lane).toBe("agent");
    if (r.lane !== "agent") throw new Error("expected agent");
    expect(r.reason).toBe("unsupported_for_deterministic");
  });

  it("routes a spreadsheet with no mappable required columns to the agent", () => {
    const r = routeUpload({
      filename: "weird.csv",
      mime: "text/csv",
      headers: ["Foo", "Bar"],
    });
    expect(r.lane).toBe("agent");
    if (r.lane !== "agent") throw new Error("expected agent");
    expect(r.reason).toBe("no_required_columns");
  });

  it("routes a supported extension with no parseable headers to the agent", () => {
    const r = routeUpload({
      filename: "empty.csv",
      mime: "text/csv",
      headers: [],
    });
    expect(r.lane).toBe("agent");
    if (r.lane !== "agent") throw new Error("expected agent");
    expect(r.reason).toBe("unparseable");
  });

  it("uses the extension when the mime is missing or generic", () => {
    // Generic octet-stream but .xlsx extension → still spreadsheet.
    const r = routeUpload({
      filename: "stock.xlsx",
      mime: "application/octet-stream",
      headers: ["Family Name", "Quantity"],
    });
    expect(r.lane).toBe("deterministic");
    if (r.lane !== "deterministic") throw new Error("expected deterministic");
    expect(r.kind).toBe("stock");
  });

  it("accepts legacy .xls spreadsheets", () => {
    const r = routeUpload({
      filename: "legacy.xls",
      mime: "application/vnd.ms-excel",
      headers: ["Name", "Price"],
    });
    expect(r.lane).toBe("deterministic");
    if (r.lane !== "deterministic") throw new Error("expected deterministic");
    expect(r.kind).toBe("products");
  });
});
