import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import type { OpsAgentDomainService } from "@/lib/agent-control-plane/services/domain-service";
import { serializeUntrustedPromptData } from "@/lib/prompt-safety/untrusted-json";

/**
 * Transport-layer proof for the MCP mount:
 *  - the tool surface is exactly the manifest's externally exposed reads;
 *  - dispatch reaches the domain service with the resolved actor context and
 *    never with caller-supplied authority;
 *  - every unauthenticated/invalid path stays free of capability vocabulary;
 *  - error envelopes are the shared contract, serialized untrusted.
 */

const CAPABILITY_NAMES = [
  "get_job_conversation_context",
  "list_scheduled_jobs",
  "list_job_readiness_issues",
  "get_job_communication_context",
  "resolve_job_participants",
  "list_customer_jobs",
  "get_job_summary",
  "search_job_history",
  "get_correspondence_evidence",
] as const;

type ExposureOverride = ReadonlySet<string>;
let exposedOverride: ExposureOverride = new Set();

vi.mock("@/lib/agent-control-plane/registry/capability-manifest", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent-control-plane/registry/capability-manifest")
  >("@/lib/agent-control-plane/registry/capability-manifest");
  return {
    ...actual,
    get CAPABILITY_MANIFEST() {
      // Authoritative in both directions so these tests pin transport
      // behavior as a function of manifest state, independent of the real
      // manifest's current exposure choices.
      return actual.CAPABILITY_MANIFEST.map((entry) =>
        Object.freeze({
          ...entry,
          availability: Object.freeze({
            implementation: entry.availability.implementation,
            externalExposure: exposedOverride.has(entry.name)
              ? ("enabled" as const)
              : ("disabled" as const),
          }),
        })
      );
    },
  };
});

const rateDecision = { exceeded: false, retryAfterSec: 0 };
const capabilityRateCalls: Array<Record<string, unknown>> = [];
vi.mock("@/lib/agent-control-plane/mcp/rate-limit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent-control-plane/mcp/rate-limit")
  >("@/lib/agent-control-plane/mcp/rate-limit");
  return {
    ...actual,
    checkCapabilityRate: vi.fn(async (input: Record<string, unknown>) => {
      capabilityRateCalls.push(input);
      return { ...rateDecision };
    }),
  };
});

const auditRecords: Array<Record<string, unknown>> = [];
vi.mock("@/lib/agent-control-plane/mcp/audit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent-control-plane/mcp/audit")
  >("@/lib/agent-control-plane/mcp/audit");
  return {
    ...actual,
    recordMcpAudit: vi.fn(async (_rpc: unknown, record: unknown) => {
      auditRecords.push(record as Record<string, unknown>);
    }),
  };
});

import { createMcpHandler } from "@/lib/agent-control-plane/mcp/sdk";
import {
  createOpsMcpServer,
  externallyExposedReadCapabilities,
} from "@/lib/agent-control-plane/mcp/server-factory";
import type { McpGrantFacts } from "@/lib/agent-control-plane/mcp/bearer";

const GRANT_FACTS: McpGrantFacts = Object.freeze({
  grantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientName: "Claude",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  companyId: "44444444-4444-4444-8444-444444444444",
  scopes: Object.freeze(["ops.jobs.read", "ops.schedule.read"]),
  tokenId: "a".repeat(64),
  expiresAtEpochSeconds: 4_000_000_000,
});

const FAKE_ACTOR_CONTEXT = Object.freeze({
  requestId: "req-test",
  actorUserId: GRANT_FACTS.actorUserId,
  companyId: GRANT_FACTS.companyId,
}) as unknown as ActorContext;

interface DomainCall {
  method: string;
  actorContext: unknown;
  input: unknown;
  signal: AbortSignal | undefined;
}

function fakeDomainService(
  behavior: (method: string, input: unknown) => unknown
): { service: OpsAgentDomainService; calls: DomainCall[] } {
  const calls: DomainCall[] = [];
  const make =
    (method: string) =>
    async (
      actorContext: unknown,
      input: unknown,
      options?: { signal?: AbortSignal }
    ) => {
      calls.push({ method, actorContext, input, signal: options?.signal });
      const result = behavior(method, input);
      if (result instanceof Error) throw result;
      return result;
    };
  const service = {
    getJobConversationContext: make("getJobConversationContext"),
    listScheduledJobs: make("listScheduledJobs"),
    listJobReadinessIssues: make("listJobReadinessIssues"),
    getJobCommunicationContext: make("getJobCommunicationContext"),
    resolveJobParticipants: make("resolveJobParticipants"),
    listCustomerJobs: make("listCustomerJobs"),
    getJobSummary: make("getJobSummary"),
    searchJobHistory: make("searchJobHistory"),
    getCorrespondenceEvidence: make("getCorrespondenceEvidence"),
  } as unknown as OpsAgentDomainService;
  return { service, calls };
}

