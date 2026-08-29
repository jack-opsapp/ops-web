import "server-only";

import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  ListWorkQueueInputSchema,
  normalizeWorkQueueSelections,
  type ListWorkQueueInput,
  type WorkQueueSelection,
  type WorkQueueSource,
} from "@/lib/agent-control-plane/contracts/work-queue";
import { LIST_WORK_QUEUE_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/work-queue";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";

const AUTHORIZED_WORK_QUEUE_READS = new WeakSet<object>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class WorkQueueAuthorizationError extends Error {
  readonly code:
    | "WORK_QUEUE_AUTHORIZATION_INVALID"
    | "WORK_QUEUE_EXPLICIT_SOURCE_UNAUTHORIZED";
  constructor(code: WorkQueueAuthorizationError["code"]) {
    super(code);
    this.name = "WorkQueueAuthorizationError";
    this.code = code;
  }
}

export interface AuthorizedWorkQueueSource {
  readonly source: WorkQueueSource;
  readonly origin: "explicit" | "default";
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
}

export interface AuthorizedWorkQueueRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "list_work_queue";
  readonly capabilityRevision: "list_work_queue:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly query: ListWorkQueueInput;
  readonly selections: readonly WorkQueueSelection[];
  readonly authorizedSources: readonly AuthorizedWorkQueueSource[];
  readonly warnings: readonly Readonly<{
    code: "DEFAULT_COMPONENT_OMITTED";
    source: WorkQueueSource;
  }>[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
function nominalDenial(error: unknown) {
  return (
    error instanceof ActorAccessError &&
    (error.code === "FORBIDDEN" || error.code === "INSUFFICIENT_SCOPE")
  );
}
function variantFor(source: WorkQueueSource) {
  const variant = LIST_WORK_QUEUE_CANDIDATE.authorization.variants.find(
    (candidate) => candidate.key === source
  );
  if (!variant)
    throw new WorkQueueAuthorizationError("WORK_QUEUE_AUTHORIZATION_INVALID");
  return variant;
}
function bindSource(input: {
  source: WorkQueueSource;
  origin: "explicit" | "default";
  authorization: AuthorizedCapability;
}): AuthorizedWorkQueueSource {
  const policy = variantFor(input.source).policy;
  const groupIndexes = [...input.authorization.satisfiedPermissionGroupIndexes];
  const declared = [
    ...new Set(
      groupIndexes.flatMap((index) =>
        policy.permissionRequirementGroups[index]!.map(
          (requirement) => requirement.permission
        )
      )
    ),
  ].sort();
  const resolved = Object.keys(input.authorization.resolvedPermissions).sort();
  const binding = assertP2ReadPolicyBinding({
    authorization: input.authorization,
    policy,
    expected: {
      capabilityId: "list_work_queue",
      capabilityRevision: "list_work_queue:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: policy.requiredOAuthScopes,
      declaredPermissions: declared,
      satisfiedPermissionGroupIndexes: groupIndexes,
      resolvedPermissionKeys: resolved,
    },
  });
  if (
    resolved.length !== declared.length ||
    resolved.some((value, index) => value !== declared[index])
  ) {
    throw new WorkQueueAuthorizationError("WORK_QUEUE_AUTHORIZATION_INVALID");
  }
  return deepFreeze({
    source: input.source,
    origin: input.origin,
    requiredOAuthScopes: [...policy.requiredOAuthScopes],
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(binding.resolvedPermissions).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    ),
    satisfiedPermissionGroupIndexes: groupIndexes,
  });
}

export function authorizeWorkQueueRead(input: {
  query: unknown;
  actorContext: ActorContext;
}): AuthorizedWorkQueueRead {
  if (!isActorContext(input.actorContext))
    throw new WorkQueueAuthorizationError("WORK_QUEUE_AUTHORIZATION_INVALID");
  let query: ListWorkQueueInput;
  let selections: readonly WorkQueueSelection[];
  try {
    const parsed = ListWorkQueueInputSchema.parse(input.query);
    query = deepFreeze({
      ...parsed,
      ...(parsed.sources ? { sources: [...parsed.sources] } : {}),
    });
    selections = normalizeWorkQueueSelections(
      query
    ) as readonly WorkQueueSelection[];
  } catch {
    throw new WorkQueueAuthorizationError("WORK_QUEUE_AUTHORIZATION_INVALID");
  }
  const auth = input.actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !UUID_PATTERN.test(auth.oauthGrantId) ||
    !UUID_PATTERN.test(auth.oauthClientId) ||
    !GRANT_REVISION_PATTERN.test(auth.grantRevision) ||
    auth.scopeCeiling.length === 0
  ) {
    throw new WorkQueueAuthorizationError("WORK_QUEUE_AUTHORIZATION_INVALID");
  }
  const authorizedSources: AuthorizedWorkQueueSource[] = [];
  const warnings: Array<{
    code: "DEFAULT_COMPONENT_OMITTED";
    source: WorkQueueSource;
  }> = [];
  for (const selection of selections) {
    try {
      authorizedSources.push(
        bindSource({
          source: selection.source,
          origin: selection.origin,
          authorization: authorizeCapability({
            actorContext: input.actorContext,
            policy: variantFor(selection.source).policy,
          }),
        })
      );
    } catch (error) {
      if (!nominalDenial(error)) throw error;
      if (selection.origin === "explicit")
        throw new WorkQueueAuthorizationError(
          "WORK_QUEUE_EXPLICIT_SOURCE_UNAUTHORIZED"
        );
      warnings.push({
        code: "DEFAULT_COMPONENT_OMITTED",
        source: selection.source,
      });
    }
  }
  const authorization = deepFreeze({
    actorContext: input.actorContext,
    capabilityId: "list_work_queue" as const,
    capabilityRevision: "list_work_queue:2026-08-22.v1" as const,
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: [...new Set(auth.scopeCeiling)].sort(),
    query,
    selections,
    authorizedSources,
    warnings,
  }) as AuthorizedWorkQueueRead;
  AUTHORIZED_WORK_QUEUE_READS.add(authorization);
  return authorization;
}

export function isAuthorizedWorkQueueRead(
  value: unknown
): value is AuthorizedWorkQueueRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_WORK_QUEUE_READS.has(value)
  );
}
