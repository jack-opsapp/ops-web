import { describe, it, expect } from "vitest";
import { WIZARD_TRADES } from "@/lib/catalog-setup/trade-list";
import {
  selectTradeTemplate,
  TRADE_SEED_PRODUCTS,
} from "@/lib/catalog-setup/trade-templates";
import { INDUSTRY_PRESETS } from "@/lib/data/industry-presets";

// trade-templates is the offline / declined / agent-failure FLOOR (spec §3, §8,
// §10): every wizard trade resolves to a non-empty set of editable starter
// StagingCards keyed by the trade-list tokens. Cards are stamped source
// "template" + state "proposed" so the canvas treats them like any other
// proposed row the owner can accept / edit / reject (spec §7). These invariants
// guarantee no dead picker option, real preset-derived task types with auto
// colors, and unique client ids so the canvas keys never collide.

describe("selectTradeTemplate — roofing (the authored pattern)", () => {
  const cards = selectTradeTemplate("roofing");

  it("returns editable TYPES + SELL starter cards", () => {
    const types = cards.filter((c) => c.module === "types");
    expect(types.length).toBeGreaterThan(0);
    expect(cards.some((c) => c.module === "sell")).toBe(true);
  });

  it("stamps every card source 'template' and state 'proposed'", () => {
    expect(cards.every((c) => c.source === "template")).toBe(true);
    expect(cards.every((c) => c.state === "proposed")).toBe(true);
  });

  it("gives every TYPES card an auto-assigned color hex (autoAssignColors)", () => {
    const types = cards.filter((c) => c.module === "types");
    expect(types.length).toBeGreaterThan(0);
    expect(
      types.every(
        (c) =>
          c.module === "types" &&
          typeof c.fields.color === "string" &&
          /^#[0-9A-Fa-f]{6}$/.test(c.fields.color),
      ),
    ).toBe(true);
  });

  it("mirrors the roofing preset task types in order, by display name", () => {
    const typeNames = cards
      .filter((c) => c.module === "types")
      .map((c) => (c.module === "types" ? c.fields.display : ""));
    expect(typeNames).toEqual(
      INDUSTRY_PRESETS.Roofing.taskTypes.map((t) => t.name),
    );
  });

  it("seeds SELL cards from TRADE_SEED_PRODUCTS with name + kind + type", () => {
    const sell = cards.filter((c) => c.module === "sell");
    const seeds = TRADE_SEED_PRODUCTS.roofing;
    expect(sell).toHaveLength(seeds.length);
    expect(
      sell.map((c) => (c.module === "sell" ? c.fields.name : "")),
    ).toEqual(seeds.map((s) => s.name));
    for (const c of sell) {
      if (c.module !== "sell") continue;
      expect(["service", "material", "package"]).toContain(c.fields.kind);
      expect(["LABOR", "MATERIAL", "OTHER"]).toContain(c.fields.type);
    }
  });
});

describe("selectTradeTemplate — coverage across every wizard trade", () => {
  it("every wizard trade resolves to a non-empty template (no dead picker option)", () => {
    for (const t of WIZARD_TRADES) {
      expect(selectTradeTemplate(t.id).length).toBeGreaterThan(0);
    }
  });

  it("every wizard trade yields at least one TYPES card and one SELL card", () => {
    for (const t of WIZARD_TRADES) {
      const cards = selectTradeTemplate(t.id);
      expect(cards.some((c) => c.module === "types")).toBe(true);
      expect(cards.some((c) => c.module === "sell")).toBe(true);
    }
  });

  it("never produces a non-template / non-proposed card for any trade", () => {
    for (const t of WIZARD_TRADES) {
      for (const c of selectTradeTemplate(t.id)) {
        expect(c.source).toBe("template");
        expect(c.state).toBe("proposed");
      }
    }
  });
});

describe("selectTradeTemplate — stable contract", () => {
  it("stamps unique ids within a single template (canvas keys never collide)", () => {
    const ids = selectTradeTemplate("roofing").map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stamps unique ids across two different trades (no cross-trade key clash)", () => {
    const ids = [
      ...selectTradeTemplate("roofing"),
      ...selectTradeTemplate("hvac"),
    ].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns fresh ids on every call (re-selecting a trade re-stages cleanly)", () => {
    const a = selectTradeTemplate("plumbing").map((c) => c.id);
    const b = selectTradeTemplate("plumbing").map((c) => c.id);
    expect(a).not.toEqual(b);
  });

  it("authors realistic seed products for at least the three pattern trades", () => {
    for (const id of ["roofing", "hvac", "plumbing"] as const) {
      expect(TRADE_SEED_PRODUCTS[id].length).toBeGreaterThan(0);
    }
  });
});