const FAKE_RPC = Object.freeze({
  rpc: async () => ({ data: null, error: null }),
});

function buildHandler(domain: OpsAgentDomainService) {
  return createMcpHandler(
    (ctx) =>
      createOpsMcpServer({
        requestId: "req-test",
        actorContext: FAKE_ACTOR_CONTEXT,
        grantFacts: GRANT_FACTS,
        protocolEra: ctx.era,
        domainService: domain,
        auditRpcClient: FAKE_RPC,
      }),
    { legacy: "stateless" }
  );
}

function rpcRequest(body: unknown): Request {
  return new Request("https://app.opsapp.co/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

async function readRpcResponse(response: Response): Promise<{
  status: number;
  payload: Record<string, unknown> | null;
  rawText: string;
}> {
  const rawText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const dataLines = rawText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0);
    const last = dataLines[dataLines.length - 1];
    return {
      status: response.status,
      payload: last ? (JSON.parse(last) as Record<string, unknown>) : null,
      rawText,
    };
  }
  return {
    status: response.status,
    payload: rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null,
    rawText,
  };
}

async function callTool(
  handler: ReturnType<typeof buildHandler>,
  name: string,
  args: unknown
) {
  const response = await handler.fetch(
    rpcRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name, arguments: args },
    })
  );
  return readRpcResponse(response);
}

async function listTools(handler: ReturnType<typeof buildHandler>) {
  const response = await handler.fetch(
    rpcRequest({ jsonrpc: "2.0", id: 3, method: "tools/list" })
  );
  return readRpcResponse(response);
}

beforeEach(() => {
  exposedOverride = new Set();
  auditRecords.length = 0;
  capabilityRateCalls.length = 0;
  rateDecision.exceeded = false;
  rateDecision.retryAfterSec = 0;
});

describe("externallyExposedReadCapabilities", () => {
  it("is empty when no manifest entry is externally exposed", () => {
    expect(externallyExposedReadCapabilities()).toEqual([]);
  });

  it("returns exactly the flipped entries", () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const exposed = externallyExposedReadCapabilities();
    expect(exposed.map((entry) => entry.name)).toEqual(["list_scheduled_jobs"]);
  });
});

describe("tool listing", () => {
  it("lists zero tools when nothing is exposed", async () => {
    const { service } = fakeDomainService(() => ({}));
    const { status, payload } = await listTools(buildHandler(service));
    expect(status).toBe(200);
    const result = payload?.result as { tools: unknown[] };
    expect(result.tools).toEqual([]);
  });

  it("lists exactly the exposed capability with schema and annotations", async () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const { service } = fakeDomainService(() => ({}));
    const { payload, rawText } = await listTools(buildHandler(service));
    const result = payload?.result as {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        annotations?: Record<string, unknown>;
      }>;
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "list_scheduled_jobs",
    ]);
    expect(result.tools[0]?.inputSchema).toBeTruthy();
    expect(result.tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(result.tools[0]?.annotations?.destructiveHint).toBe(false);
    for (const hidden of CAPABILITY_NAMES.filter(
      (name) => name !== "list_scheduled_jobs"
    )) {
      expect(rawText).not.toContain(hidden);
    }
  });

  it("lists all nine with JSON-serializable schemas when all are exposed", async () => {
    exposedOverride = new Set(CAPABILITY_NAMES);
    const { service } = fakeDomainService(() => ({}));
    const { payload } = await listTools(buildHandler(service));
    const result = payload?.result as {
      tools: Array<{ name: string; inputSchema?: unknown }>;
    };
    expect(result.tools.map((tool) => tool.name).sort()).toEqual(
      [...CAPABILITY_NAMES].sort()
    );
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeTypeOf("object");
    }
  });
});

