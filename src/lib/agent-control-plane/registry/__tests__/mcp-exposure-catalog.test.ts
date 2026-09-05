import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "vitest";

import { DOMAIN_METHOD_BY_CAPABILITY } from "@/lib/agent-control-plane/mcp/domain-dispatch";
import {
  SCOPE_CONSENT_LABELS,
  SUPPORTED_READ_SCOPES,
} from "@/lib/agent-control-plane/mcp/oauth/scopes";
import {
  CAPABILITY_MANIFEST,
  COLLECTIONS_CAPABILITY_MANIFEST,
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST,
  getCapabilityManifestEntry,
  getInvisibleOfficeCapabilityManifestEntry,
  getPayrollReadinessCapabilityManifestEntry,
  getRecurringServicePriceChangeCapabilityManifestEntry,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST,
  getPromiseRecoveryCapabilityManifestEntry,
  getSalesTruthCapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  MCP_EXPOSURE_CATALOG,
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V2,
  MCP_EXPOSURE_V3,
  MCP_EXPOSURE_V4,
  MCP_EXPOSURE_V5,
  MCP_EXPOSURE_V6,
  MCP_EXPOSURE_V7,
  MCP_EXPOSURE_V8,
  MCP_EXPOSURE_V9,
  MCP_EXPOSURE_V10,
  MCP_EXPOSURE_V11,
  MCP_EXPOSURE_V12,
  MCP_EXPOSURE_V13,
  MCP_EXPOSURE_V14,
  assertMcpExposureInvariants,
  resolveActiveMcpExposure,
  resolveMcpExposureRevision,
  type McpExposure,
  type McpExposureInvariantInput,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  MCP_SCOPE_CONSENT_LABELS,
  COLLECTIONS_MCP_SCOPE_CONSENT_LABELS,
  INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_OPERATION_BY_ID,
  REGISTERED_MCP_SCOPES,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

const EXPECTED_EXPOSURE_V1 = {
  revision: "2026-08-22.mcp-exposure.v1",
  toolIds: [
    "list_scheduled_jobs",
    "list_job_readiness_issues",
    "get_job_communication_context",
    "get_job_conversation_context",
    "list_customer_jobs",
    "get_job_summary",
    "search_job_history",
    "get_correspondence_evidence",
    "search_customers",
    "search_jobs",
    "resolve_job_participants",
  ],
  grantableScopes: [
    "ops.jobs.read",
    "ops.schedule.read",
    "ops.customers.read",
    "ops.customer_contacts.read",
    "ops.photos.read",
    "ops.correspondence.read",
    "ops.financials.read",
  ],
} as const;

const EXPECTED_EXPOSURE_V2 = {
  revision: "2026-08-29.mcp-exposure.v2",
  toolIds: [
    "list_scheduled_jobs",
    "list_job_readiness_issues",
    "get_job_communication_context",
    "get_job_conversation_context",
    "list_customer_jobs",
    "get_job_summary",
    "search_job_history",
    "get_correspondence_evidence",
    "search_customers",
    "search_jobs",
    "resolve_job_participants",
    "get_customer_context",
    "list_tasks",
    "get_task_context",
    "list_job_artifacts",
    "get_job_artifact_evidence",
    "list_site_visits",
    "get_site_visit_context",
    "get_deck_design_geometry",
    "list_sales_documents",
    "get_sales_document",
    "list_payments",
    "list_expenses",
    "get_expense_context",
    "list_work_queue",
    "search_catalog_items",
    "get_catalog_item",
    "list_purchase_orders",
    "get_purchase_order",
    "get_company_context",
    "list_team_members",
    "list_team_availability",
    "get_integration_health",
    "get_operational_overview",
  ],
  grantableScopes: [
    "ops.jobs.read",
    "ops.schedule.read",
    "ops.customers.read",
    "ops.customer_contacts.read",
    "ops.photos.read",
    "ops.correspondence.read",
    "ops.financials.read",
    "ops.tasks.read",
    "ops.site_visits.read",
    "ops.files.read",
    "ops.financial_documents.read",
    "ops.payments.read",
    "ops.expenses.read",
    "ops.catalog.read",
    "ops.purchasing.read",
    "ops.catalog_costs.read",
    "ops.company.read",
    "ops.team.read",
    "ops.integrations.read",
    "ops.operations.read",
  ],
} as const;

const EXPECTED_EXPOSURE_V3 = {
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
} as const;

const EXPECTED_EXPOSURE_V5 = {
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
} as const;

const EXPECTED_EXPOSURE_V6 = {
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
} as const;

const EXPECTED_EXPOSURE_V7 = {
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
} as const;

const EXPECTED_EXPOSURE_V8 = {
  revision: "2026-09-01.mcp-exposure.v8",
  toolIds: [
    "analyze_hiring_break_even",
    "check_customer_reply",
    "analyze_sales_truth",
    "check_payroll_readiness",
  ],
  grantableScopes: EXPECTED_EXPOSURE_V7.grantableScopes,
} as const;

const EXPECTED_EXPOSURE_V9 = {
  revision: "2026-09-01.mcp-exposure.v9",
  toolIds: [
    ...EXPECTED_EXPOSURE_V8.toolIds,
    "prepare_recurring_service_price_change",
  ],
  grantableScopes: [
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
  ],
} as const;

type MutableInvariantInput = {
  exposure: {
    revision: string;
    toolIds: string[];
    grantableScopes: string[];
  };
  manifestEntries: McpExposureInvariantInput["manifestEntries"];
  domainMethods: Record<string, string>;
  registeredScopes: string[];
  scopeOperations: Record<string, string>;
  consentLabels: Record<string, string>;
};

function invariantInput(): MutableInvariantInput {
  return {
    exposure: {
      revision: MCP_EXPOSURE_V1.revision,
      toolIds: [...MCP_EXPOSURE_V1.toolIds],
      grantableScopes: [...MCP_EXPOSURE_V1.grantableScopes],
    },
    manifestEntries: CAPABILITY_MANIFEST,
    domainMethods: {
      ...DOMAIN_METHOD_BY_CAPABILITY,
    } as Record<string, string>,
    registeredScopes: [...REGISTERED_MCP_SCOPES],
    scopeOperations: { ...MCP_SCOPE_OPERATION_BY_ID },
    consentLabels: { ...MCP_SCOPE_CONSENT_LABELS } as Record<string, string>,
  };
}

describe("immutable MCP exposure catalogue", () => {
  it("pins the exact v1 bytes, order, and digest independently", () => {
    expect(MCP_EXPOSURE_V1).toEqual(EXPECTED_EXPOSURE_V1);
    const serialized = JSON.stringify(MCP_EXPOSURE_V1);
    expect(new TextEncoder().encode(serialized)).toHaveLength(488);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "d45d11434ed1ecced446b9a92ed47c0416451420f5a03c115fec869297a6aa2f"
    );
  });

  it("pins the exact v2 bytes, order, and digest independently", () => {
    expect(MCP_EXPOSURE_V2).toEqual(EXPECTED_EXPOSURE_V2);
    const serialized = JSON.stringify(MCP_EXPOSURE_V2);
    expect(new TextEncoder().encode(serialized)).toHaveLength(1_259);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "a94f0429f65bf8ff01cb52868b1ae59a2bea760a442b05a39b8b17c011e9201d"
    );
  });

  it("keeps every revision deeply frozen while referentially reusing active v14", () => {
    const first = resolveActiveMcpExposure();
    const second = resolveActiveMcpExposure();

    expectTypeOf(resolveActiveMcpExposure).toEqualTypeOf<() => McpExposure>();
    expect(first).toBe(MCP_EXPOSURE_V14);
    expect(second).toBe(first);
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V1.revision]).toBe(
      MCP_EXPOSURE_V1
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V2.revision]).toBe(
      MCP_EXPOSURE_V2
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V3.revision]).toBe(
      MCP_EXPOSURE_V3
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V4.revision]).toBe(
      MCP_EXPOSURE_V4
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V5.revision]).toBe(
      MCP_EXPOSURE_V5
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V6.revision]).toBe(
      MCP_EXPOSURE_V6
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V7.revision]).toBe(
      MCP_EXPOSURE_V7
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V8.revision]).toBe(
      MCP_EXPOSURE_V8
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V9.revision]).toBe(
      MCP_EXPOSURE_V9
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V10.revision]).toBe(
      MCP_EXPOSURE_V10
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V11.revision]).toBe(
      MCP_EXPOSURE_V11
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V12.revision]).toBe(
      MCP_EXPOSURE_V12
    );
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V13.revision]).toBe(
      MCP_EXPOSURE_V13
    );
    expect(Object.keys(MCP_EXPOSURE_CATALOG)).toEqual([
      MCP_EXPOSURE_V1.revision,
      MCP_EXPOSURE_V2.revision,
      MCP_EXPOSURE_V3.revision,
      MCP_EXPOSURE_V4.revision,
      MCP_EXPOSURE_V5.revision,
      MCP_EXPOSURE_V6.revision,
      MCP_EXPOSURE_V7.revision,
      MCP_EXPOSURE_V8.revision,
      MCP_EXPOSURE_V9.revision,
      MCP_EXPOSURE_V10.revision,
      MCP_EXPOSURE_V11.revision,
      MCP_EXPOSURE_V12.revision,
      MCP_EXPOSURE_V13.revision,
      MCP_EXPOSURE_V14.revision,
    ]);
    for (const exposure of [
      MCP_EXPOSURE_V1,
      MCP_EXPOSURE_V2,
      MCP_EXPOSURE_V3,
      MCP_EXPOSURE_V4,
      MCP_EXPOSURE_V5,
      MCP_EXPOSURE_V6,
      MCP_EXPOSURE_V7,
      MCP_EXPOSURE_V8,
      MCP_EXPOSURE_V9,
      MCP_EXPOSURE_V10,
      MCP_EXPOSURE_V11,
      MCP_EXPOSURE_V12,
      MCP_EXPOSURE_V13,
      MCP_EXPOSURE_V14,
    ]) {
      expect(Object.isFrozen(exposure)).toBe(true);
      expect(Object.isFrozen(exposure.toolIds)).toBe(true);
      expect(Object.isFrozen(exposure.grantableScopes)).toBe(true);
    }
  });

  it("keeps v5-v8 stable while adding one inactive ephemeral preview in v9", () => {
    expect(MCP_EXPOSURE_V5).toEqual(EXPECTED_EXPOSURE_V5);
    expect(MCP_EXPOSURE_V6).toEqual(EXPECTED_EXPOSURE_V6);
    expect(MCP_EXPOSURE_V7).toEqual(EXPECTED_EXPOSURE_V7);
    expect(MCP_EXPOSURE_V8).toEqual(EXPECTED_EXPOSURE_V8);
    expect(MCP_EXPOSURE_V9).toEqual(EXPECTED_EXPOSURE_V9);
    expect(
      resolveMcpExposureRevision(MCP_EXPOSURE_CATALOG, MCP_EXPOSURE_V6.revision)
    ).toBe(MCP_EXPOSURE_V6);
    expect(resolveActiveMcpExposure()).toBe(MCP_EXPOSURE_V14);
    const entry = getPromiseRecoveryCapabilityManifestEntry(
      "check_customer_reply"
    );
    expect(entry.operation).toBe("read");
    expect(entry.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const salesEntry = getSalesTruthCapabilityManifestEntry(
      "analyze_sales_truth"
    );
    expect(salesEntry.operation).toBe("read");
    expect(salesEntry.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const payrollEntry = getPayrollReadinessCapabilityManifestEntry(
      "check_payroll_readiness"
    );
    expect(payrollEntry.operation).toBe("read");
    expect(payrollEntry.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const priceEntry = getRecurringServicePriceChangeCapabilityManifestEntry(
      "prepare_recurring_service_price_change"
    );
    expect(priceEntry.operation).toBe("prepare");
    expect(priceEntry.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(() =>
      assertMcpExposureInvariants({
        exposure: MCP_EXPOSURE_V9,
        manifestEntries: RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST,
        domainMethods: DOMAIN_METHOD_BY_CAPABILITY,
        registeredScopes: REGISTERED_MCP_SCOPES,
        scopeOperations: MCP_SCOPE_OPERATION_BY_ID,
        consentLabels: PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS,
        allowedOperations: ["read", "prepare"],
      })
    ).not.toThrow();
  });

  it("pins inactive v3 to the single prepare-only closeout vertical", () => {
    expect(MCP_EXPOSURE_V3).toEqual(EXPECTED_EXPOSURE_V3);
    expect(resolveActiveMcpExposure()).toBe(MCP_EXPOSURE_V14);
    const entry = getInvisibleOfficeCapabilityManifestEntry(
      "prepare_day_closeout"
    );
    expect(entry.operation).toBe("prepare");
    expect(entry.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(() =>
      assertMcpExposureInvariants({
        exposure: MCP_EXPOSURE_V3,
        manifestEntries: INVISIBLE_OFFICE_CAPABILITY_MANIFEST,
        domainMethods: DOMAIN_METHOD_BY_CAPABILITY,
        registeredScopes: REGISTERED_MCP_SCOPES,
        scopeOperations: MCP_SCOPE_OPERATION_BY_ID,
        consentLabels: INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
        allowedOperations: ["read", "prepare"],
      })
    ).not.toThrow();
  });

  it("pins collections prepare consent to its exact customer-draft label", () => {
    expect(() =>
      assertMcpExposureInvariants({
        exposure: MCP_EXPOSURE_V4,
        manifestEntries: COLLECTIONS_CAPABILITY_MANIFEST,
        domainMethods: DOMAIN_METHOD_BY_CAPABILITY,
        registeredScopes: REGISTERED_MCP_SCOPES,
        scopeOperations: MCP_SCOPE_OPERATION_BY_ID,
        consentLabels: COLLECTIONS_MCP_SCOPE_CONSENT_LABELS,
        allowedOperations: ["read", "prepare"],
      })
    ).not.toThrow();
    expect(COLLECTIONS_MCP_SCOPE_CONSENT_LABELS["ops.operations.prepare"]).toBe(
      "Prepare collections aging and customer drafts for approval"
    );
  });

  it("makes OAuth compatibility views use the v1 scope array and only its neutral labels", () => {
    expect(SUPPORTED_READ_SCOPES).toBe(MCP_EXPOSURE_V1.grantableScopes);
    expect(Object.keys(SCOPE_CONSENT_LABELS)).toEqual(
      MCP_EXPOSURE_V1.grantableScopes
    );
    for (const scope of MCP_EXPOSURE_V1.grantableScopes) {
      expect(SCOPE_CONSENT_LABELS[scope]).toBe(MCP_SCOPE_CONSENT_LABELS[scope]);
    }
  });

  it("resolves every tool to one implemented read, label, required scope, and static method", () => {
    const input = invariantInput();
    input.exposure = {
      revision: MCP_EXPOSURE_V2.revision,
      toolIds: [...MCP_EXPOSURE_V2.toolIds],
      grantableScopes: [...MCP_EXPOSURE_V2.grantableScopes],
    };
    expect(() => assertMcpExposureInvariants(input)).not.toThrow();
    for (const toolId of MCP_EXPOSURE_V2.toolIds) {
      const entry = getCapabilityManifestEntry(toolId);
      expect(entry.operation).toBe("read");
      expect(entry.availability.implementation).toBe("available");
      expect(entry.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(DOMAIN_METHOD_BY_CAPABILITY).toHaveProperty(toolId);
    }
    for (const scope of MCP_EXPOSURE_V2.grantableScopes) {
      expect(MCP_SCOPE_CONSENT_LABELS).toHaveProperty(scope);
      expect(MCP_SCOPE_OPERATION_BY_ID[scope]).toBe("read");
    }
  });

  it.each([
    {
      name: "a duplicate tool ID",
      mutate(input: MutableInvariantInput) {
        input.exposure.toolIds = [
          ...input.exposure.toolIds,
          input.exposure.toolIds[0]!,
        ];
      },
    },
    {
      name: "a duplicate grantable scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = [
          ...input.exposure.grantableScopes,
          input.exposure.grantableScopes[0]!,
        ];
      },
    },
    {
      name: "a write capability",
      mutate(input: MutableInvariantInput) {
        input.exposure.toolIds = [
          "prepare_estimate_import",
          ...input.exposure.toolIds.slice(1),
        ];
      },
    },
    {
      name: "an unavailable read",
      mutate(input: MutableInvariantInput) {
        const [first, ...remaining] = input.manifestEntries;
        input.manifestEntries = [
          {
            ...first!,
            availability: { implementation: "unavailable" },
          },
          ...remaining,
        ];
      },
    },
    {
      name: "a missing domain method",
      mutate(input: MutableInvariantInput) {
        const { list_scheduled_jobs: _missing, ...remaining } =
          input.domainMethods;
        input.domainMethods = remaining;
      },
    },
    {
      name: "a missing required scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = input.exposure.grantableScopes.filter(
          (scope) => scope !== "ops.financials.read"
        );
      },
    },
    {
      name: "an unregistered scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = [
          ...input.exposure.grantableScopes,
          "ops.unregistered.read",
        ];
        input.consentLabels = {
          ...input.consentLabels,
          "ops.unregistered.read": "See unregistered data",
        };
      },
    },
    {
      name: "a scope without a consent label",
      mutate(input: MutableInvariantInput) {
        const { "ops.jobs.read": _missing, ...remaining } = input.consentLabels;
        input.consentLabels = remaining;
      },
    },
    {
      name: "a labelled but unused scope",
      mutate(input: MutableInvariantInput) {
        input.exposure.grantableScopes = [
          ...input.exposure.grantableScopes,
          "ops.catalog.read",
        ];
        input.consentLabels = {
          ...input.consentLabels,
          "ops.catalog.read": "See catalogue data",
        };
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const input = invariantInput();
    mutate(input);
    expect(() => assertMcpExposureInvariants(input)).toThrow(TypeError);
  });

  it("rejects a read tool that requires a registered write scope", () => {
    const input = invariantInput();
    const [first, ...remaining] = input.manifestEntries;
    const [variant, ...otherVariants] = first!.authorization.variants;
    input.manifestEntries = [
      {
        ...first!,
        authorization: {
          variants: [
            {
              ...variant!,
              policy: {
                ...variant!.policy,
                requiredOAuthScopes: [
                  ...variant!.policy.requiredOAuthScopes,
                  "ops.jobs.write",
                ],
              },
            },
            ...otherVariants,
          ],
        },
      },
      ...remaining,
    ];
    input.exposure.grantableScopes.push("ops.jobs.write");
    input.consentLabels["ops.jobs.write"] = "Modify jobs";

    expect(() => assertMcpExposureInvariants(input)).toThrow(
      "MCP exposure requires a non-read scope"
    );
  });

  it("rejects a registered prepare scope even when it is only grantable", () => {
    const input = invariantInput();
    input.exposure.grantableScopes.push("ops.jobs.prepare");
    input.consentLabels["ops.jobs.prepare"] = "Prepare job changes";

    expect(() => assertMcpExposureInvariants(input)).toThrow(
      "MCP exposure grants a non-read scope"
    );
  });

  it("rejects unknown revisions through the pure catalogue seam without disclosing entries", () => {
    expect(() =>
      resolveMcpExposureRevision(MCP_EXPOSURE_CATALOG, "unknown")
    ).toThrow("Unknown MCP exposure revision");
  });
});
