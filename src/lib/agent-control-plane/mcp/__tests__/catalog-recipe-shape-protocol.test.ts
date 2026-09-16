// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { McpGrantFacts } from "@/lib/agent-control-plane/mcp/bearer";
import { createMcpHandler } from "@/lib/agent-control-plane/mcp/sdk";
import { createOpsMcpServer } from "@/lib/agent-control-plane/mcp/server-factory";
import {
  MCP_EXPOSURE_V14,
  MCP_EXPOSURE_V23,
  MCP_EXPOSURE_V24,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import type {
  DomainCallOptions,
  OpsAgentDomainService,
} from "@/lib/agent-control-plane/services/domain-service";

const ACTOR_CONTEXT = Object.freeze({
  requestId: "request-catalog-shape",
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
}) as unknown as ActorContext;

const ITEM_REF = {
  item_ref: {
    kind: "catalog_family",
    id: "18000000-0000-4000-8000-000000000001",
  },
};

function grantFacts(exposureRevision: string): McpGrantFacts {
  return Object.freeze({
    grantId: "33333333-3333-4333-8333-333333333333",
    clientId: "44444444-4444-4444-8444-444444444444",
    clientName: "Connector",
    actorUserId: ACTOR_CONTEXT.actorUserId,
    companyId: ACTOR_CONTEXT.companyId,
    scopes: Object.freeze(["ops.catalog.read"]),
    exposureRevision,
    tokenId: "a".repeat(64),
    expiresAtEpochSeconds: 4_000_000_000,
  });
}

function recordingDomain() {
  const calls: {
    readonly tool: string;
    readonly options: DomainCallOptions | undefined;
  }[] = [];
  const service = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        return async (
          _actor: unknown,
          _input: unknown,
          options?: DomainCallOptions
        ) => {
          calls.push({ tool: property, options });
          return { ok: true };
        };
      },
    }
  ) as OpsAgentDomainService;
  return { calls, service };
}

async function callTool(
  exposureRevision: string,
  domainService: OpsAgentDomainService,
  capabilityName: string,
  args: unknown
) {
  const input = {
    requestId: "request-catalog-shape",
    actorContext: ACTOR_CONTEXT,
    grantFacts: grantFacts(exposureRevision),
    protocolEra: "legacy" as const,
    domainService,
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
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: capabilityName, arguments: args },
      }),
    })
  );
  const raw = await response.text();
  const data = raw
    .split(/\r?\n/)
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  return JSON.parse(data ?? raw) as {
    result?: { content: Array<{ text: string }>; isError?: boolean };
    error?: unknown;
  };
}

async function listTools(exposureRevision: string) {
  const { service } = recordingDomain();
  const input = {
    requestId: "request-catalog-shape",
    actorContext: ACTOR_CONTEXT,
    grantFacts: grantFacts(exposureRevision),
    protocolEra: "legacy" as const,
    domainService: service,
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
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      }),
    })
  );
  const raw = await response.text();
  const data = raw
    .split(/\r?\n/)
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  return (
    JSON.parse(data ?? raw) as {
      result: { tools: Array<{ name: string; description: string }> };
    }
  ).result.tools;
}

describe("catalogue recipe shape is chosen by the exposure", () => {
  it("sends shape v2 for V24 and shape v1 for every earlier pin", async () => {
    for (const [revision, shape] of [
      [MCP_EXPOSURE_V24.revision, "v2"],
      [MCP_EXPOSURE_V23.revision, "v1"],
      [MCP_EXPOSURE_V14.revision, "v1"],
    ] as const) {
      const { calls, service } = recordingDomain();
      const response = await callTool(
        revision,
        service,
        "get_catalog_item",
        ITEM_REF
      );
      expect(response.result?.isError, JSON.stringify(response)).not.toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.tool).toBe("getCatalogItem");
      expect(calls[0]?.options?.catalogRecipeShape).toBe(shape);
    }
  });

  it("never lets a tool argument choose the shape", async () => {
    const { calls, service } = recordingDomain();
    await callTool(MCP_EXPOSURE_V23.revision, service, "get_catalog_item", {
      ...ITEM_REF,
      recipe_shape: "v2",
      catalogRecipeShape: "v2",
    });
    expect(calls[0]?.options?.catalogRecipeShape ?? "v1").toBe("v1");
    expect(JSON.stringify(calls)).not.toContain("recipe_shape");
  });

  it("leaves every other tool without a catalogue shape", async () => {
    const { calls, service } = recordingDomain();
    await callTool(MCP_EXPOSURE_V24.revision, service, "search_catalog_items", {
      query: { kind: "family", value: "Lag" },
    });
    expect(calls[0]?.tool).toBe("searchCatalogItems");
    expect(calls[0]?.options?.catalogRecipeShape).toBeUndefined();
  });

  it("says what the richer read returns only on the V24 tool description", async () => {
    const [v24, v23] = await Promise.all([
      listTools(MCP_EXPOSURE_V24.revision),
      listTools(MCP_EXPOSURE_V23.revision),
    ]);
    const describe24 = v24.find((tool) => tool.name === "get_catalog_item");
    const describe23 = v23.find((tool) => tool.name === "get_catalog_item");
    expect(describe24?.description).toContain("recipe");
    expect(describe24?.description).not.toBe(describe23?.description);
    expect(describe23?.description).not.toContain("scaled");
    expect(v24.map((tool) => tool.name)).toEqual(
      v23.map((tool) => tool.name)
    );
  });
});