describe("tool dispatch", () => {
  it("dispatches to the domain with the resolved actor context and serializes untrusted", async () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const domainResult = { contract: "ok", occurrences: [] };
    const { service, calls } = fakeDomainService(() => domainResult);
    const { payload } = await callTool(
      buildHandler(service),
      "list_scheduled_jobs",
      { from: "2026-08-01T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" }
    );
    const result = payload?.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      serializeUntrustedPromptData(domainResult)
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("listScheduledJobs");
    expect(calls[0]?.actorContext).toBe(FAKE_ACTOR_CONTEXT);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    const audit = auditRecords.find((record) => record.outcome === "ok");
    expect(audit).toBeTruthy();
    expect(audit?.tool).toBe("list_scheduled_jobs");
    expect(audit?.grantId).toBe(GRANT_FACTS.grantId);
    expect(audit?.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the shared error envelope for domain access errors", async () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const { service } = fakeDomainService(
      () =>
        new ActorAccessError({
          requestId: "req-test",
          code: "FORBIDDEN",
          message: "The requested data is not accessible.",
          retryable: false,
          auditReason: "test_forbidden",
        })
    );
    const { payload } = await callTool(
      buildHandler(service),
      "list_scheduled_jobs",
      { from: "2026-08-01T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z" }
    );
    const result = payload?.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0]?.text ?? "{}");
    expect(envelope.code).toBe("FORBIDDEN");
    expect(envelope.request_id).toBe("req-test");
    expect(
      auditRecords.some((record) => record.outcome === "forbidden")
    ).toBe(true);
  });

  it("collapses unexpected failures to the INTERNAL envelope without internals", async () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const { service } = fakeDomainService(
      () => new Error("secret stack detail")
    );
    const { payload } = await callTool(
      buildHandler(service),
      "list_scheduled_jobs",
      { from: "2026-08-01T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z" }
    );
    const result = payload?.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0]?.text ?? "{}");
    expect(envelope.code).toBe("INTERNAL");
    expect(result.content[0]?.text).not.toContain("secret stack detail");
    expect(
      auditRecords.some((record) => record.outcome === "internal")
    ).toBe(true);
  });

  it("returns RATE_LIMITED envelope when the capability bucket is exhausted", async () => {
    exposedOverride = new Set(["search_job_history"]);
    rateDecision.exceeded = true;
    rateDecision.retryAfterSec = 30;
    const { service, calls } = fakeDomainService(() => ({}));
    const { payload } = await callTool(
      buildHandler(service),
      "search_job_history",
      {
        query: "deck",
        scope: {
          kind: "jobs",
          job_refs: [
            { kind: "project", id: "55555555-5555-4555-8555-555555555555" },
          ],
        },
      }
    );
    const result = payload?.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(result.content[0]?.text ?? "{}");
    expect(envelope.code).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(0);
    expect(capabilityRateCalls[0]?.bucket).toBe("evidence_search");
    expect(
      auditRecords.some((record) => record.outcome === "rate_limited")
    ).toBe(true);
  });

  it("rejects calls to unexposed capabilities without confirming their existence", async () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const { service, calls } = fakeDomainService(() => ({}));
    const { payload, rawText } = await callTool(
      buildHandler(service),
      "get_correspondence_evidence",
      {}
    );
    expect(payload?.error ?? (payload?.result as { isError?: boolean })?.isError).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(rawText).not.toContain("list_customer_jobs");
    expect(rawText).not.toContain("search_job_history");
  });
});

