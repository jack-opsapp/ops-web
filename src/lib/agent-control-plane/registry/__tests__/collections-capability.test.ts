import { describe, expect, it } from "vitest";

import { resolveDomainReadMethod } from "@/lib/agent-control-plane/mcp/domain-dispatch";
import {
  COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
  getCollectionsCapabilityManifestEntry,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V3,
  MCP_EXPOSURE_V4,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";

describe("collections capability isolation", () => {
  it("requires the complete company-wide collections authority", () => {
    const capability = getCollectionsCapabilityManifestEntry(
      "prepare_collections"
    );
    expect(COLLECTIONS_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-31.capability-manifest.v10"
    );
    expect(capability).toMatchObject({
      name: "prepare_collections",
      operation: "prepare",
      writeFamily: "collections",
      riskTier: "medium",
      rateLimitBucket: "prepare",
      confirmationPolicy: {
        kind: "change_set_preview",
        exactPreviewRequired: true,
        expires: true,
      },
    });
    expect(capability.authorization.variants[0]!.policy.requiredOAuthScopes).toEqual(
      [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.financial_documents.read",
        "ops.operations.prepare",
        "ops.operations.read",
      ]
    );
    expect(
      capability.authorization.variants[0]!.policy.permissionRequirementGroups[0]
    ).toEqual([
      { permission: "clients.view", allowedScopes: ["all"] },
      { permission: "email.view", allowedScopes: ["all"] },
      { permission: "invoices.view", allowedScopes: ["all"] },
      { permission: "reports.view", allowedScopes: ["all"] },
    ]);
  });

  it("adds an inactive one-tool v4 without changing v2 or v3", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(
      "2026-08-29.mcp-exposure.v2"
    );
    expect(MCP_EXPOSURE_V2.toolIds).toHaveLength(34);
    expect(MCP_EXPOSURE_V3).toEqual({
      revision: "2026-08-30.mcp-exposure.v3",
      toolIds: ["prepare_day_closeout"],
      grantableScopes: [
        "ops.correspondence.read",
        "ops.financial_documents.read",
        "ops.jobs.read",
        "ops.operations.prepare",
        "ops.operations.read",
        "ops.schedule.read",
        "ops.tasks.read",
      ],
    });
    expect(MCP_EXPOSURE_V4).toEqual({
      revision: "2026-08-31.mcp-exposure.v4",
      toolIds: ["prepare_collections"],
      grantableScopes: [
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.financial_documents.read",
        "ops.operations.prepare",
        "ops.operations.read",
      ],
    });
    expect(resolveMcpExposure(MCP_EXPOSURE_V4.revision)).toBe(MCP_EXPOSURE_V4);
    expect(resolveDomainReadMethod("prepare_collections")).toBe(
      "prepareCollections"
    );
  });
});
