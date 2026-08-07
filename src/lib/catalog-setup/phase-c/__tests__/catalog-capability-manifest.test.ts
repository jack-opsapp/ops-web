import { describe, expect, it } from "vitest";
import {
  CATALOG_CAPABILITY_MANIFEST_REVISION,
  guidedCapability,
  guidedCapabilityForAction,
  guidedCapabilityManifestForModel,
  isGuidedCapabilityAvailable,
} from "../catalog-capability-manifest";
import { OPS_CAPABILITY_REGISTRY_REVISION } from "@/lib/ops-capabilities/registry";

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
    expect(isGuidedCapabilityAvailable("tax-rate-configuration/v1")).toBe(
      false,
    );
    expect(isGuidedCapabilityAvailable("deck-geometry/v1")).toBe(false);
    expect(isGuidedCapabilityAvailable("roll-inventory/v1")).toBe(false);
  });

  it("knows what Deck Designer actually does without offering Phase C configuration", () => {
    expect(guidedCapability("deck-geometry/v1")).toMatchObject({
      available: false,
      phaseCAccess: "discover_only",
      runtimeConsumer: "OPS Decks / DeckKit",
      knownAbilities: expect.arrayContaining([
        "calculate deck material quantities",
        "generate vinyl cut plans",
        "reuse compatible vinyl offcuts",
      ]),
    });

    expect(guidedCapabilityManifestForModel()).toMatchObject({
      registryRevision: OPS_CAPABILITY_REGISTRY_REVISION,
      knownTools: expect.arrayContaining([
        expect.objectContaining({
          name: "Deck Designer",
          phaseCAccess: "discover_only",
          canConfigure: false,
        }),
      ]),
    });
  });

  it("exposes concrete material scope but never operator-owned review readiness", () => {
    expect(
      guidedCapability("static-product-materials/v1")?.questionIntents,
    ).toContain("material_tracking_scope");
    expect(
      guidedCapability("catalog-core/v1")?.questionIntents,
    ).not.toContain("review_readiness");
    expect(
      guidedCapability("catalog-core/v1")?.questionIntents,
    ).not.toContain("quote_display");
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
    expect(guidedCapabilityForAction("upsert_tax_rate")).toMatchObject({
      ref: "tax-rate-configuration/v1",
      available: false,
    });
  });

  it("tells Phase C the exact supported fields for each available action", () => {
    const manifest = guidedCapabilityManifestForModel();

    expect(manifest.actionPayloads.upsert_product).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "name",
        "basePrice",
        "pricingUnit",
        "minimumCharge",
        "isTaxable",
        "showInStorefront",
        "taskTypeClientId",
        "linkedFamilyRef",
      ]),
      properties: expect.objectContaining({
        basePrice: expect.objectContaining({ type: "number" }),
        isTaxable: expect.objectContaining({ type: "boolean" }),
      }),
    });
    expect(
      manifest.actionPayloads.upsert_product.properties,
    ).not.toHaveProperty("showPricingUnit");
    expect(manifest.actionPayloads).not.toHaveProperty(
      "upsert_tax_rate",
    );
  });
});
