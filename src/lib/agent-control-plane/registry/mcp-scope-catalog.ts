import "server-only";

/**
 * Closed vocabulary for every OAuth scope understood by the agent control
 * plane. Registration and consent are separate: a scope is grantable only
 * when the active immutable exposure revision includes it.
 */
export const REGISTERED_MCP_SCOPES = Object.freeze([
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
] as const);

export type RegisteredMcpScope = (typeof REGISTERED_MCP_SCOPES)[number];
export type McpScopeOperation = "read" | "prepare" | "write" | "send";

const REGISTERED_MCP_SCOPE_SET: ReadonlySet<string> = new Set(
  REGISTERED_MCP_SCOPES
);

export const MCP_SCOPE_OPERATION_BY_ID = Object.freeze({
  "ops.catalog.prepare": "prepare",
  "ops.catalog.read": "read",
  "ops.catalog.write": "write",
  "ops.communications.prepare": "prepare",
  "ops.communications.send": "send",
  "ops.correspondence.read": "read",
  "ops.customer_contacts.read": "read",
  "ops.customers.read": "read",
  "ops.financials.prepare": "prepare",
  "ops.financials.read": "read",
  "ops.financials.write": "write",
  "ops.jobs.prepare": "prepare",
  "ops.jobs.read": "read",
  "ops.jobs.write": "write",
  "ops.photos.read": "read",
  "ops.schedule.prepare": "prepare",
  "ops.schedule.read": "read",
  "ops.schedule.write": "write",
} as const satisfies Readonly<Record<RegisteredMcpScope, McpScopeOperation>>);

export const MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  "ops.jobs.read": "See your jobs and their status",
  "ops.schedule.read": "See your schedule and who's assigned",
  "ops.customers.read": "See your clients and their jobs",
  "ops.customer_contacts.read":
    "See who to contact on a job and how to reach them",
  "ops.photos.read": "See which jobs are missing photos",
  "ops.correspondence.read": "See client email history on your jobs",
  "ops.financials.read": "See estimate and invoice summaries on your jobs",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export type LabelledMcpScope = keyof typeof MCP_SCOPE_CONSENT_LABELS;

export const MCP_SCOPE_CATALOG = Object.freeze({
  scopeIds: REGISTERED_MCP_SCOPES,
  operations: MCP_SCOPE_OPERATION_BY_ID,
  consentLabels: MCP_SCOPE_CONSENT_LABELS,
});

export function isRegisteredMcpScope(
  value: string
): value is RegisteredMcpScope {
  return REGISTERED_MCP_SCOPE_SET.has(value);
}

export function mcpScopeConsentLabel(scope: string): string | null {
  return Object.prototype.hasOwnProperty.call(MCP_SCOPE_CONSENT_LABELS, scope)
    ? MCP_SCOPE_CONSENT_LABELS[scope as LabelledMcpScope]
    : null;
}
