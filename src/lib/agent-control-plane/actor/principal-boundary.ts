import "server-only";

import type { AuditClientIdentity } from "./types";

declare const VERIFIED_ACTOR_PRINCIPAL: unique symbol;
const VERIFIED_ACTOR_PRINCIPALS = new WeakSet<object>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

interface PrincipalBrand {
  readonly [VERIFIED_ACTOR_PRINCIPAL]: true;
}

export interface VerifiedInternalPrincipal
  extends AuditClientIdentity, PrincipalBrand {
  readonly kind: "internal";
  readonly channel: "internal" | "ops_api";
  readonly firebaseSubject: string;
}

export interface ValidatedMcpPrincipal
  extends AuditClientIdentity, PrincipalBrand {
  readonly kind: "mcp";
  readonly channel: "mcp";
  readonly actorUserId: string;
  readonly companyId: string;
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly validatedScopes: readonly string[];
  readonly tokenId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly grantRevision: string;
}

export type VerifiedActorPrincipal =
  | VerifiedInternalPrincipal
  | ValidatedMcpPrincipal;

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function optionalAuditValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function requireUuid(value: string, field: string): string {
  const normalized = requireNonBlank(value, field).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be a UUID`);
  }
  return normalized;
}

function requireOAuthScope(value: string): string {
  const normalized = requireNonBlank(value, "validatedScope");
  if (!OAUTH_SCOPE_TOKEN_PATTERN.test(normalized)) {
    throw new TypeError("validatedScope is invalid");
  }
  return normalized;
}

function brandVerifiedPrincipal<T extends object>(
  principal: T
): Readonly<T> & PrincipalBrand {
  VERIFIED_ACTOR_PRINCIPALS.add(principal);
  return Object.freeze(principal) as Readonly<T> & PrincipalBrand;
}

/**
 * Trusted internal adapter boundary. Import enforcement prevents tool/domain
 * handlers from turning caller strings into authenticated OPS authority.
 */
export function createInternalPrincipalFromVerifiedFirebase(input: {
  channel: "internal" | "ops_api";
  firebaseSubject: string;
  applicationId?: string | null;
  protocolEra?: string | null;
}): VerifiedInternalPrincipal {
  return brandVerifiedPrincipal({
    kind: "internal" as const,
    channel: input.channel,
    firebaseSubject: requireNonBlank(input.firebaseSubject, "firebaseSubject"),
    applicationId: optionalAuditValue(input.applicationId),
    protocolEra: optionalAuditValue(input.protocolEra),
  });
}

/**
 * Trusted MCP middleware boundary. This accepts only the middleware's already
 * validated current grant result. The future OAuth persistence layer must
 * validate revocation before calling this boundary; this module does not
 * pretend that persistence or revocation exists yet.
 */
export function createMcpPrincipalFromValidatedGrant(input: {
  actorUserId: string;
  companyId: string;
  oauthGrantId: string;
  oauthClientId: string;
  validatedScopes: readonly string[];
  tokenId: string;
  issuer: string;
  audience: string;
  grantRevision: string;
  applicationId?: string | null;
  protocolEra?: string | null;
}): ValidatedMcpPrincipal {
  const validatedScopes = Object.freeze(
    Array.from(
      new Set(input.validatedScopes.map((scope) => requireOAuthScope(scope)))
    ).sort((left, right) => left.localeCompare(right))
  );

  return brandVerifiedPrincipal({
    kind: "mcp" as const,
    channel: "mcp" as const,
    actorUserId: requireUuid(input.actorUserId, "actorUserId"),
    companyId: requireUuid(input.companyId, "companyId"),
    oauthGrantId: requireNonBlank(input.oauthGrantId, "oauthGrantId"),
    oauthClientId: requireNonBlank(input.oauthClientId, "oauthClientId"),
    validatedScopes,
    tokenId: requireNonBlank(input.tokenId, "tokenId"),
    issuer: requireNonBlank(input.issuer, "issuer"),
    audience: requireNonBlank(input.audience, "audience"),
    grantRevision: requireNonBlank(input.grantRevision, "grantRevision"),
    applicationId: optionalAuditValue(input.applicationId),
    protocolEra: optionalAuditValue(input.protocolEra),
  });
}

export function isVerifiedActorPrincipal(
  value: unknown
): value is VerifiedActorPrincipal {
  return (
    typeof value === "object" &&
    value !== null &&
    VERIFIED_ACTOR_PRINCIPALS.has(value)
  );
}
