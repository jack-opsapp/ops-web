import "server-only";

import type { OpsAgentDomainService } from "@/lib/agent-control-plane/services/domain-service";
import type { CurrentProductionMcpToolId } from "@/lib/agent-control-plane/registry/read-capabilities/current-production";

type AsyncDomainMethodName = {
  [Name in keyof OpsAgentDomainService]: OpsAgentDomainService[Name] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? Name
    : never;
}[keyof OpsAgentDomainService];

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
} as const satisfies Readonly<
  Record<CurrentProductionMcpToolId, AsyncDomainMethodName>
>);

export type McpDomainCapabilityId = CurrentProductionMcpToolId;
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
