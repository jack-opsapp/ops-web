import "server-only";

import type { AuditClientIdentity } from "./types";

declare const VERIFIED_ACTOR_PRINCIPAL: unique symbol;
const VERIFIED_ACTOR_PRINCIPALS = new WeakSet<object>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const MAX_PROVIDER_THREAD_ID_BYTES = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

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

/**
 * Actor and company identity resolved by the canonical Phase C job/mailbox
 * router before entering the shared control plane. This carries no blanket
 * service authority; current membership and permissions are re-read below.
 */
export interface VerifiedPhaseCPrincipal
  extends AuditClientIdentity, PrincipalBrand {
  readonly kind: "phase_c";
  readonly channel: "internal";
  readonly actorUserId: string;
  readonly companyId: string;
  readonly phaseCRoute: PhaseCRouteProof;
}

export interface PhaseCRouteProof {
  readonly assignmentVersion: number;
  readonly connectionId: string;
  readonly opportunityId: string;
  readonly internalThreadId: string;
  readonly providerThreadId: string;
  readonly sourceActivityId: string;
  readonly sourceTurnId: string;
  readonly sourceConversationId: string;
}

export type VerifiedActorPrincipal =
  | VerifiedInternalPrincipal
  | VerifiedPhaseCPrincipal
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

function requireAssignmentVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("assignmentVersion must be a non-negative integer");
  }
  return value;
}

function requireProviderThreadId(value: string): string {
  const normalized = requireNonBlank(value, "providerThreadId");
  if (
    normalized !== value ||
    new TextEncoder().encode(normalized).byteLength >
      MAX_PROVIDER_THREAD_ID_BYTES ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new TypeError("providerThreadId is invalid");
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
 * Trusted Phase C internal-adapter boundary. The adapter may call this only
 * after verifying the non-transferable result minted by resolvePhaseCEmailActor.
 */
export function createInternalPrincipalFromVerifiedPhaseCRouting(input: {
  actorUserId: string;
  companyId: string;
  assignmentVersion: number;
  connectionId: string;
  opportunityId: string;
  internalThreadId: string;
  providerThreadId: string;
  sourceActivityId: string;
  sourceTurnId: string;
  sourceConversationId: string;
  applicationId?: string | null;
  protocolEra?: string | null;
}): VerifiedPhaseCPrincipal {
  const phaseCRoute = Object.freeze({
    assignmentVersion: requireAssignmentVersion(input.assignmentVersion),
    connectionId: requireUuid(input.connectionId, "connectionId"),
    opportunityId: requireUuid(input.opportunityId, "opportunityId"),
    internalThreadId: requireUuid(input.internalThreadId, "internalThreadId"),
    providerThreadId: requireProviderThreadId(input.providerThreadId),
    sourceActivityId: requireUuid(input.sourceActivityId, "sourceActivityId"),
    sourceTurnId: requireUuid(input.sourceTurnId, "sourceTurnId"),
    sourceConversationId: requireUuid(
      input.sourceConversationId,
      "sourceConversationId"
    ),
  });
  return brandVerifiedPrincipal({
    kind: "phase_c" as const,
    channel: "internal" as const,
    actorUserId: requireUuid(input.actorUserId, "actorUserId"),
    companyId: requireUuid(input.companyId, "companyId"),
    phaseCRoute,
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
  // OAuth scopes are ASCII tokens. Match the consent catalogue and the
  // database's COLLATE "C" order before binding the exact grant array.
  const validatedScopes = Object.freeze(
    Array.from(
      new Set(input.validatedScopes.map((scope) => requireOAuthScope(scope)))
    ).sort()
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
