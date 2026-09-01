import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetTaskContextInputSchema,
  ListTasksInputSchema,
  type GetTaskContextInput,
  type ListTasksInput,
} from "@/lib/agent-control-plane/contracts/tasks";
import {
  GET_TASK_CONTEXT_CANDIDATE,
  LIST_TASKS_CANDIDATE,
  selectedGetTaskContextVariantKeys,
  selectedListTasksVariantKeys,
  type GetTaskContextAuthorizationVariantKey,
  type ListTasksAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/tasks";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_LIST_TASKS_READS = new WeakSet<object>();
const AUTHORIZED_TASK_CONTEXT_READS = new WeakSet<object>();

export class TaskReadAuthorizationError extends Error {
  readonly code = "TASK_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("TASK_READ_AUTHORIZATION_INVALID");
    this.name = "TaskReadAuthorizationError";
  }
}

interface AuthorizedTaskReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly string[];
  readonly tasksScope: "all" | "assigned";
  readonly projectsScope: "all" | "assigned";
  readonly calendarScope: "all" | "own" | null;
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
}

export interface AuthorizedListTasksRead extends AuthorizedTaskReadBase {
  readonly capabilityId: "list_tasks";
  readonly capabilityRevision: "list_tasks:2026-08-22.v1";
  readonly query: ListTasksInput;
  readonly estimatesScope: null;
  readonly projectFinancialsScope: null;
  readonly variantKeys: readonly ListTasksAuthorizationVariantKey[];
}

export interface AuthorizedGetTaskContextRead extends AuthorizedTaskReadBase {
  readonly capabilityId: "get_task_context";
  readonly capabilityRevision: "get_task_context:2026-08-22.v1";
  readonly query: GetTaskContextInput;
  readonly estimatesScope: "all" | "assigned" | null;
  readonly projectFinancialsScope: "all" | null;
  readonly variantKeys: readonly GetTaskContextAuthorizationVariantKey[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].sort((left, right) => left.localeCompare(right))
  );
}

function exactAuthorizationRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TaskReadAuthorizationError();
  }
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const expected = [...expectedKeys].sort((left, right) =>
    left.localeCompare(right)
  );
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TaskReadAuthorizationError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function scope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "estimates.view" | "projects.view" | "tasks.view"
): "all" | "assigned" {
  const value = permissions[key];
  if (value !== "all" && value !== "assigned") {
    throw new TaskReadAuthorizationError();
  }
  return value;
}

function calendarScope(
  permissions: Readonly<Record<string, PermissionScope>>
): "all" | "own" {
  const value = permissions["calendar.view"];
  if (value !== "all" && value !== "own") {
    throw new TaskReadAuthorizationError();
  }
  return value;
}

function projectFinancialsScope(
  permissions: Readonly<Record<string, PermissionScope>>
): "all" {
  if (permissions["projects.view_financials"] !== "all") {
    throw new TaskReadAuthorizationError();
  }
  return "all";
}

function assertSameScope<T extends string>(current: T | null, next: T): T {
  if (current !== null && current !== next) {
    throw new TaskReadAuthorizationError();
  }
  return next;
}

function assertMcpActor(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    !actorContext.auth.oauthGrantId ||
    !actorContext.auth.oauthClientId ||
    !actorContext.auth.grantRevision ||
    actorContext.auth.scopeCeiling.length === 0
  ) {
    throw new TaskReadAuthorizationError();
  }
  return actorContext.auth;
}

