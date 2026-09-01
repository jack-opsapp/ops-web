import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  GET_PURCHASE_ORDER_CANDIDATE,
  LIST_PURCHASE_ORDERS_CANDIDATE,
  PURCHASE_ORDER_AUTHORIZATION_VARIANT_KEYS,
  selectedGetPurchaseOrderVariantKeys,
  selectedListPurchaseOrdersVariantKeys,
} from "../purchasing";

const ORDER_ID = "18200000-0000-4000-8000-000000000001";

describe("P2 purchase-order candidates", () => {
  it("keeps both exact reads dark, immutable, bounded, and read-only", () => {
    expect(LIST_PURCHASE_ORDERS_CANDIDATE).toMatchObject({
      name: "list_purchase_orders",
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
    expect(GET_PURCHASE_ORDER_CANDIDATE).toMatchObject({
      name: "get_purchase_order",
      bounds: { maxResultItems: 1 },
    });
    for (const candidate of [
      LIST_PURCHASE_ORDERS_CANDIDATE,
      GET_PURCHASE_ORDER_CANDIDATE,
    ]) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(
        CAPABILITY_MANIFEST.find((entry) => entry.name === candidate.name)
      ).toBe(candidate);
    }
  });

  it("requires complete purchasing authority and a separate cost union", () => {
    expect(PURCHASE_ORDER_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "orders",
      "costs",
    ]);
    for (const candidate of [
      LIST_PURCHASE_ORDERS_CANDIDATE,
      GET_PURCHASE_ORDER_CANDIDATE,
    ]) {
      expect(candidate.authorization.variants.map(({ key }) => key)).toEqual([
        "orders",
        "costs",
      ]);
      expect(candidate.authorization.variants[0]!.policy).toMatchObject({
        requiredOAuthScopes: ["ops.purchasing.read"],
        permissionRequirementGroups: [
          [{ permission: "catalog.orders.view", allowedScopes: ["all"] }],
        ],
      });
      expect(candidate.authorization.variants[1]!.policy).toMatchObject({
        requiredOAuthScopes: ["ops.catalog_costs.read"],
        permissionRequirementGroups: [
          [
            { permission: "catalog.products.view", allowedScopes: ["all"] },
            { permission: "finances.view", allowedScopes: ["all"] },
          ],
        ],
      });
    }
  });

  it("always selects orders and adds costs only from the closed section", () => {
    expect(selectedListPurchaseOrdersVariantKeys({})).toEqual(["orders"]);
    expect(
      selectedListPurchaseOrdersVariantKeys({ sections: ["costs"] })
    ).toEqual(["orders", "costs"]);
    expect(
      selectedGetPurchaseOrderVariantKeys({
        purchase_order_ref: { kind: "purchase_order", id: ORDER_ID },
      })
    ).toEqual(["orders"]);
    expect(
      selectedGetPurchaseOrderVariantKeys({
        purchase_order_ref: { kind: "purchase_order", id: ORDER_ID },
        sections: ["costs"],
      })
    ).toEqual(["orders", "costs"]);
  });
});
