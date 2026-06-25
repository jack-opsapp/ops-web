import { describe, it, expect } from "vitest";
import { buildCatalogSetupPayload } from "../payload-builder";

describe("buildCatalogSetupPayload — flat product", () => {
  it("maps a single flat product to a products[] doc with a client_id", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "c1",
          name: "Service Call",
          basePrice: 95,
          sku: "SVC-1",
          kind: "service",
          isTaxable: true,
        },
      ],
    });
    expect(payload.mode).toBe("edit");
    expect(payload.products).toHaveLength(1);
    const p = payload.products![0];
    expect(p.client_id).toBe("c1");
    expect(p.name).toBe("Service Call");
    expect(p.base_price).toBe(95);
    expect(p.default_price).toBe(95); // builder mirrors base→default
    expect(p.sku).toBe("SVC-1");
    expect(p.kind).toBe("service");
    expect(p.type).toBe("LABOR"); // service→LABOR mapping
    expect(p.is_taxable).toBe(true);
    expect("tiered_pricing" in p).toBe(false); // NEVER emit tiered_pricing
  });

  it("maps kind→type for material and package, and mirrors id when supplied", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        { clientId: "m1", id: "row-m1", name: "Shingle", kind: "material" },
        { clientId: "pk1", name: "Reroof Package", kind: "package" },
      ],
    });
    const [m, pk] = payload.products!;
    expect(m.type).toBe("MATERIAL");
    expect(m.id).toBe("row-m1"); // existing row → UPSERT target
    expect(pk.type).toBe("OTHER");
    expect(pk.id).toBeUndefined(); // no id → INSERT
  });

  it("passes through optional fields and external_* stamping", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "c1",
          name: "Tune-up",
          kind: "service",
          basePrice: 150,
          unitCost: 40,
          description: "Annual HVAC tune-up",
          pricingUnit: "each",
          categoryId: "cat-1",
          unitId: "unit-1",
          minimumCharge: 100,
          externalSource: "quickbooks",
          externalId: "QB-7",
        },
      ],
    });
    const p = payload.products![0];
    expect(p.unit_cost).toBe(40);
    expect(p.description).toBe("Annual HVAC tune-up");
    expect(p.pricing_unit).toBe("each");
    expect(p.category_id).toBe("cat-1");
    expect(p.unit_id).toBe("unit-1");
    expect(p.minimum_charge).toBe(100);
    expect(p.external_source).toBe("quickbooks");
    expect(p.external_id).toBe("QB-7");
  });
});

describe("buildCatalogSetupPayload — tier ladder", () => {
  it("maps a size tier to select option + values + add_flat modifiers (never tiered_pricing)", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "p1",
          name: "Asphalt Shingle Roof",
          kind: "service",
          tier: {
            optionName: "Size",
            basePrice: 4000,
            steps: [
              { label: "Small", price: 4000 },
              { label: "Medium", price: 6500 },
              { label: "Large", price: 9000 },
            ],
          },
        },
      ],
    });
    const p = payload.products![0];
    expect(p.base_price).toBe(4000); // base = lowest tier
    expect(p.default_price).toBe(4000);
    expect(p.options).toHaveLength(1);
    const opt = p.options![0];
    expect(opt.kind).toBe("select");
    expect(opt.affects_price).toBe(true);
    expect(opt.values.map((v) => v.label)).toEqual([
      "Small",
      "Medium",
      "Large",
    ]);
    // modifiers: base tier = 0 delta (omitted), others = price - base
    const mods = p.pricing_modifiers!;
    expect(mods.every((m) => m.modifier_kind === "add_flat")).toBe(true);
    const med = mods.find(
      (m) => m.option_value_client_id === opt.values[1].client_id
    )!;
    expect(med.amount).toBe(2500); // 6500 - 4000
    const large = mods.find(
      (m) => m.option_value_client_id === opt.values[2].client_id
    )!;
    expect(large.amount).toBe(5000); // 9000 - 4000
    expect(med.option_client_id).toBe(opt.client_id); // modifier refs same product's option
    expect("tiered_pricing" in p).toBe(false);
  });

  it("omits the zero-delta modifier for the base step", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "p1",
          name: "Tiered",
          kind: "service",
          tier: {
            optionName: "Size",
            basePrice: 100,
            steps: [
              { label: "S", price: 100 },
              { label: "L", price: 175 },
            ],
          },
        },
      ],
    });
    const p = payload.products![0];
    const opt = p.options![0];
    const mods = p.pricing_modifiers!;
    // only the non-base step gets a modifier
    expect(mods).toHaveLength(1);
    expect(mods[0].option_value_client_id).toBe(opt.values[1].client_id);
    expect(mods[0].amount).toBe(75);
  });

  it("derives base from the lowest step when basePrice is omitted", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "p1",
          name: "No explicit base",
          kind: "service",
          tier: {
            optionName: "Size",
            steps: [
              { label: "M", price: 6500 },
              { label: "S", price: 4000 },
              { label: "L", price: 9000 },
            ],
          },
        },
      ],
    });
    const p = payload.products![0];
    expect(p.base_price).toBe(4000); // lowest of the steps
    // sort order preserved as authored, deltas still relative to base
    const opt = p.options![0];
    expect(opt.values.map((v) => v.label)).toEqual(["M", "S", "L"]);
    const small = p.pricing_modifiers!.find(
      (m) => m.option_value_client_id === opt.values[1].client_id
    );
    expect(small).toBeUndefined(); // S is the base → no modifier
    const medium = p.pricing_modifiers!.find(
      (m) => m.option_value_client_id === opt.values[0].client_id
    )!;
    expect(medium.amount).toBe(2500);
  });

  it("throws when a tier has fewer than two steps", () => {
    expect(() =>
      buildCatalogSetupPayload({
        mode: "edit",
        products: [
          {
            clientId: "p1",
            name: "Bad tier",
            kind: "service",
            tier: {
              optionName: "Size",
              steps: [{ label: "Only", price: 100 }],
            },
          },
        ],
      })
    ).toThrow(/tier.*at least two steps|two steps/i);
  });
});

