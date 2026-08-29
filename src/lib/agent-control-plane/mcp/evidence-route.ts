import { resolveActiveMcpExposure } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  resolveMcpBearer,
  type McpBearerResolution,
} from "@/lib/agent-control-plane/mcp/bearer";
import {
  createMcpEvidenceRedeemer,
  type McpEvidenceRedemptionResult,
} from "@/lib/agent-control-plane/mcp/evidence-redemption";
import {
  createConfiguredMcpEvidenceTokenCodec,
  mcpEvidenceSigningConfigured,
  type VerifiedMcpEvidenceToken,
} from "@/lib/agent-control-plane/mcp/evidence-token";
import { resolveMcpOAuthConfig } from "@/lib/agent-control-plane/mcp/oauth";
import {
  getMcpServerRuntime,
  mcpRuntimeConfigured,
  type McpServerRuntime,
} from "@/lib/agent-control-plane/mcp/runtime";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const EMAIL_ATTACHMENT_BUCKET = "email-attachments" as const;
const MAX_IMAGE_BYTES = 25 * 1_024 * 1_024;
const MAX_PDF_BYTES = 50 * 1_024 * 1_024;
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const BASE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Accept-Ranges": "none",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
});
const JSON_HEADERS = Object.freeze({
  ...BASE_HEADERS,
  "Content-Type": "application/json",
});

type DeliveredEvidence = Extract<
  McpEvidenceRedemptionResult,
  { outcome: "delivered" }
>;

export interface EvidenceRouteDependencies {
  readonly runtimeConfigured: () => boolean;
  readonly evidenceSigningConfigured: () => boolean;
  readonly getRuntime: () => McpServerRuntime;
  readonly resolveBearer: (
    request: Request,
    runtime: McpServerRuntime
  ) => Promise<McpBearerResolution>;
  readonly verifyToken: (token: string) => VerifiedMcpEvidenceToken;
  readonly redeem: (
    runtime: McpServerRuntime,
    input: {
      readonly requestId: string;
      readonly token: VerifiedMcpEvidenceToken;
      readonly resolution: Extract<
        McpBearerResolution,
        { kind: "authenticated" }
      >;
    }
  ) => Promise<McpEvidenceRedemptionResult>;
  readonly download: (input: DeliveredEvidence) => Promise<Blob | null>;
}

export interface EvidenceRouteContext {
  readonly params: Promise<Readonly<{ token: string }>>;
}

