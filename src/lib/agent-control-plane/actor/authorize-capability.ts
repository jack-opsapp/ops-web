import "server-only";

import {
  actorForbidden,
  authorizationInternal,
  insufficientOAuthScope,
} from "./errors";
import {
  isManifestCapabilityPolicy,
  type ManifestCapabilityPolicy,
} from "./capability-policy-boundary";
import { isActorContext, type ActorContext } from "./resolve-actor-context";
import type { PermissionScope } from "@/lib/types/permissions";

declare const AUTHORIZED_CAPABILITY: unique symbol;
const AUTHORIZED_CAPABILITIES = new WeakSet<object>();
const SCOPE_RANK: Readonly<Record<PermissionScope, number>> = Object.freeze({
  all: 3,
  assigned: 2,
  own: 1,
});

interface AuthorizedCapabilityBrand {
  readonly [AUTHORIZED_CAPABILITY]: true;
}

export interface AuthorizedCapability extends AuthorizedCapabilityBrand {
  readonly actorContext: ActorContext;
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly declaredOAuthScopes: readonly string[];
  readonly declaredPermissions: readonly string[];
  readonly resolvedPermissions: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly satisfiedOAuthScopes: readonly string[];
}

export interface AuthorizeCapabilityInput {
  readonly actorContext: ActorContext;
  readonly policy: ManifestCapabilityPolicy;
}

function widestAllowedScope(
  allowedScopes: readonly PermissionScope[]
): PermissionScope {
  return allowedScopes.reduce((widest, scope) =>
    SCOPE_RANK[scope] > SCOPE_RANK[widest] ? scope : widest
  );
}

export function authorizeCapability({
  actorContext,
  policy,
}: AuthorizeCapabilityInput): AuthorizedCapability {
  if (!isActorContext(actorContext)) {
    throw authorizationInternal(
      "unknown-request",
      "actor_context_source_untrusted"
    );
  }
  if (!isManifestCapabilityPolicy(policy)) {
    throw authorizationInternal(
      actorContext.requestId,
      "capability_policy_source_untrusted"
    );
  }
  if (
    policy.capabilityManifestRevision !==
    actorContext.capabilityManifestRevision
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "capability_manifest_revision_mismatch"
    );
  }

  const declaredOAuthScopes = Object.freeze([...policy.requiredOAuthScopes]);

  let satisfiedOAuthScopes: readonly string[] = Object.freeze([]);
  if (actorContext.auth.channel === "mcp") {
    const ceiling = new Set(actorContext.auth.scopeCeiling);
    const missing = declaredOAuthScopes.filter((scope) => !ceiling.has(scope));
    if (missing.length > 0) {
      const requiredScope = missing.join(" ");
      throw insufficientOAuthScope(
        actorContext.requestId,
        requiredScope,
        `Bearer error="insufficient_scope", scope="${requiredScope}"`
      );
    }
    satisfiedOAuthScopes = declaredOAuthScopes;
  }

  const resolvedPermissions: Record<string, PermissionScope> = {};
  const satisfiedPermissionGroupIndexes: number[] = [];
  for (const [
    groupIndex,
    group,
  ] of policy.permissionRequirementGroups.entries()) {
    const groupPermissions: Record<string, PermissionScope> = {};
    let groupSatisfied = true;
    for (const requirement of group) {
      const permission = requirement.permission;
      const resolved = actorContext.effectivePermissions[permission];
      if (actorContext.adminBypass) {
        groupPermissions[permission] = widestAllowedScope(
          requirement.allowedScopes
        );
        continue;
      }
      if (!resolved || !requirement.allowedScopes.includes(resolved)) {
        groupSatisfied = false;
        break;
      }
      groupPermissions[permission] = resolved;
    }
    if (!groupSatisfied) continue;

    satisfiedPermissionGroupIndexes.push(groupIndex);
    for (const [permission, scope] of Object.entries(groupPermissions)) {
      const existing = resolvedPermissions[permission];
      if (!existing || SCOPE_RANK[scope] > SCOPE_RANK[existing]) {
        resolvedPermissions[permission] = scope;
      }
    }
  }
  if (satisfiedPermissionGroupIndexes.length === 0) {
    throw actorForbidden(
      actorContext.requestId,
      "capability_ops_permission_denied"
    );
  }

  const declaredPermissions = Object.freeze(
    Array.from(
      new Set(
        policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      )
    ).sort((left, right) => left.localeCompare(right))
  );

  const authorization = {
    actorContext,
    capabilityId: policy.capabilityId.trim(),
    capabilityRevision: policy.capabilityRevision.trim(),
    capabilityManifestRevision: policy.capabilityManifestRevision.trim(),
    declaredOAuthScopes,
    declaredPermissions,
    resolvedPermissions: Object.freeze(resolvedPermissions),
    satisfiedPermissionGroupIndexes: Object.freeze(
      satisfiedPermissionGroupIndexes
    ),
    satisfiedOAuthScopes,
  };
  AUTHORIZED_CAPABILITIES.add(authorization);
  return Object.freeze(authorization) as AuthorizedCapability;
}

export function isAuthorizedCapability(
  value: unknown
): value is AuthorizedCapability {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_CAPABILITIES.has(value)
  );
}
