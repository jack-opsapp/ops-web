import { describe, expect, it } from "vitest";

import {
  CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  getCatalogSetupWriteCapabilityManifestEntry,
  resolveCatalogSetupWriteCapabilityAuthorization,
} from "../capability-manifest";
import { MCP_EXPOSURE_V23, MCP_EXPOSURE_V24 } from "../mcp-exposure-catalog";
import { CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS } from "../catalog-setup-write-capability";

const VARIANT = "411f89c9-d2a1-44a8-8377-6c11a098f0f7";

function input(over: Record<string, unknown> = {}) {
  return {
    variant_ref: { kind: "catalog_variant", id: VARIANT },
    warning_threshold: 24,
    critical_threshold: 6,
    evidence: [
      { kind: "operator_statement", text: "Warn at 24, critical at 6." },
    ],
    idempotency_key: "catalog-setup:line-thresholds",
    ...over,
  };
}

describe("prepare_set_variant_thresholds on the shared manifest", () => {
  it("is the second catalogue prepare, minted under v28 beside the first", () => {
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
      "prepare_set_variant_thresholds"
    );
    // The grant surface does not widen: this kind needs no scope of its own.
    expect(MCP_EXPOSURE_V24.grantableScopes).toHaveLength(22);
  });

  it("asks for the same catalogue authority as the first prepare and no more", () => {
    const thresholds = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_variant_thresholds"
    );
    const variant = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_variant"
    );
    expect(thresholds.operation).toBe("prepare");
    expect(thresholds.riskTier).toBe("high");
    expect(thresholds.annotations.readOnlyHint).toBe(false);
    expect(thresholds.annotations.destructiveHint).toBe(false);
    expect(thresholds.auditClass).toBe("mutation_prepare");
    expect(
      thresholds.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual(variant.authorization.variants[0]!.policy.requiredOAuthScopes);
    expect(
      thresholds.authorization.variants[0]!.policy.permissionRequirementGroups
    ).toEqual(
      variant.authorization.variants[0]!.policy.permissionRequirementGroups
    );
  });

  it("never asks for stock-adjust authority, because it moves no stock", () => {
    const resolved = resolveCatalogSetupWriteCapabilityAuthorization(
      "prepare_set_variant_thresholds",
      input()
    );
    expect(resolved.variants.map((entry) => entry.key)).toEqual([
      "catalog_setup_write_base",
    ]);
    // A request that smuggles the create tool's stock key in never reaches the
    // selector at all: the strict input schema refuses it first, so the shared
    // AUTHORIZATION object cannot leak the stock-adjust variant into this kind.
    expect(() =>
      resolveCatalogSetupWriteCapabilityAuthorization(
        "prepare_set_variant_thresholds",
        input({ opening_quantity: { quantity: "12" } })
      )
    ).toThrow();
  });

  it("says in the description how whole units, clearing and origins behave", () => {
    const description = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_variant_thresholds"
    ).description;
    expect(description).toContain("whole units");
    expect(description).toContain("null clears it");
    expect(description).toContain("family default");
    expect(description).toContain("category default");
    expect(description).toContain("variant, family, category or none");
    expect(description).toContain("at or below the warning level");
    expect(description).toContain(
      "a number equal to the level the variant would inherit"
    );
  });

  it("is staged behind the same exact-preview approval as every other kind", () => {
    const thresholds = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_variant_thresholds"
    );
    expect(thresholds.confirmationPolicy).toMatchObject({
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    });
    expect(thresholds.idempotencyPolicy).toMatchObject({
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    });
    expect(thresholds.evidencePolicy.input).toBe("required");
    expect(thresholds.availability.implementation).toBe("available");
  });
});
