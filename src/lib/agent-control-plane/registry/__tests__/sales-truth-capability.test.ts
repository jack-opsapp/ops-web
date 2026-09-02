import { describe, expect, it } from "vitest";

import {
  PROMISE_RECOVERY_CAPABILITY_MANIFEST,
  SALES_TRUTH_CAPABILITY_MANIFEST,
  SALES_TRUTH_CAPABILITY_MANIFEST_REVISION,
  resolveSalesTruthCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V6,
  MCP_EXPOSURE_V7,
  capabilityManifestRevisionForExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import { resolveDomainReadMethod } from "../../mcp/domain-dispatch";

describe("sales-truth capability", () => {
  it("adds one available read with exact pipeline and correspondence authority", () => {
    const priorNames = new Set(
      PROMISE_RECOVERY_CAPABILITY_MANIFEST.map((entry) => entry.name)
    );
    const added = SALES_TRUTH_CAPABILITY_MANIFEST.filter(
      (entry) => !priorNames.has(entry.name)
    );

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      name: "analyze_sales_truth",
      schemaRevision: "2026-09-01.v1",
      operation: "read",
      riskTier: "high",
      auditClass: "sensitive_read",
      rateLimitBucket: "lightweight_read",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      availability: { implementation: "available" },
      evidencePolicy: {
        input: "not_required",
        output: "required",
        maxEvidenceRefs: 100,
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      },
    });
    expect(added[0]!.authorization.variants).toHaveLength(1);
    expect(
      added[0]!.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual(["ops.correspondence.read", "ops.operations.read"]);
    expect(
      added[0]!.authorization.variants[0]!.policy.permissionRequirementGroups
    ).toEqual([
      [
        { permission: "email.view", allowedScopes: ["all"] },
        { permission: "pipeline.view", allowedScopes: ["all"] },
      ],
    ]);
  });

  it("accepts only empty input through the v13 manifest-owned policy", () => {
    const resolved = resolveSalesTruthCapabilityAuthorization(
      "analyze_sales_truth",
      {}
    );
    expect(resolved.parsedInput).toEqual({});
    expect(resolved.variants).toHaveLength(1);
    expect(resolved.variants[0]!.policy.capabilityManifestRevision).toBe(
      SALES_TRUTH_CAPABILITY_MANIFEST_REVISION
    );
    expect(() =>
      resolveSalesTruthCapabilityAuthorization("analyze_sales_truth", {
        window_days: 30,
      })
    ).toThrow();
  });

  it("keeps v1-v6 stable and adds one dormant read-only v7 exposure", () => {
    expect(MCP_EXPOSURE_V7).toEqual({
      revision: "2026-09-01.mcp-exposure.v7",
      toolIds: [
        "analyze_hiring_break_even",
        "check_customer_reply",
        "analyze_sales_truth",
      ],
      grantableScopes: [
        "ops.company.read",
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.expenses.read",
        "ops.financial_documents.read",
        "ops.financials.read",
        "ops.jobs.read",
        "ops.operations.read",
        "ops.payments.read",
        "ops.schedule.read",
        "ops.site_visits.read",
        "ops.tasks.read",
        "ops.team.read",
      ],
    });
    expect(MCP_EXPOSURE_V7.toolIds.slice(0, 2)).toEqual(
      MCP_EXPOSURE_V6.toolIds
    );
    expect(resolveMcpExposure(MCP_EXPOSURE_V7.revision)).toBe(MCP_EXPOSURE_V7);
    expect(resolveDomainReadMethod("analyze_sales_truth")).toBe(
      "analyzeSalesTruth"
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V7.revision)
    ).toBe(SALES_TRUTH_CAPABILITY_MANIFEST_REVISION);
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V2.revision);
  });
});
