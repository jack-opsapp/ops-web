import { describe, it, expect } from "vitest";
import { cardsToBuilderInput } from "../card-to-builder-input";
import type { StagingCard } from "../../staging-card";

const sell = (over: Partial<StagingCard> = {}): StagingCard =>
  ({
    id: "c-sell",
    source: "manual",
    state: "accepted",
    module: "sell",
    fields: {
      name: "Service Call",
      defaultPrice: 95,
      unitCost: 40,
      sku: "SVC-1",
      isTaxable: true,
      kind: "service",
      type: "LABOR",
      pricingUnit: "each",
    },
    ...over,
  }) as StagingCard;

const stock = (over: Partial<StagingCard> = {}): StagingCard =>
  ({
    id: "c-stock",
    source: "manual",
    state: "accepted",
    module: "stock",
    fields: {
      name: '2x6x16 PT',
      sku: "PT-2616",
      quantity: 120,
      unitCost: 12.5,
      reorderPoint: 40,
    },
    ...over,
  }) as StagingCard;

const typeCard = (over: Partial<StagingCard> = {}): StagingCard =>
  ({
    id: "c-type",
    source: "template",
    state: "accepted",
    module: "types",
    fields: { display: "Roofing", isTrade: true },
    ...over,
  }) as StagingCard;

describe("cardsToBuilderInput", () => {
  it("maps an accepted sell card to a ProductInput (defaultPrice → basePrice)", () => {
    const { products } = cardsToBuilderInput([sell()]);
    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.clientId).toBe("c-sell");
    expect(p.name).toBe("Service Call");
    expect(p.kind).toBe("service");
    expect(p.basePrice).toBe(95);
    expect(p.unitCost).toBe(40);
    expect(p.sku).toBe("SVC-1");
    expect(p.pricingUnit).toBe("each");
    expect(p.isTaxable).toBe(true);
    expect(p.isActive).toBe(true);
    expect(p.id).toBeUndefined(); // create, not upsert
  });

  it("sets ProductInput.id from matchedExistingId for a merge card (upsert)", () => {
    const { products } = cardsToBuilderInput([
      sell({ state: "merge", matchedExistingId: "live-row-7" }),
    ]);
    expect(products[0].id).toBe("live-row-7");
  });

  it("omits price/cost when null (never emits basePrice: null)", () => {
    const { products } = cardsToBuilderInput([
      sell({
        fields: {
          name: "No price yet",
          defaultPrice: null,
          unitCost: null,
          isTaxable: false,
          kind: "material",
          type: "MATERIAL",
        },
      } as Partial<StagingCard>),
    ]);
    const p = products[0];
    expect("basePrice" in p).toBe(false);
    expect("unitCost" in p).toBe(false);
    expect(p.kind).toBe("material");
  });

  it("maps a stock card to one FamilyInput with a single variant", () => {
    const { stockFamilies } = cardsToBuilderInput([stock()]);
    expect(stockFamilies).toHaveLength(1);
    const fam = stockFamilies[0];
    expect(fam.name).toBe("2x6x16 PT");
    expect(fam.variants).toHaveLength(1);
    const v = fam.variants![0];
    expect(v.clientId).toBe("c-stock:variant");
    expect(v.sku).toBe("PT-2616");
    expect(v.quantity).toBe(120);
    expect(v.unitCost).toBe(12.5);
    expect(v.reorderPoint).toBe(40);
  });

  it("surfaces type cards separately (never silently dropped)", () => {
    const { typeCards, products, stockFamilies } = cardsToBuilderInput([typeCard()]);
    expect(typeCards).toEqual([{ display: "Roofing", isTrade: true }]);
    expect(products).toHaveLength(0);
    expect(stockFamilies).toHaveLength(0);
  });

  it("drops non-committable cards (proposed / rejected)", () => {
    const { products } = cardsToBuilderInput([
      sell({ id: "a", state: "proposed" }),
      sell({ id: "b", state: "rejected" }),
      sell({ id: "c", state: "accepted" }),
    ]);
    expect(products.map((p) => p.clientId)).toEqual(["c"]);
  });

  it("stamps externalSource on created products + variants for re-import dedupe", () => {
    const res = cardsToBuilderInput([sell(), stock()], {
      externalSource: "quickbooks",
    });
    expect(res.products[0].externalSource).toBe("quickbooks");
    expect(res.stockFamilies[0].externalSource).toBe("quickbooks");
    expect(res.stockFamilies[0].variants![0].externalSource).toBe("quickbooks");
  });
});
