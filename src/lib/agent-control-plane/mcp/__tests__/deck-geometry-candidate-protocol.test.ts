// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createDeckGeometryCandidateMcpServer,
  createOpsMcpServer,
  type CreateOpsMcpServerInput,
} from "../server-factory";
import { createMcpHandler } from "../sdk";
import { createOpsAgentP2DomainService } from "../../services/p2/domain-service";
import { createSupabaseOpsAgentP2Repositories } from "../../services/p2/repositories";
import {
  deckGeometryAuthorization,
  deckGeometryActorContext,
  deckGeometryRawSnapshot,
  DECK_GEOMETRY_DECK_REF,
  DECK_GEOMETRY_JOB_ID,
} from "../../services/p2/deck-design/__tests__/deck-geometry-service-fixtures";
import { nativeDrawing } from "../../services/p2/deck-design/__tests__/deck-geometry-native-fixtures";
import { deckGeometryDrawingContentHash } from "../../services/p2/deck-design/deck-geometry-proof";
import { MCP_DECK_GEOMETRY_CANDIDATE_EXPOSURE } from "../../registry/deck-geometry-exposure";
import {
  MCP_EXPOSURE_V2,
  resolveMcpExposure,
} from "../../registry/mcp-exposure-catalog";
import { DeckDesignGeometryResultV2Schema } from "../../contracts/deck-design-geometry-v2";
import type { OpsAgentReadCatalogueService } from "../../services/read-catalogue-service";

const REQUEST = {
  source: "job_artifact",
  job_ref: { kind: "opportunity", id: DECK_GEOMETRY_JOB_ID },
  deck_design_ref: DECK_GEOMETRY_DECK_REF,
};
async function fixture(
  options: {
    legacy?: boolean;
    sourceError?: string;
    rateLimited?: boolean;
    missingFilesScope?: boolean;
    missingPermission?: boolean;
  } = {}
) {
  const authorization = await deckGeometryAuthorization(REQUEST);
  const actor =
    options.missingFilesScope || options.missingPermission
      ? await deckGeometryActorContext(
          options.missingPermission ? { "deck_builder.view": null } : undefined,
          options.missingFilesScope
            ? authorization.grantedScopeCeiling.filter(
                (s) => s !== "ops.files.read"
              )
            : authorization.grantedScopeCeiling
        )
      : authorization.actorContext;
  const drawing_source = JSON.stringify(nativeDrawing());
  const raw = deckGeometryRawSnapshot(authorization, {
    drawing_source,
    drawing_content_hash: deckGeometryDrawingContentHash(drawing_source),
  });
  const rpc = vi.fn(async () => ({
    data: options.sourceError ? null : raw,
    error: options.sourceError
      ? {
          code: options.sourceError === "stale" ? "40001" : "P0002",
          message:
            options.sourceError === "stale"
              ? "agent_deck_geometry_read_stale"
              : "agent_deck_geometry_not_found_or_not_visible",
        }
      : null,
  }));
  const realDomain = createOpsAgentP2DomainService({
    repositories: createSupabaseOpsAgentP2Repositories({ rpc }),
    cursorKey: { keyId: "deck-protocol", key: new Uint8Array(32).fill(7) },
  });
  // The candidate uses the real composed P2 domain, authorization and repository.
  // Legacy's unrelated P1 methods are not called in these deck-only assertions.
  const domain = new Proxy(realDomain, {
    get(target, key) {
      return key in target
        ? Reflect.get(target, key)
        : async () => {
            throw new Error("UNEXPECTED_NON_DECK_CALL");
          };
    },
  }) as OpsAgentReadCatalogueService;
  const audit = vi.fn(async () => ({ data: null, error: null }));
  const input: CreateOpsMcpServerInput = {
    requestId: actor.requestId,
    actorContext: actor,
    grantFacts: {
      grantId: authorization.oauthGrantId,
      clientId: authorization.oauthClientId,
      clientName: "Deck protocol fixture",
      actorUserId: actor.actorUserId,
      companyId: actor.companyId,
      scopes: actor.auth.channel === "mcp" ? [...actor.auth.scopeCeiling] : [],
      exposureRevision: options.legacy
        ? MCP_EXPOSURE_V2.revision
        : MCP_DECK_GEOMETRY_CANDIDATE_EXPOSURE.revision,
      tokenId: actor.auth.channel === "mcp" ? actor.auth.tokenId : "",
      expiresAtEpochSeconds: 4000000000,
    },
    protocolEra: "legacy" as const,
    domainService: domain,
    auditRpcClient: { rpc: audit },
    durableRateLimiter: {
      consume: async () =>
        options.rateLimited
          ? {
              allowed: false as const,
              remainingUnits: 0,
              resetAt: "2099-01-01T00:00:00.000Z",
            }
          : {
              allowed: true as const,
              remainingUnits: 5,
              resetAt: "2099-01-01T00:00:00.000Z",
            },
    },
  };
  const handler = createMcpHandler(
    (context) =>
      (options.legacy
        ? createOpsMcpServer
        : createDeckGeometryCandidateMcpServer)({
        ...input,
        protocolEra: context.era,
      }),
    { legacy: "stateless" }
  );
  return {
    rpc,
    audit,
    input,
    call: async (
      args: Record<string, unknown> = REQUEST,
      method = "tools/call"
    ) => {
      const response = await handler.fetch(
        new Request("https://app.opsapp.co/api/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params:
              method === "tools/list"
                ? {}
                : { name: "get_deck_design_geometry", arguments: args },
          }),
        })
      );
      const text = await response.text();
      return JSON.parse(
        text
          .split(/\r?\n/)
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
          .trim() ?? text
      );
    },
  };
}
const body = (response: { result: { content: Array<{ text: string }> } }) =>
  JSON.parse(response.result.content[0].text);
