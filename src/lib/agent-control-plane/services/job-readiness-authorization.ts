import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ParsedJobReadinessIssuesInput } from "@/lib/agent-control-plane/contracts/schedule";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const CAPABILITY_ID = "list_job_readiness_issues" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_JOB_READINESS_READ: unique symbol;

export interface AuthorizedJobReadinessRead {
  readonly [AUTHORIZED_JOB_READINESS_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly calendarScope: "all" | "own";
  readonly clientsScope: "all" | "assigned" | null;
  readonly photosScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned";
  readonly tasksScope: "all" | "assigned";
  readonly query: ParsedJobReadinessIssuesInput;
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStrings(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  const left = sorted(actual);
  const right = sorted(expected);
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function policyPermissionKeys(
  policy: ReturnType<
    typeof resolveCapabilityAuthorization
  >["variants"][number]["policy"]
): readonly string[] {
  return Array.from(
    new Set(
      policy.permissionRequirementGroups.flatMap((group) =>
        group.map((requirement) => requirement.permission)
      )
    )
  ).sort();
}

function proofMatchesPolicy(
  proof: AuthorizedCapability,
  policy: ReturnType<
    typeof resolveCapabilityAuthorization
  >["variants"][number]["policy"]
): boolean {
  const expectedPermissions = policyPermissionKeys(policy);
  const actualPermissionKeys = Object.keys(proof.resolvedPermissions);
  const expectedSatisfiedOAuthScopes =
    proof.actorContext.auth.channel === "mcp" ? policy.requiredOAuthScopes : [];
  return (
    proof.capabilityId === CAPABILITY_ID &&
    proof.capabilityRevision === policy.capabilityRevision &&
    proof.capabilityManifestRevision === CAPABILITY_MANIFEST_REVISION &&
    sameStrings(proof.declaredPermissions, expectedPermissions) &&
    sameStrings(actualPermissionKeys, expectedPermissions) &&
    sameStrings(proof.satisfiedOAuthScopes, expectedSatisfiedOAuthScopes) &&
    sameStrings(proof.satisfiedPermissionGroupIndexes.map(String), ["0"])
  );
}

export function authorizeJobReadinessRead(input: {
  readonly authorizations:
    AuthorizedCapability | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedJobReadinessRead {
  const authorizations = Array.isArray(input.authorizations)
    ? input.authorizations
    : [input.authorizations];
  if (
    authorizations.length === 0 ||
    authorizations.some((proof) => !isAuthorizedCapability(proof))
  ) {
    throw authorizationInternal(
      "unknown-request",
      "job_readiness_capability_untrusted"
    );
  }
  const actorContext = authorizations[0]!.actorContext;
  if (authorizations.some((proof) => proof.actorContext !== actorContext)) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_readiness_actor_mismatch"
    );
  }
  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(CAPABILITY_ID, input.rawInput);
  } catch {
    throw authorizationInternal(
      actorContext.requestId,
      "job_readiness_input_untrusted"
    );
  }
  if (
    resolved.capability.name !== CAPABILITY_ID ||
    resolved.variants.length !== authorizations.length ||
    new Set(authorizations).size !== authorizations.length
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_readiness_variant_mismatch"
    );
  }

  const requiredOAuthScopes = Array.from(
    new Set(
      resolved.variants.flatMap((variant) => variant.policy.requiredOAuthScopes)
    )
  ).sort();
  const resolvedPermissions: Record<string, PermissionScope> = {};
  const unmatched = [...authorizations];
  for (const variant of resolved.variants) {
    const matchIndex = unmatched.findIndex((authorization) =>
      proofMatchesPolicy(authorization, variant.policy)
    );
    if (matchIndex < 0) {
      throw authorizationInternal(
        actorContext.requestId,
        "job_readiness_capability_identity_mismatch"
      );
    }
    const [authorization] = unmatched.splice(matchIndex, 1);
    Object.assign(resolvedPermissions, authorization.resolvedPermissions);
  }
  if (unmatched.length !== 0) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_readiness_capability_identity_mismatch"
    );
  }
  const calendarScope = scope(resolvedPermissions["calendar.view"], [
    "all",
    "own",
  ]);
  const projectsScope = scope(resolvedPermissions["projects.view"], [
    "all",
    "assigned",
  ]);
  const tasksScope = scope(resolvedPermissions["tasks.view"], [
    "all",
    "assigned",
  ]);
  const clientsScope = scope(resolvedPermissions["clients.view"], [
    "all",
    "assigned",
  ]);
  const photosScope = scope(resolvedPermissions["photos.view"], [
    "all",
    "assigned",
  ]);
  const query = resolved.parsedInput as ParsedJobReadinessIssuesInput;
  if (
    !calendarScope ||
    !projectsScope ||
    !tasksScope ||
    (query.rule_codes.includes("CUSTOMER_RECORD_UNRESOLVED") &&
      !clientsScope) ||
    (query.rule_codes.includes("SITE_PHOTOS_MISSING") && !photosScope)
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_readiness_permission_union_invalid"
    );
  }
  if (
    actorContext.auth.channel === "mcp" &&
    requiredOAuthScopes.some(
      (required) => !actorContext.auth.scopeCeiling.includes(required)
    )
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_readiness_oauth_scope_unproven"
    );
  }
  const proof = {
    actorContext,
    capabilityId: CAPABILITY_ID,
    capabilityRevision: resolved.variants[0]!.policy.capabilityRevision,
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    requiredOAuthScopes: Object.freeze(requiredOAuthScopes),
    calendarScope,
    clientsScope,
    photosScope,
    projectsScope,
    tasksScope,
    query: Object.freeze({
      ...query,
      rule_codes: Object.freeze([...query.rule_codes]),
    }),
  };
  PROOFS.add(proof);
  return Object.freeze(proof) as unknown as AuthorizedJobReadinessRead;
}

export function isAuthorizedJobReadinessRead(
  value: unknown
): value is AuthorizedJobReadinessRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
