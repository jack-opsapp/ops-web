import { describe, expect, it } from "vitest";

import {
  getRecurringServicePriceChangeCapabilityManifestEntry,
  PAYROLL_READINESS_CAPABILITY_MANIFEST,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
  resolveRecurringServicePriceChangeCapabilityAuthorization,
} from "../capability-manifest";
import {
  ACTIVE_MCP_EXPOSURE_REVISION,
  capabilityManifestRevisionForExposure,
  MCP_EXPOSURE_V8,
  MCP_EXPOSURE_V9,
  resolveMcpExposure,
} from "../mcp-exposure-catalog";

const INPUT = {
  service_selector: "Lawn maintenance",
  increase_percent: "8",
  effective_month: "2026-11",
} as const;

describe("recurring-service price-change dormant capability", () => {
  it("adds one high-risk prepare capability with no commit or send twin", () => {
    const entry = getRecurringServicePriceChangeCapabilityManifestEntry(
      "prepare_recurring_service_price_change"
    );
    expect(entry).toMatchObject({
      schemaRevision: "2026-09-01.v1",
      operation: "prepare",
      writeFamily: "recurring_service_price_change",
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
      RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST.some((candidate) =>
        /^(commit|send|change|apply)_recurring_service_price/.test(
          candidate.name
        )
      )
    ).toBe(false);
  });

  it("owns the exact eight-scope and eight-permission authorization policy", () => {
    const resolved = resolveRecurringServicePriceChangeCapabilityAuthorization(
      "prepare_recurring_service_price_change",
      INPUT
    );
    expect(resolved.parsedInput).toEqual(INPUT);
    expect(resolved.variants).toHaveLength(1);
    expect(resolved.variants[0]!.policy).toMatchObject({
      capabilityManifestRevision:
        RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
      requiredOAuthScopes: [
        "ops.catalog.read",
        "ops.company.read",
        "ops.correspondence.read",
        "ops.customer_contacts.read",
        "ops.customers.read",
        "ops.financial_documents.read",
        "ops.operations.prepare",
        "ops.schedule.read",
      ],
      permissionRequirementGroups: [
        [
          { permission: "calendar.view", allowedScopes: ["all"] },
          { permission: "catalog.products.view", allowedScopes: ["all"] },
          { permission: "catalog.view", allowedScopes: ["all"] },
          { permission: "clients.view", allowedScopes: ["all"] },
          { permission: "email.view", allowedScopes: ["all"] },
          { permission: "estimates.view", allowedScopes: ["all"] },
          { permission: "invoices.view", allowedScopes: ["all"] },
          { permission: "settings.company", allowedScopes: ["all"] },
        ],
      ],
    });
  });

  it("makes v9 additive to v8 while the historical v2 catalogue stays immutable", () => {
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe("2026-09-04.mcp-exposure.v14");
    expect(MCP_EXPOSURE_V9.toolIds).toEqual([
      ...MCP_EXPOSURE_V8.toolIds,
      "prepare_recurring_service_price_change",
    ]);
    expect(MCP_EXPOSURE_V9.grantableScopes).toEqual([
      "ops.catalog.read",
      "ops.company.read",
      "ops.correspondence.read",
      "ops.customer_contacts.read",
      "ops.customers.read",
      "ops.expenses.read",
      "ops.financial_documents.read",
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
    expect(resolveMcpExposure(MCP_EXPOSURE_V9.revision)).toBe(MCP_EXPOSURE_V9);
    expect(
      capabilityManifestRevisionForExposure(MCP_EXPOSURE_V9.revision)
    ).toBe(RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION);
  });

  it("remints every v14 entry at v15 without changing the v14 bytes", () => {
    expect(RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST).toHaveLength(
      PAYROLL_READINESS_CAPABILITY_MANIFEST.length + 1
    );
    for (const previous of PAYROLL_READINESS_CAPABILITY_MANIFEST) {
      const reminted = getRecurringServicePriceChangeCapabilityManifestEntry(
        previous.name
      );
      expect(reminted).not.toBe(previous);
      expect(
        reminted.authorization.variants.every(
          (variant) =>
            variant.policy.capabilityManifestRevision ===
            RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
        )
      ).toBe(true);
    }
    expect(
      Object.isFrozen(RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST)
    ).toBe(true);
  });
});
