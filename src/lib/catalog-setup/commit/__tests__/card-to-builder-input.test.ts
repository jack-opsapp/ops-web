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

  it("UPSERTs a merge card into its matched live row when the on-file row is present", () => {
    const { products } = cardsToBuilderInput(
      [sell({ state: "merge", matchedExistingId: "live-7" })],
      { existingRows: onFile },
    );
    expect(products[0].id).toBe("live-7");
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

  // ─── Per-field show-diff + merge preservation (spec §11, §17.2) ───────────
  // A merge doc is rebuilt FROM the on-file row, overriding only the accepted
  // diffed fields. catalog_setup_save UPSERTs every column from the doc (absent ⇒
  // a default), so a merge that sent only the incoming card fields would WIPE
  // descriptions, un-categorize, reset storefront, and REACTIVATE a retired
  // product. "[ the rest stays on file ]" holds only when on-file is carried back.

  const onFile = {
    "live-7": {
      name: "On-file name",
      description: "On-file description",
      defaultPrice: 80,
      unitCost: 30,
      sku: "OLD-SKU",
      isTaxable: false,
      kind: "material" as const,
      pricingUnit: "ea",
      categoryId: "cat-1",
      isActive: false, // the operator had RETIRED this product
      showInStorefront: false,
    },
  };

  const mergeSell = (fieldSelections?: Record<string, boolean>): StagingCard =>
    sell({
      state: "merge",
      matchedExistingId: "live-7",
      ...(fieldSelections ? { fieldSelections } : {}),
    } as Partial<StagingCard>);

  it("default merge: accepted diffed fields take incoming, non-diffed columns stay on file", () => {
    const { products } = cardsToBuilderInput([mergeSell()], { existingRows: onFile });
    const p = products[0];
    expect(p.id).toBe("live-7"); // UPSERT into the live row
    // diffed fields default to take-incoming (the card's values)
    expect(p.name).toBe("Service Call");
    expect(p.basePrice).toBe(95);
    expect(p.isTaxable).toBe(true);
    // non-diffed committable columns are PRESERVED from the on-file row
    expect(p.description).toBe("On-file description");
    expect(p.categoryId).toBe("cat-1");
    expect(p.sku).toBe("OLD-SKU");
    expect(p.pricingUnit).toBe("ea");
    expect(p.kind).toBe("material"); // never reclassified on a re-import
  });

  it("NEVER reactivates a retired product: is_active is carried from on-file (not forced true)", () => {
    const { products } = cardsToBuilderInput([mergeSell()], { existingRows: onFile });
    expect(products[0].isActive).toBe(false); // stays retired
    // a pure create still defaults isActive true
    expect(cardsToBuilderInput([sell()]).products[0].isActive).toBe(true);
  });

  it("preserves show_in_storefront from on-file on a merge", () => {
    const { products } = cardsToBuilderInput([mergeSell()], { existingRows: onFile });
    expect(products[0].showInStorefront).toBe(false);
  });

  it("a REJECTED field commits the on-file value; accepted/unspecified take incoming", () => {
    const { products } = cardsToBuilderInput(
      [mergeSell({ base_price: false, is_taxable: false, name: true })],
      { existingRows: onFile },
    );
    const p = products[0];
    expect(p.basePrice).toBe(80); // rejected → on-file
    expect(p.isTaxable).toBe(false); // rejected → on-file
    expect(p.name).toBe("Service Call"); // accepted → incoming
  });

  it("reverts name to the on-file value when rejected", () => {
    const { products } = cardsToBuilderInput([mergeSell({ name: false })], {
      existingRows: onFile,
    });
    expect(products[0].name).toBe("On-file name");
  });

  it("a STOCK merge card UPSERTs into its matched live family (id carried)", () => {
    const { stockFamilies } = cardsToBuilderInput([
      stock({ state: "merge", matchedExistingId: "fam-9" }),
    ]);
    expect(stockFamilies[0].id).toBe("fam-9");
    // a non-merge stock card creates a fresh family (no id)
    expect("id" in cardsToBuilderInput([stock()]).stockFamilies[0]).toBe(false);
  });

  it("an EDITED matched card still UPSERTs (merge binding survives an edit — no duplicate)", () => {
    const { products } = cardsToBuilderInput(
      [sell({ state: "edited", matchedExistingId: "live-7" })],
      { existingRows: onFile },
    );
    expect(products[0].id).toBe("live-7"); // not a second create
  });

  it("a stale merge whose live row vanished cross-session creates, never resurrects by id", () => {
    // matchedExistingId present but NO on-file row (the live row was deleted).
    const { products } = cardsToBuilderInput([mergeSell()], { existingRows: {} });
    expect("id" in products[0]).toBe(false); // a fresh create, not an UPSERT
    expect(products[0].name).toBe("Service Call"); // uses the incoming card
  });
});
