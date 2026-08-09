import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  getCapabilityManifestEntry,
  CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { PermissionScope } from "@/lib/types/permissions";

const CAPABILITY_ID = "get_correspondence_evidence" as const;
const VARIANT_KEY = "correspondence_evidence" as const;
const REQUIRED_OAUTH_SCOPE = "ops.correspondence.read" as const;
const REQUIRED_PERMISSION = "inbox.view" as const;

declare const AUTHORIZED_CORRESPONDENCE_EVIDENCE_READ: unique symbol;
const AUTHORIZED_CORRESPONDENCE_EVIDENCE_READS = new WeakSet<object>();

interface AuthorizedCorrespondenceEvidenceReadBrand {
  readonly [AUTHORIZED_CORRESPONDENCE_EVIDENCE_READ]: true;
}

/** Exact, capability-specific proof consumed by the evidence repository. */
export interface AuthorizedCorrespondenceEvidenceRead extends AuthorizedCorrespondenceEvidenceReadBrand {
  readonly actorContext: ActorContext;
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScope: typeof REQUIRED_OAUTH_SCOPE;
  readonly inboxScope: PermissionScope;
}

function sameStrings(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function authorizeCorrespondenceEvidenceRead(
  authorization: AuthorizedCapability
): AuthorizedCorrespondenceEvidenceRead {
  if (!isAuthorizedCapability(authorization)) {
    throw authorizationInternal(
      "unknown-request",
      "correspondence_evidence_capability_untrusted"
    );
  }

  const { actorContext } = authorization;
  const entry = getCapabilityManifestEntry(CAPABILITY_ID);
  const variant = entry.authorization.variants.find(
    (candidate) => candidate.key === VARIANT_KEY
  );
  if (!variant) {
    throw authorizationInternal(
      actorContext.requestId,
      "correspondence_evidence_manifest_variant_missing"
    );
  }
  const { policy } = variant;
  const allowedInboxScopes = policy.permissionRequirementGroups[0]?.find(
    (requirement) => requirement.permission === REQUIRED_PERMISSION
  )?.allowedScopes;
  const inboxScope = authorization.resolvedPermissions[REQUIRED_PERMISSION];
  const resolvedPermissionKeys = Object.keys(
    authorization.resolvedPermissions
  ).sort((left, right) => left.localeCompare(right));

  if (
    entry.name !== CAPABILITY_ID ||
    authorization.capabilityId !== CAPABILITY_ID ||
    authorization.capabilityRevision !== policy.capabilityRevision ||
    authorization.capabilityManifestRevision !== CAPABILITY_MANIFEST_REVISION ||
    authorization.capabilityManifestRevision !==
      policy.capabilityManifestRevision ||
    !sameStrings(policy.requiredOAuthScopes, [REQUIRED_OAUTH_SCOPE]) ||
    !sameStrings(authorization.declaredPermissions, [REQUIRED_PERMISSION]) ||
    !sameStrings(resolvedPermissionKeys, [REQUIRED_PERMISSION]) ||
    !sameStrings(authorization.satisfiedPermissionGroupIndexes.map(String), [
      "0",
    ]) ||
    !inboxScope ||
    !allowedInboxScopes?.includes(inboxScope)
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "correspondence_evidence_capability_identity_mismatch"
    );
  }

  if (actorContext.auth.channel === "mcp") {
    if (
      !sameStrings(authorization.satisfiedOAuthScopes, [
        REQUIRED_OAUTH_SCOPE,
      ]) ||
      !actorContext.auth.scopeCeiling.includes(REQUIRED_OAUTH_SCOPE)
    ) {
      throw authorizationInternal(
        actorContext.requestId,
        "correspondence_evidence_oauth_scope_unproven"
      );
    }
  } else if (authorization.satisfiedOAuthScopes.length !== 0) {
    throw authorizationInternal(
      actorContext.requestId,
      "correspondence_evidence_internal_oauth_state_invalid"
    );
  }

  const proof = {
    actorContext,
    capabilityId: CAPABILITY_ID,
    capabilityRevision: policy.capabilityRevision,
    capabilityManifestRevision: policy.capabilityManifestRevision,
    requiredOAuthScope: REQUIRED_OAUTH_SCOPE,
    inboxScope,
  };
  AUTHORIZED_CORRESPONDENCE_EVIDENCE_READS.add(proof);
  return Object.freeze(proof) as AuthorizedCorrespondenceEvidenceRead;
}

export function isAuthorizedCorrespondenceEvidenceRead(
  value: unknown
): value is AuthorizedCorrespondenceEvidenceRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_CORRESPONDENCE_EVIDENCE_READS.has(value)
  );
}