function json(status: number, body: Readonly<Record<string, string>>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function bearerChallenge(invalidToken: boolean): string {
  try {
    const config = resolveMcpOAuthConfig();
    const scopes = resolveActiveMcpExposure().grantableScopes.join(" ");
    return [
      "Bearer",
      ...(invalidToken ? ['error="invalid_token",'] : []),
      `resource_metadata="${config.protectedResourceMetadataUrl}",`,
      `scope="${scopes}"`,
    ].join(" ");
  } catch {
    return invalidToken ? 'Bearer error="invalid_token"' : "Bearer";
  }
}

function unauthenticated(invalidToken: boolean) {
  const response = json(401, { error: "unauthorized" });
  response.headers.set("WWW-Authenticate", bearerChallenge(invalidToken));
  return response;
}

function notFound() {
  return json(404, { error: "not_found" });
}

function safeBinding(
  token: VerifiedMcpEvidenceToken,
  resolution: Extract<McpBearerResolution, { kind: "authenticated" }>
): boolean {
  const auth = resolution.actorContext.auth;
  const facts = resolution.grantFacts;
  return (
    auth.channel === "mcp" &&
    token.claims.audience === auth.audience &&
    token.claims.clientId === auth.oauthClientId &&
    token.claims.grantId === auth.oauthGrantId &&
    token.claims.actorUserId === resolution.actorContext.actorUserId &&
    token.claims.companyId === resolution.actorContext.companyId &&
    facts.clientId === token.claims.clientId &&
    facts.grantId === token.claims.grantId &&
    facts.actorUserId === token.claims.actorUserId &&
    facts.companyId === token.claims.companyId
  );
}

function safeDelivery(delivery: DeliveredEvidence): boolean {
  return (
    delivery.locatorKind === "storage_path" &&
    ALLOWED_MIME_TYPES.has(delivery.mimeType) &&
    Number.isSafeInteger(delivery.byteSize) &&
    delivery.byteSize >= 1 &&
    ((delivery.mimeType.startsWith("image/") &&
      delivery.byteSize <= MAX_IMAGE_BYTES) ||
      (delivery.mimeType === "application/pdf" &&
        delivery.byteSize <= MAX_PDF_BYTES))
  );
}

export function createEvidenceGetHandler(
  dependencies: EvidenceRouteDependencies
) {
  return async function evidenceGet(
    request: Request,
    context: EvidenceRouteContext
  ): Promise<Response> {
    if (request.headers.has("range")) {
      return json(416, { error: "range_not_supported" });
    }
    const authorization = request.headers.get("authorization");
    if (authorization === null || authorization.trim() === "") {
      return unauthenticated(false);
    }
    if (
      !dependencies.runtimeConfigured() ||
      !dependencies.evidenceSigningConfigured()
    ) {
      return json(503, { error: "temporarily_unavailable" });
    }

    let runtimeRef: McpServerRuntime;
    let resolution: McpBearerResolution;
    try {
      runtimeRef = dependencies.getRuntime();
      resolution = await dependencies.resolveBearer(request, runtimeRef);
    } catch {
      return json(503, { error: "temporarily_unavailable" });
    }
    switch (resolution.kind) {
      case "unauthenticated":
        return unauthenticated(false);
      case "invalid_token":
        return unauthenticated(true);
      case "forbidden":
        return json(403, { error: "forbidden" });
      case "unavailable":
        return json(503, { error: "temporarily_unavailable" });
      case "authenticated":
        break;
    }

    let rawToken: string;
    let token: VerifiedMcpEvidenceToken;
    try {
      const params = await context.params;
      rawToken = params.token;
      if (
        typeof rawToken !== "string" ||
        rawToken.length < 1 ||
        rawToken.length > 8_192 ||
        rawToken !== rawToken.trim()
      ) {
        return notFound();
      }
      token = dependencies.verifyToken(rawToken);
    } catch {
      return notFound();
    }
    if (!safeBinding(token, resolution)) return notFound();

    let rateDecision;
    try {
      rateDecision = await runtimeRef.durableRateLimiter.consume({
        requestId: resolution.requestId,
        grantId: resolution.grantFacts.grantId,
        actorUserId: resolution.grantFacts.actorUserId,
        companyId: resolution.grantFacts.companyId,
        capabilityId: "redeem_mcp_evidence",
        protocolEra: "modern",
        bucket: "evidence_search",
      });
    } catch {
      return json(503, { error: "temporarily_unavailable" });
    }
    if (!rateDecision.allowed) {
      const response = json(429, { error: "rate_limited" });
      const resetSeconds = Math.ceil(
        (Date.parse(rateDecision.resetAt) - Date.now()) / 1_000
      );
      response.headers.set("Retry-After", String(Math.max(1, resetSeconds)));
      return response;
    }

    let redemption: McpEvidenceRedemptionResult;
    try {
      redemption = await dependencies.redeem(runtimeRef, {
        requestId: resolution.requestId,
        token,
        resolution,
      });
    } catch {
      console.error(
        JSON.stringify({
          at: "mcp_evidence_redemption",
          requestId: resolution.requestId,
          code: "TEMPORARILY_UNAVAILABLE",
        })
      );
      return json(503, { error: "temporarily_unavailable" });
    }
    if (redemption.outcome !== "delivered") return notFound();
    if (!safeDelivery(redemption)) return notFound();

    let stored: Blob | null;
    try {
      stored = await dependencies.download(redemption);
    } catch {
      console.error(
        JSON.stringify({
          at: "mcp_evidence_download",
          requestId: resolution.requestId,
          code: "STORAGE_UNAVAILABLE",
        })
      );
      return notFound();
    }
    if (
      !(stored instanceof Blob) ||
      stored.size !== redemption.byteSize ||
      stored.type.toLowerCase() !== redemption.mimeType
    ) {
      return notFound();
    }

    return new Response(stored.stream(), {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": redemption.mimeType,
        "Content-Length": String(redemption.byteSize),
      },
    });
  };
}

const PRODUCTION_DEPENDENCIES: EvidenceRouteDependencies = Object.freeze({
  runtimeConfigured: mcpRuntimeConfigured,
  evidenceSigningConfigured: mcpEvidenceSigningConfigured,
  getRuntime: getMcpServerRuntime,
  resolveBearer: resolveMcpBearer,
  verifyToken(token: string) {
    return createConfiguredMcpEvidenceTokenCodec().verify(token);
  },
  redeem(
    runtimeRef: McpServerRuntime,
    input: {
      readonly requestId: string;
      readonly token: VerifiedMcpEvidenceToken;
      readonly resolution: Extract<
        McpBearerResolution,
        { kind: "authenticated" }
      >;
    }
  ) {
    return createMcpEvidenceRedeemer(runtimeRef.rpcClient).redeem({
      requestId: input.requestId,
      protocolEra: "modern",
      token: input.token,
      actorContext: input.resolution.actorContext,
      grantFacts: input.resolution.grantFacts,
    });
  },
  async download(input: DeliveredEvidence) {
    if (input.locatorKind !== "storage_path") return null;
    const { data, error } = await getServiceRoleClient()
      .storage.from(EMAIL_ATTACHMENT_BUCKET)
      .download(input.locator);
    return error == null && data instanceof Blob ? data : null;
  },
});

export function createProductionEvidenceGetHandler() {
  return createEvidenceGetHandler(PRODUCTION_DEPENDENCIES);
}

export function evidenceMethodNotAllowed(_request: Request): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: "GET" },
  });
}