function bindVariants(input: {
  readonly candidate:
    | typeof LIST_TASKS_CANDIDATE
    | typeof GET_TASK_CONTEXT_CANDIDATE;
  readonly capabilityId: "get_task_context" | "list_tasks";
  readonly capabilityRevision:
    | "get_task_context:2026-08-22.v1"
    | "list_tasks:2026-08-22.v1";
  readonly variantKeys: readonly string[];
  readonly authorizations: unknown;
}) {
  const authorizations = exactAuthorizationRecord(
    input.authorizations,
    input.variantKeys
  );
  const policies = new Map(
    input.candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );

  let actorContext: ActorContext | null = null;
  let tasksScope: "all" | "assigned" | null = null;
  let projectsScope: "all" | "assigned" | null = null;
  let selectedCalendarScope: "all" | "own" | null = null;
  let estimatesScope: "all" | "assigned" | null = null;
  let selectedProjectFinancialsScope: "all" | null = null;
  const requiredOAuthScopes: string[] = [];

  for (const key of input.variantKeys) {
    const policy = policies.get(key);
    if (!policy) throw new TaskReadAuthorizationError();
    const declaredPermissions = sortedUnique(
      policy.permissionRequirementGroups.flatMap((group) =>
        group.map((requirement) => requirement.permission)
      )
    );
    const binding = assertP2ReadPolicyBinding({
      authorization: authorizations[key],
      policy,
      expected: {
        capabilityId: input.capabilityId,
        capabilityRevision: input.capabilityRevision,
        capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
        requiredOAuthScopes: policy.requiredOAuthScopes,
        declaredPermissions,
        satisfiedPermissionGroupIndexes: [0],
        resolvedPermissionKeys: declaredPermissions,
      },
    });
    if (actorContext !== null && binding.actorContext !== actorContext) {
      throw new TaskReadAuthorizationError();
    }
    actorContext ??= binding.actorContext;
    requiredOAuthScopes.push(...binding.requiredOAuthScopes);
    tasksScope = assertSameScope(
      tasksScope,
      scope(binding.resolvedPermissions, "tasks.view")
    );
    projectsScope = assertSameScope(
      projectsScope,
      scope(binding.resolvedPermissions, "projects.view")
    );
    if (key === "schedule") {
      selectedCalendarScope = assertSameScope(
        selectedCalendarScope,
        calendarScope(binding.resolvedPermissions)
      );
    }
    if (key === "financial_origin") {
      estimatesScope = assertSameScope(
        estimatesScope,
        scope(binding.resolvedPermissions, "estimates.view")
      );
      selectedProjectFinancialsScope = projectFinancialsScope(
        binding.resolvedPermissions
      );
    }
  }

  if (!actorContext || !tasksScope || !projectsScope) {
    throw new TaskReadAuthorizationError();
  }
  const auth = assertMcpActor(actorContext);
  return {
    actorContext,
    requiredOAuthScopes: sortedUnique(requiredOAuthScopes),
    tasksScope,
    projectsScope,
    calendarScope: selectedCalendarScope,
    estimatesScope,
    projectFinancialsScope: selectedProjectFinancialsScope,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
  } as const;
}

export function authorizeListTasksRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListTasksRead {
  try {
    const query = deepFreeze(ListTasksInputSchema.parse(input.query));
    const variantKeys = selectedListTasksVariantKeys(query);
    const binding = bindVariants({
      candidate: LIST_TASKS_CANDIDATE,
      capabilityId: "list_tasks",
      capabilityRevision: "list_tasks:2026-08-22.v1",
      variantKeys,
      authorizations: input.authorizations,
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "list_tasks" as const,
      capabilityRevision: "list_tasks:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      estimatesScope: null,
      projectFinancialsScope: null,
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_LIST_TASKS_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof TaskReadAuthorizationError) throw error;
    throw new TaskReadAuthorizationError();
  }
}

export function authorizeGetTaskContextRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetTaskContextRead {
  try {
    const parsed = GetTaskContextInputSchema.parse(input.query);
    const query = deepFreeze({
      ...parsed,
      sections: [...parsed.sections].sort((left, right) =>
        left.localeCompare(right)
      ),
    }) as GetTaskContextInput;
    const variantKeys = selectedGetTaskContextVariantKeys(query);
    const binding = bindVariants({
      candidate: GET_TASK_CONTEXT_CANDIDATE,
      capabilityId: "get_task_context",
      capabilityRevision: "get_task_context:2026-08-22.v1",
      variantKeys,
      authorizations: input.authorizations,
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "get_task_context" as const,
      capabilityRevision: "get_task_context:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_TASK_CONTEXT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof TaskReadAuthorizationError) throw error;
    throw new TaskReadAuthorizationError();
  }
}

export function isAuthorizedListTasksRead(
  value: unknown
): value is AuthorizedListTasksRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_TASKS_READS.has(value)
  );
}

export function isAuthorizedGetTaskContextRead(
  value: unknown
): value is AuthorizedGetTaskContextRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_TASK_CONTEXT_READS.has(value)
  );
}
