import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  isManifestCapabilityPolicy,
  type ManifestCapabilityPolicy,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";

export interface P2ReadPolicyExpectation {
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly declaredPermissions: readonly string[];
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly resolvedPermissionKeys: readonly string[];
}

export interface P2ValidatedReadPolicyBinding {
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissions: AuthorizedCapability["resolvedPermissions"];
}

export class P2ReadAuthorizationError extends Error {
  readonly code = "P2_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("P2_READ_AUTHORIZATION_INVALID");
    this.name = "P2ReadAuthorizationError";
  }
}

function same<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] | null {
  if (
    values.some(
      (value) => typeof value !== "string" || !value || value !== value.trim()
    ) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return Object.freeze(
    [...values].sort((left, right) => left.localeCompare(right))
  );
}

function declaredPolicyPermissions(
  policy: ManifestCapabilityPolicy
): readonly string[] {
  return Object.freeze(
    Array.from(
      new Set(
        policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      )
    ).sort((left, right) => left.localeCompare(right))
  );
}

/**
 * Validates an already nominally minted manifest policy and capability proof.
 * The shared kernel returns only a frozen snapshot; each domain remains
 * responsible for minting its own WeakSet-backed authorization.
 */
export function assertP2ReadPolicyBinding(input: {
  readonly authorization: unknown;
  readonly policy: unknown;
  readonly expected: P2ReadPolicyExpectation;
}): P2ValidatedReadPolicyBinding {
  if (
    !isAuthorizedCapability(input.authorization) ||
    !isManifestCapabilityPolicy(input.policy)
  ) {
    throw new P2ReadAuthorizationError();
  }

  const expectedOAuth = uniqueSorted(input.expected.requiredOAuthScopes);
  const expectedPermissions = uniqueSorted(input.expected.declaredPermissions);
  const expectedResolvedKeys = uniqueSorted(
    input.expected.resolvedPermissionKeys
  );
  const policyPermissions = declaredPolicyPermissions(input.policy);
  const actualResolvedKeys = Object.keys(
    input.authorization.resolvedPermissions
  ).sort((left, right) => left.localeCompare(right));
  const expectedSatisfiedOAuth =
    input.authorization.actorContext.auth.channel === "mcp"
      ? input.expected.requiredOAuthScopes
      : [];

  if (
    !expectedOAuth ||
    !expectedPermissions ||
    !expectedResolvedKeys ||
    !same(input.expected.requiredOAuthScopes, expectedOAuth) ||
    !same(input.expected.declaredPermissions, expectedPermissions) ||
    !same(input.expected.resolvedPermissionKeys, expectedResolvedKeys) ||
    input.expected.capabilityId !== input.policy.capabilityId ||
    input.expected.capabilityRevision !== input.policy.capabilityRevision ||
    input.expected.capabilityManifestRevision !==
      input.policy.capabilityManifestRevision ||
    !same(
      input.policy.requiredOAuthScopes,
      input.expected.requiredOAuthScopes
    ) ||
    !same(policyPermissions, input.expected.declaredPermissions) ||
    input.authorization.capabilityId !== input.expected.capabilityId ||
    input.authorization.capabilityRevision !==
      input.expected.capabilityRevision ||
    input.authorization.capabilityManifestRevision !==
      input.expected.capabilityManifestRevision ||
    input.authorization.actorContext.capabilityManifestRevision !==
      input.expected.capabilityManifestRevision ||
    !same(
      input.authorization.declaredOAuthScopes,
      input.expected.requiredOAuthScopes
    ) ||
    !same(input.authorization.satisfiedOAuthScopes, expectedSatisfiedOAuth) ||
    !same(
      input.authorization.declaredPermissions,
      input.expected.declaredPermissions
    ) ||
    !same(
      input.authorization.satisfiedPermissionGroupIndexes,
      input.expected.satisfiedPermissionGroupIndexes
    ) ||
    !same(actualResolvedKeys, input.expected.resolvedPermissionKeys)
  ) {
    throw new P2ReadAuthorizationError();
  }

  return Object.freeze({
    actorContext: input.authorization.actorContext,
    capabilityId: input.authorization.capabilityId,
    capabilityRevision: input.authorization.capabilityRevision,
    capabilityManifestRevision: input.authorization.capabilityManifestRevision,
    requiredOAuthScopes: Object.freeze([
      ...input.authorization.declaredOAuthScopes,
    ]),
    resolvedPermissions: Object.freeze({
      ...input.authorization.resolvedPermissions,
    }),
  });
}
