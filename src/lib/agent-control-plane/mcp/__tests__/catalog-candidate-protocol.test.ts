// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  createCatalogAuthoringCandidateMcpServer,
  createOpsMcpServer,
} from "../server-factory";
import { createMcpHandler } from "../sdk";
import { createCatalogAuthoringService } from "../../services/catalog-authoring/catalog-authoring-service";
import {
  actorFixture,
  REQUEST,
  resultFixture,
  SCOPES,
  GRANT_ID,
  CLIENT_ID,
} from "../../services/catalog-authoring/__tests__/fixtures";
import {
  MCP_EXPOSURE_V19,
  resolveMcpExposure,
} from "../../registry/mcp-exposure-catalog";
import type { ScheduleChangeRpcClient } from "../../services/schedule-change/schedule-change-repository";
import type { OpsAgentCapabilityService } from "../../services/capability-service";

async function fixture() {
  const { actor, authorityClient } = await actorFixture();
  const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() =>
    Promise.resolve({ data: resultFixture(), error: null })
  );
  const service = createCatalogAuthoringService({
    rpc,
    authorityRepository: authorityClient.repository,
  });
  const domain = new Proxy(service, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      return async () => ({ ok: true });
    },
  }) as OpsAgentCapabilityService;
  const input = {
    requestId: actor.requestId,
    actorContext: actor,
    grantFacts: {
      grantId: GRANT_ID,
      clientId: CLIENT_ID,
      actorUserId: actor.actorUserId,
      companyId: actor.companyId,
      scopes: SCOPES,
      grantRevision: "a".repeat(32),
      exposureRevision: MCP_EXPOSURE_V19.revision,
      tokenId: "b".repeat(64),
      expiresAtEpochSeconds: 4000000000,
    },
    protocolEra: "legacy" as const,
    domainService: domain,
    auditRpcClient: { rpc: async () => ({ data: null, error: null }) },
    durableRateLimiter: {
      consume: async () => ({
        allowed: true,
        remainingUnits: 5,
        resetAt: "2099-01-01T00:00:00.000Z",
      }),
    },
  };
  const handler = createMcpHandler(
    (context) =>
      createCatalogAuthoringCandidateMcpServer({
        ...input,
        protocolEra: context.era,
      }),
    { legacy: "stateless" }
  );
  return {
    rpc,
    input,
    call: async (method: string, params: unknown) => {
      const response = await handler.fetch(
        new Request("https://app.opsapp.co/api/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        })
      );
      const raw = await response.text();
      return JSON.parse(
        raw
          .split(/\r?\n/)
          .find((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim() ?? raw
      );
    },
  };
}
describe("dormant catalog MCP protocol", () => {
  it("cannot be selected through the production server", async () => {
    const f = await fixture();
    expect(() => resolveMcpExposure(MCP_EXPOSURE_V19.revision)).toThrow();
    expect(() => createOpsMcpServer(f.input)).toThrow();
  });
  it("lists inspect and prepare tools but never commit tools", async () => {
    const f = await fixture();
    const result = await f.call("tools/list", {});
    const names = result.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(MCP_EXPOSURE_V19.toolIds);
    expect(names).not.toContain("commit_catalog_changes");
    expect(names).not.toContain("commit_inventory_adjustment");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("routes a strict preparation through current domain authority", async () => {
    const f = await fixture();
    const result = await f.call("tools/call", {
      name: "prepare_catalog_changes",
      arguments: REQUEST,
    });
    expect(result.result?.isError).not.toBe(true);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).toContain("approval_required");
    expect(JSON.stringify(result)).toContain("untrusted");
  });
  it("accepts the inspection request schema and returns an unpersisted preview", async () => {
    const f = await fixture();
    const preview = resultFixture();
    f.rpc.mockResolvedValueOnce({
      data: {
        ...preview,
        status: "ready",
        action_id: null,
        change_set_id: null,
        preview_sha256: null,
        expires_at: null,
      },
      error: null,
    });
    const result = await f.call("tools/call", {
      name: "inspect_catalog_changes",
      arguments: REQUEST,
    });
    expect(result.result?.isError).not.toBe(true);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.rpc.mock.calls[0][0]).toBe("inspect_catalog_changes_as_system");
    expect(JSON.parse(result.result.content[0].text)).toMatchObject({
      status: "ready",
      action_id: null,
      change_set_id: null,
    });
  });
  it("rejects forged operator approval at the protocol boundary", async () => {
    const f = await fixture();
    const result = await f.call("tools/call", {
      name: "prepare_catalog_changes",
      arguments: { ...REQUEST, approved: true },
    });
    expect(result.error || result.result?.isError).toBeTruthy();
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
