import { describe, expect, it } from "vitest";

import {
  HIRING_WHAT_IF_CAPABILITY_MANIFEST,
  PROMISE_RECOVERY_CAPABILITY_MANIFEST,
  PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION,
  resolvePromiseRecoveryCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  MCP_EXPOSURE_V3,
  MCP_EXPOSURE_V4,
  MCP_EXPOSURE_V5,
  MCP_EXPOSURE_V6,
  capabilityManifestRevisionForExposure,
  resolveActiveMcpExposure,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import { resolveDomainReadMethod } from "../../mcp/domain-dispatch";

describe("promise-recovery capability", () => {
  it("adds one available read with only customer and correspondence authority", () => {
    const priorNames = new Set(
      HIRING_WHAT_IF_CAPABILITY_MANIFEST.map((entry) => entry.name)
    );
    const added = PROMISE_RECOVERY_CAPABILITY_MANIFEST.filter(
      (entry) => !priorNames.has(entry.name)
    );

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      name: "check_customer_reply",
      schemaRevision: "2026-08-31.v1",
      operation: "read",
      riskTier: "high",
      auditClass: "evidence_read",
      rateLimitBucket: "evidence_search",
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
        maxEvidenceRefs: 140,
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      },
    });
    expect(added[0]!.authorization.variants).toHaveLength(1);
    expect(
      added[0]!.authorization.variants[0]!.policy.requiredOAuthScopes
    ).toEqual([
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
    ]);
    expect(
      added[0]!.authorization.variants[0]!.policy.permissionRequirementGroups
    ).toEqual([
      [
        { permission: "clients.view", allowedScopes: ["all"] },
        { permission: "email.view", allowedScopes: ["all"] },
      ],
    ]);
  });

  it("parses the exact input through the v12 manifest-owned policy", () => {
    const resolved = resolvePromiseRecoveryCapabilityAuthorization(
      "check_customer_reply",
      {
        customer_query: "  Baxter Homes ",
        topic: " revised quote ",
      }
    );
    expect(resolved.parsedInput).toEqual({
      customer_query: "Baxter Homes",
      topic: "revised quote",
    });
    expect(resolved.variants[0]!.policy.capabilityManifestRevision).toBe(
      PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION
    );
  });

  it("keeps v6 dormant and adds the new read to hiring", () => {
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
    expect(MCP_EXPOSURE_V6).toEqual({
      revision: "2026-09-01.mcp-exposure.v6",
      toolIds: ["analyze_hiring_break_even", "check_customer_reply"],
      grantableScopes: [
        "ops.company.read",
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
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
    expect(resolveMcpExposure(MCP_EXPOSURE_V6.revision)).toBe(MCP_EXPOSURE_V6);
    expect(resolveDomainReadMethod("check_customer_reply")).toBe(
      "checkCustomerReply"
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V6.revision)
    ).toBe(PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION);
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe("2026-09-04.mcp-exposure.v14");
    expect(resolveActiveMcpExposure().revision).toBe(
      "2026-09-04.mcp-exposure.v14"
    );
  });

  it("does not alter the dormant Phase 3 or Phase 4 exposure contracts", () => {
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
  });
});
