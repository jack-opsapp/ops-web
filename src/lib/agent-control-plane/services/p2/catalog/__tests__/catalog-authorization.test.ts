import { describe, expect, it } from "vitest";

import {
  GetCatalogItemInputSchema,
  SearchCatalogItemsInputSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  GET_CATALOG_ITEM_CANDIDATE,
  SEARCH_CATALOG_ITEMS_CANDIDATE,
  selectedGetCatalogItemVariantKeys,
  selectedSearchCatalogItemsVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/catalog";
import {
  authorizeGetCatalogItemRead,
  authorizeSearchCatalogItemsRead,
  CatalogReadAuthorizationError,
  isAuthorizedGetCatalogItemRead,
  isAuthorizedSearchCatalogItemsRead,
} from "../catalog-authorization";
import {
  CATALOG_FAMILY_ID,
  catalogCandidateAuthorizations,
} from "./catalog-fixtures";

describe("P2 catalogue nominal authorization", () => {
  it("mints only the complete base catalogue binding for search", async () => {
    const query = SearchCatalogItemsInputSchema.parse({});
    const keys = selectedSearchCatalogItemsVariantKeys(query);
    const authorization = authorizeSearchCatalogItemsRead({
      query,
      authorizations: await catalogCandidateAuthorizations({
        candidate: SEARCH_CATALOG_ITEMS_CANDIDATE,
        keys,
      }),
    });
    expect(isAuthorizedSearchCatalogItemsRead(authorization)).toBe(true);
    expect(authorization.variantKeys).toEqual(["catalog"]);
    expect(authorization.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "catalog",
        requiredOAuthScopes: ["ops.catalog.read"],
        catalogViewScope: "all",
        catalogProductsViewScope: "all",
        financesViewScope: null,
        satisfiedPermissionGroupIndexes: [0],
      }),
    ]);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.authorizationCandidates)).toBe(true);
  });

  it("adds an independent financial binding only when supplier costs are selected", async () => {
    const query = GetCatalogItemInputSchema.parse({
      item_ref: { kind: "catalog_family", id: CATALOG_FAMILY_ID },
      sections: ["supplier_costs"],
    });
    const keys = selectedGetCatalogItemVariantKeys(query);
    const authorization = authorizeGetCatalogItemRead({
      query,
      authorizations: await catalogCandidateAuthorizations({
        candidate: GET_CATALOG_ITEM_CANDIDATE,
        keys,
      }),
    });
    expect(isAuthorizedGetCatalogItemRead(authorization)).toBe(true);
    expect(authorization.variantKeys).toEqual(["catalog", "supplier_costs"]);
    expect(authorization.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "catalog",
        catalogViewScope: "all",
        catalogProductsViewScope: "all",
        financesViewScope: null,
      }),
      expect.objectContaining({
        variantKey: "supplier_costs",
        requiredOAuthScopes: ["ops.catalog_costs.read"],
        catalogViewScope: null,
        catalogProductsViewScope: "all",
        financesViewScope: "all",
      }),
    ]);
  });

  it("fails closed when OAuth, catalog, product, or finance authority is missing", async () => {
    const query = GetCatalogItemInputSchema.parse({
      item_ref: { kind: "catalog_family", id: CATALOG_FAMILY_ID },
      sections: ["supplier_costs"],
    });
    const keys = selectedGetCatalogItemVariantKeys(query);
    for (const fixture of [
      {
        permissions: {
          "catalog.view": null,
          "catalog.products.view": "all" as const,
          "finances.view": "all" as const,
        },
      },
      {
        permissions: {
          "catalog.view": "all" as const,
          "catalog.products.view": null,
          "finances.view": "all" as const,
        },
      },
      {
        permissions: {
          "catalog.view": "all" as const,
          "catalog.products.view": "all" as const,
          "finances.view": null,
        },
      },
      { oauthScopes: ["ops.catalog.read"] },
    ]) {
      const authorizations = await catalogCandidateAuthorizations({
        candidate: GET_CATALOG_ITEM_CANDIDATE,
        keys,
        ...fixture,
      });
      expect(() =>
        authorizeGetCatalogItemRead({ query, authorizations })
      ).toThrow(CatalogReadAuthorizationError);
    }
  });

  it("rejects missing, extra, borrowed, reconstructed, accessor, non-enumerable, and mixed-actor candidates", async () => {
    const query = GetCatalogItemInputSchema.parse({
      item_ref: { kind: "catalog_family", id: CATALOG_FAMILY_ID },
      sections: ["supplier_costs"],
    });
    const keys = selectedGetCatalogItemVariantKeys(query);
    const exact = await catalogCandidateAuthorizations({
      candidate: GET_CATALOG_ITEM_CANDIDATE,
      keys,
    });
    const otherActor = await catalogCandidateAuthorizations({
      candidate: GET_CATALOG_ITEM_CANDIDATE,
      keys: ["supplier_costs"],
      actorUserId: "18100000-0000-4000-8000-000000000011",
    });
    const accessor = { catalog: exact.catalog } as Record<string, unknown>;
    Object.defineProperty(accessor, "supplier_costs", {
      enumerable: true,
      get: () => exact.supplier_costs,
    });
    const nonEnumerable = { catalog: exact.catalog } as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, "supplier_costs", {
      enumerable: false,
      value: exact.supplier_costs,
    });
    for (const invalid of [
      {},
      { catalog: exact.catalog },
      { ...exact, extra: exact.catalog },
      {
        catalog: exact.supplier_costs,
        supplier_costs: exact.catalog,
      },
      { catalog: { ...exact.catalog }, supplier_costs: exact.supplier_costs },
      {
        catalog: exact.catalog,
        supplier_costs: otherActor.supplier_costs,
      },
      accessor,
      nonEnumerable,
    ]) {
      expect(() =>
        authorizeGetCatalogItemRead({ query, authorizations: invalid })
      ).toThrow(CatalogReadAuthorizationError);
    }
  });
});
