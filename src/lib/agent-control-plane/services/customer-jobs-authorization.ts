import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ParsedCustomerJobsInput } from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const CAPABILITY_ID = "list_customer_jobs" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_CUSTOMER_JOBS_READ: unique symbol;

export interface AuthorizedCustomerJobsRead {
  readonly [AUTHORIZED_CUSTOMER_JOBS_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly clientsScope: "all" | "assigned";
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly query: ParsedCustomerJobsInput;
}

export interface Task13AuthorizedReadBase<
  TCapabilityId extends string,
  TQuery,
> {
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: TCapabilityId;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissions: Readonly<Record<string, PermissionScope>>;
  readonly query: TQuery;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
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

function permissionKeys(
  policy: ReturnType<
    typeof resolveCapabilityAuthorization
  >["variants"][number]["policy"]
): string[] {
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
  capabilityId: string,
  policy: ReturnType<
    typeof resolveCapabilityAuthorization
  >["variants"][number]["policy"]
): boolean {
  const expectedPermissions = permissionKeys(policy);
  const expectedOAuthScopes =
    proof.actorContext.auth.channel === "mcp" ? policy.requiredOAuthScopes : [];
  return (
    proof.capabilityId === capabilityId &&
    proof.capabilityRevision === policy.capabilityRevision &&
    proof.capabilityManifestRevision === CAPABILITY_MANIFEST_REVISION &&
    policy.capabilityManifestRevision === CAPABILITY_MANIFEST_REVISION &&
    sameStrings(proof.declaredOAuthScopes, policy.requiredOAuthScopes) &&
    sameStrings(proof.declaredPermissions, expectedPermissions) &&
    sameStrings(Object.keys(proof.resolvedPermissions), expectedPermissions) &&
    proof.satisfiedPermissionGroupIndexes.length === 1 &&
    proof.satisfiedPermissionGroupIndexes[0] === 0 &&
    sameStrings(proof.satisfiedOAuthScopes, expectedOAuthScopes)
  );
}

/**
 * Shared Task 13 proof verifier. Domain modules must wrap its result in their
 * own nominal WeakSet proof before any repository read is permitted.
 */
export function authorizeTask13CapabilityReadInternal<
  TCapabilityId extends string,
  TQuery,
>(input: {
  readonly capabilityId: TCapabilityId;
  readonly errorNamespace: string;
  readonly authorizations:
    | AuthorizedCapability
    | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): Task13AuthorizedReadBase<TCapabilityId, TQuery> {
  const authorizations = Object.freeze(
    Array.isArray(input.authorizations)
      ? Array.from(input.authorizations)
      : [input.authorizations]
  );
  if (
    authorizations.length === 0 ||
    authorizations.some((proof) => !isAuthorizedCapability(proof))
  ) {
    throw authorizationInternal(
      "unknown-request",
      `${input.errorNamespace}_capability_untrusted`
    );
  }

  const actorContext = authorizations[0]!.actorContext;
  if (authorizations.some((proof) => proof.actorContext !== actorContext)) {
    throw authorizationInternal(
      actorContext.requestId,
      `${input.errorNamespace}_actor_mismatch`
    );
  }

  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(
      input.capabilityId,
      input.rawInput
    );
  } catch {
    throw authorizationInternal(
      actorContext.requestId,
      `${input.errorNamespace}_input_untrusted`
    );
  }
  if (
    resolved.capability.name !== input.capabilityId ||
    resolved.variants.length !== authorizations.length ||
    new Set(authorizations).size !== authorizations.length ||
    resolved.variants.some(
      (variant) =>
        variant.policy.capabilityId !== input.capabilityId ||
        variant.policy.capabilityRevision !==
          resolved.variants[0]?.policy.capabilityRevision ||
        variant.policy.capabilityManifestRevision !==
          CAPABILITY_MANIFEST_REVISION
    )
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      `${input.errorNamespace}_variant_mismatch`
    );
  }

  const unmatched = [...authorizations];
  const resolvedPermissions: Record<string, PermissionScope> = {};
  for (const variant of resolved.variants) {
    const matchIndex = unmatched.findIndex((authorization) =>
      proofMatchesPolicy(authorization, input.capabilityId, variant.policy)
    );
    if (matchIndex < 0) {
      throw authorizationInternal(
        actorContext.requestId,
        `${input.errorNamespace}_capability_identity_mismatch`
      );
    }
    const [authorization] = unmatched.splice(matchIndex, 1);
    for (const [permission, permissionScope] of Object.entries(
      authorization.resolvedPermissions as Readonly<
        Record<string, PermissionScope>
      >
    )) {
      const existing = resolvedPermissions[permission];
      if (existing !== undefined && existing !== permissionScope) {
        throw authorizationInternal(
          actorContext.requestId,
          `${input.errorNamespace}_permission_scope_mismatch`
        );
      }
      resolvedPermissions[permission] = permissionScope;
    }
  }
  if (unmatched.length !== 0) {
    throw authorizationInternal(
      actorContext.requestId,
      `${input.errorNamespace}_capability_identity_mismatch`
    );
  }

  const requiredOAuthScopes = Array.from(
    new Set(
      resolved.variants.flatMap((variant) => variant.policy.requiredOAuthScopes)
    )
  ).sort();
  if (
    actorContext.auth.channel === "mcp" &&
    requiredOAuthScopes.some(
      (required) => !actorContext.auth.scopeCeiling.includes(required)
    )
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      `${input.errorNamespace}_oauth_scope_unproven`
    );
  }

  return Object.freeze({
    actorContext,
    capabilityId: input.capabilityId,
    capabilityRevision: resolved.variants[0]!.policy.capabilityRevision,
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    requiredOAuthScopes: Object.freeze(requiredOAuthScopes),
    resolvedPermissions: Object.freeze({ ...resolvedPermissions }),
    query: resolved.parsedInput as TQuery,
  });
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

export function authorizeCustomerJobsRead(input: {
  readonly authorizations:
    | AuthorizedCapability
    | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedCustomerJobsRead {
  const base = authorizeTask13CapabilityReadInternal<
    typeof CAPABILITY_ID,
    ParsedCustomerJobsInput
  >({
    capabilityId: CAPABILITY_ID,
    errorNamespace: "customer_jobs",
    ...input,
  });
  const clientsScope = scope(base.resolvedPermissions["clients.view"], [
    "all",
    "assigned",
  ]);
  const pipelineScope = scope(base.resolvedPermissions["pipeline.view"], [
    "all",
    "assigned",
  ]);
  const projectsScope = scope(base.resolvedPermissions["projects.view"], [
    "all",
    "assigned",
  ]);
  if (
    !clientsScope ||
    (base.query.job_kinds.includes("opportunity") && !pipelineScope) ||
    (base.query.job_kinds.includes("project") && !projectsScope)
  ) {
    throw authorizationInternal(
      base.actorContext.requestId,
      "customer_jobs_permission_union_invalid"
    );
  }

  const proof = Object.freeze({
    actorContext: base.actorContext,
    capabilityId: base.capabilityId,
    capabilityRevision: base.capabilityRevision,
    capabilityManifestRevision: base.capabilityManifestRevision,
    requiredOAuthScopes: base.requiredOAuthScopes,
    clientsScope,
    pipelineScope,
    projectsScope,
    query: base.query,
  });
  PROOFS.add(proof);
  return proof as unknown as AuthorizedCustomerJobsRead;
}

export function isAuthorizedCustomerJobsRead(
  value: unknown
): value is AuthorizedCustomerJobsRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
