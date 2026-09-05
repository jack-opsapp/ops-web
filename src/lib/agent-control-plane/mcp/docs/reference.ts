import "server-only";

import esReference from "@/i18n/dictionaries/es/mcp-reference.json";
import type { Locale } from "@/i18n/types";
import { resolveMcpOAuthConfig } from "@/lib/agent-control-plane/mcp/oauth/config";
import {
  getCapabilityManifestEntry,
  getCustomerUpdateCapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  MCP_SCOPE_OPERATION_BY_ID,
  mcpScopeConsentLabel,
  CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS,
  type McpScopeOperation,
} from "@/lib/agent-control-plane/registry/mcp-scope-catalog";

export type PublicMcpToolGroupLabel =
  | "customersJobs"
  | "jobContext"
  | "scheduleTasks"
  | "siteVisitsEvidence"
  | "financialCatalog"
  | "companyHealth";

export interface PublicMcpToolGroup {
  readonly id: string;
  /** Stable copy key. Localized labels are resolved by the page. */
  readonly label: PublicMcpToolGroupLabel;
  readonly toolIds: readonly string[];
}

export interface PublicMcpTool {
  readonly id: string;
  readonly description: string;
  readonly operation: "read" | "prepare";
  readonly availability: "available";
  readonly requiredScopes: readonly string[];
  readonly annotations: Readonly<{
    readOnlyHint: boolean;
    destructiveHint: false;
    idempotentHint: boolean;
    openWorldHint: boolean;
  }>;
}

export interface PublicMcpScope {
  readonly id: string;
  readonly operation: "read" | "prepare";
  readonly consentLabel: string;
}

export interface PublicMcpReference {
  readonly activeExposureRevision: string;
  readonly endpoint: string;
  readonly transport: "Streamable HTTP";
  readonly tools: readonly PublicMcpTool[];
  readonly scopes: readonly PublicMcpScope[];
  readonly groups: readonly PublicMcpToolGroup[];
  readonly oauth: Readonly<{
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint: string;
    revocationEndpoint: string;
    protectedResourceMetadataUrl: string;
    authorizationCode: true;
    pkceMethod: "S256";
    refreshTokens: true;
    dynamicClientRegistration: true;
  }>;
}

export interface PublicMcpReferenceLocalization {
  readonly toolDescriptions: Readonly<Record<string, string>>;
  readonly scopeConsentLabels: Readonly<Record<string, string>>;
}

const PUBLIC_MCP_REFERENCE_LOCALIZATIONS = Object.freeze({
  es: Object.freeze({
    toolDescriptions: Object.freeze({ ...esReference.toolDescriptions }),
    scopeConsentLabels: Object.freeze({ ...esReference.scopeConsentLabels }),
  }),
} satisfies Readonly<Partial<Record<Locale, PublicMcpReferenceLocalization>>>);

const PUBLIC_MCP_TOOL_GROUPS = Object.freeze([
  Object.freeze({
    id: "customers-jobs",
    label: "customersJobs",
    toolIds: Object.freeze([
      "search_customers",
      "search_jobs",
      "list_customer_jobs",
      "get_customer_context",
      "prepare_customer_update",
    ]),
  }),
  Object.freeze({
    id: "job-context",
    label: "jobContext",
    toolIds: Object.freeze([
      "get_job_summary",
      "search_job_history",
      "get_job_communication_context",
      "get_job_conversation_context",
      "get_correspondence_evidence",
      "resolve_job_participants",
    ]),
  }),
  Object.freeze({
    id: "schedule-tasks",
    label: "scheduleTasks",
    toolIds: Object.freeze([
      "list_scheduled_jobs",
      "list_job_readiness_issues",
      "list_tasks",
      "get_task_context",
      "list_work_queue",
    ]),
  }),
  Object.freeze({
    id: "site-visits-evidence",
    label: "siteVisitsEvidence",
    toolIds: Object.freeze([
      "list_site_visits",
      "get_site_visit_context",
      "get_deck_design_geometry",
      "list_job_artifacts",
      "get_job_artifact_evidence",
    ]),
  }),
  Object.freeze({
    id: "financial-catalog",
    label: "financialCatalog",
    toolIds: Object.freeze([
      "list_sales_documents",
      "get_sales_document",
      "list_payments",
      "list_expenses",
      "get_expense_context",
      "search_catalog_items",
      "get_catalog_item",
      "list_purchase_orders",
      "get_purchase_order",
    ]),
  }),
  Object.freeze({
    id: "company-health",
    label: "companyHealth",
    toolIds: Object.freeze([
      "get_company_context",
      "list_team_members",
      "list_team_availability",
      "get_integration_health",
      "get_operational_overview",
    ]),
  }),
] as const satisfies readonly PublicMcpToolGroup[]);

