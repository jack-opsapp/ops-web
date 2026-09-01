import "server-only";

import type { OpsAgentCapabilityService } from "@/lib/agent-control-plane/services/capability-service";
import type { CurrentProductionMcpToolId } from "@/lib/agent-control-plane/registry/read-capabilities/current-production";
import type { P2ReadCapabilityId } from "@/lib/agent-control-plane/registry/read-capabilities/p2";

type AsyncDomainMethodName = {
  [Name in keyof OpsAgentCapabilityService]: OpsAgentCapabilityService[Name] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? Name
    : never;
}[keyof OpsAgentCapabilityService];

export const DOMAIN_METHOD_BY_CAPABILITY = Object.freeze({
  list_scheduled_jobs: "listScheduledJobs",
  list_job_readiness_issues: "listJobReadinessIssues",
  get_job_communication_context: "getJobCommunicationContext",
  get_job_conversation_context: "getJobConversationContext",
  list_customer_jobs: "listCustomerJobs",
  get_job_summary: "getJobSummary",
  search_job_history: "searchJobHistory",
  get_correspondence_evidence: "getCorrespondenceEvidence",
  search_customers: "searchCustomers",
  search_jobs: "searchJobs",
  resolve_job_participants: "resolveJobParticipants",
  get_customer_context: "getCustomerContext",
  list_tasks: "listTasks",
  get_task_context: "getTaskContext",
  list_job_artifacts: "listJobArtifacts",
  get_job_artifact_evidence: "getJobArtifactEvidence",
  list_site_visits: "listSiteVisits",
  get_site_visit_context: "getSiteVisitContext",
  get_deck_design_geometry: "getDeckDesignGeometry",
  list_sales_documents: "listSalesDocuments",
  get_sales_document: "getSalesDocument",
  list_payments: "listPayments",
  list_expenses: "listExpenses",
  get_expense_context: "getExpenseContext",
  list_work_queue: "listWorkQueue",
  search_catalog_items: "searchCatalogItems",
  get_catalog_item: "getCatalogItem",
  list_purchase_orders: "listPurchaseOrders",
  get_purchase_order: "getPurchaseOrder",
  get_company_context: "getCompanyContext",
  list_team_members: "listTeamMembers",
  list_team_availability: "listTeamAvailability",
  get_integration_health: "getIntegrationHealth",
  get_operational_overview: "getOperationalOverview",
  prepare_day_closeout: "prepareDayCloseout",
  prepare_collections: "prepareCollections",
} as const satisfies Readonly<
  Record<
    | CurrentProductionMcpToolId
    | P2ReadCapabilityId
    | "prepare_day_closeout"
    | "prepare_collections",
    AsyncDomainMethodName
  >
>);

export type McpDomainCapabilityId =
  | CurrentProductionMcpToolId
  | P2ReadCapabilityId
  | "prepare_day_closeout"
  | "prepare_collections";
export type McpDomainMethodName =
  (typeof DOMAIN_METHOD_BY_CAPABILITY)[McpDomainCapabilityId];

export function hasDomainReadMethod(
  capabilityId: string
): capabilityId is McpDomainCapabilityId {
  return Object.prototype.hasOwnProperty.call(
    DOMAIN_METHOD_BY_CAPABILITY,
    capabilityId
  );
}

export function resolveDomainReadMethod(
  capabilityId: string
): McpDomainMethodName {
  if (!hasDomainReadMethod(capabilityId)) {
    throw new TypeError("No domain method for MCP capability");
  }
  return DOMAIN_METHOD_BY_CAPABILITY[capabilityId];
}