describe("dormant deck geometry result v2 protocol", () => {
  it("runs the original business arguments through real authorization, RPC, v2 proof and serializer", async () => {
    const f = await fixture();
    const response = await f.call();
    expect(response.result.isError).not.toBe(true);
    const result = body(response);
    expect(DeckDesignGeometryResultV2Schema.parse(result)).toEqual(result);
    expect(result.topology.connections[0].lower_edge_ref).toBeNull();
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain("lower-v");
    expect(JSON.stringify(f.rpc.mock.calls)).not.toMatch(
      /resultRevision|exposureRevision|v23/
    );
  });
  it("keeps the candidate dormant and explicitly deck-only", async () => {
    const f = await fixture();
    expect(() =>
      resolveMcpExposure(MCP_DECK_GEOMETRY_CANDIDATE_EXPOSURE.revision)
    ).toThrow();
    const response = await f.call({}, "tools/list");
    expect(response.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "get_deck_design_geometry",
    ]);
    expect(() => createOpsMcpServer(f.input)).toThrow();
  });
  it("does not let caller fields choose another result or exposure", async () => {
    const f = await fixture();
    for (const injected of [
      { resultRevision: "v1" },
      { result_revision: "v2" },
      { exposure_revision: MCP_DECK_GEOMETRY_CANDIDATE_EXPOSURE.revision },
      { company_id: "elsewhere" },
    ]) {
      const result = await f.call({ ...REQUEST, ...injected });
      expect(result.error || result.result?.isError).toBeTruthy();
    }
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("fails closed for unknown pins and actor/grant substitutions", async () => {
    const f = await fixture();
    for (const grantFacts of [
      { ...f.input.grantFacts, exposureRevision: "unknown" },
      { ...f.input.grantFacts, tokenId: "substituted-token" },
      {
        ...f.input.grantFacts,
        companyId: "99999999-9999-4999-8999-999999999999",
      },
      {
        ...f.input.grantFacts,
        grantId: "99999999-9999-4999-8999-999999999999",
      },
    ]) {
      expect(() =>
        createDeckGeometryCandidateMcpServer({ ...f.input, grantFacts })
      ).toThrow();
    }
  });
  it("does not bleed v2 selection into the original pinned connection", async () => {
    const candidate = await fixture();
    const legacy = await fixture({ legacy: true });
    expect(body(await candidate.call())).toHaveProperty("result_revision");
    expect(body(await legacy.call())).toMatchObject({
      code: "INTERNAL",
      retryable: false,
      message: expect.stringContaining("connection version"),
    });
    expect(body(await candidate.call())).toHaveProperty("result_revision");
  });
  it.each(["stale", "not_found"])(
    "preserves repository custody failure %s",
    async (sourceError) => {
      const f = await fixture({ sourceError });
      const response = await f.call();
      expect(response.result.isError).toBe(true);
      expect(body(response).code).toBe(
        sourceError === "stale" ? "TEMPORARILY_UNAVAILABLE" : "NOT_FOUND"
      );
      expect(f.audit).toHaveBeenCalledOnce();
    }
  );
  it.each(["missingFilesScope", "missingPermission"] as const)(
    "keeps authorization gate %s before source access",
    async (key) => {
      const f = await fixture({ [key]: true });
      const response = await f.call();
      expect(body(response).code).toBe(
        key === "missingFilesScope" ? "INSUFFICIENT_SCOPE" : "FORBIDDEN"
      );
      expect(f.rpc).not.toHaveBeenCalled();
      expect(f.audit).toHaveBeenCalledOnce();
    }
  );
  it("rejects source identity substitution even with a valid v2 pin", async () => {
    const f = await fixture();
    const response = await f.call({
      ...REQUEST,
      deck_design_ref: `ops_deck_design:v1:${"f".repeat(64)}`,
    });
    expect(response.result.isError).toBe(true);
    expect(JSON.stringify(response)).not.toContain("lower-v");
    expect(JSON.stringify(response)).not.toContain("railing_estimate");
  });
  it("keeps rate limiting before the geometry source read", async () => {
    const f = await fixture({ rateLimited: true });
    const response = await f.call();
    expect(body(response).code).toBe("RATE_LIMITED");
    expect(f.rpc).not.toHaveBeenCalled();
    // Durable denials are audited by the consume RPC; do not duplicate them.
    expect(f.audit).not.toHaveBeenCalled();
  });
});
