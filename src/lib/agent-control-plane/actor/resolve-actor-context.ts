import "server-only";

import type {
  ActorAuthorityRepository,
  ActorAuthoritySnapshot,
} from "./authority-repository";
import {
  isTrustedActorAuthorityRepository,
  REGISTERED_ACTOR_PERMISSION_KEYS,
} from "./authority-repository";
import {
  actorForbidden,
  authorizationInternal,
  authorizationUnavailable,
} from "./errors";
import type {
  ActorMembership,
  ActorAuthentication,
  AuditClientIdentity,
} from "./types";
import {
  isVerifiedActorPrincipal,
  type VerifiedActorPrincipal,
} from "./principal-boundary";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";

const VALID_PERMISSION_SCOPES = new Set<PermissionScope>([
  "all",
  "assigned",
  "own",
]);
const REGISTERED_PERMISSION_KEY_SET = new Set<string>(
  REGISTERED_ACTOR_PERMISSION_KEYS
);
declare const RESOLVED_ACTOR_CONTEXT: unique symbol;
const RESOLVED_ACTOR_CONTEXTS = new WeakSet<object>();

interface ActorContextBrand {
  readonly [RESOLVED_ACTOR_CONTEXT]: true;
}

/** Immutable authority minted only after current server-side resolution. */
export interface ActorContext extends ActorContextBrand {
  readonly requestId: string;
  readonly causationId: string | null;
  readonly actorUserId: string;
  readonly companyId: string;
  readonly membership: ActorMembership;
  readonly roleIds: readonly string[];
  readonly adminBypass: boolean;
  readonly configuredPermissions: readonly AppPermission[];
  readonly effectivePermissions: Readonly<
    Partial<Record<AppPermission, PermissionScope>>
  >;
  readonly permissionSnapshotRevision: string;
  readonly auth: ActorAuthentication;
  readonly auditClient: Readonly<AuditClientIdentity>;
  readonly policyRevision: string;
  readonly capabilityManifestRevision: string;
}

