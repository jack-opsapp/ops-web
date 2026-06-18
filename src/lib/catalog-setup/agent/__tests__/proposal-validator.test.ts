// TDD spec for the PURE proposal validator (plan Task 4.3).
//
// Beyond schema shape, the validator enforces commit-safety so no card can
// hard-fail `catalog_setup_save` (spec §16 war-game): SELL needs name AND price;
// STOCK variant needs a unit_id; a recipe must pin a concrete, KNOWN
// catalog_variant_id (a nil/family pin is silently dropped by RecipeResolver →
// reject here); referenced unit_ids must resolve; trade must be in the allowed
// list. On success a valid proposal becomes a StagingCard (the canvas contract);
// on failure it yields per-field, operator-facing error seeds. PURE — no I/O;
// resolvability is checked against a caller-supplied ctx.

import { describe, it, expect } from "vitest";
import {
  validateProposal,
  validateBatch,
  type ValidationContext,
} from "../proposal-validator";
import type { CatalogProposal } from "../proposal-schemas";

const ctx: ValidationContext = {
  knownUnitIds: new Set(["u1"]),
  knownVariantIds: new Set(["v1"]),
  allowedTrades: new Set([
    "roofing",
    "hvac",
    "plumbing",
    "electrical",
    "general",
  ]),
};

const sellComplete = {
  module: "SELL",
  name: "Roof tune-up",
  default_price: 250,
  kind: "service",
  type: "LABOR",
  is_taxable: true,
} as const;

const stockComplete = {
  module: "STOCK",
  name: "Architectural shingle",
  sku: "SHNG-ARCH",
  quantity: 40,
  unit_cost: 32.5,
  reorder_point: 10,
  unit_id: "u1",
} as const;

describe("validateProposal — SELL guardrails", () => {
  it("passes a complete flat SELL proposal and emits a sell StagingCard", () => {
    const r = validateProposal(sellComplete as CatalogProposal, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.card.module).toBe("sell");
      expect(r.card.source).toBe("agent");
      expect(r.card.state).toBe("proposed");
      expect(r.card.id).toBeTruthy();
      if (r.card.module === "sell") {
        expect(r.card.fields.name).toBe("Roof tune-up");
        expect(r.card.fields.defaultPrice).toBe(250);
      }
    }
  });

  it("flags a SELL proposal missing a price", () => {
    const r = validateProposal(
      { module: "SELL", name: "X", kind: "service", type: "LABOR" } as unknown as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "default_price" }),
      );
    }
  });

  it("flags a SELL proposal with a blank name (guardrail beyond schema min(1))", () => {
    const r = validateProposal(
      { module: "SELL", name: "  ", default_price: 10, kind: "service", type: "LABOR", is_taxable: true } as unknown as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "name" }),
      );
    }
  });

  it("rejects a non-positive price", () => {
    const r = validateProposal(
      { ...sellComplete, default_price: 0 } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "default_price" }),
      );
    }
  });

  it("passes a complete, resolvable SELL tiered proposal (base = lowest tier)", () => {
    const r = validateProposal(
      {
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
            { label: "S", add_flat: 0 },
            { label: "L", add_flat: 50 },
          ],
        },
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a tier ladder whose lowest tier is not the base (no zero add_flat)", () => {
    const r = validateProposal(
      {
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
            { label: "S", add_flat: 25 },
            { label: "L", add_flat: 50 },
          ],
        },
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "options" }),
      );
    }
  });

  it("rejects a tier ladder with fewer than two tiers", () => {
    const r = validateProposal(
      {
        module: "SELL",
        name: "Install",
        default_price: 100,
        kind: "service",
        type: "LABOR",
        is_taxable: false,
        options: {
          kind: "select",
          label: "Size",
          values: [{ label: "Only", add_flat: 0 }],
        },
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateProposal — STOCK guardrails", () => {
  it("passes a complete STOCK variant and emits a stock StagingCard", () => {
    const r = validateProposal(stockComplete as CatalogProposal, ctx);
    expect(r.ok).toBe(true);
    if (r.ok && r.card.module === "stock") {
      expect(r.card.fields.unitId).toBe("u1");
      expect(r.card.fields.reorderPoint).toBe(10);
    }
  });

  it("flags a STOCK variant missing a unit_id", () => {
    const { unit_id, ...noUnit } = stockComplete;
    const r = validateProposal(noUnit as unknown as CatalogProposal, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "unit_id" }),
      );
    }
  });

  it("flags a STOCK variant whose unit_id is unknown to ctx", () => {
    const r = validateProposal(
      { ...stockComplete, unit_id: "ghost-unit" } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "unit_id" }),
      );
    }
  });

  it("rejects a recipe with a nil/unknown variant pin", () => {
    const r = validateProposal(
      {
        ...stockComplete,
        materials: [{ catalog_variant_id: "ghost", qty: 1 }],
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "materials" }),
      );
    }
  });

  it("passes a recipe pinned to a known catalog_variant_id", () => {
    const r = validateProposal(
      {
        ...stockComplete,
        materials: [{ catalog_variant_id: "v1", qty: 2 }],
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a recipe material with a non-positive qty", () => {
    const r = validateProposal(
      {
        ...stockComplete,
        materials: [{ catalog_variant_id: "v1", qty: 0 }],
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateProposal — TYPES guardrails", () => {
  it("passes a TYPES proposal with an allowed trade and emits a types StagingCard", () => {
    const r = validateProposal(
      {
        module: "TYPES",
        trade: "roofing",
        task_types: [{ display: "Tear-off", is_default: false }],
      } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.card.module === "types") {
      expect(r.card.fields.isTrade).toBe(true);
      expect(r.card.fields.display).toBe("roofing");
    }
  });

  it("rejects an out-of-list trade", () => {
    const r = validateProposal(
      { module: "TYPES", trade: "underwater-basket-weaving" } as unknown as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ field: "trade" }),
      );
    }
  });

  it("rejects a trade not present in the ctx allow-list even if schema-valid", () => {
    // `masonry` is a real WIZARD_TRADE token but absent from this ctx.allowedTrades
    const r = validateProposal(
      { module: "TYPES", trade: "masonry" } as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateProposal — structural gate (schema)", () => {
  it("rejects a proposal with an unknown module before any guardrail", () => {
    const r = validateProposal(
      { module: "BILLING", name: "x" } as unknown as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it("strips/rejects a dead tiered_pricing field", () => {
    const r = validateProposal(
      { ...sellComplete, tiered_pricing: { a: 1 } } as unknown as CatalogProposal,
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateBatch", () => {
  it("returns only valid cards and aggregates rejected reasons", () => {
    const valid = sellComplete as CatalogProposal;
    const invalid = {
      module: "SELL",
      name: "No price",
      kind: "service",
      type: "LABOR",
    } as unknown as CatalogProposal;
    const r = validateBatch({ proposals: [valid, invalid] }, ctx);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].module).toBe("sell");
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].index).toBe(1);
    expect(r.rejected[0].errors.length).toBeGreaterThan(0);
  });

  it("assigns each emitted card a unique id", () => {
    const r = validateBatch(
      { proposals: [sellComplete as CatalogProposal, sellComplete as CatalogProposal] },
      ctx,
    );
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0].id).not.toBe(r.cards[1].id);
  });

  it("handles an empty batch", () => {
    const r = validateBatch({ proposals: [] }, ctx);
    expect(r.cards).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });
});
