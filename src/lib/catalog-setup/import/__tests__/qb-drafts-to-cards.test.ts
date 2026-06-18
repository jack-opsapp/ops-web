import { describe, it, expect } from "vitest";
import { mapQbItem, mapQbItems } from "../qb-item-mapper";
import { qbDraftToCard, qbDraftsToCards, qbCardId } from "../qb-drafts-to-cards";
import {
  serviceItem,
  nonInventoryItem,
  inventoryItem,
  inventoryNoQtyItem,
  groupItem,
  categoryItem,
  mixedItems,
} from "../__fixtures__/qb-items";

const TRACKED = { inventoryMode: "tracked" as const };
const OFF = { inventoryMode: "off" as const };

describe("qbDraftToCard", () => {
  it("maps a Service item to a SELL card with re-import identity stamped", () => {
    const card = qbDraftToCard(mapQbItem(serviceItem, OFF));
    expect(card).not.toBeNull();
    expect(card).toMatchObject({
      id: "qb:42",
      source: "import",
      state: "proposed",
      module: "sell",
      externalSource: "quickbooks",
      externalId: "42",
    });
    if (card?.module !== "sell") throw new Error("expected sell card");
    expect(card.fields).toMatchObject({
      name: "Roof inspection",
      defaultPrice: 150,
      unitCost: null, // PurchaseCost 0 coalesces to null (shows "—", not "$0")
      sku: "INSP-01",
      isTaxable: false,
      kind: "service",
      type: "LABOR",
      pricingUnit: "each",
    });
  });

  it("carries a NonInventory item's cost through", () => {
    const card = qbDraftToCard(mapQbItem(nonInventoryItem, OFF));
    if (card?.module !== "sell") throw new Error("expected sell card");
    expect(card.fields.kind).toBe("material");
    expect(card.fields.type).toBe("MATERIAL");
    expect(card.fields.unitCost).toBe(1.85);
    expect(card.fields.defaultPrice).toBe(4.5);
  });

  it("surfaces an Inventory item's on-hand count in the description (never dropped)", () => {
    const card = qbDraftToCard(mapQbItem(inventoryItem, TRACKED));
    if (card?.module !== "sell") throw new Error("expected sell card");
    // Inventory → sellable material in the price book (v1 QB lane scope).
    expect(card.fields.kind).toBe("material");
    expect(card.fields.description).toBe(
      "Architectural asphalt shingle, per bundle\nOn hand: 320",
    );
  });

  it("surfaces a zero on-hand count too (0, not omitted)", () => {
    const card = qbDraftToCard(mapQbItem(inventoryNoQtyItem, TRACKED));
    if (card?.module !== "sell") throw new Error("expected sell card");
    expect(card.fields.description).toBe("On hand: 0");
  });

  it("does NOT surface on-hand when the company tracks no inventory", () => {
    // inventoryMode 'off' → mapper emits no catalogItem → no on-hand line.
    const card = qbDraftToCard(mapQbItem(inventoryItem, OFF));
    if (card?.module !== "sell") throw new Error("expected sell card");
    expect(card.fields.description).toBe(
      "Architectural asphalt shingle, per bundle",
    );
  });

  it("honors a localized on-hand label", () => {
    const card = qbDraftToCard(mapQbItem(inventoryNoQtyItem, TRACKED), {
      onHandLabel: "En existencia",
    });
    if (card?.module !== "sell") throw new Error("expected sell card");
    expect(card.fields.description).toBe("En existencia: 0");
  });

  it("maps a Group item to a package product", () => {
    const card = qbDraftToCard(mapQbItem(groupItem, OFF));
    if (card?.module !== "sell") throw new Error("expected sell card");
    expect(card.fields.kind).toBe("package");
    expect(card.fields.type).toBe("OTHER");
  });

  it("drops a Category folder sentinel (returns null)", () => {
    expect(qbDraftToCard(mapQbItem(categoryItem, OFF))).toBeNull();
  });
});

describe("qbDraftsToCards", () => {
  it("adapts a whole pull, dropping folder sentinels", () => {
    const { cards } = mapQbItems(mixedItems, TRACKED); // mapQbItems already drops Category
    const out = qbDraftsToCards(cards);
    expect(out).toHaveLength(cards.length);
    expect(out.every((c) => c.module === "sell")).toBe(true);
    expect(out.every((c) => c.source === "import")).toBe(true);
    expect(out.every((c) => c.externalSource === "quickbooks")).toBe(true);
  });

  it("produces stable, deterministic ids across re-pulls (idempotent dispatch)", () => {
    const drafts = mapQbItems(mixedItems, TRACKED).cards;
    const first = qbDraftsToCards(drafts).map((c) => c.id);
    const second = qbDraftsToCards(drafts).map((c) => c.id);
    expect(second).toEqual(first);
    expect(first).toContain(qbCardId("42"));
  });
});
