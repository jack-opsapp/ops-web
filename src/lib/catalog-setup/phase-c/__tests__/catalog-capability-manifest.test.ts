import { describe, expect, it } from "vitest";
import {
  CATALOG_CAPABILITY_MANIFEST_REVISION,
  guidedCapability,
  guidedCapabilityForAction,
  isGuidedCapabilityAvailable,
} from "../catalog-capability-manifest";

describe("Phase C executable capability manifest", () => {
  it("exposes released catalog behavior to Guided Catalog Setup", () => {
    expect(isGuidedCapabilityAvailable("catalog-core/v1")).toBe(true);
    expect(
      isGuidedCapabilityAvailable("static-product-materials/v1"),
    ).toBe(true);
    expect(guidedCapability("catalog-core/v1")).toMatchObject({
      available: true,
      revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    });
  });

  it("keeps unshipped behavioral integrations unavailable", () => {
    expect(isGuidedCapabilityAvailable("dynamic-material-quantity/v1")).toBe(
      false,
    );
    expect(isGuidedCapabilityAvailable("supplier-cost-automation/v1")).toBe(
      false,
    );
    expect(isGuidedCapabilityAvailable("deck-geometry/v1")).toBe(false);
    expect(isGuidedCapabilityAvailable("roll-inventory/v1")).toBe(false);
  });

  it("fails closed for unknown capability references", () => {
    expect(isGuidedCapabilityAvailable("invented-capability/v99")).toBe(
      false,
    );
    expect(guidedCapability("invented-capability/v99")).toBeNull();
  });

  it("maps every Phase C blueprint action to an explicit capability", () => {
    expect(guidedCapabilityForAction("upsert_product")).toMatchObject({
      ref: "catalog-core/v1",
      available: true,
    });
    expect(
      guidedCapabilityForAction("upsert_product_material"),
    ).toMatchObject({
      ref: "static-product-materials/v1",
      available: true,
    });
    expect(
      guidedCapabilityForAction("upsert_material_quantity_rule"),
    ).toMatchObject({
      ref: "dynamic-material-quantity/v1",
      available: false,
    });
    expect(guidedCapabilityForAction("upsert_capability_binding")).toMatchObject(
      {
        ref: "deck-geometry/v1",
        available: false,
      },
    );
  });
});
