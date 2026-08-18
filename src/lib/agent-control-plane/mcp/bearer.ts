import "server-only";

import { randomUUID } from "node:crypto";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { createMcpPrincipalFromValidatedGrant } from "@/lib/agent-control-plane/actor/principal-boundary";
import {
  resolveActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  ACCESS_TOKEN_PREFIX,
  credentialDigest,
  resolveAccessToken,
  resolveMcpOAuthConfig,
} from "./oauth";
import type { McpServerRuntime } from "./runtime";

/**
 * Mirrors the internal adapter's actor policy revision: the MCP transport
 * consumes the same actor-authority layer, not a variant of it.
 */
const ACTOR_POLICY_REVISION = "actor-policy:v1" as const;

export interface McpGrantFacts {
  readonly grantId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly actorUserId: string;
  readonly companyId: string;
  readonly scopes: readonly string[];
  readonly tokenId: string;
  readonly expiresAtEpochSeconds: number;
}

export type McpBearerResolution =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "invalid_token" }
  | {
      readonly kind: "forbidden";
      readonly requestId: string;
      readonly grantFacts: McpGrantFacts;
    }
  | { readonly kind: "unavailable"; readonly requestId: string }
  | {
      readonly kind: "authenticated";
      readonly requestId: string;
      readonly actorContext: ActorContext;
      readonly grantFacts: McpGrantFacts;
    };

function parseBearer(header: string | null): string | null {
  if (header == null) return null;
  const match = /^Bearer[ ]+([^\s]+)$/.exec(header.trim());
  if (!match) return null;
  return match[1] ?? null;
}

/**
 * The transport auth gate. Runs BEFORE any JSON-RPC parsing: Claude's OAuth
 * flow is triggered only by a transport-level 401, never by an in-band error
 * (verified against Anthropic's connector docs, 2026-08-18). Every accepted
 * bearer re-resolves current OPS authority — a removed role, membership, or
 * grant takes effect on the next call regardless of token expiry.
 */
export async function resolveMcpBearer(
  request: Request,
  runtime: McpServerRuntime
): Promise<McpBearerResolution> {
  const presented = parseBearer(request.headers.get("authorization"));
  if (presented === null) return { kind: "unauthenticated" };

  const digest = credentialDigest(presented, ACCESS_TOKEN_PREFIX);
  if (digest === null) return { kind: "invalid_token" };

  const requestId = randomUUID();

  let row: Awaited<ReturnType<typeof resolveAccessToken>>;
  try {
    row = await resolveAccessToken(runtime.rpcClient, digest);
  } catch {
    return { kind: "unavailable", requestId };
  }
  if (row === null) return { kind: "invalid_token" };

  const config = resolveMcpOAuthConfig();
  const expiresAtMs = Date.parse(row.expires_at);
  if (
    row.token_revoked ||
    row.grant_revoked ||
    row.client_disabled ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now() ||
    row.audience !== config.resource ||
    row.issuer !== config.issuer
  ) {
    return { kind: "invalid_token" };
  }

  const grantFacts: McpGrantFacts = Object.freeze({
    grantId: row.grant_id,
    clientId: row.client_id,
    clientName: row.client_name,
    actorUserId: row.user_id,
    companyId: row.company_id,
    scopes: Object.freeze([...row.scopes]),
    tokenId: digest,
    expiresAtEpochSeconds: Math.floor(expiresAtMs / 1000),
  });

  let actorContext: ActorContext;
  try {
    const principal = createMcpPrincipalFromValidatedGrant({
      actorUserId: row.user_id,
      companyId: row.company_id,
      oauthGrantId: row.grant_id,
      oauthClientId: row.client_id,
      validatedScopes: row.scopes,
      tokenId: digest,
      issuer: row.issuer,
      audience: row.audience,
      grantRevision: row.revision,
      applicationId: row.client_id,
    });
    actorContext = await resolveActorContext({
      principal,
      authorityRepository: runtime.authorityRepository,
      requestId,
      policyRevision: ACTOR_POLICY_REVISION,
      capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    });
  } catch (error) {
    if (error instanceof ActorAccessError) {
      console.error(
        JSON.stringify({
          at: "mcp_bearer_authority",
          requestId,
          code: error.code,
          reason: error.auditReasonForLog(),
        })
      );
      if (error.code === "TEMPORARILY_UNAVAILABLE") {
        return { kind: "unavailable", requestId };
      }
    } else {
      console.error(
        JSON.stringify({
          at: "mcp_bearer_authority",
          requestId,
          code: "UNTYPED",
          reason: error instanceof Error ? error.name : "unknown",
        })
      );
    }
    // Any authority failure — inactive user, membership loss, company
    // mismatch against the grant — is terminal for this connection.
    return { kind: "forbidden", requestId, grantFacts };
  }

  return { kind: "authenticated", requestId, actorContext, grantFacts };
}
