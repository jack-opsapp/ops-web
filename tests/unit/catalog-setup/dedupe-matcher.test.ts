import { describe, it, expect } from "vitest";
import {
  matchCards,
  applyDedupe,
} from "@/lib/catalog-setup/commit/dedupe-matcher";
import type { LiveCatalogRow } from "@/lib/catalog-setup/commit/dedupe-matcher.types";
import type {
  StagingCard,
  SellFields,
  StockFields,
} from "@/lib/catalog-setup/staging-card";

// PURE show-diff dedupe matcher (plan Phase 3, Task 3.3). The matcher takes the
// accepted StagingCards + the live catalog rows (DEFERRED read — passed in) and
// classifies each card NEW vs MATCH with per-field DIFF descriptors, then stamps
// external_source/external_id. No DB, no network — fully deterministic.

// ---- card factories -------------------------------------------------------

function sellCard(
  id: string,
  fields: Partial<SellFields> & Pick<SellFields, "name">,
): StagingCard {
  return {
    id,
    source: "import",
    state: "proposed",
    module: "sell",
    fields: {
      name: fields.name,
      description: fields.description,
      defaultPrice: fields.defaultPrice ?? null,
      unitCost: fields.unitCost ?? null,
      sku: fields.sku,
      isTaxable: fields.isTaxable ?? true,
      kind: fields.kind ?? "service",
      type: fields.type ?? "LABOR",
      pricingUnit: fields.pricingUnit,
    },
  };
}

function stockCard(
  id: string,
  fields: Partial<StockFields> & Pick<StockFields, "name">,
): StagingCard {
  return {
    id,
    source: "import",
    state: "proposed",
    module: "stock",
    fields: {
      name: fields.name,
      sku: fields.sku,
      quantity: fields.quantity ?? null,
      unitCost: fields.unitCost ?? null,
      reorderPoint: fields.reorderPoint ?? null,
      unitId: fields.unitId,
    },
  };
}

// ---- matchCards: SKU match ------------------------------------------------

describe("matchCards — SKU match", () => {
  it("matches on lower(trim(sku)) and produces per-field diffs with show-diff default", () => {
    const res = matchCards({
      externalSource: "quickbooks",
      cards: [
        sellCard("c1", { sku: " SVC-1 ", name: "Service Call", defaultPrice: 120 }),
      ],
      externalRefs: { c1: { externalSource: "quickbooks", externalId: "QB-42" } },
      liveRows: [
        { id: "row-1", sku: "svc-1", name: "Service Call", base_price: 95 },
      ],
    });
    const m = res.matches[0];
    expect(m.matchedRowId).toBe("row-1");
    expect(m.matchedOn).toBe("sku");
    expect(m.defaultAction).toBe("show-diff");
    expect(m.diffs).toContainEqual({
      field: "base_price",
      incoming: 120,
      existing: 95,
    });
    expect(m.externalSource).toBe("quickbooks");
    expect(m.externalId).toBe("QB-42");
  });

  it("does not emit a diff for fields that agree", () => {
    const res = matchCards({
      cards: [sellCard("c1", { sku: "A-1", name: "Same", defaultPrice: 50 })],
      liveRows: [{ id: "r", sku: "a-1", name: "Same", base_price: 50 }],
    });
    const m = res.matches[0];
    expect(m.matchedOn).toBe("sku");
    expect(m.diffs.find((d) => d.field === "base_price")).toBeUndefined();
    expect(m.diffs.find((d) => d.field === "name")).toBeUndefined();
  });

  it("matches STOCK cards at the variant level (catalog_items has no sku)", () => {
    // A live family row (catalog_items) has sku=null; the matchable row is the
    // variant carrying the SKU. The matcher keys on the variant row's sku.
    const res = matchCards({
      cards: [stockCard("s1", { sku: "BOLT-10", name: "10mm Bolt", quantity: 40 })],
      liveRows: [
        { id: "fam-1", sku: null, name: "Bolts" }, // family — never SKU-matches
        { id: "var-1", sku: "bolt-10", name: "10mm Bolt", quantity: 12 },
      ],
    });
    const m = res.matches[0];
    expect(m.matchedRowId).toBe("var-1");
    expect(m.matchedOn).toBe("sku");
    expect(m.diffs).toContainEqual({
      field: "quantity",
      incoming: 40,
      existing: 12,
    });
  });
});

