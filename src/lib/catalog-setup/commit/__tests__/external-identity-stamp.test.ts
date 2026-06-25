import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collectExternalStampTargets,
  stampExternalIdentity,
} from "../external-identity-stamp";
import type { StagingCard } from "../../staging-card";

function sellCard(over: Partial<StagingCard> & { id: string }): StagingCard {
  return {
    source: "import",
    state: "accepted",
    module: "sell",
    fields: {
      name: "X",
      defaultPrice: 1,
      unitCost: null,
      isTaxable: true,
      kind: "service",
      type: "LABOR",
    },
    ...over,
  } as StagingCard;
}

describe("collectExternalStampTargets", () => {
  it("resolves a fresh create's row via the RPC id_map (client_id = card.id)", () => {
    const cards = [
      sellCard({ id: "qb:42", externalSource: "quickbooks", externalId: "42" }),
    ];
    const targets = collectExternalStampTargets(cards, { "qb:42": "row-new" });
    expect(targets).toEqual([
      { rowId: "row-new", externalSource: "quickbooks", externalId: "42" },
    ]);
  });

  it("prefers a merge card's matchedExistingId over the id_map", () => {
    const cards = [
      sellCard({
        id: "qb:42",
        state: "merge",
        matchedExistingId: "row-existing",
        externalSource: "quickbooks",
        externalId: "42",
      }),
    ];
    const targets = collectExternalStampTargets(cards, { "qb:42": "row-other" });
    expect(targets[0].rowId).toBe("row-existing");
  });

  it("skips manual cards (no external identity)", () => {
    const cards = [sellCard({ id: "manual-1" })];
    expect(collectExternalStampTargets(cards, { "manual-1": "row" })).toHaveLength(0);
  });

  it("skips a card with no resolvable row (no match, not in id_map)", () => {
    const cards = [
      sellCard({ id: "qb:99", externalSource: "quickbooks", externalId: "99" }),
    ];
    expect(collectExternalStampTargets(cards, {})).toHaveLength(0);
  });

  it("skips non-sell cards (stock stamping is deferred)", () => {
    const stock = {
      id: "qb:60",
      source: "import",
      state: "accepted",
      module: "stock",
      fields: { name: "S", quantity: 1, unitCost: null, reorderPoint: null },
      externalSource: "quickbooks",
      externalId: "60",
    } as StagingCard;
    expect(collectExternalStampTargets([stock], { "qb:60": "row" })).toHaveLength(0);
  });

  it("dedupes by resolved rowId", () => {
    const cards = [
      sellCard({ id: "a", state: "merge", matchedExistingId: "row-1", externalSource: "quickbooks", externalId: "1" }),
      sellCard({ id: "b", state: "merge", matchedExistingId: "row-1", externalSource: "quickbooks", externalId: "1" }),
    ];
    expect(collectExternalStampTargets(cards, {})).toHaveLength(1);
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

describe("stampExternalIdentity", () => {
  it("stamps each target with its external identity, company-scoped", async () => {
    const { db, updates } = fakeDb();
    const res = await stampExternalIdentity(db, "co-1", [
      { rowId: "row-1", externalSource: "quickbooks", externalId: "42" },
      { rowId: "row-2", externalSource: "quickbooks", externalId: "55" },
    ]);
    expect(res.stamped).toBe(2);
    expect(res.error).toBeUndefined();
    expect(updates).toEqual([
      { values: { external_source: "quickbooks", external_id: "42" }, id: "row-1", companyId: "co-1" },
      { values: { external_source: "quickbooks", external_id: "55" }, id: "row-2", companyId: "co-1" },
    ]);
  });

  it("is non-fatal: a failed row is reported, the rest still stamp", async () => {
    const { db } = fakeDb(new Set(["row-2"]));
    const res = await stampExternalIdentity(db, "co-1", [
      { rowId: "row-1", externalSource: "quickbooks", externalId: "42" },
      { rowId: "row-2", externalSource: "quickbooks", externalId: "55" },
    ]);
    expect(res.stamped).toBe(1);
    expect(res.error).toBeTruthy();
  });

  it("no-ops on an empty target set", async () => {
    const { db, updates } = fakeDb();
    const res = await stampExternalIdentity(db, "co-1", []);
    expect(res).toEqual({ stamped: 0 });
    expect(updates).toHaveLength(0);
  });
});
