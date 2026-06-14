import { describe, it, expect } from "vitest";
import { stagingReducer, initialStagingState } from "./staging-reducer";
import type { StagingCard } from "./staging-card";

function sellCard(id: string, over: Partial<StagingCard> = {}): StagingCard {
  return {
    id,
    source: "manual",
    state: "proposed",
    module: "sell",
    fields: {
      name: "Tear-off",
      defaultPrice: 100,
      unitCost: 40,
      isTaxable: true,
      kind: "service",
      type: "LABOR",
    },
    ...over,
  } as StagingCard;
}

describe("stagingReducer", () => {
  it("starts empty", () => {
    expect(initialStagingState.cards).toEqual([]);
  });

  it("ADD_CARDS appends proposed cards", () => {
    const s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a"), sellCard("b")],
    });
    expect(s.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(s.cards.every((c) => c.state === "proposed")).toBe(true);
  });

  it("ADD_CARDS is idempotent by id (re-adding does not duplicate)", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, { type: "ADD_CARDS", cards: [sellCard("a")] });
    expect(s.cards).toHaveLength(1);
  });

  it("ACCEPT_CARD flips state to accepted", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "a" });
    expect(s.cards[0].state).toBe("accepted");
  });

  it("EDIT_CARD merges fields and sets state to edited", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, {
      type: "EDIT_CARD",
      id: "a",
      fields: { defaultPrice: 250 },
    });
    const card = s.cards[0];
    expect(card.state).toBe("edited");
    expect(card.module === "sell" && card.fields.defaultPrice).toBe(250);
    expect(card.module === "sell" && card.fields.name).toBe("Tear-off");
  });

  it("REJECT_CARD flips state to rejected (kept in list for undo)", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "a" });
    expect(s.cards[0].state).toBe("rejected");
  });

  it("an action on an unknown id is a no-op (returns same state ref)", () => {
    const s0 = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    const s1 = stagingReducer(s0, { type: "ACCEPT_CARD", id: "nope" });
    expect(s1).toBe(s0);
  });

  // ─── Task 1.3: merge + undo + reset ──────────────────────────────────────

  it("MERGE_CARD sets state=merge and records matchedExistingId", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, {
      type: "MERGE_CARD",
      id: "a",
      matchedExistingId: "live-123",
    });
    expect(s.cards[0].state).toBe("merge");
    expect(s.cards[0].matchedExistingId).toBe("live-123");
  });

  it("UNRESOLVE_CARD returns a rejected card to proposed (undo)", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "a" });
    s = stagingReducer(s, { type: "UNRESOLVE_CARD", id: "a" });
    expect(s.cards[0].state).toBe("proposed");
  });

  it("UNRESOLVE_CARD clears a prior merge match (undo of merge)", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a")],
    });
    s = stagingReducer(s, {
      type: "MERGE_CARD",
      id: "a",
      matchedExistingId: "live-123",
    });
    s = stagingReducer(s, { type: "UNRESOLVE_CARD", id: "a" });
    expect(s.cards[0].state).toBe("proposed");
    expect(s.cards[0].matchedExistingId).toBeUndefined();
  });

  // ─── Inventory-off down-shift (Task 6.11) ────────────────────────────────

  function stockCard(id: string, over: Partial<StagingCard> = {}): StagingCard {
    return {
      id,
      source: "import",
      state: "accepted",
      module: "stock",
      fields: { name: "Shingle", sku: "SHGL", quantity: 40, unitCost: 12, reorderPoint: 10 },
      ...over,
    } as StagingCard;
  }

  it("DOWNSHIFT_STOCK_TO_PRODUCTS converts stock cards to products, surfacing the count", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("p"), stockCard("k")],
    });
    s = stagingReducer(s, { type: "DOWNSHIFT_STOCK_TO_PRODUCTS" });
    const kept = s.cards.find((c) => c.id === "k")!;
    expect(kept.module).toBe("sell");
    expect(kept.state).toBe("accepted"); // state preserved
    if (kept.module === "sell") {
      expect(kept.fields.name).toBe("Shingle");
      expect(kept.fields.sku).toBe("SHGL");
      expect(kept.fields.defaultPrice).toBeNull(); // honest: a product needs a price
      expect(kept.fields.description).toContain("40"); // quantity surfaced, not dropped
      expect(kept.fields.kind).toBe("material");
    }
    // the existing product is untouched
    expect(s.cards.find((c) => c.id === "p")!.module).toBe("sell");
  });

  it("DOWNSHIFT_STOCK_TO_PRODUCTS is a no-op when there is no stock (same ref)", () => {
    const s0 = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("p")],
    });
    const s1 = stagingReducer(s0, { type: "DOWNSHIFT_STOCK_TO_PRODUCTS" });
    expect(s1).toBe(s0);
  });

  it("RESET clears all cards", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sellCard("a"), sellCard("b")],
    });
    s = stagingReducer(s, { type: "RESET" });
    expect(s.cards).toEqual([]);
  });
});