describe("buildCatalogSetupPayload — variant-pinned recipes", () => {
  it("pins recipes to a concrete catalog_variant_id and rejects nil-selector family pins", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "p1",
          name: "Deck Board Run",
          kind: "material",
          recipes: [
            {
              catalogVariantId: "11111111-1111-1111-1111-111111111111",
              quantityPerUnit: 3,
            },
          ],
        },
      ],
    });
    expect(payload.products![0].product_materials![0].catalog_variant_id).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(payload.products![0].product_materials![0].quantity_per_unit).toBe(3);

    expect(() =>
      buildCatalogSetupPayload({
        mode: "edit",
        products: [
          {
            clientId: "p2",
            name: "Bad",
            kind: "material",
            recipes: [
              { catalogItemId: "22222222-2222-2222-2222-222222222222" }, // family pin, no variant, no selector
            ],
          },
        ],
      })
    ).toThrow(/recipe.*concrete variant|variant_selector/i);
  });

  it("accepts a non-empty variant_selector as a fully-resolvable pin", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "p1",
          name: "Sized Run",
          kind: "material",
          recipes: [
            {
              catalogItemId: "33333333-3333-3333-3333-333333333333",
              variantSelector: { size: "2x4" },
              quantityPerUnit: 2,
              scaledByOptionClientId: "opt-1",
            },
          ],
        },
      ],
    });
    const mat = payload.products![0].product_materials![0];
    expect(mat.variant_selector).toEqual({ size: "2x4" });
    expect(mat.catalog_item_id).toBe(
      "33333333-3333-3333-3333-333333333333"
    );
    expect(mat.scaled_by_option_client_id).toBe("opt-1");
  });

  it("rejects an empty variant_selector object as nil-selector", () => {
    expect(() =>
      buildCatalogSetupPayload({
        mode: "edit",
        products: [
          {
            clientId: "p1",
            name: "Empty selector",
            kind: "material",
            recipes: [
              {
                catalogItemId: "44444444-4444-4444-4444-444444444444",
                variantSelector: {},
              },
            ],
          },
        ],
      })
    ).toThrow(/recipe.*concrete variant|variant_selector/i);
  });

  it("defaults quantity_per_unit to 1 when omitted", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "p1",
          name: "Defaulted qty",
          kind: "material",
          recipes: [
            { catalogVariantId: "55555555-5555-5555-5555-555555555555" },
          ],
        },
      ],
    });
    expect(payload.products![0].product_materials![0].quantity_per_unit).toBe(1);
  });
});

describe("buildCatalogSetupPayload — bundles", () => {
  it("maps bundle_items resolving sibling products by client id with default relationship_kind", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        { clientId: "child-1", name: "Underlayment", kind: "material" },
        {
          clientId: "pkg-1",
          name: "Reroof Package",
          kind: "package",
          bundleItems: [
            { childProductClientId: "child-1", quantity: 2 },
          ],
        },
      ],
    });
    const pkg = payload.products!.find((p) => p.client_id === "pkg-1")!;
    expect(pkg.bundle_items).toHaveLength(1);
    const bi = pkg.bundle_items![0];
    expect(bi.child_product_client_id).toBe("child-1");
    expect(bi.quantity).toBe(2);
    expect(bi.relationship_kind).toBe("required"); // default
    expect(bi.display_order).toBe(0);
  });

  it("preserves an explicit relationship_kind and display_order and child_product_id", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [
        {
          clientId: "pkg-1",
          name: "Pkg",
          kind: "package",
          bundleItems: [
            {
              childProductId: "66666666-6666-6666-6666-666666666666",
              quantity: 1,
              displayOrder: 3,
              relationshipKind: "optional",
            },
          ],
        },
      ],
    });
    const bi = payload.products![0].bundle_items![0];
    expect(bi.child_product_id).toBe(
      "66666666-6666-6666-6666-666666666666"
    );
    expect(bi.display_order).toBe(3);
    expect(bi.relationship_kind).toBe("optional");
    expect(bi.child_product_client_id).toBeUndefined();
  });

  it("throws when a bundle item references neither a sibling client id nor a product id", () => {
    expect(() =>
      buildCatalogSetupPayload({
        mode: "edit",
        products: [
          {
            clientId: "pkg-1",
            name: "Pkg",
            kind: "package",
            bundleItems: [{ quantity: 1 }],
          },
        ],
      })
    ).toThrow(/bundle item.*child/i);
  });
});