// ---- matchCards: name fallback + create default ---------------------------

describe("matchCards — name fallback and create default", () => {
  it("falls back to lower(trim(name)) only when SKU is absent on both", () => {
    const res = matchCards({
      cards: [sellCard("c1", { name: "  Roof Inspection ", defaultPrice: 200 })],
      liveRows: [{ id: "r9", sku: null, name: "roof inspection", base_price: 175 }],
    });
    const m = res.matches[0];
    expect(m.matchedRowId).toBe("r9");
    expect(m.matchedOn).toBe("name");
    expect(m.diffs).toContainEqual({
      field: "base_price",
      incoming: 200,
      existing: 175,
    });
  });

  it("a SKU-bearing card never falls through to a name match", () => {
    // Card has a SKU that matches nothing; a name-only row exists but must be
    // ignored — SKU-bearing cards do not name-match (spec §11).
    const res = matchCards({
      cards: [sellCard("c1", { sku: "NOPE", name: "Service Call" })],
      liveRows: [{ id: "r", sku: null, name: "Service Call", base_price: 95 }],
    });
    const m = res.matches[0];
    expect(m.matchedRowId).toBeNull();
    expect(m.matchedOn).toBeNull();
    expect(m.defaultAction).toBe("create");
  });

  it("no match → create default, null row, empty diffs, external stamp preserved", () => {
    const res = matchCards({
      externalSource: "csv",
      cards: [sellCard("c1", { sku: "BRAND-NEW", name: "Brand New" })],
      externalRefs: { c1: { externalSource: "csv", externalId: "CSV-7" } },
      liveRows: [{ id: "r", sku: "other", name: "Other" }],
    });
    const m = res.matches[0];
    expect(m.matchedRowId).toBeNull();
    expect(m.matchedOn).toBeNull();
    expect(m.defaultAction).toBe("create");
    expect(m.diffs).toEqual([]);
    expect(m.externalSource).toBe("csv");
    expect(m.externalId).toBe("CSV-7");
  });

  it("inherits the run-level externalSource and null id when no per-card ref", () => {
    const res = matchCards({
      externalSource: "quickbooks",
      cards: [sellCard("c1", { name: "Manual-ish" })],
      liveRows: [],
    });
    const m = res.matches[0];
    expect(m.externalSource).toBe("quickbooks");
    expect(m.externalId).toBeNull();
  });
});

// ---- matchCards: external_id re-sync precedence ---------------------------

describe("matchCards — external_id re-sync precedence", () => {
  it("matches on (external_source, external_id) FIRST even when sku/name drifted", () => {
    const res = matchCards({
      externalSource: "quickbooks",
      cards: [
        // sku + name both changed since last import, but same QB id
        sellCard("c1", { sku: "RENAMED-1", name: "Renamed Service", defaultPrice: 130 }),
      ],
      externalRefs: { c1: { externalSource: "quickbooks", externalId: "QB-42" } },
      liveRows: [
        // a different row happens to share the new SKU — must be IGNORED
        { id: "decoy", sku: "renamed-1", name: "Decoy", base_price: 1 },
        {
          id: "row-real",
          sku: "old-sku",
          name: "Old Service",
          base_price: 95,
          external_source: "quickbooks",
          external_id: "QB-42",
        },
      ],
    });
    const m = res.matches[0];
    expect(m.matchedRowId).toBe("row-real");
    expect(m.matchedOn).toBe("external");
    expect(m.diffs).toContainEqual({
      field: "base_price",
      incoming: 130,
      existing: 95,
    });
  });

  it("does not external-match across differing sources", () => {
    const res = matchCards({
      cards: [sellCard("c1", { sku: "X", name: "X" })],
      externalRefs: { c1: { externalSource: "csv", externalId: "ID-1" } },
      liveRows: [
        {
          id: "r",
          sku: null,
          name: "X",
          external_source: "quickbooks",
          external_id: "ID-1",
        },
      ],
    });
    // same external_id but different source → no external match; falls to sku
    // (none) then name (card has sku → no name match) → create.
    const m = res.matches[0];
    expect(m.matchedOn).toBeNull();
    expect(m.defaultAction).toBe("create");
  });
});

