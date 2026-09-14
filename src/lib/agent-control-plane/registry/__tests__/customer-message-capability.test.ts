import { describe, expect, it } from "vitest";

import {
  CUSTOMER_MESSAGE_CAPABILITY_MANIFEST,
  CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  getCustomerMessageCapabilityManifestEntry,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V23,
  MCP_EXPOSURE_V15,
} from "../mcp-exposure-catalog";

describe("customer message dormant catalogue", () => {
  it("defines one prepare tool without changing the active V14 exposure", () => {
    expect(CUSTOMER_MESSAGE_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-09-06.capability-manifest.v21"
    );
    expect(CUSTOMER_MESSAGE_CAPABILITY_MANIFEST).toHaveLength(
      CUSTOMER_UPDATE_CAPABILITY_MANIFEST.length + 2
    );
    expect(MCP_EXPOSURE_V15.toolIds).toEqual([
      ...MCP_EXPOSURE_V14.toolIds,
      "prepare_customer_message",
    ]);
    expect(MCP_EXPOSURE_V15.toolIds).not.toContain("commit_customer_message");
    expect(MCP_EXPOSURE_V15.grantableScopes).toEqual([
      ...[
        ...MCP_EXPOSURE_V14.grantableScopes,
        "ops.communications.prepare",
      ].sort(),
    ]);
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V23.revision);
  });

  it("requires message, customer, correspondence, and job authority with exact approval", () => {
    const prepare = getCustomerMessageCapabilityManifestEntry(
      "prepare_customer_message"
    );
    expect(
      prepare.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual([
      "ops.communications.prepare",
      "ops.correspondence.read",
      "ops.customers.read",
      "ops.jobs.read",
    ]);
    expect(
      prepare.authorization.variants[0]!.policy.permissionRequirementGroups[0]
    ).toEqual([
      { permission: "agent.review", allowedScopes: ["all"] },
      { permission: "clients.view", allowedScopes: ["all"] },
      { permission: "inbox.send", allowedScopes: ["all"] },
      { permission: "inbox.view", allowedScopes: ["all"] },
      { permission: "pipeline.view", allowedScopes: ["all"] },
    ]);
    expect(
      getCustomerMessageCapabilityManifestEntry("commit_customer_message")
        .confirmationPolicy
    ).toMatchObject({
      kind: "confirmation_receipt",
      prepareCapability: "prepare_customer_message",
      exactPreviewRequired: true,
      singleUse: true,
    });
  });
});
