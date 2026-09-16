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
    family_ref: { kind: "catalog_family", id: FAMILY },
    name: "Height",
    values: [{ value: '42"' }, { value: '72"' }],
    value_for_existing_variants: '42"',
    evidence: [
      {
        kind: "operator_statement",
        text: 'Jackson: every endcap rail on the shelf today is the 42" one.',
      },
    ],
    idempotency_key: "catalog-setup:endcap-rail-height",
    ...over,
  };
}

describe("prepare_create_catalog_option on the shared manifest", () => {
  it("is the fifth catalogue prepare, minted under v28 beside the first four", () => {
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

  it("is exposed last in V24 and never in V23", () => {
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
      "prepare_create_catalog_option"
    );
    // The last kind widens no grant: it adds no scope of its own.
    expect(MCP_EXPOSURE_V24.grantableScopes).toHaveLength(22);
  });

  it("asks for the shared catalogue authority and nothing beyond it", () => {
    const option = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_option"
    );
    expect(option.operation).toBe("prepare");
    expect(option.riskTier).toBe("high");
    expect(option.annotations.readOnlyHint).toBe(false);
    expect(option.auditClass).toBe("mutation_prepare");
    const scopes = option.authorization.variants
      .flatMap((entry) => entry.policy.requiredOAuthScopes)
      .sort();
    expect([...new Set(scopes)]).toEqual([
      "ops.catalog.prepare",
      "ops.catalog.read",
    ]);
    // Options, their values and the variant joins are written through
    // catalog_setup_save as the approving operator, against tables whose row
    // policies ask for company isolation and no setup key — so this kind asks
    // for what create_variant asks for, and not for catalog.run_setup.
    const declared = option.authorization.variants
      .flatMap((entry) => entry.policy.permissionRequirementGroups)
      .flat()
      .map((requirement) => requirement.permission)
      .sort();
    expect(declared).toEqual([
      "agent.review",
      "catalog.manage",
      "catalog.products.view",
      "catalog.view",
    ]);
    expect(declared).not.toContain("catalog.run_setup");
  });

  it("carries no opening-stock variant, because it never records stock", () => {
    const resolved = resolveCatalogSetupWriteCapabilityAuthorization(
      "prepare_create_catalog_option",
      input()
    );
    expect(resolved.variants.map((entry) => entry.key)).toEqual([
      "catalog_setup_write_base",
    ]);
    expect(() =>
      resolveCatalogSetupWriteCapabilityAuthorization(
        "prepare_create_catalog_option",
        input({ opening_quantity: { quantity: "12" } })
      )
    ).toThrow();
  });

  it("says in the description that the grid is backfilled and listed", () => {
    const description = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_option"
    ).description;
    expect(description).toContain("backfill");
    expect(description).toContain("value_for_existing_variants");
    expect(description).toContain("prepare_create_catalog_variant");
    expect(description).toContain("lists every variant");
  });

  it("is staged behind the same exact-preview approval as every other kind", () => {
    const option = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_option"
    );
    expect(option.confirmationPolicy).toMatchObject({
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    });
    expect(option.idempotencyPolicy).toMatchObject({
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    });
    expect(option.evidencePolicy.input).toBe("required");
    expect(option.availability.implementation).toBe("available");
  });
});
