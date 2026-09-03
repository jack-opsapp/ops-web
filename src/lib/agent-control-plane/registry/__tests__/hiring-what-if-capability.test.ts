import { describe, expect, it } from "vitest";

import { resolveDomainReadMethod } from "@/lib/agent-control-plane/mcp/domain-dispatch";
import {
  HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION,
  getHiringWhatIfCapabilityManifestEntry,
  resolveHiringWhatIfCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V3,
  MCP_EXPOSURE_V4,
  MCP_EXPOSURE_V5,
  capabilityManifestRevisionForExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";

describe("hiring what-if capability isolation", () => {
  it("requires the complete current company-wide analytical authority", () => {
    const capability = getHiringWhatIfCapabilityManifestEntry(
      "analyze_hiring_break_even"
    );
    expect(HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-31.capability-manifest.v11"
    );
    expect(capability).toMatchObject({
      name: "analyze_hiring_break_even",
      operation: "read",
      riskTier: "high",
      rateLimitBucket: "lightweight_read",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      confirmationPolicy: { kind: "not_required" },
      idempotencyPolicy: { kind: "inherent" },
    });
    expect(
      capability.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual([
      "ops.company.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.financials.read",
      "ops.jobs.read",
      "ops.payments.read",
      "ops.schedule.read",
      "ops.site_visits.read",
      "ops.tasks.read",
      "ops.team.read",
    ]);
    expect(
      capability.authorization.variants[0]!.policy
        .permissionRequirementGroups[0]
    ).toEqual([
      { permission: "calendar.view", allowedScopes: ["all"] },
      { permission: "expenses.view", allowedScopes: ["all"] },
      { permission: "invoices.view", allowedScopes: ["all"] },
      { permission: "projects.view", allowedScopes: ["all"] },
      { permission: "projects.view_financials", allowedScopes: ["all"] },
      { permission: "reports.view", allowedScopes: ["all"] },
      { permission: "settings.company", allowedScopes: ["all"] },
      { permission: "tasks.view", allowedScopes: ["all"] },
      { permission: "team.view", allowedScopes: ["all"] },
    ]);
    expect(
      resolveHiringWhatIfCapabilityAuthorization("analyze_hiring_break_even", {
        role: "Installer",
        hourly_cost: 42.5,
      }).variants
    ).toHaveLength(1);
  });

  it("adds one dormant read-only v5 without changing v1 through v4", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe("2026-08-29.mcp-exposure.v2");
    expect(MCP_EXPOSURE_V1.revision).toBe("2026-08-22.mcp-exposure.v1");
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
    expect(MCP_EXPOSURE_V5).toEqual({
      revision: "2026-08-31.mcp-exposure.v5",
      toolIds: ["analyze_hiring_break_even"],
      grantableScopes: [
        "ops.company.read",
        "ops.expenses.read",
        "ops.financial_documents.read",
        "ops.financials.read",
        "ops.jobs.read",
        "ops.payments.read",
        "ops.schedule.read",
        "ops.site_visits.read",
        "ops.tasks.read",
        "ops.team.read",
      ],
    });
    expect(MCP_EXPOSURE_V5.grantableScopes).not.toContain(
      "ops.operations.prepare"
    );
    expect(resolveMcpExposure(MCP_EXPOSURE_V5.revision)).toBe(MCP_EXPOSURE_V5);
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V5.revision)
    ).toBe(HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION);
    expect(resolveDomainReadMethod("analyze_hiring_break_even")).toBe(
      "analyzeHiringBreakEven"
    );
  });
});
