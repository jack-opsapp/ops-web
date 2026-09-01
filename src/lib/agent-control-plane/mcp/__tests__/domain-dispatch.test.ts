import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DOMAIN_METHOD_BY_CAPABILITY,
  hasDomainReadMethod,
  resolveDomainReadMethod,
} from "@/lib/agent-control-plane/mcp/domain-dispatch";
import type { CurrentProductionMcpToolId } from "@/lib/agent-control-plane/registry/read-capabilities/current-production";
import type { P2ReadCapabilityId } from "@/lib/agent-control-plane/registry/read-capabilities/p2";

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
  ["get_customer_context", "getCustomerContext"],
  ["list_tasks", "listTasks"],
  ["get_task_context", "getTaskContext"],
  ["list_job_artifacts", "listJobArtifacts"],
  ["get_job_artifact_evidence", "getJobArtifactEvidence"],
  ["list_site_visits", "listSiteVisits"],
  ["get_site_visit_context", "getSiteVisitContext"],
  ["get_deck_design_geometry", "getDeckDesignGeometry"],
  ["list_sales_documents", "listSalesDocuments"],
  ["get_sales_document", "getSalesDocument"],
  ["list_payments", "listPayments"],
  ["list_expenses", "listExpenses"],
  ["get_expense_context", "getExpenseContext"],
  ["list_work_queue", "listWorkQueue"],
  ["search_catalog_items", "searchCatalogItems"],
  ["get_catalog_item", "getCatalogItem"],
  ["list_purchase_orders", "listPurchaseOrders"],
  ["get_purchase_order", "getPurchaseOrder"],
  ["get_company_context", "getCompanyContext"],
  ["list_team_members", "listTeamMembers"],
  ["list_team_availability", "listTeamAvailability"],
  ["get_integration_health", "getIntegrationHealth"],
  ["get_operational_overview", "getOperationalOverview"],
  ["prepare_day_closeout", "prepareDayCloseout"],
  ["prepare_collections", "prepareCollections"],
  ["analyze_hiring_break_even", "analyzeHiringBreakEven"],
  ["check_customer_reply", "checkCustomerReply"],
  ["analyze_sales_truth", "analyzeSalesTruth"],
  ["check_payroll_readiness", "checkPayrollReadiness"],
] as const;

describe("typed MCP domain dispatch", () => {
  it("pins all reads and both inactive prepare verticals in canonical order", () => {
    expectTypeOf<keyof typeof DOMAIN_METHOD_BY_CAPABILITY>().toEqualTypeOf<
      | CurrentProductionMcpToolId
      | P2ReadCapabilityId
      | "prepare_day_closeout"
      | "prepare_collections"
      | "analyze_hiring_break_even"
      | "check_customer_reply"
      | "analyze_sales_truth"
      | "check_payroll_readiness"
    >();
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
