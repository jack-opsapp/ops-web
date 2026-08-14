import "server-only";

import type { PermissionScope } from "@/lib/types/permissions";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ParsedJobCommunicationContextInput } from "@/lib/agent-control-plane/contracts/communication";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const CAPABILITY_ID = "get_job_communication_context" as const;
const PROOFS = new WeakSet<object>();
declare const AUTHORIZED_JOB_COMMUNICATION_READ: unique symbol;

export interface AuthorizedJobCommunicationRead {
  readonly [AUTHORIZED_JOB_COMMUNICATION_READ]: true;
  readonly actorContext: AuthorizedCapability["actorContext"];
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: readonly string[];
  readonly calendarScope: "all" | "own" | null;
  readonly clientsScope: "all" | "assigned";
  readonly inboxScope: "all" | "assigned" | "own";
  readonly photosScope: "all" | "assigned" | null;
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly tasksScope: "all" | "assigned" | null;
  readonly query: ParsedJobCommunicationContextInput;
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
  policy: ReturnType<
    typeof resolveCapabilityAuthorization
  >["variants"][number]["policy"]
): boolean {
  const expectedPermissions = permissionKeys(policy);
  const expectedOAuthScopes =
    proof.actorContext.auth.channel === "mcp" ? policy.requiredOAuthScopes : [];
  return (
    proof.capabilityId === CAPABILITY_ID &&
    proof.capabilityRevision === policy.capabilityRevision &&
    proof.capabilityManifestRevision === CAPABILITY_MANIFEST_REVISION &&
    policy.capabilityManifestRevision === CAPABILITY_MANIFEST_REVISION &&
    sameStrings(proof.declaredPermissions, expectedPermissions) &&
    sameStrings(Object.keys(proof.resolvedPermissions), expectedPermissions) &&
    proof.satisfiedPermissionGroupIndexes.length === 1 &&
    proof.satisfiedPermissionGroupIndexes[0] === 0 &&
    sameStrings(proof.satisfiedOAuthScopes, expectedOAuthScopes)
  );
}

function scope<T extends PermissionScope>(
  value: PermissionScope | undefined,
  allowed: readonly T[]
): T | null {
  return value && allowed.includes(value as T) ? (value as T) : null;
}

export function authorizeJobCommunicationRead(input: {
  readonly authorizations:
    | AuthorizedCapability
    | readonly AuthorizedCapability[];
  readonly rawInput: unknown;
}): AuthorizedJobCommunicationRead {
  const suppliedAuthorizations = input.authorizations;
  const rawInput = input.rawInput;
  const authorizations = Object.freeze(
    Array.isArray(suppliedAuthorizations)
      ? Array.from(suppliedAuthorizations)
      : [suppliedAuthorizations]
  );
  if (
    authorizations.length === 0 ||
    authorizations.some((proof) => !isAuthorizedCapability(proof))
  ) {
    throw authorizationInternal(
      "unknown-request",
      "job_communication_capability_untrusted"
    );
  }

  const actorContext = authorizations[0]!.actorContext;
  if (authorizations.some((proof) => proof.actorContext !== actorContext)) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_communication_actor_mismatch"
    );
  }

  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(CAPABILITY_ID, rawInput);
  } catch {
    throw authorizationInternal(
      actorContext.requestId,
      "job_communication_input_untrusted"
    );
  }
  if (
    resolved.capability.name !== CAPABILITY_ID ||
    resolved.variants.length !== authorizations.length ||
    new Set(authorizations).size !== authorizations.length ||
    resolved.variants.some(
      (variant) =>
        variant.policy.capabilityId !== CAPABILITY_ID ||
        variant.policy.capabilityRevision !==
          resolved.variants[0]?.policy.capabilityRevision ||
        variant.policy.capabilityManifestRevision !==
          CAPABILITY_MANIFEST_REVISION
    )
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_communication_variant_mismatch"
    );
  }

  const unmatched = [...authorizations];
  const resolvedPermissions: Record<string, PermissionScope> = {};
  for (const variant of resolved.variants) {
    const matchIndex = unmatched.findIndex((authorization) =>
      proofMatchesPolicy(authorization, variant.policy)
    );
    if (matchIndex < 0) {
      throw authorizationInternal(
        actorContext.requestId,
        "job_communication_capability_identity_mismatch"
      );
    }
    const [authorization] = unmatched.splice(matchIndex, 1);
    Object.assign(resolvedPermissions, authorization.resolvedPermissions);
  }
  if (unmatched.length !== 0) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_communication_capability_identity_mismatch"
    );
  }

  const query = resolved.parsedInput as ParsedJobCommunicationContextInput;
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
      "job_communication_oauth_scope_unproven"
    );
  }

  const calendarScope = scope(resolvedPermissions["calendar.view"], [
    "all",
    "own",
  ]);
  const clientsScope = scope(resolvedPermissions["clients.view"], [
    "all",
    "assigned",
  ]);
  const inboxScope = scope(resolvedPermissions["inbox.view"], [
    "all",
    "assigned",
    "own",
  ]);
  const photosScope = scope(resolvedPermissions["photos.view"], [
    "all",
    "assigned",
  ]);
  const pipelineScope = scope(resolvedPermissions["pipeline.view"], [
    "all",
    "assigned",
  ]);
  const projectsScope = scope(resolvedPermissions["projects.view"], [
    "all",
    "assigned",
  ]);
  const tasksScope = scope(resolvedPermissions["tasks.view"], [
    "all",
    "assigned",
  ]);
  const needsSchedule =
    query.purpose === "schedule_notice" || query.purpose === "photo_request";
  if (
    !clientsScope ||
    !inboxScope ||
    (query.job_ref.kind === "opportunity" && !pipelineScope) ||
    (query.job_ref.kind === "project" && !projectsScope) ||
    (needsSchedule && (!calendarScope || !projectsScope || !tasksScope)) ||
    (query.purpose === "photo_request" && !photosScope)
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_communication_permission_union_invalid"
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
    inboxScope,
    photosScope,
    pipelineScope,
    projectsScope,
    tasksScope,
    query: Object.freeze({
      ...query,
      job_ref: Object.freeze({ ...query.job_ref }),
    }),
  };
  PROOFS.add(proof);
  return Object.freeze(proof) as unknown as AuthorizedJobCommunicationRead;
}

export function isAuthorizedJobCommunicationRead(
  value: unknown
): value is AuthorizedJobCommunicationRead {
  return typeof value === "object" && value !== null && PROOFS.has(value);
}
