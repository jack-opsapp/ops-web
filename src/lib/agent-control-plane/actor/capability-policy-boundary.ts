import "server-only";

import { canonicalizeAgentMachineStringSet } from "../canonical-order";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "./authority-repository";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";

const REGISTERED_PERMISSION_KEY_SET = new Set<string>(
  REGISTERED_ACTOR_PERMISSION_KEYS
);
const VALID_SCOPES = new Set<PermissionScope>(["all", "assigned", "own"]);
const OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

declare const MANIFEST_CAPABILITY_POLICY: unique symbol;
const MANIFEST_CAPABILITY_POLICIES = new WeakSet<object>();
const ACTIVE_MANIFEST_CAPABILITY_POLICIES = new WeakSet<object>();

interface ManifestCapabilityPolicyBrand {
  readonly [MANIFEST_CAPABILITY_POLICY]: true;
}

export interface CapabilityPermissionRequirement {
  readonly permission: AppPermission;
  readonly allowedScopes: readonly PermissionScope[];
}

export interface ManifestCapabilityPolicy extends ManifestCapabilityPolicyBrand {
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  /** AND within a group; OR across groups. */
  readonly permissionRequirementGroups: readonly (readonly CapabilityPermissionRequirement[])[];
}

export interface ManifestCapabilityPolicyDefinition {
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  /** AND within a group; OR across groups. */
  readonly permissionRequirementGroups: readonly (readonly CapabilityPermissionRequirement[])[];
}

function requiredNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

/**
 * Creates a nominal, immutable policy. Creation alone does not make a policy
 * authorizable: the central capability manifest must activate the exact
 * object after its complete invariants pass.
 */
export function defineCapabilityPolicyForManifest(
  definition: ManifestCapabilityPolicyDefinition
): ManifestCapabilityPolicy {
  const capabilityId = requiredNonBlank(
    definition.capabilityId,
    "capabilityId"
  );
  if (!CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new TypeError("capabilityId is invalid");
  }

  const capabilityRevision = requiredNonBlank(
    definition.capabilityRevision,
    "capabilityRevision"
  );
  const capabilityManifestRevision = requiredNonBlank(
    definition.capabilityManifestRevision,
    "capabilityManifestRevision"
  );

  if (
    !Array.isArray(definition.requiredOAuthScopes) ||
    definition.requiredOAuthScopes.length === 0
  ) {
    throw new TypeError("requiredOAuthScopes must not be empty");
  }
  const normalizedOAuthScopes = definition.requiredOAuthScopes.map(
    (rawScope) => {
      const scope = requiredNonBlank(rawScope, "requiredOAuthScope");
      if (!OAUTH_SCOPE_TOKEN_PATTERN.test(scope)) {
        throw new TypeError("requiredOAuthScope is invalid");
      }
      return scope;
    }
  );
  if (new Set(normalizedOAuthScopes).size !== normalizedOAuthScopes.length) {
    throw new TypeError("requiredOAuthScope is duplicated");
  }
  const requiredOAuthScopes = canonicalizeAgentMachineStringSet(
    normalizedOAuthScopes
  );

  if (
    !Array.isArray(definition.permissionRequirementGroups) ||
    definition.permissionRequirementGroups.length === 0
  ) {
    throw new TypeError("permissionRequirementGroups must not be empty");
  }
  const seenGroupSignatures = new Set<string>();
  const permissionRequirementGroups =
    definition.permissionRequirementGroups.map((rawGroup) => {
      if (!Array.isArray(rawGroup) || rawGroup.length === 0) {
        throw new TypeError("permissionRequirementGroup must not be empty");
      }
      const seenPermissions = new Set<string>();
      const requirements = rawGroup.map((rawRequirement) => {
        if (typeof rawRequirement !== "object" || rawRequirement === null) {
          throw new TypeError("permissionRequirement is invalid");
        }
        const permission = requiredNonBlank(
          rawRequirement.permission,
          "permission"
        );
        if (
          !REGISTERED_PERMISSION_KEY_SET.has(permission) ||
          seenPermissions.has(permission)
        ) {
          throw new TypeError("permission is invalid");
        }
        seenPermissions.add(permission);

        if (
          !Array.isArray(rawRequirement.allowedScopes) ||
          rawRequirement.allowedScopes.length === 0
        ) {
          throw new TypeError("allowedScopes must not be empty");
        }
        const allowedScopes = [...rawRequirement.allowedScopes];
        if (
          allowedScopes.some(
            (scope) =>
              typeof scope !== "string" ||
              !VALID_SCOPES.has(scope as PermissionScope)
          )
        ) {
          throw new TypeError("allowedScope is invalid");
        }
        if (new Set(allowedScopes).size !== allowedScopes.length) {
          throw new TypeError("allowedScope is duplicated");
        }

        return Object.freeze({
          permission: permission as AppPermission,
          allowedScopes: Object.freeze(
            allowedScopes as readonly PermissionScope[]
          ),
        });
      });
      requirements.sort((left, right) =>
        left.permission.localeCompare(right.permission)
      );
      const signature = requirements
        .map(
          (requirement) =>
            `${requirement.permission}:${[...requirement.allowedScopes]
              .sort()
              .join(",")}`
        )
        .join("|");
      if (seenGroupSignatures.has(signature)) {
        throw new TypeError("permissionRequirementGroup is duplicated");
      }
      seenGroupSignatures.add(signature);
      return Object.freeze(requirements);
    });

  const policy = {
    capabilityId,
    capabilityRevision,
    capabilityManifestRevision,
    requiredOAuthScopes,
    permissionRequirementGroups: Object.freeze(permissionRequirementGroups),
  };
  MANIFEST_CAPABILITY_POLICIES.add(policy);
  return Object.freeze(policy) as ManifestCapabilityPolicy;
}

export function isManifestCapabilityPolicy(
  value: unknown
): value is ManifestCapabilityPolicy {
  return (
    typeof value === "object" &&
    value !== null &&
    MANIFEST_CAPABILITY_POLICIES.has(value)
  );
}

/**
 * Activates one exact nominal policy after central manifest validation. A
 * source-boundary regression test keeps this call inside the manifest module.
 */
export function activateCapabilityPolicyForManifest(
  policy: ManifestCapabilityPolicy
): ManifestCapabilityPolicy {
  if (!isManifestCapabilityPolicy(policy)) {
    throw new TypeError("manifest capability policy is untrusted");
  }
  ACTIVE_MANIFEST_CAPABILITY_POLICIES.add(policy);
  return policy;
}

export function isActiveManifestCapabilityPolicy(
  value: unknown
): value is ManifestCapabilityPolicy {
  return (
    isManifestCapabilityPolicy(value) &&
    ACTIVE_MANIFEST_CAPABILITY_POLICIES.has(value)
  );
}
