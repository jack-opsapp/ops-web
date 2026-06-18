import { describe, it, expect } from "vitest";
import { classifyImportedCards } from "../qb-import-classify";
import { qbDraftsToCards } from "../qb-drafts-to-cards";
import { mapQbItems } from "../qb-item-mapper";
import {
  serviceItem,
  nonInventoryItem,
  inventoryItem,
} from "../__fixtures__/qb-items";
import type { LiveCatalogRow } from "@/lib/catalog-setup/commit/dedupe-matcher.types";

const OFF = { inventoryMode: "off" as const };

/** Adapt the three known fixtures into SELL cards (ids qb:42 / qb:55 / qb:60). */
function importCards() {
  const drafts = mapQbItems([serviceItem, nonInventoryItem, inventoryItem], OFF)
    .cards;
  return qbDraftsToCards(drafts);
}

describe("classifyImportedCards", () => {
  it("classifies a clean catalog as all-new (every card stays proposed)", () => {
    const { cards, existingRows, matchedCount } = classifyImportedCards(
      importCards(),
      [],
      "quickbooks",
    );
    expect(matchedCount).toBe(0);
    expect(cards.every((c) => c.state === "proposed")).toBe(true);
    expect(Object.keys(existingRows)).toHaveLength(0);
  });

  it("re-pull matches by external_id even after a rename + sku drift", () => {
    // The owner re-pulls. The QB item Id 42 already lives in the catalog, but
    // its sku AND name drifted since the first import. external_id must still
    // re-sync the SAME row (no duplicate) — the won-conversion guard.
    const live: LiveCatalogRow[] = [
      {
        id: "row-42",
        name: "Renamed inspection",
        sku: "DIFFERENT-SKU",
        external_source: "quickbooks",
        external_id: "42",
        base_price: 150,
        unit_cost: null,
        is_taxable: false,
        kind: "service",
        type: "LABOR",
      },
    ];
    const { cards, existingRows, matchedCount } = classifyImportedCards(
      importCards(),
      live,
      "quickbooks",
    );
    expect(matchedCount).toBe(1);
    const card = cards.find((c) => c.id === "qb:42");
    expect(card?.state).toBe("merge");
    expect(card?.matchedExistingId).toBe("row-42");
    expect(existingRows["row-42"]).toMatchObject({
      name: "Renamed inspection",
      defaultPrice: 150,
    });
    // The other two cards have no live match → still proposed.
    expect(cards.filter((c) => c.state === "proposed")).toHaveLength(2);
  });

  it("falls back to a sku match when there is no external id on the live row", () => {
    const live: LiveCatalogRow[] = [
      {
        id: "row-pf",
        name: "Old fitting name",
        sku: "PF-3-4", // matches nonInventoryItem.Sku
        base_price: 4.5,
        unit_cost: 1.85,
        is_taxable: true,
        kind: "material",
        type: "MATERIAL",
      },
    ];
    const { cards, matchedCount, existingRows } = classifyImportedCards(
      importCards(),
      live,
      "quickbooks",
    );
    expect(matchedCount).toBe(1);
    expect(cards.find((c) => c.id === "qb:55")?.matchedExistingId).toBe("row-pf");
    expect(existingRows["row-pf"]?.unitCost).toBe(1.85);
  });

  it("produces a per-field show-diff for a price drift on a sku match", () => {
    const live: LiveCatalogRow[] = [
      {
        id: "row-pf",
        name: "Pipe fitting",
        sku: "PF-3-4",
        base_price: 9.99, // drifted from the incoming 4.5
        unit_cost: 1.85,
        is_taxable: true,
        kind: "material",
        type: "MATERIAL",
      },
    ];
    const { existingRows } = classifyImportedCards(
      importCards(),
      live,
      "quickbooks",
    );
    // The canvas compares card.fields.defaultPrice (4.5) to existing (9.99).
    expect(existingRows["row-pf"]?.defaultPrice).toBe(9.99);
  });
});
