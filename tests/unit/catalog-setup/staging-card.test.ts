import { describe, it, expect, expectTypeOf } from "vitest";
import {
  COMMITTABLE_STATES,
  type ModuleKey,
  type CardSource,
  type CardState,
  type SellFields,
  type StockFields,
  type TypeFields,
  type StagingCard,
  type CardFieldsFor,
  type RunningTotals,
} from "@/lib/catalog-setup/staging-card";

// The canonical staging-card model is the contract the whole wizard imports
// (mappers, reducer, selectors, store, canvas). These tests pin the exported
// names + shapes so later slices can rely on them; the bulk of the value is
// type-level (a drift in a field name or union member breaks compilation here),
// with a small runtime invariant on COMMITTABLE_STATES.

describe("staging-card module enums", () => {
  it("ModuleKey is exactly sell | stock | types", () => {
    expectTypeOf<ModuleKey>().toEqualTypeOf<"sell" | "stock" | "types">();
  });

  it("CardSource is exactly import | agent | template | manual", () => {
    expectTypeOf<CardSource>().toEqualTypeOf<
      "import" | "agent" | "template" | "manual"
    >();
  });

  it("CardState is exactly proposed | accepted | edited | rejected | merge", () => {
    expectTypeOf<CardState>().toEqualTypeOf<
      "proposed" | "accepted" | "edited" | "rejected" | "merge"
    >();
  });
});

describe("COMMITTABLE_STATES", () => {
  it("is exactly accepted, edited, merge (the states a commit writes)", () => {
    expect([...COMMITTABLE_STATES].sort()).toEqual(
      ["accepted", "edited", "merge"].sort(),
    );
  });

  it("excludes proposed and rejected (they never commit)", () => {
    const set = new Set<string>(COMMITTABLE_STATES);
    expect(set.has("proposed")).toBe(false);
    expect(set.has("rejected")).toBe(false);
  });

  it("every member is a valid CardState", () => {
    const valid: CardState[] = [
      "proposed",
      "accepted",
      "edited",
      "rejected",
      "merge",
    ];
    for (const s of COMMITTABLE_STATES) {
      expect(valid).toContain(s);
    }
  });
});

describe("StagingCard discriminated union", () => {
  it("narrows fields on the `module` discriminant", () => {
    const sell: StagingCard = {
      id: "a",
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
    };
    // The discriminant must narrow `fields` to SellFields.
    if (sell.module === "sell") {
      expectTypeOf(sell.fields).toEqualTypeOf<SellFields>();
      expect(sell.fields.defaultPrice).toBe(100);
    }
  });

  it("constructs a stock card with StockFields", () => {
    const stock: StagingCard = {
      id: "s",
      source: "import",
      state: "proposed",
      module: "stock",
      fields: {
        name: "Copper pipe",
        quantity: 40,
        unitCost: 3.5,
        reorderPoint: 10,
      },
    };
    if (stock.module === "stock") {
      expectTypeOf(stock.fields).toEqualTypeOf<StockFields>();
      expect(stock.fields.quantity).toBe(40);
    }
  });

  it("constructs a types card with TypeFields", () => {
    const t: StagingCard = {
      id: "t",
      source: "template",
      state: "proposed",
      module: "types",
      fields: { display: "Tear-off crew" },
    };
    if (t.module === "types") {
      expectTypeOf(t.fields).toEqualTypeOf<TypeFields>();
      expect(t.fields.display).toBe("Tear-off crew");
    }
  });

  it("carries an optional matchedExistingId for the dedupe/merge path", () => {
    const merged: StagingCard = {
      id: "m",
      source: "import",
      state: "merge",
      module: "sell",
      matchedExistingId: "live-123",
      fields: {
        name: "Tear-off",
        defaultPrice: 100,
        unitCost: 40,
        isTaxable: true,
        kind: "service",
        type: "LABOR",
      },
    };
    expect(merged.matchedExistingId).toBe("live-123");
  });
});

describe("CardFieldsFor<M> helper", () => {
  it("resolves the fields type for each module key", () => {
    expectTypeOf<CardFieldsFor<"sell">>().toEqualTypeOf<SellFields>();
    expectTypeOf<CardFieldsFor<"stock">>().toEqualTypeOf<StockFields>();
    expectTypeOf<CardFieldsFor<"types">>().toEqualTypeOf<TypeFields>();
  });
});

describe("RunningTotals shape", () => {
  it("has proposed / added / rejected numeric counters", () => {
    const totals: RunningTotals = { proposed: 1, added: 2, rejected: 0 };
    expectTypeOf(totals).toEqualTypeOf<{
      proposed: number;
      added: number;
      rejected: number;
    }>();
    expect(totals.added).toBe(2);
  });
});
