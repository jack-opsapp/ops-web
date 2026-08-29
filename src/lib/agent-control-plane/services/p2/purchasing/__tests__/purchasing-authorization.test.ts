import { describe, expect, it } from "vitest";

import {
  GetPurchaseOrderInputSchema,
  ListPurchaseOrdersInputSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  GET_PURCHASE_ORDER_CANDIDATE,
  LIST_PURCHASE_ORDERS_CANDIDATE,
  selectedGetPurchaseOrderVariantKeys,
  selectedListPurchaseOrdersVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/purchasing";
import {
  authorizeGetPurchaseOrderRead,
  authorizeListPurchaseOrdersRead,
  isAuthorizedGetPurchaseOrderRead,
  isAuthorizedListPurchaseOrdersRead,
  PurchaseOrderReadAuthorizationError,
} from "../purchase-order-authorization";
import {
  PURCHASE_ORDER_ID,
  purchasingCandidateAuthorizations,
} from "./purchasing-fixtures";

describe("P2 purchase-order nominal authorization", () => {
  it("mints the exact base order binding", async () => {
    const query = ListPurchaseOrdersInputSchema.parse({});
    const keys = selectedListPurchaseOrdersVariantKeys(query);
    const authorization = authorizeListPurchaseOrdersRead({
      query,
      authorizations: await purchasingCandidateAuthorizations({
        candidate: LIST_PURCHASE_ORDERS_CANDIDATE,
        keys,
      }),
    });
    expect(isAuthorizedListPurchaseOrdersRead(authorization)).toBe(true);
    expect(authorization.variantKeys).toEqual(["orders"]);
    expect(authorization.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "orders",
        requiredOAuthScopes: ["ops.purchasing.read"],
        orderViewScope: "all",
        catalogProductsViewScope: null,
        financesViewScope: null,
        satisfiedPermissionGroupIndexes: [0],
      }),
    ]);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.authorizationCandidates)).toBe(true);
  });

  it("adds a separate catalogue-finance binding only when costs are selected", async () => {
    const query = GetPurchaseOrderInputSchema.parse({
      purchase_order_ref: { kind: "purchase_order", id: PURCHASE_ORDER_ID },
      sections: ["costs"],
    });
    const keys = selectedGetPurchaseOrderVariantKeys(query);
    const authorization = authorizeGetPurchaseOrderRead({
      query,
      authorizations: await purchasingCandidateAuthorizations({
        candidate: GET_PURCHASE_ORDER_CANDIDATE,
        keys,
      }),
    });
    expect(isAuthorizedGetPurchaseOrderRead(authorization)).toBe(true);
    expect(authorization.variantKeys).toEqual(["orders", "costs"]);
    expect(authorization.authorizationCandidates).toEqual([
      expect.objectContaining({
        variantKey: "orders",
        orderViewScope: "all",
        catalogProductsViewScope: null,
        financesViewScope: null,
      }),
      expect.objectContaining({
        variantKey: "costs",
        requiredOAuthScopes: ["ops.catalog_costs.read"],
        orderViewScope: null,
        catalogProductsViewScope: "all",
        financesViewScope: "all",
      }),
    ]);
  });

  it("fails closed when OAuth, order, product, or finance authority is missing", async () => {
    const query = GetPurchaseOrderInputSchema.parse({
      purchase_order_ref: { kind: "purchase_order", id: PURCHASE_ORDER_ID },
      sections: ["costs"],
    });
    const keys = selectedGetPurchaseOrderVariantKeys(query);
    for (const fixture of [
      {
        permissions: {
          "catalog.orders.view": null,
          "catalog.products.view": "all" as const,
          "finances.view": "all" as const,
        },
      },
      {
        permissions: {
          "catalog.orders.view": "all" as const,
          "catalog.products.view": null,
          "finances.view": "all" as const,
        },
      },
      {
        permissions: {
          "catalog.orders.view": "all" as const,
          "catalog.products.view": "all" as const,
          "finances.view": null,
        },
      },
      { oauthScopes: ["ops.purchasing.read"] },
    ]) {
      const authorizations = await purchasingCandidateAuthorizations({
        candidate: GET_PURCHASE_ORDER_CANDIDATE,
        keys,
        ...fixture,
      });
      expect(() =>
        authorizeGetPurchaseOrderRead({ query, authorizations })
      ).toThrow(PurchaseOrderReadAuthorizationError);
    }
  });

  it("rejects missing, extra, borrowed, reconstructed, accessor, non-enumerable, and mixed-actor candidates", async () => {
    const query = GetPurchaseOrderInputSchema.parse({
      purchase_order_ref: { kind: "purchase_order", id: PURCHASE_ORDER_ID },
      sections: ["costs"],
    });
    const keys = selectedGetPurchaseOrderVariantKeys(query);
    const exact = await purchasingCandidateAuthorizations({
      candidate: GET_PURCHASE_ORDER_CANDIDATE,
      keys,
    });
    const otherActor = await purchasingCandidateAuthorizations({
      candidate: GET_PURCHASE_ORDER_CANDIDATE,
      keys: ["costs"],
      actorUserId: "18200000-0000-4000-8000-000000000010",
    });
    const accessor = { orders: exact.orders } as Record<string, unknown>;
    Object.defineProperty(accessor, "costs", {
      enumerable: true,
      get: () => exact.costs,
    });
    const nonEnumerable = { orders: exact.orders } as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, "costs", {
      enumerable: false,
      value: exact.costs,
    });
    for (const invalid of [
      {},
      { orders: exact.orders },
      { ...exact, extra: exact.orders },
      { orders: exact.costs, costs: exact.orders },
      { orders: { ...exact.orders }, costs: exact.costs },
      { orders: exact.orders, costs: otherActor.costs },
      accessor,
      nonEnumerable,
    ]) {
      expect(() =>
        authorizeGetPurchaseOrderRead({ query, authorizations: invalid })
      ).toThrow(PurchaseOrderReadAuthorizationError);
    }
  });
});
