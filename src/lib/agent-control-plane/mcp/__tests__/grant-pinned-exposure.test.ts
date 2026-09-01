import { describe, expect, it } from "vitest";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { McpGrantFacts } from "@/lib/agent-control-plane/mcp/bearer";
import { createOpsMcpServer } from "@/lib/agent-control-plane/mcp/server-factory";
import { createMcpHandler } from "@/lib/agent-control-plane/mcp/sdk";
import type { OpsAgentDomainService } from "@/lib/agent-control-plane/services/domain-service";

const V1_REVISION = "2026-08-22.mcp-exposure.v1";
const V2_REVISION = "2026-08-29.mcp-exposure.v2";
const V3_REVISION = "2026-08-30.mcp-exposure.v3";
const V4_REVISION = "2026-08-31.mcp-exposure.v4";
const V5_REVISION = "2026-08-31.mcp-exposure.v5";
const V6_REVISION = "2026-09-01.mcp-exposure.v6";
const V1_TOOLS = [
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
] as const;
const V2_TOOLS = [
  ...V1_TOOLS,
  "get_customer_context",
  "list_tasks",
  "get_task_context",
  "list_job_artifacts",
  "get_job_artifact_evidence",
  "list_site_visits",
  "get_site_visit_context",
  "get_deck_design_geometry",
  "list_sales_documents",
  "get_sales_document",
  "list_payments",
  "list_expenses",
  "get_expense_context",
  "list_work_queue",
  "search_catalog_items",
  "get_catalog_item",
  "list_purchase_orders",
  "get_purchase_order",
  "get_company_context",
  "list_team_members",
  "list_team_availability",
  "get_integration_health",
  "get_operational_overview",
] as const;

const ACTOR_CONTEXT = Object.freeze({
  requestId: "request-grant-exposure",
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
}) as unknown as ActorContext;

const DOMAIN_SERVICE = new Proxy(
  {},
  {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return async () => ({ ok: true });
    },
  }
) as OpsAgentDomainService;

function grantFacts(exposureRevision: string): McpGrantFacts {
  return Object.freeze({
    grantId: "33333333-3333-4333-8333-333333333333",
    clientId: "44444444-4444-4444-8444-444444444444",
    clientName: "Connector",
    actorUserId: ACTOR_CONTEXT.actorUserId,
    companyId: ACTOR_CONTEXT.companyId,
    scopes: Object.freeze(["ops.jobs.read"]),
    exposureRevision,
    tokenId: "a".repeat(64),
    expiresAtEpochSeconds: 4_000_000_000,
  });
}

function serverInput(exposureRevision: string) {
  return {
    requestId: "request-grant-exposure",
    actorContext: ACTOR_CONTEXT,
    grantFacts: grantFacts(exposureRevision),
    protocolEra: "legacy" as const,
    domainService: DOMAIN_SERVICE,
    auditRpcClient: {
      async rpc() {
        return { data: null, error: null };
      },
    },
    durableRateLimiter: {
      async consume() {
        return {
          allowed: true,
          remainingUnits: 1,
          resetAt: "2099-08-29T00:00:00.000Z",
        };
      },
    },
  };
}

async function listTools(exposureRevision: string): Promise<string[]> {
  const input = serverInput(exposureRevision);
  const handler = createMcpHandler(
    (context) => createOpsMcpServer({ ...input, protocolEra: context.era }),
    { legacy: "stateless" }
  );
  const response = await handler.fetch(
    new Request("https://app.opsapp.co/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  const raw = await response.text();
  const data = raw
    .split(/\r?\n/)
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  const payload = JSON.parse(data ?? raw) as {
    result: { tools: Array<{ name: string }> };
  };
  return payload.result.tools.map((tool) => tool.name);
}

describe("grant-pinned MCP exposure", () => {
  it("keeps an existing v1 grant on exactly the historical eleven tools", async () => {
    await expect(listTools(V1_REVISION)).resolves.toEqual(V1_TOOLS);
  });

  it("gives a newly consented v2 grant exactly all thirty-four reads", async () => {
    await expect(listTools(V2_REVISION)).resolves.toEqual(V2_TOOLS);
  });

  it("keeps inactive v3 narrow to prepare-only closeout and never exposes commit", async () => {
    await expect(listTools(V3_REVISION)).resolves.toEqual([
      "prepare_day_closeout",
    ]);
    await expect(listTools(V3_REVISION)).resolves.not.toContain(
      "commit_day_closeout"
    );
  });

  it("keeps inactive v4 narrow to prepare-only collections and never exposes commit or send", async () => {
    await expect(listTools(V4_REVISION)).resolves.toEqual([
      "prepare_collections",
    ]);
    await expect(listTools(V4_REVISION)).resolves.not.toContain(
      "commit_collections_draft"
    );
    await expect(listTools(V4_REVISION)).resolves.not.toContain(
      "send_collections_message"
    );
  });

  it("keeps dormant v5 narrow to one read-only hiring analysis", async () => {
    await expect(listTools(V5_REVISION)).resolves.toEqual([
      "analyze_hiring_break_even",
    ]);
    await expect(listTools(V5_REVISION)).resolves.not.toContain(
      "prepare_hiring_plan"
    );
  });

  it("keeps dormant v6 additive to hiring with one customer-reply read", async () => {
    await expect(listTools(V6_REVISION)).resolves.toEqual([
      "analyze_hiring_break_even",
      "check_customer_reply",
    ]);
  });

  it("fails closed before tool registration for an unknown stored revision", () => {
    expect(() =>
      createOpsMcpServer(serverInput("unknown.mcp-exposure"))
    ).toThrow("Unknown MCP exposure revision");
  });
});
