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
  "ops.catalog_costs.read": "read",
  "ops.communications.prepare": "prepare",
  "ops.communications.send": "send",
  "ops.company.read": "read",
  "ops.correspondence.read": "read",
  "ops.customer_contacts.read": "read",
  "ops.customers.read": "read",
  "ops.expenses.read": "read",
  "ops.files.read": "read",
  "ops.financial_documents.read": "read",
  "ops.financials.prepare": "prepare",
  "ops.financials.read": "read",
  "ops.financials.write": "write",
  "ops.integrations.read": "read",
  "ops.jobs.prepare": "prepare",
  "ops.jobs.read": "read",
  "ops.jobs.write": "write",
  "ops.operations.read": "read",
  "ops.operations.prepare": "prepare",
  "ops.payments.read": "read",
  "ops.photos.read": "read",
  "ops.purchasing.read": "read",
  "ops.schedule.prepare": "prepare",
  "ops.schedule.read": "read",
  "ops.schedule.write": "write",
  "ops.site_visits.read": "read",
  "ops.tasks.read": "read",
  "ops.team.read": "read",
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
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export const INVISIBLE_OFFICE_MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  ...MCP_SCOPE_CONSENT_LABELS,
  "ops.operations.prepare":
    "Prepare end-of-day closeouts and exact OPS filing previews",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export const COLLECTIONS_MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  ...MCP_SCOPE_CONSENT_LABELS,
  "ops.operations.prepare":
    "Prepare collections aging and customer drafts for approval",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export const PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  ...MCP_SCOPE_CONSENT_LABELS,
  "ops.operations.prepare":
    "Prepare recurring-service price-change previews and customer notice drafts",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export const ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  ...PRICE_CHANGE_MCP_SCOPE_CONSENT_LABELS,
  "ops.financials.prepare":
    "Prepare exact draft estimates from authorized past jobs",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export const WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  ...ESTIMATE_DRAFT_MCP_SCOPE_CONSENT_LABELS,
  "ops.communications.prepare":
    "Prepare exact client schedule-update drafts for approval",
  "ops.schedule.prepare":
    "Prepare exact weather reschedule proposals for approval",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export const CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS = Object.freeze({
  ...WEATHER_RESCHEDULE_MCP_SCOPE_CONSENT_LABELS,
  "ops.communications.prepare":
    "Prepare exact client schedule-update and crew recovery messages for approval",
  "ops.schedule.prepare":
    "Prepare exact weather and crew recovery schedule proposals for approval",
} as const satisfies Partial<Record<RegisteredMcpScope, string>>);

export type LabelledMcpScope =
  keyof typeof CREW_CALLOUT_RECOVERY_MCP_SCOPE_CONSENT_LABELS;

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
    ? MCP_SCOPE_CONSENT_LABELS[scope as keyof typeof MCP_SCOPE_CONSENT_LABELS]
    : null;
}
