import { describe, expect, it } from "vitest";

import {
  CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  getCatalogSetupWriteCapabilityManifestEntry,
  resolveCatalogSetupWriteCapabilityAuthorization,
} from "../capability-manifest";
import { MCP_EXPOSURE_V23, MCP_EXPOSURE_V24 } from "../mcp-exposure-catalog";
import { CATALOG_SETUP_WRITE_PREPARE_DEFINITIONS } from "../catalog-setup-write-capability";

const VARIANT = "18234bac-442f-41e8-98e7-956c051fbf21";

function input(over: Record<string, unknown> = {}) {
  return {
    variant_ref: { kind: "catalog_variant", id: VARIANT },
    profile_key: "rails-direct-2026",
    label: "Rails Direct 2026 rate card",
    unit_cost: { amount: "18.25", currency: "CAD" },
    evidence: [
      { kind: "operator_statement", text: "Rails Direct quoted 18.25 per LF." },
    ],
    idempotency_key: "catalog-setup:vinyl-rails-direct",
    ...over,
  };
}

describe("prepare_set_supplier_cost on the shared manifest", () => {
  it("is the fourth catalogue prepare, minted under v28 beside the first three", () => {
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
    expect(MCP_EXPOSURE_V23.toolIds).not.toContain("prepare_set_supplier_cost");
    // Cost visibility is an existing read scope, already grantable in V23.
    expect(MCP_EXPOSURE_V24.grantableScopes).toContain("ops.catalog_costs.read");
    expect(MCP_EXPOSURE_V24.grantableScopes).toHaveLength(22);
  });

  it("asks for cost-read scope and cost-visibility permission on top of the base", () => {
    const cost = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_supplier_cost"
    );
    expect(cost.operation).toBe("prepare");
    expect(cost.riskTier).toBe("high");
    expect(cost.annotations.readOnlyHint).toBe(false);
    expect(cost.auditClass).toBe("mutation_prepare");
    const scopes = cost.authorization.variants
      .flatMap((entry) => entry.policy.requiredOAuthScopes)
      .sort();
    expect([...new Set(scopes)]).toEqual([
      "ops.catalog.prepare",
      "ops.catalog.read",
      "ops.catalog_costs.read",
    ]);
    const declared = cost.authorization.variants
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
      "finances.view",
    ]);
  });

  it("carries the cost authority unconditionally, never behind an input selector", () => {
    const resolved = resolveCatalogSetupWriteCapabilityAuthorization(
      "prepare_set_supplier_cost",
      input()
    );
    // Every request to this tool reads and writes cost, so the authority is not
    // conditional on a field the caller could omit.
    expect(resolved.variants.map((entry) => entry.key)).toEqual([
      "catalog_setup_write_base",
      "catalog_setup_write_setup_authority",
      "catalog_setup_write_cost_authority",
    ]);
    expect(() =>
      resolveCatalogSetupWriteCapabilityAuthorization(
        "prepare_set_supplier_cost",
        input({ opening_quantity: { quantity: "12" } })
      )
    ).toThrow();
  });

  it("says in the description how the one default and the mirror behave", () => {
    const description = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_supplier_cost"
    ).description;
    expect(description).toContain("exactly one default");
    expect(description).toContain("demotes");
    expect(description).toContain("revived");
    expect(description).toContain("company's own currency");
    // Gap #17: the two cost models must not drift for anything written here.
    expect(description).toContain("mirror");
  });

  it("is staged behind the same exact-preview approval as every other kind", () => {
    const cost = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_set_supplier_cost"
    );
    expect(cost.confirmationPolicy).toMatchObject({
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    });
    expect(cost.idempotencyPolicy).toMatchObject({
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    });
    expect(cost.evidencePolicy.input).toBe("required");
    expect(cost.availability.implementation).toBe("available");
  });
});
