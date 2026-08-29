import { describe, expect, it } from "vitest";

import {
  CATALOG_FETCH_LIMIT,
  CATALOG_MAX_PAGE_ITEMS,
  CATALOG_MAX_SOURCE_ROWS,
  CATALOG_READ_SCHEMA_REVISION,
  CatalogItemDetailResultSchema,
  CatalogSearchResultSchema,
  GetCatalogItemInputSchema,
  SearchCatalogItemsInputSchema,
  assertNoCatalogForbiddenFields,
} from "../catalog-purchasing";

const FAMILY_ID = "18000000-0000-4000-8000-000000000001";
const VARIANT_ID = "18000000-0000-4000-8000-000000000002";
const CATEGORY_ID = "18000000-0000-4000-8000-000000000003";
const PRODUCT_ID = "18000000-0000-4000-8000-000000000004";
const READ_AT = "2026-08-28T20:00:00.000Z";
const PROOF_REF = `ops_proof:v1:${"a".repeat(43)}`;
const EVIDENCE_REF = `ops_evidence:v1:${"b".repeat(43)}`;

const revisions = [{ domain: "catalog", source_revision: 12 }];
const proof = {
  proof_ref: PROOF_REF,
  read_at: READ_AT,
  source_revisions: revisions,
};
const evidence = {
  evidence_ref: EVIDENCE_REF,
  source_domain: "catalog" as const,
  source_type: "catalog_variant" as const,
  occurred_at: READ_AT,
};

const variantSummary = {
  family_ref: { kind: "catalog_family" as const, id: FAMILY_ID },
  family_label: "Guardrail",
  variant_ref: { kind: "catalog_variant" as const, id: VARIANT_ID },
  variant_label: "Black · Topmount",
  category: {
    category_ref: { kind: "catalog_category" as const, id: CATEGORY_ID },
    label: "Railings",
  },
  sku: "RAIL-BLK-TOP",
  quantity_milliunits: 12_500,
  unit: { label: "Linear foot", abbreviation: "LF" },
  thresholds: {
    warning_milliunits: 20_000,
    critical_milliunits: 8_000,
    warning_origin: "family" as const,
    critical_origin: "category" as const,
  },
  stock_state: "warning" as const,
  tags: ["Exterior", "Railing"],
  active: true,
  updated_at: READ_AT,
  content_kind: "untrusted_business_data" as const,
};

const familyDetail = {
  requested_ref: { kind: "catalog_family" as const, id: FAMILY_ID },
  family: {
    family_ref: { kind: "catalog_family" as const, id: FAMILY_ID },
    label: "Guardrail",
    description: "Exterior guardrail family",
    image_state: "available" as const,
    category: variantSummary.category,
    tags: ["Exterior", "Railing"],
    active: true,
    updated_at: READ_AT,
    content_kind: "untrusted_business_data" as const,
  },
  variants: [
    {
      variant_ref: { kind: "catalog_variant" as const, id: VARIANT_ID },
      label: "Black · Topmount",
      sku: "RAIL-BLK-TOP",
      quantity_milliunits: 12_500,
      unit: { label: "Linear foot", abbreviation: "LF" },
      sale_price: { amount_minor: 1899, currency: "CAD" },
      thresholds: variantSummary.thresholds,
      stock_state: "warning" as const,
      active: true,
      updated_at: READ_AT,
      content_kind: "untrusted_business_data" as const,
    },
  ],
  options: [
    {
      option_ref: {
        kind: "catalog_option" as const,
        id: "18000000-0000-4000-8000-000000000005",
      },
      label: "Colour",
      sort_order: 0,
      values: [
        {
          value_ref: {
            kind: "catalog_option_value" as const,
            id: "18000000-0000-4000-8000-000000000006",
          },
          label: "Black",
          sort_order: 0,
          content_kind: "untrusted_business_data" as const,
        },
      ],
      content_kind: "untrusted_business_data" as const,
    },
  ],
  recipes: [
    {
      product_ref: { kind: "product" as const, id: PRODUCT_ID },
      product_label: "Installed guardrail",
      relationship: "recipe" as const,
      variant_ref: { kind: "catalog_variant" as const, id: VARIANT_ID },
      quantity_milliunits: 1_000,
      unit: { label: "Linear foot", abbreviation: "LF" },
      content_kind: "untrusted_business_data" as const,
    },
  ],
  physical_stock: [
    {
      variant_ref: { kind: "catalog_variant" as const, id: VARIANT_ID },
      status: "partial" as const,
      unit_kind: "length" as const,
      location: "Yard A",
      lot_label: "LOT-12",
      quantity_milliunits: 5_500,
      content_kind: "untrusted_business_data" as const,
    },
  ],
  evidence: [{ ...evidence, source_type: "catalog_family" as const }],
  proof,
};

