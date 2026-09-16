import { describe, expect, it } from "vitest";

import {
  CatalogItemDetailResultSchema,
  CatalogItemDetailV2ResultSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { getCatalogItem } from "../catalog-reads";
import { createSupabaseCatalogReadRepository } from "../catalog-repository";
import {
  catalogDetailEntityProofRef,
  catalogDetailEvidenceRef,
  catalogDetailProofContext,
  type CatalogDetailSource,
  type CatalogDetailSourceInspected,
} from "../catalog-proof";
import {
  CATALOG_COMPANY_ID,
  CATALOG_FAMILY_ID,
  CATALOG_PRODUCT_ID,
  CATALOG_READ_AT,
  CATALOG_SOURCE_REVISIONS,
  CATALOG_VARIANT_ID,
  getCatalogAuthorization,
} from "./catalog-fixtures";

const MATERIAL_ID = "18100000-0000-4000-8000-00000000000a";
const OPTION_ID = "18100000-0000-4000-8000-00000000000b";
const OPTION_VALUE_ID = "18100000-0000-4000-8000-00000000000c";

class StubRpcClient {
  readonly calls: Array<{
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}

  rpc(name: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ name, args });
    return Promise.resolve(this.response);
  }
}

const familyShape = {
  requested_ref: { kind: "catalog_family" as const, id: CATALOG_FAMILY_ID },
  family: {
    family_ref: { kind: "catalog_family" as const, id: CATALOG_FAMILY_ID },
    label: "Lag Screws",
    description: null,
    image_state: "absent" as const,
    category: null,
    tags: [],
    active: true,
    updated_at: CATALOG_READ_AT,
    content_kind: "untrusted_business_data" as const,
  },
  variants: [
    {
      variant_ref: { kind: "catalog_variant" as const, id: CATALOG_VARIANT_ID },
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
      updated_at: CATALOG_READ_AT,
      content_kind: "untrusted_business_data" as const,
    },
  ],
  options: [],
  physical_stock: [],
};

function v1Source(): CatalogDetailSource {
  return {
    ...familyShape,
    recipes: [
      {
        product_ref: { kind: "product" as const, id: CATALOG_PRODUCT_ID },
        product_label: "Picket Rail — Level",
        relationship: "recipe" as const,
        variant_ref: null,
        quantity_milliunits: 6_000,
        unit: null,
        content_kind: "untrusted_business_data" as const,
      },
    ],
  };
}

function v2Source(): CatalogDetailSource {
  return {
    ...familyShape,
    recipes: [
      {
        product_ref: { kind: "product" as const, id: CATALOG_PRODUCT_ID },
        product_label: "Picket Rail — Level",
        relationship: "recipe" as const,
        material_ref: { kind: "product_material" as const, id: MATERIAL_ID },
        family_ref: { kind: "catalog_family" as const, id: CATALOG_FAMILY_ID },
        variant_ref: null,
        variant_selector: [
          { catalog_option_label: "Color", value_expression: "$option.color" },
        ],
        quantity_milliunits: 6_000,
        quantity_per_unit: "6.0000",
        quantity_basis: "per_option_count" as const,
        scaled_by: {
          option_ref: { kind: "product_option" as const, id: OPTION_ID },
          option_name: "Left ends",
        },
        unit: null,
        content_kind: "untrusted_business_data" as const,
      },
    ],
    recipe_products: [
      {
        product_ref: { kind: "product" as const, id: CATALOG_PRODUCT_ID },
        product_label: "Picket Rail — Level",
        options: [
          {
            option_ref: { kind: "product_option" as const, id: OPTION_ID },
            name: "Left ends",
            kind: "integer" as const,
            required: false,
            affects_recipe: true,
            default_value: "0",
            values: [
              {
                value_ref: {
                  kind: "product_option_value" as const,
                  id: OPTION_VALUE_ID,
                },
                value: "0",
                content_kind: "untrusted_business_data" as const,
              },
            ],
            content_kind: "untrusted_business_data" as const,
          },
        ],
        content_kind: "untrusted_business_data" as const,
      },
    ],
  };
}

