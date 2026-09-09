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
  MCP_CATALOG_TRIAL_EXPOSURE,
  resolveActiveMcpExposure,
  resolveMcpExposure,
} from "../../registry/mcp-exposure-catalog";
import type { ScheduleChangeRpcClient } from "../../services/schedule-change/schedule-change-repository";
import type { OpsAgentCapabilityService } from "../../services/capability-service";
import { CATALOG_AUTHORING_DEFINITIONS } from "../../registry/catalog-authoring-capability";

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
describe("catalog MCP candidate and restricted trial protocol", () => {
  it("does not give internal commits the prepare request instructions", () => {
    const commits = CATALOG_AUTHORING_DEFINITIONS.filter(
      (d) => d.operation === "commit"
    );
    expect(commits).toHaveLength(2);
    for (const commit of commits) {
      expect(commit.description).not.toContain("Request JSON Schema:");
      expect(commit.description).not.toContain("nested row fields");
    }
  });
  it("selects only the restricted trial, never the full candidate or public activation", async () => {
    const f = await fixture();
    expect(resolveMcpExposure(MCP_EXPOSURE_V19.revision)).toBe(
      MCP_CATALOG_TRIAL_EXPOSURE
    );
    expect(() => createOpsMcpServer(f.input)).not.toThrow();
    expect(resolveActiveMcpExposure().toolIds).not.toContain(
      "prepare_catalog_changes"
    );
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
  it.each(["prepare_catalog_changes", "prepare_inventory_adjustment"])(
    "%s exposes a request conflict without encouraging an unchanged retry",
    async (name) => {
      const f = await fixture();
      f.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "P0001", message: "CATALOG_IDEMPOTENCY_CONFLICT" },
      });
      const result = await f.call("tools/call", {
        name,
        arguments:
          name === "prepare_catalog_changes"
            ? REQUEST
            : {
                ...REQUEST,
                operation: "inventory",
                rows: [
                  {
                    row_key: "stock",
                    source_row: "1",
                    entity: "stock",
                    existing_id: "10000000-0000-4000-8000-000000000001",
                    expected_sha256: `sha256:${"a".repeat(64)}`,
                    values: { quantity: "6", reason: "Counted" },
                  },
                ],
              },
      });
      expect(result.result.isError).toBe(true);
      const error = JSON.parse(result.result.content[0].text);
      expect(error).toMatchObject({
        code: "INVALID_ARGUMENT",
        retryable: false,
        request_id: f.input.requestId,
        details: {
          field_issues: [
            {
              path: ["idempotency_key"],
              code: "CATALOG_IDEMPOTENCY_CONFLICT",
            },
          ],
        },
      });
      expect(error.message).toMatch(/different changes/);
      expect(error.message).toMatch(/Inspect current records/);
      expect(error.message).toMatch(/new proposal/);
    }
  );
  it.each([
    ["P0001", "CATALOG_IDEMPOTENCY_CONFLICT private detail", "INTERNAL", true],
    ["55P03", "CATALOG_IDEMPOTENCY_CONFLICT", "TEMPORARILY_UNAVAILABLE", true],
    ["42501", "CATALOG_IDEMPOTENCY_CONFLICT", "FORBIDDEN", false],
  ])(
    "keeps %s failures separate from the exact business conflict",
    async (code, message, expected, retryable) => {
      const f = await fixture();
      f.rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
      const result = await f.call("tools/call", {
        name: "prepare_catalog_changes",
        arguments: REQUEST,
      });
      const error = JSON.parse(result.result.content[0].text);
      expect(error).toMatchObject({ code: expected, retryable });
      expect(error.message).not.toContain("private detail");
      expect(error.details?.field_issues).toBeUndefined();
    }
  );
  it("includes the exact nested request reference when host declarations hide row alternatives", async () => {
    const f = await fixture();
    const result = await f.call("tools/list", {});
    for (const name of [
      "inspect_catalog_changes",
      "prepare_catalog_changes",
      "prepare_inventory_adjustment",
    ]) {
      const tool = result.result.tools.find(
        (t: { name: string }) => t.name === name
      );
      const reference = tool.description.match(
        /Request JSON Schema:\n(\{.*\})$/
      )?.[1];
      expect(reference).toBeDefined();
      const schema = JSON.parse(reference);
      // The reference is delivered by the actual SDK, not a separate test prompt.
      expect(schema).toEqual(tool.inputSchema);
      const rows = schema.properties.rows.items.oneOf;
      expect(
        rows.map(
          (r: { properties: { entity: { const: string } } }) =>
            r.properties.entity.const
        )
      ).toEqual([
        "unit",
        "category",
        "family",
        "product",
        "variant",
        "recipe",
        "stock",
      ]);
      const product = rows[3];
      expect(product.properties.values.properties.pricing_unit.enum).toContain(
        "flat_rate"
      );
      expect(product.properties.values.properties.taxable.type).toBe("boolean");
      expect(product.properties.values.properties.price.pattern).toBe(
        "^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$"
      );
      expect(
        rows.every(
          (option: { additionalProperties: boolean }) =>
            option.additionalProperties === false
        )
      ).toBe(true);
    }
    expect(f.rpc).not.toHaveBeenCalled();
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
  it.each([
    [
      "stock fields on a product",
      {
        ...REQUEST,
        rows: [
          {
            ...REQUEST.rows[0],
            values: { ...REQUEST.rows[0].values, quantity: "5" },
          },
        ],
      },
    ],
    [
      "unreviewed inventory in a catalog request",
      {
        ...REQUEST,
        rows: [
          {
            ...REQUEST.rows[0],
            entity: "stock",
            values: { quantity: "5", reason: "Counted" },
          },
        ],
      },
    ],
    [
      "an imprecise price",
      {
        ...REQUEST,
        rows: [
          {
            ...REQUEST.rows[0],
            values: { ...REQUEST.rows[0].values, price: "12.555" },
          },
        ],
      },
    ],
    [
      "a missing current record version",
      {
        ...REQUEST,
        rows: [
          {
            ...REQUEST.rows[0],
            existing_id: "10000000-0000-4000-8000-000000000001",
          },
        ],
      },
    ],
    [
      "a duplicate source identity",
      { ...REQUEST, rows: [REQUEST.rows[0], REQUEST.rows[0]] },
    ],
  ])("rejects %s before a business call", async (_label, input) => {
    const f = await fixture();
    const result = await f.call("tools/call", {
      name: "prepare_catalog_changes",
      arguments: input,
    });
    expect(result.error || result.result?.isError).toBeTruthy();
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