function requiredNonBlank(value: string, field: string): string {
  if (value.trim() !== value || value.length === 0) {
    throw new TypeError(`${field} must be non-blank`);
  }
  return value;
}

function requiredLocalizedText(
  entries: Readonly<Record<string, string>>,
  id: string,
  field: string
): string {
  if (!Object.prototype.hasOwnProperty.call(entries, id)) {
    throw new TypeError(`${field} is missing for ${id}`);
  }
  return requiredNonBlank(entries[id] as string, `${field} for ${id}`);
}

export function assertPublicMcpReferenceLocalizationCoverage(
  reference: Pick<PublicMcpReference, "tools" | "scopes">,
  localization: PublicMcpReferenceLocalization
): void {
  for (const tool of reference.tools) {
    requiredLocalizedText(
      localization.toolDescriptions,
      tool.id,
      "MCP tool description localization"
    );
  }
  for (const scope of reference.scopes) {
    requiredLocalizedText(
      localization.scopeConsentLabels,
      scope.id,
      "MCP scope consent localization"
    );
  }
}

export function assertPublicMcpToolGroupCoverage(
  activeToolIds: readonly string[],
  groups: readonly PublicMcpToolGroup[]
): void {
  if (activeToolIds.length === 0 || groups.length === 0) {
    throw new TypeError("Public MCP tool grouping must not be empty");
  }

  const active = new Set(activeToolIds);
  if (active.size !== activeToolIds.length) {
    throw new TypeError("Active MCP tool ids must be unique");
  }

  const grouped = new Set<string>();
  for (const group of groups) {
    requiredNonBlank(group.id, "Public MCP tool group id");
    requiredNonBlank(group.label, "Public MCP tool group label");
    if (group.toolIds.length === 0) {
      throw new TypeError("Public MCP tool group must not be empty");
    }
    for (const toolId of group.toolIds) {
      if (!active.has(toolId)) {
        throw new TypeError("Public MCP tool group contains an inactive tool");
      }
      if (grouped.has(toolId)) {
        throw new TypeError("Public MCP tool appears in more than one group");
      }
      grouped.add(toolId);
    }
  }

  if (grouped.size !== active.size) {
    throw new TypeError("Public MCP tool grouping omits an active tool");
  }
}

function publicScope(scopeId: string): PublicMcpScope {
  const operation = MCP_SCOPE_OPERATION_BY_ID[
    scopeId as keyof typeof MCP_SCOPE_OPERATION_BY_ID
  ] as McpScopeOperation | undefined;
  const consentLabel =
    scopeId === "ops.customers.prepare"
      ? CUSTOMER_UPDATE_MCP_SCOPE_CONSENT_LABELS[scopeId]
      : mcpScopeConsentLabel(scopeId);
  if (
    (operation !== "read" &&
      !(operation === "prepare" && scopeId === "ops.customers.prepare")) ||
    consentLabel === null
  ) {
    throw new TypeError("Active MCP scope is not safe for public docs");
  }
  return Object.freeze({
    id: scopeId,
    operation,
    consentLabel: requiredNonBlank(consentLabel, "MCP scope consent label"),
  });
}

