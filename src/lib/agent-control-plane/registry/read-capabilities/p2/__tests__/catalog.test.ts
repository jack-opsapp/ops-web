import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  CATALOG_AUTHORIZATION_VARIANT_KEYS,
  GET_CATALOG_ITEM_CANDIDATE,
  SEARCH_CATALOG_ITEMS_CANDIDATE,
  selectedGetCatalogItemVariantKeys,
  selectedSearchCatalogItemsVariantKeys,
} from "../catalog";

const UUID = "18100000-0000-4000-8000-000000000001";

describe("P2 catalogue candidates", () => {
  it("keeps both exact reads dark, immutable, bounded, and read-only", () => {
    expect(SEARCH_CATALOG_ITEMS_CANDIDATE).toMatchObject({
      name: "search_catalog_items",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      bounds: {
        maxInputBytes: 8_192,
        maxOutputCharacters: 60_000,
        maxResultItems: 25,
      },
      availability: { implementation: "available" },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(GET_CATALOG_ITEM_CANDIDATE).toMatchObject({
      name: "get_catalog_item",
      bounds: { maxResultItems: 1 },
      availability: { implementation: "available" },
    });
    for (const candidate of [
      SEARCH_CATALOG_ITEMS_CANDIDATE,
      GET_CATALOG_ITEM_CANDIDATE,
    ]) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(
        CAPABILITY_MANIFEST.some((entry) => entry.name === candidate.name)
      ).toBe(false);
    }
  });

  it("requires complete catalogue authority before the independently selected cost ceiling", () => {
    expect(CATALOG_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "catalog",
      "supplier_costs",
    ]);
    expect(
      SEARCH_CATALOG_ITEMS_CANDIDATE.authorization.variants.map(
        ({ key }) => key
      )
    ).toEqual(["catalog"]);
    const base =
      SEARCH_CATALOG_ITEMS_CANDIDATE.authorization.variants[0]!.policy;
    expect(base.requiredOAuthScopes).toEqual(["ops.catalog.read"]);
    expect(base.permissionRequirementGroups).toEqual([
      [
        { permission: "catalog.products.view", allowedScopes: ["all"] },
        { permission: "catalog.view", allowedScopes: ["all"] },
      ],
    ]);

    expect(
      GET_CATALOG_ITEM_CANDIDATE.authorization.variants.map(({ key }) => key)
    ).toEqual(["catalog", "supplier_costs"]);
    expect(
      GET_CATALOG_ITEM_CANDIDATE.authorization.variants[0]!.policy
    ).toMatchObject({
      requiredOAuthScopes: base.requiredOAuthScopes,
      permissionRequirementGroups: base.permissionRequirementGroups,
    });
    expect(
      GET_CATALOG_ITEM_CANDIDATE.authorization.variants[1]!.policy
    ).toMatchObject({
      requiredOAuthScopes: ["ops.catalog_costs.read"],
      permissionRequirementGroups: [
        [
          { permission: "catalog.products.view", allowedScopes: ["all"] },
          { permission: "finances.view", allowedScopes: ["all"] },
        ],
      ],
    });
  });

  it("always selects base authority and selects supplier costs only from the closed section", () => {
    expect(selectedSearchCatalogItemsVariantKeys({})).toEqual(["catalog"]);
    expect(
      selectedGetCatalogItemVariantKeys({
        item_ref: { kind: "catalog_family", id: UUID },
      })
    ).toEqual(["catalog"]);
    expect(
      selectedGetCatalogItemVariantKeys({
        item_ref: { kind: "catalog_variant", id: UUID },
        sections: ["supplier_costs"],
      })
    ).toEqual(["catalog", "supplier_costs"]);
  });
});
