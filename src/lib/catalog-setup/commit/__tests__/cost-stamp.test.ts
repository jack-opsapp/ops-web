import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectCostStampTargets, stampUnitCost } from "../cost-stamp";
import type { StagingCard } from "../../staging-card";

function sellCard(over: Partial<StagingCard> & { id: string }): StagingCard {
  return {
    source: "manual",
    state: "accepted",
    module: "sell",
    fields: {
      name: "X",
      defaultPrice: 100,
      unitCost: 40,
      isTaxable: true,
      kind: "service",
      type: "LABOR",
    },
    ...over,
  } as StagingCard;
}

describe("collectCostStampTargets", () => {
  it("resolves a created SELL card's row via the id_map and carries its cost", () => {
    const targets = collectCostStampTargets([sellCard({ id: "c1" })], {
      c1: "row-new",
    });
    expect(targets).toEqual([{ rowId: "row-new", unitCost: 40 }]);
  });

  it("SKIPS a merge card — its on-file cost is preserved, never overwritten", () => {
    const cards = [
      sellCard({ id: "c1", state: "merge", matchedExistingId: "row-existing" }),
    ];
    expect(collectCostStampTargets(cards, { c1: "row-x" })).toHaveLength(0);
  });

  it("skips a card with no cost (nothing to persist)", () => {
    const card = sellCard({ id: "c1" });
    (card.fields as { unitCost: number | null }).unitCost = null;
    expect(collectCostStampTargets([card], { c1: "row" })).toHaveLength(0);
  });

  it("skips non-committable cards (proposed / rejected)", () => {
    const cards = [
      sellCard({ id: "p", state: "proposed" }),
      sellCard({ id: "r", state: "rejected" }),
    ];
    expect(collectCostStampTargets(cards, { p: "rp", r: "rr" })).toHaveLength(0);
  });

  it("skips a card the id_map did not resolve to a row", () => {
    expect(collectCostStampTargets([sellCard({ id: "c1" })], {})).toHaveLength(0);
  });

  it("skips non-sell cards (stock cost lands with stock import)", () => {
    const stock = {
      id: "s1",
      source: "manual",
      state: "accepted",
      module: "stock",
      fields: { name: "S", quantity: 1, unitCost: 12, reorderPoint: null },
    } as StagingCard;
    expect(collectCostStampTargets([stock], { s1: "row" })).toHaveLength(0);
  });

  it("dedupes by resolved rowId", () => {
    const cards = [sellCard({ id: "a" }), sellCard({ id: "b" })];
    expect(
      collectCostStampTargets(cards, { a: "row-1", b: "row-1" }),
    ).toHaveLength(1);
  });
});

/** Records the UPDATEs a stamp run issues; lets a test inject a per-row error. */
function fakeDb(errorRowIds: Set<string> = new Set()) {
  const updates: Array<{ values: Record<string, unknown>; id: string; companyId: string }> = [];
  const db = {
    from() {
      return {
        update(values: Record<string, unknown>) {
          return {
            eq(_c: string, id: string) {
              return {
                async eq(_c2: string, companyId: string) {
                  updates.push({ values, id, companyId });
                  return { error: errorRowIds.has(id) ? { message: "boom" } : null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, updates };
}

describe("stampUnitCost", () => {
  it("writes unit_cost onto each target, company-scoped", async () => {
    const { db, updates } = fakeDb();
    const res = await stampUnitCost(db, "co-1", [
      { rowId: "row-1", unitCost: 40 },
      { rowId: "row-2", unitCost: 6.5 },
    ]);
    expect(res.stamped).toBe(2);
    expect(res.error).toBeUndefined();
    expect(updates).toEqual([
      { values: { unit_cost: 40 }, id: "row-1", companyId: "co-1" },
      { values: { unit_cost: 6.5 }, id: "row-2", companyId: "co-1" },
    ]);
  });

  it("is non-fatal: a failed row is reported, the rest still stamp", async () => {
    const { db } = fakeDb(new Set(["row-2"]));
    const res = await stampUnitCost(db, "co-1", [
      { rowId: "row-1", unitCost: 40 },
      { rowId: "row-2", unitCost: 6.5 },
    ]);
    expect(res.stamped).toBe(1);
    expect(res.error).toBeTruthy();
  });

  it("no-ops on an empty target set", async () => {
    const { db, updates } = fakeDb();
    const res = await stampUnitCost(db, "co-1", []);
    expect(res).toEqual({ stamped: 0 });
    expect(updates).toHaveLength(0);
  });
});