// ---- applyDedupe ----------------------------------------------------------

describe("applyDedupe — resolve actions + stamp external_*", () => {
  const baseCards = [
    sellCard("c1", { sku: "A-1", name: "Alpha", defaultPrice: 120 }),
    sellCard("c2", { sku: "B-2", name: "Bravo", defaultPrice: 60 }),
    sellCard("c3", { name: "Charlie", defaultPrice: 30 }),
  ];
  const liveRows: LiveCatalogRow[] = [
    { id: "row-a", sku: "a-1", name: "Alpha", base_price: 95 },
    { id: "row-b", sku: "b-2", name: "Bravo Old", base_price: 60 },
  ];

  it("skip drops the card entirely", () => {
    const { matches } = matchCards({ cards: baseCards, liveRows });
    const resolved = applyDedupe(baseCards, matches, {
      c1: { action: "skip" },
    });
    expect(resolved.find((r) => r.card.id === "c1")).toBeUndefined();
    expect(resolved).toHaveLength(2);
  });

  it("merge-all binds the card to the matched row id (so the RPC UPSERTs)", () => {
    const { matches } = matchCards({ cards: baseCards, liveRows });
    const resolved = applyDedupe(baseCards, matches, {
      c1: { action: "merge-all" },
    });
    const r = resolved.find((x) => x.card.id === "c1")!;
    expect(r.id).toBe("row-a");
  });

  it("show-diff applies only the accepted fields over the live row", () => {
    const { matches } = matchCards({ cards: baseCards, liveRows });
    // c1: matched row-a; live base_price 95, incoming 120. Reject the price diff
    // → the resolved card keeps the live value (95), not the incoming 120.
    const resolved = applyDedupe(baseCards, matches, {
      c1: { action: "show-diff", fieldSelections: { base_price: false } },
    });
    const r = resolved.find((x) => x.card.id === "c1")!;
    expect(r.id).toBe("row-a");
    const f = r.card.module === "sell" ? r.card.fields : null;
    expect(f?.defaultPrice).toBe(95); // diff rejected → reverted to existing
  });

  it("show-diff keeps the incoming value when the field is accepted", () => {
    const { matches } = matchCards({ cards: baseCards, liveRows });
    const resolved = applyDedupe(baseCards, matches, {
      c1: { action: "show-diff", fieldSelections: { base_price: true } },
    });
    const r = resolved.find((x) => x.card.id === "c1")!;
    const f = r.card.module === "sell" ? r.card.fields : null;
    expect(f?.defaultPrice).toBe(120); // diff accepted → incoming kept
  });

  it("create leaves id unset but stamps external_* on the resolved card", () => {
    const { matches } = matchCards({
      externalSource: "csv",
      cards: baseCards,
      externalRefs: { c3: { externalSource: "csv", externalId: "CSV-3" } },
      liveRows,
    });
    const resolved = applyDedupe(baseCards, matches, {});
    const r = resolved.find((x) => x.card.id === "c3")!;
    expect(r.id).toBeNull();
    expect(r.externalSource).toBe("csv");
    expect(r.externalId).toBe("CSV-3");
  });

  it("defaults each card to its match's defaultAction when no resolution given", () => {
    const { matches } = matchCards({ cards: baseCards, liveRows });
    // c1 matched → default show-diff (with no selections = keep incoming);
    // c3 no match → default create. Both survive, c1 bound to its row.
    const resolved = applyDedupe(baseCards, matches, {});
    expect(resolved).toHaveLength(3);
    expect(resolved.find((x) => x.card.id === "c1")!.id).toBe("row-a");
    expect(resolved.find((x) => x.card.id === "c3")!.id).toBeNull();
  });
});
