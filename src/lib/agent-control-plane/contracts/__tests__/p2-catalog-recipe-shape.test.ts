import { describe, expect, it } from "vitest";

import {
  CATALOG_MAX_RECIPE_PRODUCTS,
  CATALOG_MAX_RECIPE_PRODUCT_OPTIONS,
  CATALOG_MAX_RECIPE_PRODUCT_OPTION_VALUES,
  CATALOG_MAX_RECIPE_SELECTOR_ENTRIES,
  CATALOG_RECIPE_SHAPES,
  CatalogItemDetailResultSchema,
  CatalogItemDetailV2ResultSchema,
  catalogItemDetailResultSchema,
} from "../catalog-purchasing";

const READ_AT = "2026-08-22T17:04:05.120Z";
const FAMILY_ID = "18000000-0000-4000-8000-000000000001";
const VARIANT_ID = "18000000-0000-4000-8000-000000000002";
const CATEGORY_ID = "18000000-0000-4000-8000-000000000003";
const PRODUCT_ID = "18000000-0000-4000-8000-000000000004";
const OPTION_ID = "18000000-0000-4000-8000-000000000007";
const OPTION_VALUE_ID = "18000000-0000-4000-8000-000000000008";
const MATERIAL_A = "18000000-0000-4000-8000-00000000000a";
const MATERIAL_B = "18000000-0000-4000-8000-00000000000b";

const proof = {
  proof_ref: `ops_proof:v1:${"a".repeat(64)}`,
  read_at: READ_AT,
  source_revisions: [{ domain: "catalog" as const, source_revision: 12 }],
};
const evidence = {
  evidence_ref: `ops_evidence:v1:${"b".repeat(64)}`,
  source_domain: "catalog" as const,
  source_type: "catalog_family" as const,
  occurred_at: READ_AT,
};

const family = {
  family_ref: { kind: "catalog_family" as const, id: FAMILY_ID },
  label: "Lag Screws",
  description: null,
  image_state: "absent" as const,
  category: {
    category_ref: { kind: "catalog_category" as const, id: CATEGORY_ID },
    label: "Fasteners",
  },
  tags: [],
  active: true,
  updated_at: READ_AT,
  content_kind: "untrusted_business_data" as const,
};

const variants = [
  {
    variant_ref: { kind: "catalog_variant" as const, id: VARIANT_ID },
    label: "Black · 4 inch",
    sku: "LAG-BLK-4",
    quantity_milliunits: 0,
    unit: null,
    sale_price: null,
    thresholds: {
      warning_milliunits: null,
      critical_milliunits: null,
      warning_origin: "none" as const,
      critical_origin: "none" as const,
    },
    stock_state: "untracked" as const,
    active: true,
    updated_at: READ_AT,
    content_kind: "untrusted_business_data" as const,
  },
];

const recipeProduct = {
  product_ref: { kind: "product" as const, id: PRODUCT_ID },
  product_label: "Picket Rail — Level",
  options: [
    {
      option_ref: { kind: "product_option" as const, id: OPTION_ID },
      name: "Left ends",
      kind: "integer" as const,
      required: false,
      affects_recipe: true,
      default_value: "0",
      values: [],
      content_kind: "untrusted_business_data" as const,
    },
    {
      option_ref: {
        kind: "product_option" as const,
        id: "18000000-0000-4000-8000-000000000009",
      },
      name: "Color",
      kind: "select" as const,
      required: true,
      affects_recipe: true,
      default_value: "Black",
      values: [
        {
          value_ref: {
            kind: "product_option_value" as const,
            id: OPTION_VALUE_ID,
          },
          value: "Black",
          content_kind: "untrusted_business_data" as const,
        },
      ],
      content_kind: "untrusted_business_data" as const,
    },
  ],
  content_kind: "untrusted_business_data" as const,
};

const perUnitLine = {
  product_ref: { kind: "product" as const, id: PRODUCT_ID },
  product_label: "Picket Rail — Level",
  relationship: "recipe" as const,
  material_ref: { kind: "product_material" as const, id: MATERIAL_A },
  family_ref: { kind: "catalog_family" as const, id: FAMILY_ID },
  variant_ref: null,
  variant_selector: [
    { catalog_option_label: "Color", value_expression: "$option.color" },
  ],
  quantity_milliunits: 1_000,
  quantity_per_unit: "1.0000",
  quantity_basis: "per_product_unit" as const,
  scaled_by: null,
  unit: null,
  content_kind: "untrusted_business_data" as const,
};

const scaledLine = {
  ...perUnitLine,
  material_ref: { kind: "product_material" as const, id: MATERIAL_B },
  quantity_milliunits: 6_000,
  quantity_per_unit: "6.0000",
  quantity_basis: "per_option_count" as const,
  scaled_by: {
    option_ref: { kind: "product_option" as const, id: OPTION_ID },
    option_name: "Left ends",
  },
};

const detailV2 = {
  requested_ref: { kind: "catalog_family" as const, id: FAMILY_ID },
  family,
  variants,
  options: [],
  recipes: [perUnitLine, scaledLine],
  recipe_products: [recipeProduct],
  physical_stock: [],
  evidence: [evidence],
  proof,
};

