import { describe, expect, it } from "vitest";

import {
  CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  getCatalogSetupWriteCapabilityManifestEntry,
  resolveCatalogSetupWriteCapabilityAuthorization,
} from "../capability-manifest";
import { MCP_EXPOSURE_V23, MCP_EXPOSURE_V24 } from "../mcp-exposure-catalog";
import { CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS } from "../catalog-setup-write-capability";

const FAMILY = "948ac4a0-882f-efe9-3bc4-b6f7c53fb12f";

function input(over: Record<string, unknown> = {}) {
  return {
    item_ref: { kind: "catalog_family", id: FAMILY },
    sale_price: { amount: "7.50", currency: "CAD" },
    evidence: [
      { kind: "operator_statement", text: "Endcap rail goes to 7.50." },
    ],
    idempotency_key: "catalog-setup:endcap-rail-price",
    ...over,
  };
}

describe("prepare_set_catalog_pricing on the shared manifest", () => {
  it("is the third catalogue prepare, minted under v28 beside the first two", () => {
    expect(
      CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS.map(
        (definition) => definition.name
      )
    ).toEqual([
      "prepare_create_catalog_variant",
      "prepare_set_variant_thresholds",
      "prepare_set_catalog_pricing",
      "prepare_set_supplier_cost",
      "prepare_create_catalog_option",
    ]);
    const added = CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST.filter(
      (entry) =>
        !CUSTOMER_UPDATE_CAPABILITY_MANIFEST.some(
          (existing) => existing.name === entry.name
        )
    ).map((entry) => entry.name);
    expect(added).toEqual([
      "prepare_create_catalog_variant",
      "prepare_set_variant_thresholds",
      "prepare_set_catalog_pricing",
      "prepare_set_supplier_cost",
      "prepare_create_catalog_option",
      "commit_catalog_setup_write",
    ]);
  });

  it("is exposed in V24 in the plan's order and never in V23", () => {
    expect(MCP_EXPOSURE_V24.toolIds).toEqual([
      ...MCP_EXPOSURE_V23.toolIds,
      "prepare_create_catalog_variant",
      "prepare_set_variant_thresholds",
      "prepare_set_catalog_pricing",
      "prepare_set_supplier_cost",
      "prepare_create_catalog_option",
    ]);
    expect(MCP_EXPOSURE_V24.toolIds).toHaveLength(40);
    expect(MCP_EXPOSURE_V23.toolIds).not.toContain(
      "prepare_set_catalog_pricing"
    );
    // Money is not a new grant surface: this kind needs no scope of its own.
    expect(MCP_EXPOSURE_V24.grantableScopes).toHaveLength(22);
  });

  it("asks for catalogue-setup authority on top of the shared catalogue base", () => {
    const pricing = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_catalog_pricing"
    );
    const variant = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_variant"
    );
    expect(pricing.operation).toBe("prepare");
    expect(pricing.riskTier).toBe("high");
    expect(pricing.annotations.readOnlyHint).toBe(false);
    expect(pricing.auditClass).toBe("mutation_prepare");
    expect(
      pricing.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual(variant.authorization.variants[0]!.policy.requiredOAuthScopes);
    const declared = pricing.authorization.variants
      .flatMap((entry) => entry.policy.permissionRequirementGroups)
      .flat()
      .map((requirement) => requirement.permission)
      .sort();
    expect(declared).toEqual([
      "agent.review",
      "catalog.manage",
      "catalog.products.view",
      "catalog.run_setup",
      "catalog.view",
    ]);
  });

  it("never asks for stock-adjust authority, because it moves no stock", () => {
    const resolved = resolveCatalogSetupWriteCapabilityAuthorization(
      "prepare_set_catalog_pricing",
      input()
    );
    expect(resolved.variants.map((entry) => entry.key)).toEqual([
      "catalog_setup_write_base",
      "catalog_setup_write_setup_authority",
    ]);
    expect(() =>
      resolveCatalogSetupWriteCapabilityAuthorization(
        "prepare_set_catalog_pricing",
        input({ opening_quantity: { quantity: "12" } })
      )
    ).toThrow();
  });

  it("says in the description how price resolves and that costs live elsewhere", () => {
    const description = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_catalog_pricing"
    ).description;
    expect(description).toContain(
      "the variant override when set, otherwise the family default"
    );
    expect(description).toContain("prepare_set_supplier_cost");
    expect(description).toContain("company's own currency");
    expect(description).toContain("clears");
    // A pricing tool that quietly also wrote cost would be two decisions in one
    // approval, so the description says the boundary out loud.
    expect(description).not.toContain("unit_cost argument");
  });

  it("is staged behind the same exact-preview approval as every other kind", () => {
    const pricing = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_catalog_pricing"
    );
    expect(pricing.confirmationPolicy).toMatchObject({
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    });
    expect(pricing.idempotencyPolicy).toMatchObject({
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    });
    expect(pricing.evidencePolicy.input).toBe("required");
    expect(pricing.availability.implementation).toBe("available");
  });
});
