/**
 * Client-safe mirror of the reviewed MCP consent vocabulary.
 *
 * The canonical registry is server-only. Keep this map byte-identical so an
 * operator sees the same authority language when granting and reviewing an
 * external agent. Unknown authority stays visible instead of disappearing.
 */
export const CONNECTED_AGENT_SCOPE_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
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
    "ops.operations.read":
      "See authorized work queues and operational summaries",
  });

export function connectedAgentScopeLine(scopes: readonly string[]): string {
  return scopes
    .map((scope) => CONNECTED_AGENT_SCOPE_LABELS[scope] ?? scope)
    .join(" · ");
}
