// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import dictionary from "@/i18n/dictionaries/en/mcp-tools.json";

import type { ActorContext } from "../../actor/resolve-actor-context";
import {
  MCP_EXPOSURE_CATALOG,
  type McpExposure,
} from "../../registry/mcp-exposure-catalog";
import type { OpsAgentDomainService } from "../../services/domain-service";
import { createOpsMcpServer } from "../server-factory";
import { createMcpHandler } from "../sdk";

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { type: string };
  annotations: {
    title?: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

async function listTools(exposure: McpExposure) {
  const domainCall = vi.fn(async () => {
    throw new Error("Listing must not call business tools");
  });
  const audit = vi.fn(async () => ({ data: null, error: null }));
  const consume = vi.fn(async () => ({
    allowed: true,
    remainingUnits: 1,
    resetAt: "2099-01-01T00:00:00.000Z",
  }));
  const actorContext = {
    requestId: "display-title-test",
    actorUserId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
  } as unknown as ActorContext;
  const handler = createMcpHandler(
    (context) =>
      createOpsMcpServer({
        requestId: actorContext.requestId,
        actorContext,
        grantFacts: {
          grantId: "33333333-3333-4333-8333-333333333333",
          clientId: "44444444-4444-4444-8444-444444444444",
          clientName: "Display metadata fixture",
          actorUserId: actorContext.actorUserId,
          companyId: actorContext.companyId,
          scopes: exposure.grantableScopes,
          exposureRevision: exposure.revision,
          tokenId: "a".repeat(64),
          expiresAtEpochSeconds: 4_000_000_000,
        },
        protocolEra: context.era,
        domainService: new Proxy(
          {},
          { get: () => domainCall }
        ) as OpsAgentDomainService,
        auditRpcClient: { rpc: audit },
        durableRateLimiter: { consume },
      }),
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
  expect(response.status).toBe(200);
  const raw = await response.text();
  const data = raw
    .split(/\r?\n/)
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  const payload = JSON.parse(data ?? raw) as {
    result: { tools: ListedTool[] };
  };
  expect(domainCall).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
  return payload.result.tools;
}

describe("MCP display metadata", () => {
  const exposures = Object.values(MCP_EXPOSURE_CATALOG).filter((entry) =>
    /\.mcp-exposure\.v\d+$/.test(entry.revision)
  );

  it.each(exposures)(
    "publishes readable titles without changing $revision tool IDs",
    async (exposure) => {
      const tools = await listTools(exposure);
      expect(tools.map((tool) => tool.name)).toEqual(exposure.toolIds);
      // Freeze all non-display discovery bytes, including nested argument
      // schemas, full descriptions and safety values. Display copy may evolve
      // without changing invocation or authorization metadata.
      const invocationMetadata = tools.map(
        ({ title: _title, annotations, ...tool }) => {
          const { title: _annotationTitle, ...hints } = annotations;
          return { ...tool, annotations: hints };
        }
      );
      expect(
        createHash("sha256")
          .update(JSON.stringify(invocationMetadata))
          .digest("hex")
      ).toMatchSnapshot();
      for (const tool of tools) {
        expect(Object.hasOwn(dictionary.titles, tool.name), tool.name).toBe(
          true
        );
        expect(tool.title, tool.name).toMatch(/^[A-Z][^_]+$/);
        expect(tool.title, tool.name).not.toBe(tool.name);
        expect(tool.annotations.title, tool.name).toBe(tool.title);
        expect(tool.description?.trim().length, tool.name).toBeGreaterThan(10);
        expect(tool.inputSchema.type, tool.name).toBe("object");
        for (const hint of [
          "readOnlyHint",
          "destructiveHint",
          "idempotentHint",
          "openWorldHint",
        ] as const) {
          expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe(
            "boolean"
          );
        }
      }
    }
  );

  it("distinguishes user-facing labels from stable invocation names", async () => {
    const exposure = Object.values(MCP_EXPOSURE_CATALOG).find((entry) =>
      entry.revision.endsWith("mcp-exposure.v2")
    )!;
    const tools = await listTools(exposure);
    expect(tools.find((tool) => tool.name === "search_jobs")?.title).toBe(
      "Search jobs"
    );
    expect(tools.find((tool) => tool.name === "get_job_summary")?.title).toBe(
      "View job summary"
    );
    expect(
      tools.find((tool) => tool.name === "get_deck_design_geometry")?.title
    ).toBe("View deck measurements");
  });
});