const detailV1 = {
  requested_ref: detailV2.requested_ref,
  family,
  variants,
  options: [],
  recipes: [
    {
      product_ref: { kind: "product" as const, id: PRODUCT_ID },
      product_label: "Picket Rail — Level",
      relationship: "recipe" as const,
      variant_ref: null,
      quantity_milliunits: 1_000,
      unit: null,
      content_kind: "untrusted_business_data" as const,
    },
  ],
  physical_stock: [],
  evidence: [evidence],
  proof,
};

describe("catalogue detail recipe shapes", () => {
  it("pins the shape vector and the v2 bounds", () => {
    expect(CATALOG_RECIPE_SHAPES).toEqual(["v1", "v2"]);
    expect(CATALOG_MAX_RECIPE_SELECTOR_ENTRIES).toBe(32);
    expect(CATALOG_MAX_RECIPE_PRODUCTS).toBe(64);
    expect(CATALOG_MAX_RECIPE_PRODUCT_OPTIONS).toBe(128);
    expect(CATALOG_MAX_RECIPE_PRODUCT_OPTION_VALUES).toBe(512);
    expect(catalogItemDetailResultSchema("v1")).toBe(
      CatalogItemDetailResultSchema
    );
    expect(catalogItemDetailResultSchema("v2")).toBe(
      CatalogItemDetailV2ResultSchema
    );
  });

  it("reads a selector, an authored quantity, a scaling option and the basis", () => {
    const parsed = CatalogItemDetailV2ResultSchema.parse(detailV2);
    expect(parsed).toEqual(detailV2);
    expect(parsed.recipes[1]?.scaled_by?.option_name).toBe("Left ends");
    expect(parsed.recipes[1]?.quantity_basis).toBe("per_option_count");
    expect(parsed.recipe_products[0]?.options[0]?.kind).toBe("integer");
  });

  it("states a four-decimal quantity a milliunit integer cannot carry", () => {
    const line = {
      ...perUnitLine,
      quantity_milliunits: null,
      quantity_per_unit: "0.0526",
    };
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [line],
      }).success
    ).toBe(true);
    for (const quantity of ["1", "1.000", "1.00000", "-1.0000", "1,0000"]) {
      expect(
        CatalogItemDetailV2ResultSchema.safeParse({
          ...detailV2,
          recipes: [{ ...line, quantity_per_unit: quantity }],
        }).success
      ).toBe(false);
    }
  });

  it("never lets a v1 caller accept v2 rows or a v2 caller accept v1 rows", () => {
    expect(CatalogItemDetailResultSchema.safeParse(detailV2).success).toBe(
      false
    );
    expect(CatalogItemDetailV2ResultSchema.safeParse(detailV1).success).toBe(
      false
    );
    expect(CatalogItemDetailResultSchema.parse(detailV1)).toEqual(detailV1);
  });

  it("couples every recipe line to a listed product and to that product's options", () => {
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipe_products: [],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [
          perUnitLine,
          {
            ...scaledLine,
            scaled_by: {
              option_ref: {
                kind: "product_option" as const,
                id: "18000000-0000-4000-8000-0000000000ff",
              },
              option_name: "Ghost",
            },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [
          perUnitLine,
          {
            ...scaledLine,
            family_ref: {
              kind: "catalog_family" as const,
              id: "18000000-0000-4000-8000-0000000000fe",
            },
          },
        ],
      }).success
    ).toBe(false);
  });

  it("requires a canonical, tie-free recipe and recipe-product order", () => {
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [scaledLine, perUnitLine],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [perUnitLine, perUnitLine],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipe_products: [recipeProduct, recipeProduct],
      }).success
    ).toBe(false);
  });

  it("holds a stock link and a scaled line to their own exact shape", () => {
    const stockLink = {
      product_ref: { kind: "product" as const, id: PRODUCT_ID },
      product_label: "Picket Rail — Level",
      relationship: "stock_link" as const,
      material_ref: null,
      family_ref: null,
      variant_ref: null,
      variant_selector: null,
      quantity_milliunits: null,
      quantity_per_unit: null,
      quantity_basis: null,
      scaled_by: null,
      unit: null,
      content_kind: "untrusted_business_data" as const,
    };
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [stockLink],
      }).success
    ).toBe(true);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [{ ...stockLink, quantity_per_unit: "1.0000" }],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [{ ...scaledLine, scaled_by: null }],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [{ ...perUnitLine, material_ref: null }],
      }).success
    ).toBe(false);
  });

  it("bounds an untrusted selector and keeps its labels canonical", () => {
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [{ ...perUnitLine, variant_selector: [] }],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [
          {
            ...perUnitLine,
            variant_selector: [
              {
                catalog_option_label: "Height",
                value_expression: "$option.height",
              },
              {
                catalog_option_label: "Color",
                value_expression: "$option.color",
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailV2ResultSchema.safeParse({
        ...detailV2,
        recipes: [
          {
            ...perUnitLine,
            variant_selector: Array.from(
              { length: CATALOG_MAX_RECIPE_SELECTOR_ENTRIES + 1 },
              (_, index) => ({
                catalog_option_label: `Axis ${String(index).padStart(3, "0")}`,
                value_expression: `$option.axis ${index}`,
              })
            ),
          },
        ],
      }).success
    ).toBe(false);
  });
});