function rawDetail(
  authorization: Awaited<ReturnType<typeof getCatalogAuthorization>>,
  source: CatalogDetailSource
) {
  const inspected: CatalogDetailSourceInspected = {
    families: 1,
    variants: source.variants.length,
    options: source.options.length,
    option_values: source.options.reduce(
      (count, option) => count + option.values.length,
      0
    ),
    recipes: source.recipes.length,
    stock_units: source.physical_stock.length,
    supplier_costs: "supplier_costs" in source ? source.supplier_costs.length : 0,
    ...("recipe_products" in source
      ? {
          recipe_products: source.recipe_products.length,
          recipe_product_options: source.recipe_products.reduce(
            (count, product) => count + product.options.length,
            0
          ),
          recipe_product_option_values: source.recipe_products.reduce(
            (count, product) =>
              count +
              product.options.reduce(
                (values, option) => values + option.values.length,
                0
              ),
            0
          ),
        }
      : {}),
  };
  const context = catalogDetailProofContext({
    authorization,
    readAt: CATALOG_READ_AT,
    sourceRevisions: CATALOG_SOURCE_REVISIONS,
    sourceInspected: inspected,
  });
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    authorization_candidates: authorization.authorizationCandidates.map(
      (candidate) => ({
        variant_key: candidate.variantKey,
        required_oauth_scopes: candidate.requiredOAuthScopes,
        resolved_permission_scopes: candidate.resolvedPermissionScopes,
        satisfied_permission_group_indexes:
          candidate.satisfiedPermissionGroupIndexes,
      })
    ),
    query: authorization.query,
    read_at: CATALOG_READ_AT,
    source_revisions: CATALOG_SOURCE_REVISIONS,
    selected_authorization_variants: authorization.variantKeys,
    source_inspected: inspected,
    result: source,
    proof_ref: catalogDetailEntityProofRef({ context, result: source }),
    evidence_ref: catalogDetailEvidenceRef({
      companyId: CATALOG_COMPANY_ID,
      requestedRef: authorization.query.item_ref,
      familyUpdatedAt: source.family.updated_at,
    }),
  };
}

describe("catalogue detail reads the shape the server selected", () => {
  it("asks the database for shape v1 with no shape-specific bounds by default", async () => {
    const authorization = await getCatalogAuthorization();
    const client = new StubRpcClient({
      data: rawDetail(authorization, v1Source()),
      error: null,
    });
    const repository = createSupabaseCatalogReadRepository(client);
    const result = await getCatalogItem({ authorization, repository });
    expect(CatalogItemDetailResultSchema.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty("recipe_products");
    expect(client.calls[0]?.args).toMatchObject({
      p_recipe_shape: "v1",
      p_recipe_selector_key_limit: 32,
      p_recipe_product_limit: 64,
      p_recipe_product_fetch_limit: 65,
      p_recipe_option_limit: 128,
      p_recipe_option_fetch_limit: 129,
      p_recipe_option_value_limit: 512,
      p_recipe_option_value_fetch_limit: 513,
    });
  });

  it("asks for shape v2 and returns the selector, scaling and recipe products", async () => {
    const authorization = await getCatalogAuthorization();
    const client = new StubRpcClient({
      data: rawDetail(authorization, v2Source()),
      error: null,
    });
    const repository = createSupabaseCatalogReadRepository(client);
    const result = await getCatalogItem({
      authorization,
      repository,
      recipeShape: "v2",
    });
    expect(client.calls[0]?.args).toMatchObject({ p_recipe_shape: "v2" });
    expect(CatalogItemDetailV2ResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      recipes: [
        {
          quantity_basis: "per_option_count",
          quantity_per_unit: "6.0000",
          scaled_by: { option_name: "Left ends" },
        },
      ],
      recipe_products: [{ options: [{ name: "Left ends" }] }],
    });
  });

  it("refuses a payload whose shape is not the one that was requested", async () => {
    const authorization = await getCatalogAuthorization();
    for (const [shape, source] of [
      ["v1", v2Source()],
      ["v2", v1Source()],
    ] as const) {
      const repository = createSupabaseCatalogReadRepository(
        new StubRpcClient({
          data: rawDetail(authorization, source),
          error: null,
        })
      );
      await expect(
        getCatalogItem({ authorization, repository, recipeShape: shape })
      ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
    }
  });

  it("refuses an unknown shape before it reaches the database", async () => {
    const authorization = await getCatalogAuthorization();
    const client = new StubRpcClient({
      data: rawDetail(authorization, v1Source()),
      error: null,
    });
    const repository = createSupabaseCatalogReadRepository(client);
    await expect(
      getCatalogItem({
        authorization,
        repository,
        recipeShape: "v3" as "v2",
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(client.calls).toHaveLength(0);
  });

  it("refuses a v2 payload whose recipe-product counts do not match", async () => {
    const authorization = await getCatalogAuthorization();
    const raw = rawDetail(authorization, v2Source());
    const repository = createSupabaseCatalogReadRepository(
      new StubRpcClient({
        data: {
          ...raw,
          source_inspected: {
            ...raw.source_inspected,
            recipe_products: 2,
          },
        },
        error: null,
      })
    );
    await expect(
      getCatalogItem({ authorization, repository, recipeShape: "v2" })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
  });
});