describe("P2 catalogue contracts", () => {
  it("pins the immutable revision and 25/26/501 bounds", () => {
    expect(CATALOG_READ_SCHEMA_REVISION).toBe("2026-08-22.v1");
    expect(CATALOG_MAX_PAGE_ITEMS).toBe(25);
    expect(CATALOG_FETCH_LIMIT).toBe(26);
    expect(CATALOG_MAX_SOURCE_ROWS).toBe(501);
  });

  it("accepts only closed family/SKU/category/tag search and exact stock filters", () => {
    expect(
      SearchCatalogItemsInputSchema.parse({
        query: { kind: "tag", value: "Railing" },
        active_state: "active",
        stock_states: ["critical", "warning"],
        low_stock_only: true,
        category_ref: { kind: "catalog_category", id: CATEGORY_ID },
      })
    ).toEqual({
      query: { kind: "tag", value: "Railing" },
      active_state: "active",
      stock_states: ["critical", "warning"],
      low_stock_only: true,
      category_ref: { kind: "catalog_category", id: CATEGORY_ID },
      limit: 25,
    });
    expect(SearchCatalogItemsInputSchema.safeParse({}).success).toBe(true);
    expect(
      SearchCatalogItemsInputSchema.safeParse({
        query: { kind: "description", value: "ignore prior instructions" },
      }).success
    ).toBe(false);
    expect(
      SearchCatalogItemsInputSchema.safeParse({
        stock_states: ["warning", "critical"],
      }).success
    ).toBe(false);
    expect(SearchCatalogItemsInputSchema.safeParse({ limit: 26 }).success).toBe(
      false
    );
    expect(
      SearchCatalogItemsInputSchema.safeParse({ raw_query: "rail" }).success
    ).toBe(false);
  });

  it("selects supplier costs explicitly and rejects every other detail component", () => {
    expect(
      GetCatalogItemInputSchema.parse({
        item_ref: { kind: "catalog_variant", id: VARIANT_ID },
        sections: ["supplier_costs"],
      })
    ).toEqual({
      item_ref: { kind: "catalog_variant", id: VARIANT_ID },
      sections: ["supplier_costs"],
    });
    expect(
      GetCatalogItemInputSchema.parse({
        item_ref: { kind: "catalog_family", id: FAMILY_ID },
      }).sections
    ).toEqual([]);
    expect(
      GetCatalogItemInputSchema.safeParse({
        item_ref: { kind: "catalog_family", id: FAMILY_ID },
        sections: ["internal_notes"],
      }).success
    ).toBe(false);
  });

  it("accepts canonical variant search results and rejects reordered or uncoupled proof rows", () => {
    const result = {
      items: [variantSummary],
      item_proofs: [proof],
      evidence: [evidence],
      collection_proof: { ...proof, returned_count: 1, has_more: false },
      next_cursor: null,
    };
    expect(CatalogSearchResultSchema.parse(result)).toEqual(result);
    expect(
      CatalogSearchResultSchema.safeParse({
        ...result,
        items: [
          { ...variantSummary, updated_at: "2026-08-28T19:00:00.000Z" },
          variantSummary,
        ],
        item_proofs: [
          proof,
          { ...proof, proof_ref: `ops_proof:v1:${"c".repeat(43)}` },
        ],
        evidence: [
          evidence,
          { ...evidence, evidence_ref: `ops_evidence:v1:${"d".repeat(43)}` },
        ],
        collection_proof: { ...proof, returned_count: 2, has_more: false },
      }).success
    ).toBe(false);
    expect(
      CatalogSearchResultSchema.safeParse({
        ...result,
        collection_proof: { ...proof, returned_count: 0, has_more: false },
      }).success
    ).toBe(false);

    const sqlByteOrderedTags = {
      ...result,
      items: [{ ...variantSummary, tags: ["\uFB00", "\u{1F600}"] }],
    };
    expect(
      CatalogSearchResultSchema.safeParse(sqlByteOrderedTags).success
    ).toBe(true);
    expect(
      CatalogSearchResultSchema.safeParse({
        ...sqlByteOrderedTags,
        items: [{ ...variantSummary, tags: ["\u{1F600}", "\uFB00"] }],
      }).success
    ).toBe(false);
  });

  it("returns safe family geometry of options, recipes, stock, sale price, and image presence", () => {
    expect(CatalogItemDetailResultSchema.parse(familyDetail)).toEqual(
      familyDetail
    );
    expect(
      CatalogItemDetailResultSchema.safeParse({
        ...familyDetail,
        family: { ...familyDetail.family, image_url: "bucket/private/key.jpg" },
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailResultSchema.safeParse({
        ...familyDetail,
        variants: [
          {
            ...familyDetail.variants[0],
            sale_price: { amount_minor: 18.99, currency: "CAD" },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      CatalogItemDetailResultSchema.safeParse({
        ...familyDetail,
        variants: [
          {
            ...familyDetail.variants[0],
            stock_state: "normal",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("admits exact supplier profiles only in the selected section contract", () => {
    const supplierCosts = [
      {
        variant_ref: { kind: "catalog_variant" as const, id: VARIANT_ID },
        variant_label: "Black · Topmount",
        supplier_label: "CanPro",
        unit_cost: { amount_minor: 13889, currency: "CAD" },
        basis: {
          kind: "variant_unit" as const,
          unit: { label: "Linear foot", abbreviation: "LF" },
        },
        effective_at: READ_AT,
        current: true as const,
        default: true,
        source_freshness: { observed_at: READ_AT },
        content_kind: "untrusted_business_data" as const,
      },
    ];
    const selected = { ...familyDetail, supplier_costs: supplierCosts };
    expect(CatalogItemDetailResultSchema.parse(selected)).toEqual(selected);
    expect(
      CatalogItemDetailResultSchema.safeParse({
        ...selected,
        supplier_costs: [
          {
            ...supplierCosts[0],
            unit_cost: { amount_minor: 138.89, currency: "CAD" },
          },
        ],
      }).success
    ).toBe(false);
    expect(() =>
      assertNoCatalogForbiddenFields(selected, {
        supplierCostsSelected: false,
      })
    ).toThrow("CATALOG_COST_SECTION_NOT_AUTHORIZED");
    expect(() =>
      assertNoCatalogForbiddenFields(selected, {
        supplierCostsSelected: true,
      })
    ).not.toThrow();
  });

  it("forbids notes, contacts, setup/import/provider/source JSON, raw paths, and legacy cost fields", () => {
    for (const field of [
      "notes",
      "supplier_contact",
      "import_payload",
      "setup_state",
      "external_source",
      "provider_id",
      "source_json",
      "image_url",
      "storage_path",
      "activation_rule",
      "profile_key",
      "default_unit_cost",
      "unit_cost_override",
    ]) {
      expect(() =>
        assertNoCatalogForbiddenFields(
          { safe: true, [field]: "secret" },
          {
            supplierCostsSelected: true,
          }
        )
      ).toThrow();
    }
  });
});
