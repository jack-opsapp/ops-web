import { randomUUID } from "node:crypto";

import { recordMcpAudit, type McpAuditOutcome } from "@/lib/agent-control-plane/mcp/audit";
import {
  resolveMcpBearer,
  type McpBearerResolution,
} from "@/lib/agent-control-plane/mcp/bearer";
import {
  resolveMcpOAuthConfig,
  SUPPORTED_READ_SCOPES,
} from "@/lib/agent-control-plane/mcp/oauth";
import { checkTransportRate } from "@/lib/agent-control-plane/mcp/rate-limit";
import {
  getMcpServerRuntime,
  mcpRuntimeConfigured,
  type McpServerRuntime,
} from "@/lib/agent-control-plane/mcp/runtime";
import { createMcpHandler } from "@/lib/agent-control-plane/mcp/sdk";
import { createOpsMcpServer } from "@/lib/agent-control-plane/mcp/server-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The OPS remote MCP endpoint. Dark to unauthenticated traffic by
 * construction: the bearer gate answers before any JSON-RPC parsing, and no
 * response on an unauthenticated path names a capability, tool, or schema.
 * Claude's OAuth flow is triggered exclusively by the transport-level 401
 * challenge below.
 */

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://claude.ai",
  "https://claude.com",
]);

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});

function scopeParameter(): string {
  return SUPPORTED_READ_SCOPES.join(" ");
}

function bearerChallenge(invalidToken: boolean): string {
  const config = resolveMcpOAuthConfig();
  const parts = [
    ...(invalidToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${config.protectedResourceMetadataUrl}"`,
    `scope="${scopeParameter()}"`,
  ];
  return `Bearer ${parts.join(", ")}`;
}

function unauthenticatedResponse(invalidToken: boolean): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      ...JSON_HEADERS,
      "WWW-Authenticate": bearerChallenge(invalidToken),
    },
  });
}

function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: JSON_HEADERS,
  });
}

function unavailableResponse(): Response {
  return new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
    status: 503,
    headers: JSON_HEADERS,
  });
}

function originRejected(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  if (ALLOWED_ORIGINS.has(origin)) return false;
  try {
    return origin !== resolveMcpOAuthConfig().issuer;
  } catch {
    return true;
  }
}

async function auditTransportOutcome(
  runtimeRef: McpServerRuntime | null,
  input: {
    requestId: string;
    outcome: McpAuditOutcome;
    errorCode: string | null;
    resolution?: McpBearerResolution;
  }
): Promise<void> {
  const grantFacts =
    input.resolution &&
    (input.resolution.kind === "authenticated" ||
      input.resolution.kind === "forbidden")
      ? input.resolution.grantFacts
      : null;
  if (!runtimeRef) {
    console.error(
      JSON.stringify({
        at: "mcp_transport_audit_unconfigured",
        requestId: input.requestId,
        outcome: input.outcome,
      })
    );
    return;
  }
  await recordMcpAudit(runtimeRef.rpcClient, {
    requestId: input.requestId,
    grantId: grantFacts?.grantId ?? null,
    clientId: grantFacts?.clientId ?? null,
    actorUserId: grantFacts?.actorUserId ?? null,
    companyId: grantFacts?.companyId ?? null,
    tool: null,
    protocolEra: null,
    outcome: input.outcome,
    errorCode: input.errorCode,
    inputSha256: null,
    resultBytes: null,
    latencyMs: null,
  });
}

async function gate(request: Request): Promise<
  | { kind: "response"; response: Response }
  | {
      kind: "authenticated";
      runtime: McpServerRuntime;
      resolution: Extract<McpBearerResolution, { kind: "authenticated" }>;
    }
