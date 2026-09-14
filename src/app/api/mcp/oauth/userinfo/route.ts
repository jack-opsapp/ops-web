import { resolveMcpBearer } from "@/lib/agent-control-plane/mcp/bearer";
import { resolveMcpOAuthConfig } from "@/lib/agent-control-plane/mcp/oauth";
import { checkTransportRate } from "@/lib/agent-control-plane/mcp/rate-limit";
import {
  getMcpServerRuntime,
  mcpRuntimeConfigured,
} from "@/lib/agent-control-plane/mcp/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_SCOPE = "ops.company.read";
const HEADERS = Object.freeze({
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
});

function errorResponse(
  status: number,
  error: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...HEADERS, ...headers },
  });
}

function challenge(error?: "invalid_token" | "insufficient_scope"): string {
  const config = resolveMcpOAuthConfig();
  return `Bearer ${error ? `error="${error}", ` : ""}resource_metadata="${config.protectedResourceMetadataUrl}", scope="${REQUIRED_SCOPE}"`;
}

/**
 * Minimal OAuth bearer identity binding, not OpenID Connect UserInfo.
 * Uses the MCP resource audience and fresh grant/membership checks. No
 * business lookup, caller-selected subject, cookie auth, or credential output.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    if (new URL(request.url).search)
      return errorResponse(400, "invalid_request");
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== resolveMcpOAuthConfig().issuer) {
      return errorResponse(403, "forbidden");
    }
    if (!request.headers.get("authorization")?.trim()) {
      return errorResponse(401, "unauthorized", {
        "WWW-Authenticate": challenge(),
      });
    }
    if (!mcpRuntimeConfigured())
      return errorResponse(503, "temporarily_unavailable");

    const resolution = await resolveMcpBearer(request, getMcpServerRuntime());
    switch (resolution.kind) {
      case "unauthenticated":
      case "invalid_token":
        return errorResponse(401, "unauthorized", {
          "WWW-Authenticate": challenge(
            resolution.kind === "invalid_token" ? "invalid_token" : undefined
          ),
        });
      case "forbidden":
        return errorResponse(403, "forbidden");
      case "unavailable":
        return errorResponse(503, "temporarily_unavailable");
      case "authenticated": {
        if (
          resolution.actorContext.auth.channel !== "mcp" ||
          !resolution.actorContext.auth.scopeCeiling.includes(REQUIRED_SCOPE)
        ) {
          return errorResponse(403, "insufficient_scope", {
            "WWW-Authenticate": challenge("insufficient_scope"),
          });
        }
        const rate = await checkTransportRate(resolution.grantFacts.grantId);
        if (rate.exceeded) {
          return errorResponse(429, "rate_limited", {
            "Retry-After": String(Math.max(1, rate.retryAfterSec)),
          });
        }
        return new Response(
          JSON.stringify({
            actorId: resolution.actorContext.actorUserId,
            companyId: resolution.actorContext.companyId,
          }),
          { status: 200, headers: HEADERS }
        );
      }
    }
  } catch {
    return errorResponse(503, "temporarily_unavailable");
  }
}

function methodNotAllowed(): Response {
  return errorResponse(405, "method_not_allowed", { Allow: "GET" });
}
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
