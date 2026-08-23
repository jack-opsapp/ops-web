import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DOMAIN_METHOD_BY_CAPABILITY,
  hasDomainReadMethod,
  resolveDomainReadMethod,
} from "@/lib/agent-control-plane/mcp/domain-dispatch";
import type { CurrentProductionMcpToolId } from "@/lib/agent-control-plane/registry/read-capabilities/current-production";

const EXPECTED_EXTERNAL_ORDER_TO_DOMAIN_METHOD = [
  ["list_scheduled_jobs", "listScheduledJobs"],
  ["list_job_readiness_issues", "listJobReadinessIssues"],
  ["get_job_communication_context", "getJobCommunicationContext"],
  ["get_job_conversation_context", "getJobConversationContext"],
  ["list_customer_jobs", "listCustomerJobs"],
  ["get_job_summary", "getJobSummary"],
  ["search_job_history", "searchJobHistory"],
  ["get_correspondence_evidence", "getCorrespondenceEvidence"],
  ["search_customers", "searchCustomers"],
  ["search_jobs", "searchJobs"],
  ["resolve_job_participants", "resolveJobParticipants"],
] as const;

describe("typed MCP domain dispatch", () => {
  it("pins the complete static eleven-read map in external order", () => {
    expectTypeOf<
      keyof typeof DOMAIN_METHOD_BY_CAPABILITY
    >().toEqualTypeOf<CurrentProductionMcpToolId>();
    expect(Object.entries(DOMAIN_METHOD_BY_CAPABILITY)).toEqual(
      EXPECTED_EXTERNAL_ORDER_TO_DOMAIN_METHOD
    );
    expect(Object.isFrozen(DOMAIN_METHOD_BY_CAPABILITY)).toBe(true);
    for (const [
      capabilityId,
      method,
    ] of EXPECTED_EXTERNAL_ORDER_TO_DOMAIN_METHOD) {
      expect(hasDomainReadMethod(capabilityId)).toBe(true);
      expect(resolveDomainReadMethod(capabilityId)).toBe(method);
    }
  });

  it("fails closed for an unknown capability without reflecting its value", () => {
    expect(hasDomainReadMethod("get_raw_database")).toBe(false);
    expect(() => resolveDomainReadMethod("get_raw_database")).toThrow(
      "No domain method for MCP capability"
    );
    expect(() => resolveDomainReadMethod("get_raw_database")).not.toThrow(
      /get_raw_database/
    );
  });
});
