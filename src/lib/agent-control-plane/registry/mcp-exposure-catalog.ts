import {
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST,
  CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION,
} from "./capability-manifest";
import { CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS } from "./mcp-scope-catalog";
import "server-only";

import {
  DOMAIN_METHOD_BY_CAPABILITY,
  type McpDomainCapabilityId,
} from "@/lib/agent-control-plane/mcp/domain-dispatch";
import {
  MCP_SCOPE_CONSENT_LABELS,
  COLLECTIONS_MCP_SCOPE_CONSENT_LABELS,
  INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS,
  ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS,
  WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS,
  CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS,
  DISPATCH_CONFIRMATION_TASK_MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_OPERATION_BY_ID,
  REGISTERED_MCP_SCOPES,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";
import type { CapabilityManifestEntry } from "@/lib/agent-control-plane/registry/capability-types";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
  COLLECTIONS_CAPABILITY_MANIFEST,
  COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
  HIRING_WHAT_IF_CAPABILITY_MANIFEST,
  HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION,
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST,
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION,
  PROMISE_RECOVERY_CAPABILITY_MANIFEST,
  PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION,
  SALES_TRUTH_CAPABILITY_MANIFEST,
  SALES_TRUTH_CAPABILITY_MANIFEST_REVISION,
  PAYROLL_READINESS_CAPABILITY_MANIFEST,
  PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST,
  RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION,
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST,
  ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION,
  WEATHER_RESCHEDULE_CAPABILITY_MANIFEST,
  WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
  CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST,
  CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
  DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST,
  DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";

export interface McpExposure {
  readonly revision: string;
  readonly toolIds: readonly string[];
  readonly grantableScopes: readonly string[];
}

export interface McpExposureInvariantInput {
  readonly exposure: McpExposure;
  readonly manifestEntries: readonly CapabilityManifestEntry[];
  readonly domainMethods: Readonly<Record<string, string>>;
  readonly registeredScopes: readonly string[];
  readonly scopeOperations: Readonly<Record<string, string>>;
  readonly consentLabels: Readonly<Record<string, string>>;
  readonly allowedOperations?: readonly ("read" | "prepare")[];
}

export const MCP_EXPOSURE_V1 = Object.freeze({
  revision: "2026-08-22.mcp-exposure.v1",
  toolIds: Object.freeze([
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
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
    "ops.jobs.read",
    "ops.schedule.read",
    "ops.customers.read",
    "ops.customer_contacts.read",
    "ops.photos.read",
    "ops.correspondence.read",
    "ops.financials.read",
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V2 = Object.freeze({
  revision: "2026-08-29.mcp-exposure.v2",
  toolIds: Object.freeze([
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
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
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
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V3 = Object.freeze({
  revision: "2026-08-30.mcp-exposure.v3",
  toolIds: Object.freeze(["prepare_day_closeout"] as const),
  grantableScopes: Object.freeze([
    "ops.correspondence.read",
    "ops.financial_documents.read",
    "ops.jobs.read",
    "ops.operations.prepare",
    "ops.operations.read",
    "ops.schedule.read",
    "ops.tasks.read",
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V4 = Object.freeze({
  revision: "2026-08-31.mcp-exposure.v4",
  toolIds: Object.freeze(["prepare_collections"] as const),
  grantableScopes: Object.freeze([
    "ops.correspondence.read",
    "ops.customer_contacts.read",
    "ops.customers.read",
    "ops.financial_documents.read",
    "ops.operations.prepare",
    "ops.operations.read",
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V5 = Object.freeze({
  revision: "2026-08-31.mcp-exposure.v5",
  toolIds: Object.freeze(["analyze_hiring_break_even"] as const),
  grantableScopes: Object.freeze([
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
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V6 = Object.freeze({
  revision: "2026-09-01.mcp-exposure.v6",
  toolIds: Object.freeze([
    "analyze_hiring_break_even",
    "check_customer_reply",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
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
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V7 = Object.freeze({
  revision: "2026-09-01.mcp-exposure.v7",
  toolIds: Object.freeze([
    "analyze_hiring_break_even",
    "check_customer_reply",
    "analyze_sales_truth",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
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
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V8 = Object.freeze({
  revision: "2026-09-01.mcp-exposure.v8",
  toolIds: Object.freeze([
    "analyze_hiring_break_even",
    "check_customer_reply",
    "analyze_sales_truth",
    "check_payroll_readiness",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: MCP_EXPOSURE_V7.grantableScopes,
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V9 = Object.freeze({
  revision: "2026-09-01.mcp-exposure.v9",
  toolIds: Object.freeze([
    ...MCP_EXPOSURE_V8.toolIds,
    "prepare_recurring_service_price_change",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
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
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V10 = Object.freeze({
  revision: "2026-09-02.mcp-exposure.v10",
  toolIds: Object.freeze([
    ...MCP_EXPOSURE_V9.toolIds,
    "prepare_estimate_from_past_job",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
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
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V11 = Object.freeze({
  revision: "2026-09-03.mcp-exposure.v11",
  toolIds: Object.freeze([
    ...MCP_EXPOSURE_V10.toolIds,
    "prepare_weather_reschedule",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze([
    "ops.catalog.read",
    "ops.communications.prepare",
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
    "ops.schedule.prepare",
    "ops.schedule.read",
    "ops.site_visits.read",
    "ops.tasks.read",
    "ops.team.read",
  ] as const),
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V12 = Object.freeze({
  revision: "2026-09-03.mcp-exposure.v12",
  toolIds: Object.freeze([
    ...MCP_EXPOSURE_V11.toolIds,
    "prepare_crew_callout_recovery",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: MCP_EXPOSURE_V11.grantableScopes,
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V13 = Object.freeze({
  revision: "2026-09-03.mcp-exposure.v13",
  toolIds: Object.freeze([
    ...MCP_EXPOSURE_V12.toolIds,
    "prepare_dispatch_confirmation_task",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: MCP_EXPOSURE_V12.grantableScopes,
} as const satisfies McpExposure);

export const MCP_EXPOSURE_V14 = Object.freeze({
  revision: "2026-09-04.mcp-exposure.v14",
  toolIds: Object.freeze([
    ...MCP_EXPOSURE_V2.toolIds,
    "prepare_customer_update",
  ] as const satisfies readonly McpDomainCapabilityId[]),
  grantableScopes: Object.freeze(
    [...MCP_EXPOSURE_V2.grantableScopes, "ops.customers.prepare"].sort()
  ),
} as const satisfies McpExposure);

export const ACTIVE_MCP_EXPOSURE_REVISION = MCP_EXPOSURE_V14.revision;

export const MCP_EXPOSURE_CATALOG: Readonly<Record<string, McpExposure>> =
  Object.freeze({
    [MCP_EXPOSURE_V1.revision]: MCP_EXPOSURE_V1,
    [MCP_EXPOSURE_V2.revision]: MCP_EXPOSURE_V2,
    [MCP_EXPOSURE_V3.revision]: MCP_EXPOSURE_V3,
    [MCP_EXPOSURE_V4.revision]: MCP_EXPOSURE_V4,
    [MCP_EXPOSURE_V5.revision]: MCP_EXPOSURE_V5,
    [MCP_EXPOSURE_V6.revision]: MCP_EXPOSURE_V6,
    [MCP_EXPOSURE_V7.revision]: MCP_EXPOSURE_V7,
    [MCP_EXPOSURE_V8.revision]: MCP_EXPOSURE_V8,
    [MCP_EXPOSURE_V9.revision]: MCP_EXPOSURE_V9,
    [MCP_EXPOSURE_V10.revision]: MCP_EXPOSURE_V10,
    [MCP_EXPOSURE_V11.revision]: MCP_EXPOSURE_V11,
    [MCP_EXPOSURE_V12.revision]: MCP_EXPOSURE_V12,
    [MCP_EXPOSURE_V13.revision]: MCP_EXPOSURE_V13,
    [MCP_EXPOSURE_V14.revision]: MCP_EXPOSURE_V14,
  });

function requiredNonBlank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be non-blank`);
  }
  return value;
}

function assertUniqueNonBlank(
  values: readonly string[],
  field: string
): Set<string> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = requiredNonBlank(value, field);
    if (unique.has(normalized)) {
      throw new TypeError(`${field} contains a duplicate`);
    }
    unique.add(normalized);
  }
  return unique;
}

/** Pure invariant boundary used by startup and adversarial fixtures. */
export function assertMcpExposureInvariants(
  input: McpExposureInvariantInput
): void {
  requiredNonBlank(input.exposure.revision, "exposure.revision");
  const toolIds = assertUniqueNonBlank(
    input.exposure.toolIds,
    "exposure.toolIds"
  );
  const grantableScopes = assertUniqueNonBlank(
    input.exposure.grantableScopes,
    "exposure.grantableScopes"
  );
  const registeredScopes = new Set(input.registeredScopes);
  const manifestByName = new Map(
    input.manifestEntries.map((entry) => [entry.name, entry] as const)
  );
  const requiredScopes = new Set<string>();
  const allowedOperations = new Set(input.allowedOperations ?? ["read"]);
  const readOnly =
    allowedOperations.size === 1 && allowedOperations.has("read");

  for (const toolId of toolIds) {
    const entry = manifestByName.get(toolId);
    if (
      !entry ||
      !allowedOperations.has(entry.operation as "read" | "prepare") ||
      entry.availability.implementation !== "available"
    ) {
      throw new TypeError(
        readOnly
          ? "MCP exposure contains a non-callable read"
          : "MCP exposure contains a non-callable capability"
      );
    }
    if (!Object.prototype.hasOwnProperty.call(input.domainMethods, toolId)) {
      throw new TypeError("MCP exposure is missing a domain method");
    }
    for (const variant of entry.authorization.variants) {
      for (const scope of variant.policy.requiredOAuthScopes) {
        if (
          !allowedOperations.has(
            input.scopeOperations[scope] as "read" | "prepare"
          )
        ) {
          throw new TypeError(
            readOnly
              ? "MCP exposure requires a non-read scope"
              : "MCP exposure requires a disallowed scope"
          );
        }
        requiredScopes.add(scope);
      }
    }
  }

  for (const scope of grantableScopes) {
    if (!registeredScopes.has(scope)) {
      throw new TypeError("MCP exposure contains an unregistered scope");
    }
    if (
      !allowedOperations.has(input.scopeOperations[scope] as "read" | "prepare")
    ) {
      throw new TypeError(
        readOnly
          ? "MCP exposure grants a non-read scope"
          : "MCP exposure grants a disallowed scope"
      );
    }
    if (
      !Object.prototype.hasOwnProperty.call(input.consentLabels, scope) ||
      requiredNonBlank(input.consentLabels[scope], "scope consent label") !==
        input.consentLabels[scope]
    ) {
      throw new TypeError("MCP exposure scope is missing its consent label");
    }
    if (!requiredScopes.has(scope)) {
      throw new TypeError("MCP exposure grants an unused scope");
    }
  }
  for (const scope of requiredScopes) {
    if (!grantableScopes.has(scope)) {
      throw new TypeError("MCP exposure omits a required scope");
    }
  }
}

function validateExposure(exposure: McpExposure): void {
  if (
    !Object.isFrozen(exposure) ||
    !Object.isFrozen(exposure.toolIds) ||
    !Object.isFrozen(exposure.grantableScopes)
  ) {
    throw new TypeError("MCP exposure must be deeply frozen");
  }
  assertMcpExposureInvariants({
    exposure,
    manifestEntries:
      exposure.revision === MCP_EXPOSURE_V14.revision
        ? CUSTOMER_UPDATE_CAPABILITY_MANIFEST
        : exposure.revision === MCP_EXPOSURE_V13.revision
          ? DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST
          : exposure.revision === MCP_EXPOSURE_V12.revision
            ? CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST
            : exposure.revision === MCP_EXPOSURE_V11.revision
              ? WEATHER_RESCHEDULE_CAPABILITY_MANIFEST
              : exposure.revision === MCP_EXPOSURE_V10.revision
                ? ESTIMATE_DRAFT_CAPABILITY_MANIFEST
                : exposure.revision === MCP_EXPOSURE_V9.revision
                  ? RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST
                  : exposure.revision === MCP_EXPOSURE_V8.revision
                    ? PAYROLL_READINESS_CAPABILITY_MANIFEST
                    : exposure.revision === MCP_EXPOSURE_V7.revision
                      ? SALES_TRUTH_CAPABILITY_MANIFEST
                      : exposure.revision === MCP_EXPOSURE_V6.revision
                        ? PROMISE_RECOVERY_CAPABILITY_MANIFEST
                        : exposure.revision === MCP_EXPOSURE_V5.revision
                          ? HIRING_WHAT_IF_CAPABILITY_MANIFEST
                          : exposure.revision === MCP_EXPOSURE_V4.revision
                            ? COLLECTIONS_CAPABILITY_MANIFEST
                            : exposure.revision === MCP_EXPOSURE_V3.revision
                              ? INVISIBLE_OFFICE_CAPABILITY_MANIFEST
                              : CAPABILITY_MANIFEST,
    domainMethods: DOMAIN_METHOD_BY_CAPABILITY,
    registeredScopes: REGISTERED_MCP_SCOPES,
    scopeOperations: MCP_SCOPE_OPERATION_BY_ID,
    consentLabels:
      exposure.revision === MCP_EXPOSURE_V14.revision
        ? CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS
        : exposure.revision === MCP_EXPOSURE_V13.revision
          ? DISPATCH_CONFIRMATION_TASK_MCP_SCOPE_CONSENT_LABELS
          : exposure.revision === MCP_EXPOSURE_V12.revision
            ? CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS
            : exposure.revision === MCP_EXPOSURE_V11.revision
              ? WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS
              : exposure.revision === MCP_EXPOSURE_V10.revision
                ? ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS
                : exposure.revision === MCP_EXPOSURE_V9.revision
                  ? PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS
                  : exposure.revision === MCP_EXPOSURE_V4.revision
                    ? COLLECTIONS_MCP_SCOPE_CONSENT_LABELS
                    : exposure.revision === MCP_EXPOSURE_V3.revision
                      ? INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS
                      : MCP_SCOPE_CONSENT_LABELS,
    allowedOperations:
      exposure.revision === MCP_EXPOSURE_V3.revision ||
      exposure.revision === MCP_EXPOSURE_V4.revision ||
      exposure.revision === MCP_EXPOSURE_V9.revision ||
      exposure.revision === MCP_EXPOSURE_V10.revision ||
      exposure.revision === MCP_EXPOSURE_V11.revision ||
      exposure.revision === MCP_EXPOSURE_V12.revision ||
      exposure.revision === MCP_EXPOSURE_V13.revision ||
      exposure.revision === MCP_EXPOSURE_V14.revision
        ? ["read", "prepare"]
        : ["read"],
  });
}

validateExposure(MCP_EXPOSURE_V1);
validateExposure(MCP_EXPOSURE_V2);
validateExposure(MCP_EXPOSURE_V3);
validateExposure(MCP_EXPOSURE_V4);
validateExposure(MCP_EXPOSURE_V5);
validateExposure(MCP_EXPOSURE_V6);
validateExposure(MCP_EXPOSURE_V7);
validateExposure(MCP_EXPOSURE_V8);
validateExposure(MCP_EXPOSURE_V9);
validateExposure(MCP_EXPOSURE_V10);
validateExposure(MCP_EXPOSURE_V11);
validateExposure(MCP_EXPOSURE_V12);
validateExposure(MCP_EXPOSURE_V13);
validateExposure(MCP_EXPOSURE_V14);

export function capabilityManifestRevisionForExposure(
  exposureRevision: string
): string {
  return exposureRevision === MCP_EXPOSURE_V14.revision
    ? CUSTOMER_UPDATE_CAPABILITY_MANIFEST_REVISION
    : exposureRevision === MCP_EXPOSURE_V13.revision
      ? DISPATCH_CONFIRMATION_TASK_CAPABILITY_MANIFEST_REVISION
      : exposureRevision === MCP_EXPOSURE_V12.revision
        ? CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION
        : exposureRevision === MCP_EXPOSURE_V11.revision
          ? WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION
          : exposureRevision === MCP_EXPOSURE_V10.revision
            ? ESTIMATE_DRAFT_CAPABILITY_MANIFEST_REVISION
            : exposureRevision === MCP_EXPOSURE_V9.revision
              ? RECURRING_SERVICE_PRICE_CHANGE_CAPABILITY_MANIFEST_REVISION
              : exposureRevision === MCP_EXPOSURE_V7.revision
                ? SALES_TRUTH_CAPABILITY_MANIFEST_REVISION
                : exposureRevision === MCP_EXPOSURE_V8.revision
                  ? PAYROLL_READINESS_CAPABILITY_MANIFEST_REVISION
                  : exposureRevision === MCP_EXPOSURE_V6.revision
                    ? PROMISE_RECOVERY_CAPABILITY_MANIFEST_REVISION
                    : exposureRevision === MCP_EXPOSURE_V5.revision
                      ? HIRING_WHAT_IF_CAPABILITY_MANIFEST_REVISION
                      : exposureRevision === MCP_EXPOSURE_V4.revision
                        ? COLLECTIONS_CAPABILITY_MANIFEST_REVISION
                        : exposureRevision === MCP_EXPOSURE_V3.revision
                          ? INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
                          : CAPABILITY_MANIFEST_REVISION;
}

/** Pure exact-revision seam for catalogue invariants and adversarial tests. */
export function resolveMcpExposureRevision(
  catalog: Readonly<Record<string, McpExposure>>,
  revision: string
): McpExposure {
  const exposure = catalog[revision];
  if (!exposure) throw new TypeError("Unknown MCP exposure revision");
  return exposure;
}

/** Resolve one code-owned immutable revision or fail closed. */
export function resolveMcpExposure(revision: string): McpExposure {
  const exposure = resolveMcpExposureRevision(MCP_EXPOSURE_CATALOG, revision);
  validateExposure(exposure);
  return exposure;
}

/** Resolve only the code-owned active revision or fail closed at startup. */
export function resolveActiveMcpExposure(): McpExposure {
  return resolveMcpExposure(ACTIVE_MCP_EXPOSURE_REVISION);
}
