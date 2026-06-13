// TDD spec for the PURE agent proposal schemas (plan Task 4.2).
//
// The agent emits proposals in three UPPERCASE module shapes — SELL / STOCK /
// TYPES — mirroring spec §9 (the live-table column shape) and §11 (the commit
// payload row shape). These schemas are the structural gate: a proposal that
// can't parse here can never become a StagingCard. `tiered_pricing` is
// structurally impossible (spec §9 "never tiered_pricing"; the column is dead).

import { describe, it, expect } from "vitest";
import {
  CatalogProposalSchema,
  ProposalBatchSchema,
  SellProposalSchema,
  StockProposalSchema,
  TypesProposalSchema,
  type CatalogProposal,
  type SellProposal,
  type StockProposal,
  type TypesProposal,
} from "../proposal-schemas";

const sellFlat: SellProposal = {
  module: "SELL",
  name: "Roof tune-up",
  default_price: 250,
  kind: "service",
  type: "LABOR",
  is_taxable: true,
};

const sellTiered: SellProposal = {
  module: "SELL",
  name: "Install",
  default_price: 100,
  kind: "service",
  type: "LABOR",
  is_taxable: false,
  options: {
    kind: "select",
    label: "Size",
    values: [
      { label: "Small", add_flat: 0 },
      { label: "Large", add_flat: 50 },
    ],
  },
};

const stockVariant: StockProposal = {
  module: "STOCK",
  name: "Architectural shingle",
  sku: "SHNG-ARCH",
  quantity: 40,
  unit_cost: 32.5,
  reorder_point: 10,
  unit_id: "u1",
};

const typesTrade: TypesProposal = {
  module: "TYPES",
  trade: "roofing",
  task_types: [{ display: "Tear-off", color: "#9DB582", is_default: false }],
};

describe("SellProposalSchema", () => {
  it("accepts a flat-priced SELL proposal", () => {
    expect(SellProposalSchema.safeParse(sellFlat).success).toBe(true);
  });

  it("accepts a tiered SELL proposal (select option + add_flat values)", () => {
    expect(SellProposalSchema.safeParse(sellTiered).success).toBe(true);
  });

  it("rejects a SELL proposal with no price (default_price absent)", () => {
    const { default_price, ...noPrice } = sellFlat;
    expect(SellProposalSchema.safeParse(noPrice).success).toBe(false);
  });

  it("rejects an unknown kind enum", () => {
    expect(
      SellProposalSchema.safeParse({ ...sellFlat, kind: "widget" }).success,
    ).toBe(false);
  });

  it("rejects an unknown type enum", () => {
    expect(
      SellProposalSchema.safeParse({ ...sellFlat, type: "SHIPPING" }).success,
    ).toBe(false);
  });

  it("rejects an options ladder that is not a select", () => {
    expect(
      SellProposalSchema.safeParse({
        ...sellTiered,
        options: { kind: "integer", label: "Qty", values: [] },
      }).success,
    ).toBe(false);
  });

  it("has no tiered_pricing field (dead column → strict rejects it)", () => {
    const withDead = { ...sellFlat, tiered_pricing: { a: 1 } };
    const r = SellProposalSchema.safeParse(withDead);
    // strict() makes the unknown key fail; even if it somehow parsed, the dead
    // field must never round-trip onto the typed proposal.
    expect(r.success).toBe(false);
    expect(
      r.success && (r.data as Record<string, unknown>).tiered_pricing,
    ).toBeFalsy();
  });
});

describe("StockProposalSchema", () => {
  it("accepts a valid STOCK variant", () => {
    expect(StockProposalSchema.safeParse(stockVariant).success).toBe(true);
  });

  it("accepts a recipe pinned to a concrete catalog_variant_id", () => {
    expect(
      StockProposalSchema.safeParse({
        ...stockVariant,
        materials: [{ catalog_variant_id: "v1", qty: 2 }],
      }).success,
    ).toBe(true);
  });

  it("rejects a recipe material with no catalog_variant_id", () => {
    expect(
      StockProposalSchema.safeParse({
        ...stockVariant,
        materials: [{ qty: 2 }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      StockProposalSchema.safeParse({ ...stockVariant, surprise: true })
        .success,
    ).toBe(false);
  });
});

describe("TypesProposalSchema", () => {
  it("accepts a TYPES proposal with a known trade + task types", () => {
    expect(TypesProposalSchema.safeParse(typesTrade).success).toBe(true);
  });

  it("rejects an out-of-list trade", () => {
    expect(
      TypesProposalSchema.safeParse({
        ...typesTrade,
        trade: "underwater-basket-weaving",
      }).success,
    ).toBe(false);
  });
});

describe("CatalogProposalSchema (discriminated union)", () => {
  it("discriminates on module", () => {
    const parsed = CatalogProposalSchema.safeParse(sellFlat);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const p: CatalogProposal = parsed.data;
      expect(p.module).toBe("SELL");
    }
  });

  it("rejects an unknown module", () => {
    expect(
      CatalogProposalSchema.safeParse({ ...sellFlat, module: "BILLING" })
        .success,
    ).toBe(false);
  });
});

describe("ProposalBatchSchema", () => {
  it("accepts a batch of mixed proposals", () => {
    expect(
      ProposalBatchSchema.safeParse({
        proposals: [sellFlat, stockVariant, typesTrade],
      }).success,
    ).toBe(true);
  });

  it("accepts an empty batch", () => {
    expect(ProposalBatchSchema.safeParse({ proposals: [] }).success).toBe(true);
  });

  it("rejects a batch whose proposals key is missing", () => {
    expect(ProposalBatchSchema.safeParse({}).success).toBe(false);
  });
});
