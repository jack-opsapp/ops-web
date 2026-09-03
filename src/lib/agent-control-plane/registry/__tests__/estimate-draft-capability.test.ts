import { describe, expect, it } from "vitest";

import {
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST,
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
  getEstimateDraftCapabilityManifestEntry,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST,
  resolveEstimateDraftCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  capabilityManifestRevisionForExposure,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V9,
  MCP_EXPOSURE_V10,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";
import { ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS } from "../mcp-scope-catalog";

const INPUT = {
  target_opportunity_id: "10000000-0000-4000-8000-000000000001",
  source_estimate_id: "30000000-0000-4000-8000-000000000001",
  increase_percent: "8",
} as const;

describe("estimate draft dormant capability", () => {
  it("adds one exact prepare capability with no commit, issue, approve, or send twin", () => {
    const entry = getEstimateDraftCapabilityManifestEntry(
      "prepare_estimate_from_past_job"
    );
    expect(entry).toMatchObject({
      schemaRevision: "2026-09-02.v1",
      operation: "prepare",
      writeFamily: "estimate_draft",
      riskTier: "high",
      auditClass: "mutation_prepare",
      rateLimitBucket: "prepare",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      confirmationPolicy: {
        kind: "change_set_preview",
        exactPreviewRequired: true,
        expires: true,
      },
      idempotencyPolicy: { kind: "inherent" },
    });
    expect(entry.bounds).toMatchObject({ maxBatchItems: 100 });
    expect(
      ESTIMATE_DRAFT_CAPABILITY_MANIFEST.some(
        (candidate) =>
          candidate.writeFamily === "estimate_draft" &&
          candidate.operation === "commit"
      )
    ).toBe(false);
  });

  it("owns the exact five-scope and six-permission owner authorization policy", () => {
    const resolved = resolveEstimateDraftCapabilityAuthorization(
      "prepare_estimate_from_past_job",
      INPUT
    );
    expect(resolved.parsedInput).toEqual(INPUT);
    expect(resolved.variants).toHaveLength(1);
    expect(resolved.variants[0]!.policy).toMatchObject({
      capabilityManifestRevision: ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes: [
        "ops.company.read",
        "ops.customers.read",
        "ops.financial_documents.read",
        "ops.financials.prepare",
        "ops.jobs.read",
      ],
      permissionRequirementGroups: [
        [
          { permission: "clients.view", allowedScopes: ["all"] },
          { permission: "estimates.create", allowedScopes: ["all"] },
          { permission: "estimates.view", allowedScopes: ["all"] },
          { permission: "pipeline.view", allowedScopes: ["all"] },
          { permission: "projects.view", allowedScopes: ["all"] },
          { permission: "settings.company", allowedScopes: ["all"] },
        ],
      ],
    });
  });

  it("makes v10 additive to v9 while production remains exactly v2", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe(MCP_EXPOSURE_V2.revision);
    expect(MCP_EXPOSURE_V10.toolIds).toEqual([
      ...MCP_EXPOSURE_V9.toolIds,
      "prepare_estimate_from_past_job",
    ]);
    expect(MCP_EXPOSURE_V10.grantableScopes).toEqual([
      "ops.catalog.read",
      "ops.company.read",
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
      "ops.financials.prepare",
      "ops.financials.read",
      "ops.jobs.read",
      "ops.operations.prepare",
      "ops.operations.read",
      "ops.payments.read",
      "ops.schedule.read",
      "ops.site_visits.read",
      "ops.tasks.read",
      "ops.team.read",
    ]);
    expect(resolveMcpExposure(MCP_EXPOSURE_V10.revision)).toBe(
      MCP_EXPOSURE_V10
    );
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V10.revision)
    ).toBe(ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION);
    expect(
      ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS["ops.financials.prepare"]
    ).toBe("Prepare exact draft estimates from authorized past jobs");
    expect(
      ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS["ops.operations.prepare"]
    ).toBe(
      "Prepare recurring-service price-change previews and customer notice drafts"
    );
  });

  it("remints every v15 entry at v16 without changing the v15 bytes", () => {
    const frozenV15 = JSON.stringify(
      RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST
    );
    expect(ESTIMATE_DRAFT_CAPABILITY_MANIFEST).toHaveLength(
      RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST.length + 1
    );
    for (const previous of RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST) {
      const reminted = getEstimateDraftCapabilityManifestEntry(previous.name);
      expect(reminted).not.toBe(previous);
      expect(
        reminted.authorization.variants.every(
          (variant) =>
            variant.policy.capabilityManifestRevision ===
            ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION
        )
      ).toBe(true);
    }
    expect(
      JSON.stringify(RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST)
    ).toBe(frozenV15);
    expect(Object.isFrozen(ESTIMATE_DRAFT_CAPABILITY_MANIFEST)).toBe(true);
  });
});
