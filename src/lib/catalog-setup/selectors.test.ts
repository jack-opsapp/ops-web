import { describe, it, expect } from "vitest";
import { stagingReducer, initialStagingState } from "./staging-reducer";
import { selectRunningTotals, selectByModule, selectBlockers } from "./selectors";
import type { StagingCard } from "./staging-card";

function sell(id: string, price: number | null): StagingCard {
  return {
    id,
    source: "manual",
    state: "proposed",
    module: "sell",
    fields: {
      name: id,
      defaultPrice: price,
      unitCost: 0,
      isTaxable: true,
      kind: "service",
      type: "LABOR",
    },
  };
}
function typeCard(id: string): StagingCard {
  return {
    id,
    source: "manual",
    state: "proposed",
    module: "types",
    fields: { display: id },
  };
}

describe("selectors", () => {
  it("running totals count proposed and added (accepted+edited+merge), excluding rejected", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", 1), sell("b", 1), sell("c", 1), sell("d", 1)],
    });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "a" });
    s = stagingReducer(s, { type: "EDIT_CARD", id: "b", fields: { defaultPrice: 5 } });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "c" });
    const t = selectRunningTotals(s);
    expect(t).toEqual({ proposed: 1, added: 2, rejected: 1 }); // d still proposed
  });

  it("counts merge toward added", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", 1)],
    });
    s = stagingReducer(s, { type: "MERGE_CARD", id: "a", matchedExistingId: "live-1" });
    expect(selectRunningTotals(s)).toEqual({ proposed: 0, added: 1, rejected: 0 });
  });

  it("groups non-rejected cards by module", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", 1), typeCard("t1")],
    });
    s = stagingReducer(s, { type: "REJECT_CARD", id: "a" });
    const g = selectByModule(s);
    expect(g.sell).toHaveLength(0);
    expect(g.types.map((c) => c.id)).toEqual(["t1"]);
  });

  it("blockers: an accepted/edited SELL card with null price blocks build-it", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", null), sell("b", 100)],
    });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "a" });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "b" });
    expect(selectBlockers(s)).toEqual([{ kind: "missing_price", count: 1 }]);
  });

  it("a proposed card with null price does NOT block (only committable cards block)", () => {
    const s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", null)],
    });
    expect(selectBlockers(s)).toEqual([]);
  });

  it("a merge card with null price does NOT block (price comes from the matched live row)", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", null)],
    });
    s = stagingReducer(s, { type: "MERGE_CARD", id: "a", matchedExistingId: "live-1" });
    expect(selectBlockers(s)).toEqual([]);
  });

  it("blockers: a committable card with no name surfaces missing_name", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [sell("a", 100)],
    });
    s = stagingReducer(s, { type: "EDIT_CARD", id: "a", fields: { name: "" } });
    expect(selectBlockers(s)).toEqual([{ kind: "missing_name", count: 1 }]);
  });

  it("a TYPES card with a display value is NOT a missing_name blocker", () => {
    let s = stagingReducer(initialStagingState, {
      type: "ADD_CARDS",
      cards: [typeCard("t1")],
    });
    s = stagingReducer(s, { type: "ACCEPT_CARD", id: "t1" });
    expect(selectBlockers(s)).toEqual([]);
  });
});
