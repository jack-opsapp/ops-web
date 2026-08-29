import "server-only";

import {
  DOMAIN_METHOD_BY_CAPABILITY,
  type McpDomainCapabilityId,
} from "@/lib/agent-control-plane/mcp/domain-dispatch";
import {
  MCP_SCOPE_CONSENT_LABELS,
  MCP_SCOPE_OPERATION_BY_ID,
  REGISTERED_MCP_SCOPES,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";
import type { CapabilityManifestEntry } from "@/lib/agent-control-plane/registry/capability-types";
import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";

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

export const ACTIVE_MCP_EXPOSURE_REVISION = MCP_EXPOSURE_V1.revision;

export const MCP_EXPOSURE_CATALOG: Readonly<Record<string, McpExposure>> =
  Object.freeze({
    [MCP_EXPOSURE_V1.revision]: MCP_EXPOSURE_V1,
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

  for (const toolId of toolIds) {
    const entry = manifestByName.get(toolId);
    if (
      !entry ||
      entry.operation !== "read" ||
      entry.availability.implementation !== "available"
    ) {
      throw new TypeError("MCP exposure contains a non-callable read");
    }
    if (!Object.prototype.hasOwnProperty.call(input.domainMethods, toolId)) {
      throw new TypeError("MCP exposure is missing a domain method");
    }
    for (const variant of entry.authorization.variants) {
      for (const scope of variant.policy.requiredOAuthScopes) {
        if (input.scopeOperations[scope] !== "read") {
          throw new TypeError("MCP exposure requires a non-read scope");
        }
        requiredScopes.add(scope);
      }
    }
  }

  for (const scope of grantableScopes) {
    if (!registeredScopes.has(scope)) {
      throw new TypeError("MCP exposure contains an unregistered scope");
    }
    if (input.scopeOperations[scope] !== "read") {
      throw new TypeError("MCP exposure grants a non-read scope");
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
    manifestEntries: CAPABILITY_MANIFEST,
    domainMethods: DOMAIN_METHOD_BY_CAPABILITY,
    registeredScopes: REGISTERED_MCP_SCOPES,
    scopeOperations: MCP_SCOPE_OPERATION_BY_ID,
    consentLabels: MCP_SCOPE_CONSENT_LABELS,
  });
}

validateExposure(MCP_EXPOSURE_V1);

/** Pure exact-revision seam for catalogue invariants and adversarial tests. */
export function resolveMcpExposureRevision(
  catalog: Readonly<Record<string, McpExposure>>,
  revision: string
): McpExposure {
  const exposure = catalog[revision];
  if (!exposure) throw new TypeError("Unknown MCP exposure revision");
  return exposure;
}

/** Resolve only the code-owned active revision or fail closed at startup. */
export function resolveActiveMcpExposure(): McpExposure {
  const exposure = resolveMcpExposureRevision(
    MCP_EXPOSURE_CATALOG,
    ACTIVE_MCP_EXPOSURE_REVISION
  );
  validateExposure(exposure);
  return exposure;
}
