import { describe, expect, it } from "vitest";
import {
  CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
  getCustomerUpdateCapabilityManifestEntry,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V14,
  capabilityManifestRevisionForExposure,
} from "../mcp-exposure-catalog";
import {
  MCP_SCOPE_CONSENT_LABELS,
  CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS,
} from "../mcp-scope-catalog";
describe("customer update dormant catalogue", () => {
  it("exposes only its prepare tool alongside immutable production reads", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V2.revision);
    expect(MCP_EXPOSURE_V14.toolIds).toEqual([
      ...MCP_EXPOSURE_V2.toolIds,
      "prepare_customer_update",
    ]);
    expect(MCP_EXPOSURE_V14.toolIds).not.toContain("commit_customer_update");
    expect(MCP_EXPOSURE_V14.toolIds).toHaveLength(35);
    expect(MCP_EXPOSURE_V14.grantableScopes).toHaveLength(21);
    expect(Object.keys(MCP_SCOPE_CONSENT_LABELS)).toHaveLength(20);
    expect(Object.keys(CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS)).toHaveLength(
      21
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V14.revision)
    ).toBe(CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION);
    expect(CUSTOMER_UPDATE_CAPABILITY_MANIFEST).toHaveLength(
      CAPABILITY_MANIFEST.length + 2
    );
  });
  it("requires granular record/review/team permissions and exact single-use confirmation", () => {
    const prepare = getCustomerUpdateCapabilityManifestEntry(
      "prepare_customer_update"
    );
    expect(
      prepare.authorization.variants[0]!.policy.permissionRequirementGroups[0]
    ).toEqual([
      { permission: "agent.review", allowedScopes: ["all"] },
      { permission: "pipeline.edit", allowedScopes: ["all"] },
      { permission: "pipeline.view", allowedScopes: ["all"] },
      { permission: "team.view", allowedScopes: ["all"] },
    ]);
    expect(
      getCustomerUpdateCapabilityManifestEntry("commit_customer_update")
        .confirmationPolicy
    ).toMatchObject({
      kind: "confirmation_receipt",
      exactPreviewRequired: true,
      singleUse: true,
    });
  });
});