export interface ResolveActorContextInput {
  readonly principal: VerifiedActorPrincipal;
  readonly authorityRepository: ActorAuthorityRepository;
  readonly requestId: string;
  readonly causationId?: string | null;
  readonly policyRevision: string;
  /** Injected until the Task 4 capability manifest owns this revision. */
  readonly capabilityManifestRevision: string;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAuthority(snapshot: ActorAuthoritySnapshot): {
  actorUserId: string;
  companyId: string;
  roleIds: readonly string[];
  configuredPermissions: readonly AppPermission[];
  effectivePermissions: Readonly<Record<string, PermissionScope>>;
} | null {
  if (
    snapshot.isActive !== true ||
    typeof snapshot.isAdmin !== "boolean" ||
    !nonBlank(snapshot.actorUserId) ||
    !nonBlank(snapshot.companyId) ||
    !nonBlank(snapshot.permissionSnapshotRevision) ||
    !Array.isArray(snapshot.roleIds) ||
    !Array.isArray(snapshot.configuredPermissions) ||
    !Array.isArray(snapshot.effectivePermissions)
  ) {
    return null;
  }

  const normalizedRoleIds: string[] = [];
  for (const roleId of snapshot.roleIds) {
    if (!nonBlank(roleId)) return null;
    normalizedRoleIds.push(roleId.trim().toLowerCase());
  }
  const roleIds = Array.from(new Set(normalizedRoleIds)).sort((left, right) =>
    left.localeCompare(right)
  );

  const configuredPermissions: AppPermission[] = [];
  const seenConfiguredPermissions = new Set<string>();
  for (const rawPermission of snapshot.configuredPermissions) {
    if (typeof rawPermission !== "string") return null;
    const permission = rawPermission.trim();
    if (
      !REGISTERED_PERMISSION_KEY_SET.has(permission) ||
      seenConfiguredPermissions.has(permission)
    ) {
      return null;
    }
    seenConfiguredPermissions.add(permission);
    configuredPermissions.push(permission as AppPermission);
  }
  configuredPermissions.sort((left, right) => left.localeCompare(right));

  const permissions: Record<string, PermissionScope> = {};
  for (const row of snapshot.effectivePermissions) {
    if (typeof row !== "object" || row === null) return null;
    if (!nonBlank(row.permission)) return null;
    const permission = row.permission.trim();
    if (
      !permission ||
      !REGISTERED_PERMISSION_KEY_SET.has(permission) ||
      !VALID_PERMISSION_SCOPES.has(row.scope) ||
      Object.prototype.hasOwnProperty.call(permissions, permission)
    ) {
      return null;
    }
    permissions[permission] = row.scope;
  }

  const sortedPermissions = Object.freeze(
    Object.fromEntries(
      Object.entries(permissions).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ) as Record<string, PermissionScope>
  );

  return {
    actorUserId: snapshot.actorUserId.trim().toLowerCase(),
    companyId: snapshot.companyId.trim().toLowerCase(),
    roleIds: Object.freeze(roleIds),
    configuredPermissions: Object.freeze(configuredPermissions),
    effectivePermissions: sortedPermissions,
  };
}

function authenticationFor(
  principal: VerifiedActorPrincipal
): ActorAuthentication {
  if (principal.kind === "internal") {
    return Object.freeze({
      channel: principal.channel,
      scopeCeiling: null,
    });
  }

  return Object.freeze({
    channel: "mcp" as const,
    scopeCeiling: Object.freeze([...principal.validatedScopes]),
    oauthGrantId: principal.oauthGrantId,
    oauthClientId: principal.oauthClientId,
    tokenId: principal.tokenId,
    issuer: principal.issuer,
    audience: principal.audience,
    grantRevision: principal.grantRevision,
  });
}

export async function resolveActorContext(
  input: ResolveActorContextInput
): Promise<ActorContext> {
  const requestId = input.requestId.trim();
  if (!requestId) {
    throw new TypeError("requestId is required");
  }
  if (!isVerifiedActorPrincipal(input.principal)) {
    throw actorForbidden(requestId, "principal_source_untrusted");
  }
  if (!isTrustedActorAuthorityRepository(input.authorityRepository)) {
    throw authorizationInternal(
      requestId,
      "actor_authority_repository_untrusted"
    );
  }

  let snapshot: ActorAuthoritySnapshot | null;
  try {
    snapshot =
      input.principal.kind === "internal"
        ? await input.authorityRepository.resolveInternalAuthority({
            firebaseSubject: input.principal.firebaseSubject,
            registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
          })
        : await input.authorityRepository.resolveMcpAuthority({
            actorUserId: input.principal.actorUserId,
            companyId: input.principal.companyId,
            registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
          });
  } catch {
    throw authorizationUnavailable(requestId, "authority_lookup_failed");
  }

  if (!snapshot || snapshot.isActive === false) {
    throw actorForbidden(requestId, "actor_authority_unavailable");
  }

  const normalized = normalizeAuthority(snapshot);
  if (!normalized) {
    throw authorizationUnavailable(requestId, "authority_snapshot_malformed");
  }

  if (
    input.principal.kind === "mcp" &&
    (normalized.actorUserId !== input.principal.actorUserId ||
      normalized.companyId !== input.principal.companyId)
  ) {
    throw actorForbidden(requestId, "grant_authority_mismatch");
  }

  if (
    !nonBlank(input.policyRevision) ||
    !nonBlank(input.capabilityManifestRevision)
  ) {
    throw authorizationUnavailable(requestId, "authority_revision_missing");
  }

  const membership = Object.freeze({
    userActive: true as const,
    companyActive: true as const,
  });
  const auditClient = Object.freeze({
    applicationId: input.principal.applicationId,
    protocolEra: input.principal.protocolEra,
  });

  const context = {
    requestId,
    causationId: input.causationId?.trim() || null,
    actorUserId: normalized.actorUserId,
    companyId: normalized.companyId,
    membership,
    roleIds: normalized.roleIds,
    adminBypass: snapshot.isAdmin,
    configuredPermissions: normalized.configuredPermissions,
    effectivePermissions: normalized.effectivePermissions,
    permissionSnapshotRevision: snapshot.permissionSnapshotRevision,
    auth: authenticationFor(input.principal),
    auditClient,
    policyRevision: input.policyRevision.trim(),
    capabilityManifestRevision: input.capabilityManifestRevision.trim(),
  };
  RESOLVED_ACTOR_CONTEXTS.add(context);
  return Object.freeze(context) as ActorContext;
}

export function isActorContext(value: unknown): value is ActorContext {
  return (
    typeof value === "object" &&
    value !== null &&
    RESOLVED_ACTOR_CONTEXTS.has(value)
  );
}
