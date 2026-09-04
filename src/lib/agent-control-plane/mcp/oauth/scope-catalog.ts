import "server-only";

import {
  MCP_EXPOSURE_V3,
  MCP_EXPOSURE_V4,
  MCP_EXPOSURE_V9,
  MCP_EXPOSURE_V10,
  MCP_EXPOSURE_V11,
  MCP_EXPOSURE_V12,
  MCP_EXPOSURE_V13,
  type McpExposure,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
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
  type LabelledMcpScope,
  type RegisteredMcpScope,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

export interface McpConsentCatalog {
  readonly revision: string;
  readonly registeredScopes: readonly RegisteredMcpScope[];
  readonly operations: Readonly<Record<RegisteredMcpScope, string>>;
  readonly consentLabels: Readonly<Partial<Record<LabelledMcpScope, string>>>;
  readonly allowedOperations?: readonly ("read" | "prepare")[];
}

export interface McpConsentSnapshot {
  readonly consentCatalogRevision: string;
  readonly exposureRevision: string;
  readonly scopeCeiling: readonly LabelledMcpScope[];
  readonly acceptedLabels: readonly string[];
}

export const MCP_CONSENT_CATALOG_V1 = Object.freeze({
  revision: "2026-08-22.mcp-consent-catalog.v1",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: MCP_SCOPE_CONSENT_LABELS,
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V2 = Object.freeze({
  revision: "2026-08-30.mcp-consent-catalog.v2",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V3 = Object.freeze({
  revision: "2026-08-31.mcp-consent-catalog.v3",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: COLLECTIONS_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V4 = Object.freeze({
  revision: "2026-09-01.mcp-consent-catalog.v4",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V5 = Object.freeze({
  revision: "2026-09-02.mcp-consent-catalog.v5",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V6 = Object.freeze({
  revision: "2026-09-03.mcp-consent-catalog.v6",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V7 = Object.freeze({
  revision: "2026-09-03.mcp-consent-catalog.v7",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const MCP_CONSENT_CATALOG_V8 = Object.freeze({
  revision: "2026-09-03.mcp-consent-catalog.v8",
  registeredScopes: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: DISPATCH_CONFIRMATION_TASK_MCP_SCOPE_CONSENT_LABELS,
  allowedOperations: Object.freeze(["read", "prepare"] as const),
} as const satisfies McpConsentCatalog);

export const ACTIVE_MCP_CONSENT_CATALOG_REVISION =
  MCP_CONSENT_CATALOG_V1.revision;

export const MCP_CONSENT_CATALOG: Readonly<Record<string, McpConsentCatalog>> =
  Object.freeze({
    [MCP_CONSENT_CATALOG_V1.revision]: MCP_CONSENT_CATALOG_V1,
    [MCP_CONSENT_CATALOG_V2.revision]: MCP_CONSENT_CATALOG_V2,
    [MCP_CONSENT_CATALOG_V3.revision]: MCP_CONSENT_CATALOG_V3,
    [MCP_CONSENT_CATALOG_V4.revision]: MCP_CONSENT_CATALOG_V4,
    [MCP_CONSENT_CATALOG_V5.revision]: MCP_CONSENT_CATALOG_V5,
    [MCP_CONSENT_CATALOG_V6.revision]: MCP_CONSENT_CATALOG_V6,
    [MCP_CONSENT_CATALOG_V7.revision]: MCP_CONSENT_CATALOG_V7,
    [MCP_CONSENT_CATALOG_V8.revision]: MCP_CONSENT_CATALOG_V8,
  });

function assertConsentCatalog(catalog: McpConsentCatalog): void {
  if (
    !Object.isFrozen(catalog) ||
    !Object.isFrozen(catalog.registeredScopes) ||
    !Object.isFrozen(catalog.operations) ||
    !Object.isFrozen(catalog.consentLabels) ||
    (catalog.allowedOperations !== undefined &&
      !Object.isFrozen(catalog.allowedOperations))
  ) {
    throw new TypeError("MCP consent catalogue must be deeply frozen");
  }
  if (catalog.revision.trim() !== catalog.revision || catalog.revision === "") {
    throw new TypeError("MCP consent catalogue revision must be non-blank");
  }
  const registered = new Set<string>(catalog.registeredScopes);
  const allowedOperations = new Set(catalog.allowedOperations ?? ["read"]);
  if (registered.size !== catalog.registeredScopes.length) {
    throw new TypeError("MCP consent catalogue contains duplicate scopes");
  }
  for (const scope of catalog.registeredScopes) {
    if (!Object.prototype.hasOwnProperty.call(catalog.operations, scope)) {
      throw new TypeError(
        "MCP consent catalogue scope is missing an operation"
      );
    }
  }
  for (const [scope, label] of Object.entries(catalog.consentLabels)) {
    if (
      !registered.has(scope) ||
      !allowedOperations.has(
        catalog.operations[scope as RegisteredMcpScope] as "read" | "prepare"
      ) ||
      label.trim() !== label ||
      label === ""
    ) {
      throw new TypeError("MCP consent catalogue contains an invalid label");
    }
  }
}

assertConsentCatalog(MCP_CONSENT_CATALOG_V1);
assertConsentCatalog(MCP_CONSENT_CATALOG_V2);
assertConsentCatalog(MCP_CONSENT_CATALOG_V3);
assertConsentCatalog(MCP_CONSENT_CATALOG_V4);
assertConsentCatalog(MCP_CONSENT_CATALOG_V5);
assertConsentCatalog(MCP_CONSENT_CATALOG_V6);
assertConsentCatalog(MCP_CONSENT_CATALOG_V7);
assertConsentCatalog(MCP_CONSENT_CATALOG_V8);

export function resolveMcpConsentCatalogRevision(
  revision: string
): McpConsentCatalog {
  const catalog = MCP_CONSENT_CATALOG[revision];
  if (!catalog) throw new TypeError("Unknown MCP consent catalogue revision");
  assertConsentCatalog(catalog);
  return catalog;
}

export function resolveActiveMcpConsentCatalog(): McpConsentCatalog {
  return resolveMcpConsentCatalogRevision(ACTIVE_MCP_CONSENT_CATALOG_REVISION);
}

/**
 * Bind one immutable consent snapshot to the exact exposure object selected
 * by the route. This module deliberately never selects an exposure revision.
 */
export function consentSnapshotForExposure(
  exposure: McpExposure,
  catalog: McpConsentCatalog
): McpConsentSnapshot {
  const requiredCatalogRevision =
    exposure.revision === MCP_EXPOSURE_V13.revision
      ? MCP_CONSENT_CATALOG_V8.revision
      : exposure.revision === MCP_EXPOSURE_V12.revision
        ? MCP_CONSENT_CATALOG_V7.revision
        : exposure.revision === MCP_EXPOSURE_V11.revision
          ? MCP_CONSENT_CATALOG_V6.revision
          : exposure.revision === MCP_EXPOSURE_V10.revision
            ? MCP_CONSENT_CATALOG_V5.revision
            : exposure.revision === MCP_EXPOSURE_V9.revision
              ? MCP_CONSENT_CATALOG_V4.revision
              : exposure.revision === MCP_EXPOSURE_V4.revision
                ? MCP_CONSENT_CATALOG_V3.revision
                : exposure.revision === MCP_EXPOSURE_V3.revision
                  ? MCP_CONSENT_CATALOG_V2.revision
                  : null;
  if (
    requiredCatalogRevision !== null &&
    catalog.revision !== requiredCatalogRevision
  ) {
    throw new TypeError("MCP exposure consent catalogue mismatch");
  }
  const registered = new Set<string>(catalog.registeredScopes);
  const allowedOperations = new Set(catalog.allowedOperations ?? ["read"]);
  const ceiling: LabelledMcpScope[] = [];
  const labels: string[] = [];
  for (const scope of exposure.grantableScopes) {
    if (
      !registered.has(scope) ||
      !allowedOperations.has(
        catalog.operations[scope as RegisteredMcpScope] as "read" | "prepare"
      ) ||
      !Object.prototype.hasOwnProperty.call(catalog.consentLabels, scope)
    ) {
      throw new TypeError("MCP exposure scope is not consentable");
    }
    ceiling.push(scope as LabelledMcpScope);
    labels.push(catalog.consentLabels[scope as LabelledMcpScope]!);
  }
  if (ceiling.length === 0 || new Set(ceiling).size !== ceiling.length) {
    throw new TypeError("MCP exposure scope ceiling is invalid");
  }
  return Object.freeze({
    consentCatalogRevision: catalog.revision,
    exposureRevision: exposure.revision,
    scopeCeiling: exposure.grantableScopes as readonly LabelledMcpScope[],
    acceptedLabels: Object.freeze(labels),
  });
}

export function consentLabelsForScopes(
  scopes: readonly string[],
  catalog: McpConsentCatalog
): readonly string[] | null {
  if (scopes.length === 0 || scopes.length > 32) return null;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (
      seen.has(scope) ||
      !Object.prototype.hasOwnProperty.call(catalog.consentLabels, scope)
    ) {
      return null;
    }
    seen.add(scope);
    labels.push(catalog.consentLabels[scope as LabelledMcpScope]!);
  }
  return Object.freeze(labels);
}
