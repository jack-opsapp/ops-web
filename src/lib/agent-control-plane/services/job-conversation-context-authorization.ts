import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { JobRef } from "@/lib/agent-control-plane/contracts";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { PermissionScope } from "@/lib/types/permissions";

const CAPABILITY_ID = "get_job_conversation_context" as const;
const REQUIRED_OAUTH_SCOPES = Object.freeze([
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.jobs.read",
] as const);
const DEFAULT_SECTIONS = Object.freeze([
  "memory",
  "recent_turns",
  "participants",
  "gaps",
  "cross_job_seed",
] as const);

export type JobConversationContextRequestedSection =
  (typeof DEFAULT_SECTIONS)[number];

declare const AUTHORIZED_JOB_CONVERSATION_CONTEXT_READ: unique symbol;
const AUTHORIZED_READS = new WeakSet<object>();

interface AuthorizedJobConversationContextReadBrand {
  readonly [AUTHORIZED_JOB_CONVERSATION_CONTEXT_READ]: true;
}

export interface AuthorizedJobConversationContextRead extends AuthorizedJobConversationContextReadBrand {
  readonly actorContext: ActorContext;
  readonly capabilityId: typeof CAPABILITY_ID;
  readonly capabilityRevision: string;
  readonly capabilityManifestRevision: string;
  readonly requiredOAuthScopes: typeof REQUIRED_OAUTH_SCOPES;
  readonly jobRef: JobRef;
  readonly exactTurnLimit: number;
  readonly requiredThroughTurnId: string | null;
  readonly sections: readonly JobConversationContextRequestedSection[];
  readonly inboxScope: "all";
  readonly clientsScope: "all";
  readonly jobPermission: "pipeline.view" | "projects.view";
  readonly jobScope: PermissionScope;
}

export interface AuthorizeJobConversationContextReadInput {
  readonly authorization: AuthorizedCapability;
  readonly rawInput: unknown;
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

function asParsedInput(value: unknown): {
  job_ref: JobRef;
  exact_turn_limit: number;
  required_through_turn_id?: string;
  sections: JobConversationContextRequestedSection[];
} {
  return value as {
    job_ref: JobRef;
    exact_turn_limit: number;
    required_through_turn_id?: string;
    sections: JobConversationContextRequestedSection[];
  };
}

/**
 * Narrows the generic manifest proof to the one exact read the repository can
 * consume. The proof binds the parsed job reference and all prompt bounds.
 */
export function authorizeJobConversationContextRead({
  authorization,
  rawInput,
}: AuthorizeJobConversationContextReadInput): AuthorizedJobConversationContextRead {
  if (!isAuthorizedCapability(authorization)) {
    throw authorizationInternal(
      "unknown-request",
      "job_conversation_context_capability_untrusted"
    );
  }

  const { actorContext } = authorization;
  let resolved: ReturnType<typeof resolveCapabilityAuthorization>;
  try {
    resolved = resolveCapabilityAuthorization(CAPABILITY_ID, rawInput);
  } catch {
    throw authorizationInternal(
      actorContext.requestId,
      "job_conversation_context_input_untrusted"
    );
  }
  if (resolved.variants.length !== 1) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_conversation_context_variant_ambiguous"
    );
  }

  const parsed = asParsedInput(resolved.parsedInput);
  const variant = resolved.variants[0]!;
  const policy = variant.policy;
  const expectedVariant = parsed.job_ref.kind;
  const jobPermission =
    parsed.job_ref.kind === "opportunity"
      ? ("pipeline.view" as const)
      : ("projects.view" as const);
  const resolvedPermissionKeys = Object.keys(
    authorization.resolvedPermissions
  ).sort((left, right) => left.localeCompare(right));
  const expectedPermissionKeys = [
    "clients.view",
    "inbox.view",
    jobPermission,
  ].sort((left, right) => left.localeCompare(right));
  const inboxScope = authorization.resolvedPermissions["inbox.view"];
  const clientsScope = authorization.resolvedPermissions["clients.view"];
  const jobScope = authorization.resolvedPermissions[jobPermission];

  if (
    resolved.capability.name !== CAPABILITY_ID ||
    variant.key !== expectedVariant ||
    authorization.capabilityId !== CAPABILITY_ID ||
    authorization.capabilityRevision !== policy.capabilityRevision ||
    authorization.capabilityManifestRevision !== CAPABILITY_MANIFEST_REVISION ||
    authorization.capabilityManifestRevision !==
      policy.capabilityManifestRevision ||
    !sameStrings(policy.requiredOAuthScopes, REQUIRED_OAUTH_SCOPES) ||
    !sameStrings(authorization.declaredPermissions, expectedPermissionKeys) ||
    !sameStrings(resolvedPermissionKeys, expectedPermissionKeys) ||
    !sameStrings(authorization.satisfiedPermissionGroupIndexes.map(String), [
      "0",
    ]) ||
    inboxScope !== "all" ||
    clientsScope !== "all" ||
    !jobScope ||
    !["all", "assigned"].includes(jobScope)
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_conversation_context_capability_identity_mismatch"
    );
  }

  if (actorContext.auth.channel === "mcp") {
    const scopeCeiling = actorContext.auth.scopeCeiling;
    if (
      !sameStrings(authorization.satisfiedOAuthScopes, REQUIRED_OAUTH_SCOPES) ||
      REQUIRED_OAUTH_SCOPES.some((scope) => !scopeCeiling.includes(scope))
    ) {
      throw authorizationInternal(
        actorContext.requestId,
        "job_conversation_context_oauth_scope_unproven"
      );
    }
  } else if (authorization.satisfiedOAuthScopes.length !== 0) {
    throw authorizationInternal(
      actorContext.requestId,
      "job_conversation_context_internal_oauth_state_invalid"
    );
  }

  const proof = {
    actorContext,
    capabilityId: CAPABILITY_ID,
    capabilityRevision: policy.capabilityRevision,
    capabilityManifestRevision: policy.capabilityManifestRevision,
    requiredOAuthScopes: REQUIRED_OAUTH_SCOPES,
    jobRef: Object.freeze({ ...parsed.job_ref }),
    exactTurnLimit: parsed.exact_turn_limit,
    requiredThroughTurnId: parsed.required_through_turn_id ?? null,
    sections: Object.freeze([...(parsed.sections ?? DEFAULT_SECTIONS)]),
    inboxScope,
    clientsScope,
    jobPermission,
    jobScope,
  };
  AUTHORIZED_READS.add(proof);
  return Object.freeze(proof) as AuthorizedJobConversationContextRead;
}

export function isAuthorizedJobConversationContextRead(
  value: unknown
): value is AuthorizedJobConversationContextRead {
  return (
    typeof value === "object" && value !== null && AUTHORIZED_READS.has(value)
  );
}