describe("buildCatalogSetupPayload — single catalog family + variants", () => {
  it("maps one family object (NOT an array) + variants with option_value_client_ids", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      family: {
        name: "2x4 Lumber",
        categoryId: "cat-lumber",
        defaultUnitId: "unit-each",
        variants: [
          {
            clientId: "v1",
            sku: "2X4-8FT",
            quantity: 120,
            unitCost: 4.5,
            reorderPoint: 40,
            optionValueClientIds: ["ov-len-8"],
          },
          {
            clientId: "v2",
            sku: "2X4-10FT",
            quantity: 60,
            priceOverride: 6.25,
            reorderPoint: 20,
          },
        ],
      },
    });
    // family is a single object, not an array
    expect(Array.isArray(payload.family)).toBe(false);
    expect(payload.family!.name).toBe("2x4 Lumber");
    expect(payload.family!.category_id).toBe("cat-lumber");
    expect(payload.family!.default_unit_id).toBe("unit-each");

    expect(payload.variants).toHaveLength(2);
    const v1 = payload.variants![0];
    expect(v1.client_id).toBe("v1");
    expect(v1.sku).toBe("2X4-8FT");
    expect(v1.quantity).toBe(120);
    expect(v1.unit_cost_override).toBe(4.5);
    // single reorder point fans into warning threshold
    expect(v1.warning_threshold).toBe(40);
    expect(v1.option_value_client_ids).toEqual(["ov-len-8"]);

    const v2 = payload.variants![1];
    expect(v2.price_override).toBe(6.25);
    expect(v2.warning_threshold).toBe(20);
  });

  it("throws when more than one family is passed (single-family-per-call RPC shape)", () => {
    expect(() =>
      buildCatalogSetupPayload({
        mode: "edit",
        // @ts-expect-error — the builder accepts a single FamilyInput; an array is a misuse
        family: [
          { name: "Fam A", variants: [] },
          { name: "Fam B", variants: [] },
        ],
      })
    ).toThrow(/single family|one family per call/i);
  });

  it("stamps external_* on the family and variants", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      family: {
        name: "Imported Fam",
        externalSource: "quickbooks",
        externalId: "QB-ITEM-9",
        variants: [
          {
            clientId: "v1",
            sku: "X",
            externalSource: "quickbooks",
            externalId: "QB-VAR-9",
          },
        ],
      },
    });
    expect(payload.family!.external_source).toBe("quickbooks");
    expect(payload.family!.external_id).toBe("QB-ITEM-9");
    expect(payload.variants![0].external_source).toBe("quickbooks");
    expect(payload.variants![0].external_id).toBe("QB-VAR-9");
  });
});

describe("buildCatalogSetupPayload — mode + deleted_ids", () => {
  it("defaults mode to create when omitted", () => {
    const payload = buildCatalogSetupPayload({
      products: [{ clientId: "c1", name: "X", kind: "service" }],
    });
    expect(payload.mode).toBe("create");
  });

  it("passes deleted_ids through in edit mode", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [{ clientId: "c1", name: "X", kind: "service" }],
      deletedIds: { products: ["dead-1", "dead-2"], variants: ["dead-v"] },
    });
    expect(payload.deleted_ids).toEqual({
      products: ["dead-1", "dead-2"],
      variants: ["dead-v"],
    });
  });

  it("omits empty collections instead of emitting empty arrays", () => {
    const payload = buildCatalogSetupPayload({
      mode: "edit",
      products: [{ clientId: "c1", name: "X", kind: "service" }],
    });
    expect(payload.family).toBeUndefined();
    expect(payload.variants).toBeUndefined();
    expect(payload.deleted_ids).toBeUndefined();
    // a flat product has no nested option/modifier/recipe/bundle arrays
    const p = payload.products![0];
    expect(p.options).toBeUndefined();
    expect(p.pricing_modifiers).toBeUndefined();
    expect(p.product_materials).toBeUndefined();
    expect(p.bundle_items).toBeUndefined();
  });

  it("returns an empty payload (no products, no family) without throwing", () => {
    const payload = buildCatalogSetupPayload({ mode: "edit" });
    expect(payload.mode).toBe("edit");
    expect(payload.products).toBeUndefined();
    expect(payload.family).toBeUndefined();
  });
});
