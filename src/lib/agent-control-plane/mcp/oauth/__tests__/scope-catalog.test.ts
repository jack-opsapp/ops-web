import { describe, expect, it } from "vitest";

import {
  ACTIVE_MCP_CONSENT_CATALOG_REVISION,
  MCP_CONSENT_CATALOG_V1,
  MCP_CONSENT_CATALOG_V2,
  MCP_CONSENT_CATALOG_V3,
  MCP_CONSENT_CATALOG_V4,
  consentSnapshotForExposure,
  resolveActiveMcpConsentCatalog,
  resolveMcpConsentCatalogRevision,
} from "@/lib/agent-control-plane/mcp/oauth/scope-catalog";
import {
  MCP_EXPOSURE_V1,
  MCP_EXPOSURE_V3,
  MCP_EXPOSURE_V4,
  MCP_EXPOSURE_V9,
  type McpExposure,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  MCP_SCOPE_CONSENT_LABELS,
  COLLECTIONS_MCP_SCOPE_CONSENT_LABELS,
  INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_OPERATION_BY_ID,
  PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS,
  REGISTERED_MCP_SCOPES,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

const EXISTING_SCOPE_VOCABULARY = [
  "ops.catalog.prepare",
  "ops.catalog.read",
  "ops.catalog.write",
  "ops.communications.prepare",
  "ops.communications.send",
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.financials.prepare",
  "ops.financials.read",
  "ops.financials.write",
  "ops.jobs.prepare",
  "ops.jobs.read",
  "ops.jobs.write",
  "ops.photos.read",
  "ops.schedule.prepare",
  "ops.schedule.read",
  "ops.schedule.write",
] as const;

const APPROVED_SCOPE_LABEL_ADDITIONS = {
  "ops.tasks.read": "See tasks and work that needs attention",
  "ops.site_visits.read": "See site visits and their evidence status",
  "ops.files.read": "See authorized job photos, files, and documents",
  "ops.financial_documents.read": "See estimates and invoices in detail",
  "ops.payments.read": "See payment records on authorized invoices",
  "ops.expenses.read": "See authorized expenses and reimbursements",
  "ops.catalog.read": "See products, stock levels, and selling prices",
  "ops.purchasing.read": "See purchase orders",
  "ops.catalog_costs.read": "See authorized supplier cost facts",
  "ops.company.read": "See the company operating profile",
  "ops.team.read": "See the team directory and company availability",
  "ops.integrations.read": "See integration health without credentials",
  "ops.operations.read": "See authorized work queues and operational summaries",
} as const;

const EXPECTED_REGISTERED_SCOPES = [
  "ops.catalog.prepare",
  "ops.catalog.read",
  "ops.catalog.write",
  "ops.catalog_costs.read",
  "ops.communications.prepare",
  "ops.communications.send",
  "ops.company.read",
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.expenses.read",
  "ops.files.read",
  "ops.financial_documents.read",
  "ops.financials.prepare",
  "ops.financials.read",
  "ops.financials.write",
  "ops.integrations.read",
  "ops.jobs.prepare",
  "ops.jobs.read",
  "ops.jobs.write",
  "ops.operations.read",
  "ops.operations.prepare",
  "ops.payments.read",
  "ops.photos.read",
  "ops.purchasing.read",
  "ops.schedule.prepare",
  "ops.schedule.read",
  "ops.schedule.write",
  "ops.site_visits.read",
  "ops.tasks.read",
  "ops.team.read",
] as const;

const EXISTING_READ_LABELS = {
  "ops.jobs.read": "See your jobs and their status",
  "ops.schedule.read": "See your schedule and who's assigned",
  "ops.customers.read": "See your clients and their jobs",
  "ops.customer_contacts.read":
    "See who to contact on a job and how to reach them",
  "ops.photos.read": "See which jobs are missing photos",
  "ops.correspondence.read": "See client email history on your jobs",
  "ops.financials.read": "See estimate and invoice summaries on your jobs",
} as const;

describe("registered MCP scope vocabulary", () => {
  it("pins the reviewed 31-scope union while preserving all 18 existing scope IDs", () => {
    expect([...REGISTERED_MCP_SCOPES]).toEqual(EXPECTED_REGISTERED_SCOPES);
    expect(REGISTERED_MCP_SCOPES).toHaveLength(31);
    expect(
      EXISTING_SCOPE_VOCABULARY.every((scope) =>
        REGISTERED_MCP_SCOPES.includes(scope)
      )
    ).toBe(true);
    expect(Object.isFrozen(REGISTERED_MCP_SCOPES)).toBe(true);
  });

  it("pins the intentional 13-label/12-new-ID overlap at ops.catalog.read", () => {
    const previous = new Set<string>(EXISTING_SCOPE_VOCABULARY);
    const approvedIds = Object.keys(APPROVED_SCOPE_LABEL_ADDITIONS);
    const newlyRegistered = approvedIds.filter((scope) => !previous.has(scope));

    expect(approvedIds).toHaveLength(13);
    expect(newlyRegistered).toHaveLength(12);
    expect(approvedIds.filter((scope) => previous.has(scope))).toEqual([
      "ops.catalog.read",
    ]);
  });

  it("assigns the exact operation to every registered scope", () => {
    expect(Object.keys(MCP_SCOPE_OPERATION_BY_ID)).toEqual(
      EXPECTED_REGISTERED_SCOPES
    );
    for (const scope of EXPECTED_REGISTERED_SCOPES) {
      expect(MCP_SCOPE_OPERATION_BY_ID[scope]).toBe(scope.split(".").at(-1));
    }
  });
});

describe("versioned MCP consent catalogue", () => {
  it("preserves the seven existing labels byte-for-byte and adds the thirteen approved labels", () => {
    expect(MCP_SCOPE_CONSENT_LABELS).toEqual({
      ...EXISTING_READ_LABELS,
      ...APPROVED_SCOPE_LABEL_ADDITIONS,
    });
    expect(Object.keys(MCP_SCOPE_CONSENT_LABELS)).toHaveLength(20);
    expect(Object.isFrozen(MCP_SCOPE_CONSENT_LABELS)).toBe(true);
  });

  it("resolves one immutable active catalogue revision backed by the neutral vocabulary", () => {
    expect(ACTIVE_MCP_CONSENT_CATALOG_REVISION).toBe(
      "2026-08-22.mcp-consent-catalog.v1"
    );
    expect(resolveActiveMcpConsentCatalog()).toBe(MCP_CONSENT_CATALOG_V1);
    expect(
      resolveMcpConsentCatalogRevision(ACTIVE_MCP_CONSENT_CATALOG_REVISION)
    ).toBe(MCP_CONSENT_CATALOG_V1);
    expect(MCP_CONSENT_CATALOG_V1.registeredScopes).toBe(REGISTERED_MCP_SCOPES);
    expect(MCP_CONSENT_CATALOG_V1.operations).toBe(MCP_SCOPE_OPERATION_BY_ID);
    expect(MCP_CONSENT_CATALOG_V1.consentLabels).toBe(MCP_SCOPE_CONSENT_LABELS);
    expect(Object.isFrozen(MCP_CONSENT_CATALOG_V1)).toBe(true);
    expect(
      resolveMcpConsentCatalogRevision(MCP_CONSENT_CATALOG_V2.revision)
    ).toBe(MCP_CONSENT_CATALOG_V2);
    expect(resolveActiveMcpConsentCatalog()).not.toBe(MCP_CONSENT_CATALOG_V2);
    expect(MCP_CONSENT_CATALOG_V2.consentLabels).toBe(
      INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS
    );
    expect(MCP_CONSENT_CATALOG_V2.allowedOperations).toEqual([
      "read",
      "prepare",
    ]);
    expect(
      resolveMcpConsentCatalogRevision(MCP_CONSENT_CATALOG_V3.revision)
    ).toBe(MCP_CONSENT_CATALOG_V3);
    expect(MCP_CONSENT_CATALOG_V3.consentLabels).toBe(
      COLLECTIONS_MCP_SCOPE_CONSENT_LABELS
    );
    expect(resolveActiveMcpConsentCatalog()).not.toBe(MCP_CONSENT_CATALOG_V3);
    expect(
      resolveMcpConsentCatalogRevision(MCP_CONSENT_CATALOG_V4.revision)
    ).toBe(MCP_CONSENT_CATALOG_V4);
    expect(MCP_CONSENT_CATALOG_V4.consentLabels).toBe(
      PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS
    );
  });

  it("binds dormant exposure v9 to an exact price-preview consent snapshot", () => {
    expect(() =>
      consentSnapshotForExposure(MCP_EXPOSURE_V9, MCP_CONSENT_CATALOG_V2)
    ).toThrow("MCP exposure consent catalogue mismatch");
    const snapshot = consentSnapshotForExposure(
      MCP_EXPOSURE_V9,
      MCP_CONSENT_CATALOG_V4
    );
    expect(snapshot).toMatchObject({
      consentCatalogRevision: "2026-09-01.mcp-consent-catalog.v4",
      exposureRevision: MCP_EXPOSURE_V9.revision,
      scopeCeiling: MCP_EXPOSURE_V9.grantableScopes,
    });
    expect(snapshot.acceptedLabels).toContain(
      "Prepare recurring-service price-change previews and customer notice drafts"
    );
  });

  it("binds collections exposure v4 to an exact customer-draft consent label", () => {
    expect(() =>
      consentSnapshotForExposure(MCP_EXPOSURE_V4, MCP_CONSENT_CATALOG_V2)
    ).toThrow("MCP exposure consent catalogue mismatch");
    const snapshot = consentSnapshotForExposure(
      MCP_EXPOSURE_V4,
      MCP_CONSENT_CATALOG_V3
    );
    expect(snapshot).toMatchObject({
      consentCatalogRevision: "2026-08-31.mcp-consent-catalog.v3",
      exposureRevision: MCP_EXPOSURE_V4.revision,
    });
    expect(snapshot.acceptedLabels).toContain(
      "Prepare collections aging and customer drafts for approval"
    );
  });

  it("makes the inactive v3 prepare scope consentable only through catalogue v2", () => {
    expect(() =>
      consentSnapshotForExposure(MCP_EXPOSURE_V3, MCP_CONSENT_CATALOG_V1)
    ).toThrow("MCP exposure consent catalogue mismatch");
    expect(
      consentSnapshotForExposure(MCP_EXPOSURE_V3, MCP_CONSENT_CATALOG_V2)
    ).toMatchObject({
      consentCatalogRevision: "2026-08-30.mcp-consent-catalog.v2",
      exposureRevision: MCP_EXPOSURE_V3.revision,
      scopeCeiling: MCP_EXPOSURE_V3.grantableScopes,
    });
  });

  it("keeps every newly registered read and every non-read scope dark under exposure v1", () => {
    const grantable = new Set<string>(MCP_EXPOSURE_V1.grantableScopes);
    const newlyRegisteredReadScopes = (
      Object.keys(APPROVED_SCOPE_LABEL_ADDITIONS) as Array<
        keyof typeof APPROVED_SCOPE_LABEL_ADDITIONS
      >
    ).filter((scope) => scope !== "ops.catalog.read");

    expect(newlyRegisteredReadScopes).toHaveLength(12);
    for (const scope of newlyRegisteredReadScopes) {
      expect(grantable.has(scope)).toBe(false);
      expect(MCP_SCOPE_OPERATION_BY_ID[scope]).toBe("read");
    }
    expect(grantable.has("ops.catalog.read")).toBe(false);
    for (const scope of REGISTERED_MCP_SCOPES) {
      if (MCP_SCOPE_OPERATION_BY_ID[scope] !== "read") {
        expect(grantable.has(scope)).toBe(false);
      }
    }
  });

  it("takes the exact injected exposure as the ceiling and accepted-label source", () => {
    const syntheticExposure: McpExposure = Object.freeze({
      revision: "test.mcp-exposure.v2",
      toolIds: Object.freeze(["synthetic_read"]),
      grantableScopes: Object.freeze(["ops.tasks.read", "ops.catalog.read"]),
    });

    expect(
      consentSnapshotForExposure(
        syntheticExposure,
        resolveActiveMcpConsentCatalog()
      )
    ).toEqual({
      consentCatalogRevision: "2026-08-22.mcp-consent-catalog.v1",
      exposureRevision: "test.mcp-exposure.v2",
      scopeCeiling: ["ops.tasks.read", "ops.catalog.read"],
      acceptedLabels: [
        "See tasks and work that needs attention",
        "See products, stock levels, and selling prices",
      ],
    });

    expect(
      consentSnapshotForExposure(
        MCP_EXPOSURE_V1,
        resolveActiveMcpConsentCatalog()
      ).scopeCeiling
    ).toBe(MCP_EXPOSURE_V1.grantableScopes);
  });

  it("fails closed for unknown revisions or exposure scopes without read labels", () => {
    expect(() =>
      resolveMcpConsentCatalogRevision("unknown-consent-revision")
    ).toThrow(TypeError);
    expect(() =>
      consentSnapshotForExposure(
        {
          revision: "test.invalid",
          toolIds: ["invalid"],
          grantableScopes: ["ops.jobs.write"],
        },
        resolveActiveMcpConsentCatalog()
      )
    ).toThrow(TypeError);
  });
});
