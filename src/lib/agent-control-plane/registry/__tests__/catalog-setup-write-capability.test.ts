import { describe, expect, it } from "vitest";

import {
  CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST,
  CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
  getCatalogSetupWriteCapabilityManifestEntry,
  resolveCatalogSetupWriteCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V23,
  MCP_EXPOSURE_V24,
  capabilityManifestRevisionForExposure,
} from "../mcp-exposure-catalog";
import {
  CATALOG_SETUP_WRITE_MCP_SCOPE_CONSENT_LABELS,
  CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS,
} from "../mcp-scope-catalog";
import { catalogSetupWriteHasEffect } from "../catalog-setup-write-capability";

const FAMILY = "9b30f44d-47da-4134-872d-7f9c2d6f1b44";
const COLOR = "507683da-ac06-477e-90cb-e895e7bcdd5c";
const BOARDWALK = "247c1452-41db-485e-9463-6cc7059c3bb5";

function input(over: Record<string, unknown> = {}) {
  return {
    family_ref: { kind: "catalog_family", id: FAMILY },
    option_values: [
      {
        option_ref: { kind: "catalog_option", id: COLOR },
        value_ref: { kind: "catalog_option_value", id: BOARDWALK },
      },
    ],
    price_override: { amount: "45.0000", currency: "CAD" },
    evidence: [{ kind: "operator_statement", text: "Confirmed at 45.00." }],
    idempotency_key: "catalog-setup:boardwalk",
    ...over,
  };
}

describe("catalogue setup write manifest v28", () => {
  it("remints v20 and adds exactly the five prepares and their shared commit", () => {
    expect(CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-09-15.capability-manifest.v28"
    );
    expect(CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST).toHaveLength(
      CUSTOMER_UPDATE_CAPABILITY_MANIFEST.length + 6
    );
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
    for (const entry of CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST) {
      for (const variant of entry.authorization.variants) {
        expect(variant.policy.capabilityManifestRevision).toBe(
          CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION
        );
      }
    }
  });

  it("binds V24 to v28 while V14 and V23 keep v20", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V24.revision);
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V24.revision)
    ).toBe(CATALOG_SETUP_WRITE_CAPABILITY_MANIFEST_REVISION);
    for (const exposure of [MCP_EXPOSURE_V14, MCP_EXPOSURE_V23]) {
      expect(capabilityManifestRevisionForExposure(exposure.revision)).toBe(
        CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION
      );
    }
  });

  it("exposes the prepare and keeps the commit out of the tool set", () => {
    expect(MCP_EXPOSURE_V24.toolIds).toContain("prepare_create_catalog_variant");
    expect(MCP_EXPOSURE_V24.toolIds).not.toContain("commit_catalog_setup_write");
    expect(MCP_EXPOSURE_V24.grantableScopes).toContain("ops.catalog.prepare");
    expect(MCP_EXPOSURE_V23.grantableScopes).not.toContain(
      "ops.catalog.prepare"
    );
  });

  it("adds exactly one consent label over the customer-update set", () => {
    expect(Object.keys(CATALOG_SETUP_WRITE_MCP_SCOPE_CONSENT_LABELS)).toHaveLength(
      Object.keys(CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS).length + 1
    );
    expect(
      CATALOG_SETUP_WRITE_MCP_SCOPE_CONSENT_LABELS["ops.catalog.prepare"]
    ).toBe(
      "Prepare exact catalog changes for named operator approval in OPS; never change stock or prices without that approval"
    );
    for (const [scope, label] of Object.entries(
      CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS
    )) {
      expect(
        CATALOG_SETUP_WRITE_MCP_SCOPE_CONSENT_LABELS[
          scope as keyof typeof CATALOG_SETUP_WRITE_MCP_SCOPE_CONSENT_LABELS
        ]
      ).toBe(label);
    }
  });

  it("requires catalogue editing permissions and both catalogue scopes", () => {
    const prepare = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_variant"
    );
    expect(prepare.operation).toBe("prepare");
    expect(prepare.annotations.readOnlyHint).toBe(false);
    expect(prepare.annotations.destructiveHint).toBe(false);
    expect(
      prepare.authorization.variants[0]!.policy.permissionRequirementGroups[0]
    ).toEqual([
      { permission: "agent.review", allowedScopes: ["all"] },
      { permission: "catalog.manage", allowedScopes: ["all"] },
      { permission: "catalog.products.view", allowedScopes: ["all"] },
      { permission: "catalog.view", allowedScopes: ["all"] },
    ]);
    expect(prepare.authorization.variants[0]!.policy.requiredOAuthScopes).toEqual(
      ["ops.catalog.prepare", "ops.catalog.read"]
    );
  });

  it("asks for stock-adjust authority only when the request carries opening stock", () => {
    expect(catalogSetupWriteHasEffect(input(), "opening_stock")).toBe(false);
    expect(
      catalogSetupWriteHasEffect(
        input({ opening_quantity: { quantity: "12" } }),
        "opening_stock"
      )
    ).toBe(true);

    const withoutStock = resolveCatalogSetupWriteCapabilityAuthorization(
      "prepare_create_catalog_variant",
      input()
    );
    expect(withoutStock.variants.map((variant) => variant.key)).toEqual([
      "catalog_setup_write_base",
    ]);

    const withStock = resolveCatalogSetupWriteCapabilityAuthorization(
      "prepare_create_catalog_variant",
      input({ opening_quantity: { quantity: "12", note: "Opening count" } })
    );
    expect(withStock.variants.map((variant) => variant.key)).toEqual([
      "catalog_setup_write_base",
      "catalog_setup_write_opening_stock",
    ]);
    expect(
      withStock.variants[1]!.policy.permissionRequirementGroups[0]
    ).toEqual([{ permission: "catalog.stock.adjust", allowedScopes: ["all"] }]);
  });

  it("makes the commit an exact single-use confirmation of the prepare", () => {
    const commit = getCatalogSetupWriteCapabilityManifestEntry(
      "commit_catalog_setup_write"
    );
    expect(commit.operation).toBe("commit");
    expect(commit.confirmationPolicy).toMatchObject({
      kind: "confirmation_receipt",
      prepareCapability: "prepare_create_catalog_variant",
      exactPreviewRequired: true,
      singleUse: true,
    });
    expect(
      getCatalogSetupWriteCapabilityManifestEntry(
        "prepare_create_catalog_variant"
      ).confirmationPolicy
    ).toMatchObject({
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    });
  });

  it("says in the tool description how price, thresholds and opening stock behave", () => {
    const description = getCatalogSetupWriteCapabilityManifestEntry(
      "prepare_create_catalog_variant"
    ).description;
    expect(description).toContain("every non-deleted option");
    expect(description).toContain("already exists is refused");
    expect(description).toContain("family default");
    expect(description).toContain("whole units");
    expect(description).toContain("receive stock event");
  });
});