describe("/api/mcp route gate", () => {
  const routeModulePath = "../../../../app/api/mcp/route";

  async function loadRoute(input: {
    configured: boolean;
    resolution?: unknown;
  }) {
    vi.resetModules();
    vi.doUnmock("@/lib/agent-control-plane/mcp/rate-limit");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");
    vi.doMock("@/lib/agent-control-plane/mcp/runtime", () => ({
      mcpRuntimeConfigured: () => input.configured,
      getMcpServerRuntime: () => ({
        domainService: fakeDomainService(() => ({ ok: true })).service,
        authorityRepository: {},
        rpcClient: FAKE_RPC,
      }),
    }));
    vi.doMock("@/lib/agent-control-plane/mcp/bearer", () => ({
      resolveMcpBearer: vi.fn(async () => input.resolution),
    }));
    return (await import(routeModulePath)) as {
      POST(request: Request): Promise<Response>;
      GET(request: Request): Promise<Response>;
      DELETE(request: Request): Promise<Response>;
    };
  }

  function mcpPost(headers: Record<string, string>): Request {
    return new Request("https://app.opsapp.co/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  }

  it("answers 401 with the resource-metadata challenge and zero capability vocabulary when unauthenticated", async () => {
    const route = await loadRoute({ configured: true });
    const response = await route.POST(mcpPost({}));
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      'resource_metadata="https://app.opsapp.co/.well-known/oauth-protected-resource/api/mcp"'
    );
    expect(challenge).not.toContain("invalid_token");
    expect(challenge).toContain('scope="ops.jobs.read');
    const body = await response.text();
    for (const name of CAPABILITY_NAMES) {
      expect(body).not.toContain(name);
      expect(challenge).not.toContain(name);
    }
  });

  it("adds error=invalid_token when a bearer was presented and rejected", async () => {
    const route = await loadRoute({
      configured: true,
      resolution: { kind: "invalid_token" },
    });
    const response = await route.POST(
      mcpPost({ Authorization: "Bearer ops_mcp_at_garbage" })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"'
    );
  });

  it("returns 503 without disclosure when the cursor key is not provisioned", async () => {
    const route = await loadRoute({ configured: false });
    const response = await route.POST(
      mcpPost({ Authorization: "Bearer ops_mcp_at_something" })
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    for (const name of CAPABILITY_NAMES) expect(body).not.toContain(name);
  });

  it("returns 403 terminal for actors whose authority resolution fails", async () => {
    const route = await loadRoute({
      configured: true,
      resolution: {
        kind: "forbidden",
        requestId: "req-1",
        grantFacts: GRANT_FACTS,
      },
    });
    const response = await route.POST(
      mcpPost({ Authorization: "Bearer ops_mcp_at_valid_shape_but_dead" })
    );
    expect(response.status).toBe(403);
  });

  it("rejects foreign origins before any authentication work", async () => {
    const route = await loadRoute({ configured: true });
    const response = await route.POST(
      mcpPost({ Origin: "https://evil.example" })
    );
    expect(response.status).toBe(403);
  });

  it("allows the claude.ai origin through to the auth gate", async () => {
    const route = await loadRoute({ configured: true });
    const response = await route.POST(mcpPost({ Origin: "https://claude.ai" }));
    expect(response.status).toBe(401);
  });

  it("enforces the coarse transport rate limit with Retry-After", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.opsapp.co");
    vi.doMock("@/lib/agent-control-plane/mcp/runtime", () => ({
      mcpRuntimeConfigured: () => true,
      getMcpServerRuntime: () => ({
        domainService: fakeDomainService(() => ({})).service,
        authorityRepository: {},
        rpcClient: FAKE_RPC,
      }),
    }));
    vi.doMock("@/lib/agent-control-plane/mcp/bearer", () => ({
      resolveMcpBearer: vi.fn(async () => ({
        kind: "authenticated",
        requestId: "req-2",
        actorContext: FAKE_ACTOR_CONTEXT,
        grantFacts: GRANT_FACTS,
      })),
    }));
    vi.doMock("@/lib/agent-control-plane/mcp/rate-limit", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/agent-control-plane/mcp/rate-limit")
      >("@/lib/agent-control-plane/mcp/rate-limit");
      return {
        ...actual,
        checkTransportRate: vi.fn(async () => ({
          exceeded: true,
          retryAfterSec: 17,
        })),
      };
    });
    const route = (await import(routeModulePath)) as {
      POST(request: Request): Promise<Response>;
    };
    const response = await route.POST(
      mcpPost({ Authorization: "Bearer ops_mcp_at_ok" })
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
  });

  it("serves an authenticated tools/list through the real factory", async () => {
    exposedOverride = new Set(["list_scheduled_jobs"]);
    const route = await loadRoute({
      configured: true,
      resolution: {
        kind: "authenticated",
        requestId: "req-3",
        actorContext: FAKE_ACTOR_CONTEXT,
        grantFacts: GRANT_FACTS,
      },
    });
    const response = await route.POST(
      new Request("https://app.opsapp.co/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer ops_mcp_at_live",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
      })
    );
    const { status, payload } = await readRpcResponse(response);
    expect(status).toBe(200);
    const result = payload?.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "list_scheduled_jobs",
    ]);
  });

  it("gates GET and DELETE identically and answers 405 when authenticated", async () => {
    const unauthRoute = await loadRoute({ configured: true });
    const unauthGet = await unauthRoute.GET(
      new Request("https://app.opsapp.co/api/mcp", { method: "GET" })
    );
    expect(unauthGet.status).toBe(401);

    const authedRoute = await loadRoute({
      configured: true,
      resolution: {
        kind: "authenticated",
        requestId: "req-4",
        actorContext: FAKE_ACTOR_CONTEXT,
        grantFacts: GRANT_FACTS,
      },
    });
    const authedGet = await authedRoute.GET(
      new Request("https://app.opsapp.co/api/mcp", {
        method: "GET",
        headers: { Authorization: "Bearer ops_mcp_at_live" },
      })
    );
    expect(authedGet.status).toBe(405);
    expect(authedGet.headers.get("allow")).toBe("POST");
  });
});

