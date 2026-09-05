import { describe, expect, it } from "vitest";

import {
  PAYROLL_READINESS_CAPABILITY_MANIFEST,
  PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION,
  SALES_TRUTH_CAPABILITY_MANIFEST,
  resolvePayrollReadinessCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V7,
  MCP_EXPOSURE_V8,
  capabilityManifestRevisionForExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import { resolveDomainReadMethod } from "../../mcp/domain-dispatch";

describe("payroll readiness capability", () => {
  it("adds one available high-stakes read with exact financial authority", () => {
    const priorNames = new Set(
      SALES_TRUTH_CAPABILITY_MANIFEST.map((entry) => entry.name)
    );
    const added = PAYROLL_READINESS_CAPABILITY_MANIFEST.filter(
      (entry) => !priorNames.has(entry.name)
    );

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      name: "check_payroll_readiness",
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
        maxEvidenceRefs: 691,
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      },
    });
    expect(
      added[0]!.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual([
      "ops.company.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.financials.read",
      "ops.payments.read",
    ]);
    expect(
      added[0]!.authorization.variants[0]!.policy.permissionRequirementGroups
    ).toEqual([
      [
        { permission: "expenses.view", allowedScopes: ["all"] },
        { permission: "invoices.view", allowedScopes: ["all"] },
        { permission: "reports.view", allowedScopes: ["all"] },
        { permission: "settings.company", allowedScopes: ["all"] },
      ],
    ]);
  });

  it("accepts only the requested target date through the v14 policy", () => {
    const resolved = resolvePayrollReadinessCapabilityAuthorization(
      "check_payroll_readiness",
      { target_date: "2026-09-15" }
    );
    expect(resolved.parsedInput).toEqual({ target_date: "2026-09-15" });
    expect(resolved.variants).toHaveLength(1);
    expect(resolved.variants[0]!.policy.capabilityManifestRevision).toBe(
      PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION
    );
    expect(() =>
      resolvePayrollReadinessCapabilityAuthorization(
        "check_payroll_readiness",
        { target_date: "2026-09-15", cash_balance: 10_000 }
      )
    ).toThrow();
  });

  it("keeps v1-v7 stable while adding one dormant v8 read", () => {
    expect(MCP_EXPOSURE_V8).toEqual({
      revision: "2026-09-01.mcp-exposure.v8",
      toolIds: [
        "analyze_hiring_break_even",
        "check_customer_reply",
        "analyze_sales_truth",
        "check_payroll_readiness",
      ],
      grantableScopes: MCP_EXPOSURE_V7.grantableScopes,
    });
    expect(MCP_EXPOSURE_V8.toolIds.slice(0, 3)).toEqual(
      MCP_EXPOSURE_V7.toolIds
    );
    expect(resolveMcpExposure(MCP_EXPOSURE_V8.revision)).toBe(MCP_EXPOSURE_V8);
    expect(resolveDomainReadMethod("check_payroll_readiness")).toBe(
      "checkPayrollReadiness"
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V8.revision)
    ).toBe(PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION);
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe("2026-09-04.mcp-exposure.v14");
  });
});
