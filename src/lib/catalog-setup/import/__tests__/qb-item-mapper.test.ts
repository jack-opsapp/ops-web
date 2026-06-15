import { describe, it, expect } from "vitest";
import { mapQbItem, mapQbItems } from "../qb-item-mapper";
import {
  serviceItem,
  nonInventoryItem,
  inventoryItem,
  inventoryNoQtyItem,
  groupItem,
  categoryItem,
  namelessItem,
  unknownTypeItem,
  sparseDefaultsItem,
  mixedItems,
} from "../__fixtures__/qb-items";

describe("mapQbItem — Service", () => {
  it("maps a Service item to a flat service product", () => {
    const r = mapQbItem(serviceItem, { inventoryMode: "off" });
    expect(r).toMatchObject({
      kind: "service",
      type: "LABOR",
      name: "Roof inspection",
      sku: "INSP-01",
      basePrice: 150,
      defaultPrice: 150,
      unitCost: null,
      isTaxable: false,
      pricingUnit: "each",
      externalSource: "quickbooks",
      externalId: "42",
      catalogItem: null,
      bundleItems: [],
    });
  });

  it("carries a null description through unchanged", () => {
    const r = mapQbItem(serviceItem, { inventoryMode: "off" });
    expect(r.description).toBeNull();
  });

  it("never flags a clean Service item for review or as a blocker", () => {
    const r = mapQbItem(serviceItem, { inventoryMode: "off" });
    expect(r.needsReview).toBe(false);
    expect(r.blocker).toBeNull();
  });
});

describe("mapQbItem — NonInventory", () => {
  it("maps NonInventory to material/MATERIAL with PurchaseCost → unitCost", () => {
    const r = mapQbItem(nonInventoryItem, { inventoryMode: "off" });
    expect(r).toMatchObject({
      kind: "material",
      type: "MATERIAL",
      name: "Pipe fitting",
      sku: "PF-3-4",
      description: "3/4 inch copper pipe fitting",
      basePrice: 4.5,
      defaultPrice: 4.5,
      unitCost: 1.85,
      isTaxable: true,
      pricingUnit: "each",
      externalSource: "quickbooks",
      externalId: "55",
      catalogItem: null,
      bundleItems: [],
    });
  });
});

describe("mapQbItem — Inventory", () => {
  it("with inventoryMode 'tracked' emits a linked catalog item + product draft", () => {
    const r = mapQbItem(inventoryItem, { inventoryMode: "tracked" });
    expect(r).toMatchObject({
      kind: "material",
      type: "MATERIAL",
      name: "Asphalt shingle bundle",
      basePrice: 38,
      defaultPrice: 38,
      unitCost: 24.75,
      isTaxable: true,
      externalId: "60",
      linkedCatalogItem: true,
      pendingInventoryDecision: false,
    });
    expect(r.catalogItem).toMatchObject({
      name: "Asphalt shingle bundle",
      onHand: 320,
      unitCostOverride: 24.75,
      priceOverride: 38,
      sku: "SHNG-AR",
    });
  });

  it("with inventoryMode 'off' returns no catalog item and flags a pending decision", () => {
    const r = mapQbItem(inventoryItem, { inventoryMode: "off" });
    expect(r.kind).toBe("material");
    expect(r.type).toBe("MATERIAL");
    expect(r.catalogItem).toBeNull();
    expect(r.linkedCatalogItem).toBe(false);
    expect(r.pendingInventoryDecision).toBe(true);
  });

  it("defaults on-hand to 0 when QtyOnHand is absent and tracked", () => {
    const r = mapQbItem(inventoryNoQtyItem, { inventoryMode: "tracked" });
    expect(r.catalogItem).not.toBeNull();
    expect(r.catalogItem?.onHand).toBe(0);
  });
});

describe("mapQbItem — Group (bundle)", () => {
  it("maps a Group to a package product with derived bundle items", () => {
    const r = mapQbItem(groupItem, { inventoryMode: "off" });
    expect(r).toMatchObject({
      kind: "package",
      type: "OTHER",
      name: "Bathroom rough-in kit",
      externalId: "70",
      catalogItem: null,
    });
    expect(r.bundleItems).toEqual([
      { componentExternalId: "55", quantity: 6 },
      { componentExternalId: "60", quantity: 2 },
    ]);
  });
});

describe("mapQbItem — edge types", () => {
  it("maps an unknown Type to a safe service/OTHER default flagged needsReview", () => {
    const r = mapQbItem(unknownTypeItem, { inventoryMode: "off" });
    expect(r.kind).toBe("service");
    expect(r.type).toBe("OTHER");
    expect(r.needsReview).toBe(true);
    expect(r.blocker).toBeNull();
  });

  it("flags a missing Name as a blocker", () => {
    const r = mapQbItem(namelessItem, { inventoryMode: "off" });
    expect(r.blocker).toBe("missing_name");
  });

  it("drops a Category-type item by returning a kind:null sentinel", () => {
    const r = mapQbItem(categoryItem, { inventoryMode: "off" });
    expect(r.kind).toBeNull();
  });
});

describe("mapQbItem — column defaults", () => {
  it("defaults isTaxable to true when Taxable is absent (matches column default)", () => {
    const r = mapQbItem(sparseDefaultsItem, { inventoryMode: "off" });
    expect(r.isTaxable).toBe(true);
  });

  it("defaults basePrice/defaultPrice to 0 when UnitPrice is absent (NOT NULL default 0)", () => {
    const r = mapQbItem(sparseDefaultsItem, { inventoryMode: "off" });
    expect(r.basePrice).toBe(0);
    expect(r.defaultPrice).toBe(0);
  });

  it("nulls sku when Sku is absent", () => {
    const r = mapQbItem(sparseDefaultsItem, { inventoryMode: "off" });
    expect(r.sku).toBeNull();
  });
});

describe("mapQbItems — batch wrapper", () => {
  it("drops kind:null rows and partitions cards / blockers / needsReview", () => {
    const out = mapQbItems(mixedItems, { inventoryMode: "off" });
    // categoryItem dropped → not in cards; namelessItem is a blocker.
    const cardIds = out.cards.map((c) => c.externalId);
    expect(cardIds).not.toContain("90"); // category dropped
    // 7 input − 1 category dropped = 6 cards (the blocker row is still a card
    // so the owner can see + fix it; it is ALSO listed under blockers).
    expect(out.cards).toHaveLength(6);
    expect(out.blockers.map((b) => b.externalId)).toEqual(["99"]);
    // Group (70) now flags for review (its bundle components can't be carried),
    // alongside the unknown-Type safe default (101).
    expect(out.needsReview.map((n) => n.externalId)).toEqual(["70", "101"]);
  });

  it("never includes a dropped Category card in the output", () => {
    const out = mapQbItems([categoryItem], { inventoryMode: "off" });
    expect(out.cards).toHaveLength(0);
    expect(out.blockers).toHaveLength(0);
    expect(out.needsReview).toHaveLength(0);
  });
});