describe("per-capability dispatch across the nine reads", () => {
  const U = "55555555-5555-4555-8555-555555555555";
  const MINIMAL_INPUTS: Readonly<
    Record<string, { input: unknown; method: string }>
  > = Object.freeze({
    get_job_conversation_context: {
      input: { job_ref: { kind: "opportunity", id: U } },
      method: "getJobConversationContext",
    },
    list_scheduled_jobs: {
      input: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-15T00:00:00.000Z",
      },
      method: "listScheduledJobs",
    },
    list_job_readiness_issues: {
      input: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-15T00:00:00.000Z",
      },
      method: "listJobReadinessIssues",
    },
    get_job_communication_context: {
      input: { job_ref: { kind: "project", id: U }, purpose: "general" },
      method: "getJobCommunicationContext",
    },
    resolve_job_participants: {
      input: { job_ref: { kind: "project", id: U } },
      method: "resolveJobParticipants",
    },
    list_customer_jobs: {
      input: { customer_ref: { kind: "client", id: U } },
      method: "listCustomerJobs",
    },
    get_job_summary: {
      input: { job_ref: { kind: "project", id: U } },
      method: "getJobSummary",
    },
    search_job_history: {
      input: {
        query: "deck",
        scope: { kind: "jobs", job_refs: [{ kind: "project", id: U }] },
      },
      method: "searchJobHistory",
    },
    get_correspondence_evidence: {
      input: {
        job_ref: { kind: "project", id: U },
        evidence_ids: [`job_conversation_turn:${U}`],
      },
      method: "getCorrespondenceEvidence",
    },
  });

  it("covers every capability name exactly once", () => {
    expect(Object.keys(MINIMAL_INPUTS).sort()).toEqual(
      [...CAPABILITY_NAMES].sort()
    );
  });

  for (const name of CAPABILITY_NAMES) {
    it(`dispatches ${name} to its domain method with valid minimal input`, async () => {
      exposedOverride = new Set([name]);
      const fixture = MINIMAL_INPUTS[name]!;
      const domainResult = { capability: name };
      const { service, calls } = fakeDomainService(() => domainResult);
      const { payload } = await callTool(
        buildHandler(service),
        name,
        fixture.input
      );
      const result = payload?.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(
        serializeUntrustedPromptData(domainResult)
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe(fixture.method);
      expect(calls[0]?.actorContext).toBe(FAKE_ACTOR_CONTEXT);
    });
  }
});

describe("real manifest exposure state (P1 ship pin)", () => {
  it("exposes exactly the nine v6 reads externally", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/agent-control-plane/registry/capability-manifest")
    >("@/lib/agent-control-plane/registry/capability-manifest");
    const exposed = actual.CAPABILITY_MANIFEST.filter(
      (entry) =>
        entry.availability.implementation === "available" &&
        entry.availability.externalExposure === "enabled"
    );
    expect(exposed.map((entry) => entry.name).sort()).toEqual(
      [...CAPABILITY_NAMES].sort()
    );
    for (const entry of exposed) {
      expect(entry.operation).toBe("read");
      expect(entry.annotations.readOnlyHint).toBe(true);
      expect(entry.annotations.destructiveHint).toBe(false);
    }
    const writesExposed = actual.CAPABILITY_MANIFEST.filter(
      (entry) =>
        entry.operation !== "read" &&
        entry.availability.externalExposure === "enabled"
    );
    expect(writesExposed).toEqual([]);
  });
});
