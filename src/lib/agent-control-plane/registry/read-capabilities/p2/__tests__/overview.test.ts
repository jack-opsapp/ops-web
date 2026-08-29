import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  GET_OPERATIONAL_OVERVIEW_CANDIDATE,
  OPERATIONAL_OVERVIEW_AUTHORIZATION_VARIANT_KEYS,
  selectedOperationalOverviewVariantKeys,
} from "../overview";

describe("P2 operational-overview candidate", () => {
  it("pins six independent complete authorization ceilings", () => {
    expect(OPERATIONAL_OVERVIEW_AUTHORIZATION_VARIANT_KEYS).toEqual([
      "financial_attention",
      "integration_attention",
      "schedule_readiness",
      "stock_attention",
      "unresolved_correspondence",
      "work_due",
    ]);
    expect(
      GET_OPERATIONAL_OVERVIEW_CANDIDATE.authorization.variants.map(
        (variant) => ({
          key: variant.key,
          scopes: variant.policy.requiredOAuthScopes,
          groups: variant.policy.permissionRequirementGroups,
        })
      )
    ).toEqual([
      {
        key: "financial_attention",
        scopes: [
          "ops.expenses.read",
          "ops.financial_documents.read",
          "ops.operations.read",
          "ops.payments.read",
        ],
        groups: [
          [
            {
              permission: "estimates.view",
              allowedScopes: ["all", "assigned"],
            },
            {
              permission: "expenses.approve",
              allowedScopes: ["all", "assigned"],
            },
            { permission: "expenses.view", allowedScopes: ["all"] },
            { permission: "finances.view", allowedScopes: ["all"] },
            { permission: "invoices.view", allowedScopes: ["all", "assigned"] },
            { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
            { permission: "projects.view", allowedScopes: ["all", "assigned"] },
            { permission: "reports.view", allowedScopes: ["all"] },
          ],
        ],
      },
      {
        key: "integration_attention",
        scopes: ["ops.integrations.read", "ops.operations.read"],
        groups: [
          [
            { permission: "accounting.view", allowedScopes: ["all"] },
            { permission: "email.view", allowedScopes: ["all", "own"] },
            { permission: "reports.view", allowedScopes: ["all"] },
            {
              permission: "settings.integrations",
              allowedScopes: ["all"],
            },
          ],
        ],
      },
      {
        key: "schedule_readiness",
        scopes: ["ops.operations.read", "ops.schedule.read", "ops.tasks.read"],
        groups: [
          [
            { permission: "calendar.view", allowedScopes: ["all", "own"] },
            { permission: "projects.view", allowedScopes: ["all", "assigned"] },
            { permission: "reports.view", allowedScopes: ["all"] },
            { permission: "tasks.view", allowedScopes: ["all", "assigned"] },
          ],
        ],
      },
      {
        key: "stock_attention",
        scopes: [
          "ops.catalog.read",
          "ops.operations.read",
          "ops.purchasing.read",
        ],
        groups: [
          [
            { permission: "catalog.orders.view", allowedScopes: ["all"] },
            { permission: "catalog.products.view", allowedScopes: ["all"] },
            { permission: "catalog.view", allowedScopes: ["all"] },
            { permission: "reports.view", allowedScopes: ["all"] },
          ],
        ],
      },
      {
        key: "unresolved_correspondence",
        scopes: ["ops.correspondence.read", "ops.operations.read"],
        groups: [
          [
            { permission: "email.view", allowedScopes: ["all", "own"] },
            {
              permission: "inbox.view",
              allowedScopes: ["all", "assigned", "own"],
            },
            { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
            { permission: "projects.view", allowedScopes: ["all", "assigned"] },
            { permission: "reports.view", allowedScopes: ["all"] },
          ],
        ],
      },
      {
        key: "work_due",
        scopes: ["ops.jobs.read", "ops.operations.read", "ops.tasks.read"],
        groups: [
          [
            { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
            { permission: "projects.view", allowedScopes: ["all", "assigned"] },
            { permission: "reports.view", allowedScopes: ["all"] },
            { permission: "tasks.view", allowedScopes: ["all", "assigned"] },
          ],
        ],
      },
    ]);
  });

  it("selects omitted defaults and explicit subsets canonically", () => {
    expect(selectedOperationalOverviewVariantKeys({})).toEqual(
      OPERATIONAL_OVERVIEW_AUTHORIZATION_VARIANT_KEYS
    );
    expect(
      selectedOperationalOverviewVariantKeys({
        components: ["work_due", "integration_attention"],
      })
    ).toEqual(["integration_attention", "work_due"]);
  });

  it("stays dark, immutable, read-only, and bounded", () => {
    expect(GET_OPERATIONAL_OVERVIEW_CANDIDATE).toMatchObject({
      name: "get_operational_overview",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      riskTier: "high",
      bounds: {
        maxInputBytes: 4_096,
        maxOutputCharacters: 60_000,
        maxResultItems: 6,
      },
      evidencePolicy: {
        output: "required",
        maxEvidenceRefs: 6,
        promptSafeOutput: true,
        untrustedExternalContent: "structured_and_marked",
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      confirmationPolicy: { kind: "not_required" },
      idempotencyPolicy: { kind: "inherent" },
      availability: { implementation: "available" },
      rolloutFlag: "agent_control_plane.capability.get_operational_overview",
    });
    expect(Object.isFrozen(GET_OPERATIONAL_OVERVIEW_CANDIDATE)).toBe(true);
    expect(
      CAPABILITY_MANIFEST.find(
        (entry) => entry.name === GET_OPERATIONAL_OVERVIEW_CANDIDATE.name
      )
    ).toBe(GET_OPERATIONAL_OVERVIEW_CANDIDATE);
  });
});
