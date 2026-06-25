import { describe, it, expect } from "vitest";
import { WIZARD_TRADES } from "@/lib/catalog-setup/trade-list";
import {
  previewTradeTemplate,
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

  it("leads with exactly one trade card carrying the trade slug (isTrade)", () => {
    const tradeCards = cards.filter(
      (c) => c.module === "types" && c.fields.isTrade,
    );
    expect(tradeCards).toHaveLength(1);
    const tradeCard = tradeCards[0];
    // The trade card is FIRST (the company's trade leads its task types).
    expect(cards[0]).toBe(tradeCard);
    if (tradeCard.module !== "types") throw new Error("unreachable");
    // `display` holds the stable SLUG (commit contract), not the human label.
    expect(tradeCard.fields.display).toBe("roofing");
    expect(tradeCard.fields.isTrade).toBe(true);
  });

  it("gives every task-type card (not the trade card) an auto-assigned color hex", () => {
    const taskTypes = cards.filter(
      (c) => c.module === "types" && !c.fields.isTrade,
    );
    expect(taskTypes.length).toBeGreaterThan(0);
    expect(
      taskTypes.every(
        (c) =>
          c.module === "types" &&
          typeof c.fields.color === "string" &&
          /^#[0-9A-Fa-f]{6}$/.test(c.fields.color),
      ),
    ).toBe(true);
  });

  it("the trade card carries no color (it is the trade, not a task type)", () => {
    const tradeCard = cards.find((c) => c.module === "types" && c.fields.isTrade);
    expect(tradeCard).toBeDefined();
    if (tradeCard?.module === "types") {
      expect(tradeCard.fields.color).toBeUndefined();
    }
  });

  it("mirrors the roofing preset task types in order, by display name", () => {
    const typeNames = cards
      .filter((c) => c.module === "types" && !c.fields.isTrade)
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

  it("emits exactly one trade card per trade, slug = the trade token", () => {
    for (const t of WIZARD_TRADES) {
      const tradeCards = selectTradeTemplate(t.id).filter(
        (c) => c.module === "types" && c.fields.isTrade,
      );
      expect(tradeCards).toHaveLength(1);
      const card = tradeCards[0];
      if (card.module === "types") {
        expect(card.fields.display).toBe(t.id);
      }
    }
  });
});

describe("previewTradeTemplate — counts match selectTradeTemplate (no minting)", () => {
  it("returns the preset task-type count and the seed line count per trade", () => {
    for (const t of WIZARD_TRADES) {
      const preview = previewTradeTemplate(t.id);
      const cards = selectTradeTemplate(t.id);
      const taskTypeCards = cards.filter(
        (c) => c.module === "types" && !c.fields.isTrade,
      );
      const sellCards = cards.filter((c) => c.module === "sell");
      // The preview EXCLUDES the trade card (it's the trade, not a task type).
      expect(preview.taskTypes).toBe(taskTypeCards.length);
      expect(preview.sell).toBe(sellCards.length);
      expect(preview.taskTypes).toBeGreaterThan(0);
      expect(preview.sell).toBeGreaterThan(0);
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