> {
  if (originRejected(request)) {
    return { kind: "response", response: forbiddenResponse() };
  }

  const authorization = request.headers.get("authorization");
  if (authorization === null || authorization.trim() === "") {
    console.warn(
      JSON.stringify({ at: "mcp_transport", outcome: "unauthenticated" })
    );
    return { kind: "response", response: unauthenticatedResponse(false) };
  }

  if (!mcpRuntimeConfigured()) {
    console.error(
      JSON.stringify({ at: "mcp_transport", outcome: "unconfigured" })
    );
    return { kind: "response", response: unavailableResponse() };
  }
  const runtimeRef = getMcpServerRuntime();

  const resolution = await resolveMcpBearer(request, runtimeRef);
  switch (resolution.kind) {
    case "unauthenticated":
      await auditTransportOutcome(runtimeRef, {
        requestId: randomUUID(),
        outcome: "unauthenticated",
        errorCode: null,
      });
      return { kind: "response", response: unauthenticatedResponse(false) };
    case "invalid_token":
      await auditTransportOutcome(runtimeRef, {
        requestId: randomUUID(),
        outcome: "unauthenticated",
        errorCode: "invalid_token",
      });
      return { kind: "response", response: unauthenticatedResponse(true) };
    case "forbidden":
      await auditTransportOutcome(runtimeRef, {
        requestId: resolution.requestId,
        outcome: "forbidden",
        errorCode: "FORBIDDEN",
        resolution,
      });
      return { kind: "response", response: forbiddenResponse() };
    case "unavailable":
      await auditTransportOutcome(runtimeRef, {
        requestId: resolution.requestId,
        outcome: "internal",
        errorCode: "TEMPORARILY_UNAVAILABLE",
      });
      return { kind: "response", response: unavailableResponse() };
    case "authenticated": {
      const rate = await checkTransportRate(resolution.grantFacts.grantId);
      if (rate.exceeded) {
        await auditTransportOutcome(runtimeRef, {
          requestId: resolution.requestId,
          outcome: "rate_limited",
          errorCode: "RATE_LIMITED",
          resolution,
        });
        return {
          kind: "response",
          response: new Response(
            JSON.stringify({ error: "rate_limited" }),
            {
              status: 429,
              headers: {
                ...JSON_HEADERS,
                "Retry-After": String(Math.max(1, rate.retryAfterSec)),
              },
            }
          ),
        };
      }
      return { kind: "authenticated", runtime: runtimeRef, resolution };
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated.kind === "response") return gated.response;

  const { runtime: runtimeRef, resolution } = gated;
  const config = resolveMcpOAuthConfig();

  const handler = createMcpHandler(
    (ctx) =>
      createOpsMcpServer({
        requestId: resolution.requestId,
        actorContext: resolution.actorContext,
        grantFacts: resolution.grantFacts,
        protocolEra: ctx.era,
        domainService: runtimeRef.domainService,
        auditRpcClient: runtimeRef.rpcClient,
      }),
    {
      legacy: "stateless",
      onerror: (error: Error) => {
        console.error(
          JSON.stringify({
            at: "mcp_handler",
            requestId: resolution.requestId,
            message: error.message,
          })
        );
      },
    }
  );

  try {
    return await handler.fetch(request, {
      authInfo: {
        // The raw bearer is never forwarded into the SDK; the token id is
        // its storage digest, sufficient for any per-token keying.
        token: resolution.grantFacts.tokenId,
        clientId: resolution.grantFacts.clientId,
        scopes: [...resolution.grantFacts.scopes],
        expiresAt: resolution.grantFacts.expiresAtEpochSeconds,
        resource: new URL(config.resource),
        extra: { requestId: resolution.requestId },
      },
    });
  } catch (error) {
    await auditTransportOutcome(runtimeRef, {
      requestId: resolution.requestId,
      outcome: "internal",
      errorCode: "INTERNAL",
      resolution,
    });
    console.error(
      JSON.stringify({
        at: "mcp_transport",
        requestId: resolution.requestId,
        outcome: "internal",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
  // Deliberately no handler.close() here: the returned Response may still be
  // streaming (SSE upgrade), and close() aborts in-flight exchanges. The
  // per-request handler is released with the function instance.
}

async function methodNotAllowed(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated.kind === "response") return gated.response;
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: "POST" },
  });
}

export async function GET(request: Request): Promise<Response> {
  return methodNotAllowed(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return methodNotAllowed(request);
}