function publicTool(
  toolId: string,
  activeScopeOrder: readonly string[]
): PublicMcpTool {
  const entry =
    toolId === "prepare_customer_update"
      ? getCustomerUpdateCapabilityManifestEntry(toolId)
      : getCapabilityManifestEntry(toolId);
  if (
    (entry.operation !== "read" &&
      !(
        entry.operation === "prepare" && toolId === "prepare_customer_update"
      )) ||
    entry.availability.implementation !== "available" ||
    entry.annotations.readOnlyHint !== (entry.operation === "read") ||
    entry.annotations.destructiveHint !== false
  ) {
    throw new TypeError("Active MCP tool is not safe for public docs");
  }

  const requiredScopeSet = new Set(
    entry.authorization.variants.flatMap(
      (variant) => variant.policy.requiredOAuthScopes
    )
  );
  const requiredScopes = activeScopeOrder.filter((scope) =>
    requiredScopeSet.has(scope)
  );
  if (
    requiredScopes.length !== requiredScopeSet.size ||
    requiredScopes.some(
      (scope) =>
        !(["read", "prepare"] as readonly string[]).includes(
          MCP_SCOPE_OPERATION_BY_ID[
            scope as keyof typeof MCP_SCOPE_OPERATION_BY_ID
          ]
        )
    )
  ) {
    throw new TypeError("Active MCP tool requires an undocumented scope");
  }

  return Object.freeze({
    id: entry.name,
    description: requiredNonBlank(entry.description, "MCP tool description"),
    operation: entry.operation,
    availability: "available" as const,
    requiredScopes: Object.freeze(requiredScopes),
    annotations: Object.freeze({
      readOnlyHint: entry.annotations.readOnlyHint,
      destructiveHint: false as const,
      idempotentHint: entry.annotations.idempotentHint,
      openWorldHint: entry.annotations.openWorldHint,
    }),
  });
}

function localizePublicMcpReference(
  reference: PublicMcpReference,
  locale: Locale
): PublicMcpReference {
  if (locale === "en") {
    return reference;
  }

  const localization = PUBLIC_MCP_REFERENCE_LOCALIZATIONS[locale];
  if (!localization) {
    throw new TypeError(`Public MCP localization is unavailable for ${locale}`);
  }
  assertPublicMcpReferenceLocalizationCoverage(reference, localization);

  return Object.freeze({
    ...reference,
    tools: Object.freeze(
      reference.tools.map((tool) =>
        Object.freeze({
          ...tool,
          description: requiredLocalizedText(
            localization.toolDescriptions,
            tool.id,
            "MCP tool description localization"
          ),
        })
      )
    ),
    scopes: Object.freeze(
      reference.scopes.map((scope) =>
        Object.freeze({
          ...scope,
          consentLabel: requiredLocalizedText(
            localization.scopeConsentLabels,
            scope.id,
            "MCP scope consent localization"
          ),
        })
      )
    ),
  });
}

export function resolvePublicMcpReference(
  locale: Locale = "en"
): PublicMcpReference {
  const exposure = resolveActiveMcpExposure();
  assertPublicMcpToolGroupCoverage(exposure.toolIds, PUBLIC_MCP_TOOL_GROUPS);

  const scopes = Object.freeze(exposure.grantableScopes.map(publicScope));
  const tools = Object.freeze(
    exposure.toolIds.map((toolId) =>
      publicTool(toolId, exposure.grantableScopes)
    )
  );
  const oauth = resolveMcpOAuthConfig();

  const reference: PublicMcpReference = Object.freeze({
    activeExposureRevision: exposure.revision,
    endpoint: oauth.resource,
    transport: "Streamable HTTP" as const,
    tools,
    scopes,
    groups: PUBLIC_MCP_TOOL_GROUPS,
    oauth: Object.freeze({
      issuer: oauth.issuer,
      authorizationEndpoint: oauth.authorizationEndpoint,
      tokenEndpoint: oauth.tokenEndpoint,
      registrationEndpoint: oauth.registrationEndpoint,
      revocationEndpoint: oauth.revocationEndpoint,
      protectedResourceMetadataUrl: oauth.protectedResourceMetadataUrl,
      authorizationCode: true as const,
      pkceMethod: "S256" as const,
      refreshTokens: true as const,
      dynamicClientRegistration: true as const,
    }),
  });
  return localizePublicMcpReference(reference, locale);
}
