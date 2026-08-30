import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetExpenseContextInputSchema,
  ListExpensesInputSchema,
  type GetExpenseContextInput,
  type ListExpensesInput,
} from "@/lib/agent-control-plane/contracts/expenses";
import {
  GET_EXPENSE_CONTEXT_CANDIDATE,
  LIST_EXPENSES_CANDIDATE,
  selectedGetExpenseContextVariantKeys,
  selectedListExpensesVariantKeys,
  type ExpenseAuthorizationVariantKey,
  type ExpenseContextAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/expenses";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_LIST_EXPENSE_READS = new WeakSet<object>();
const AUTHORIZED_EXPENSE_CONTEXT_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class ExpenseReadAuthorizationError extends Error {
  readonly code = "EXPENSE_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("EXPENSE_READ_AUTHORIZATION_INVALID");
    this.name = "ExpenseReadAuthorizationError";
  }
}

export interface ExpenseAuthorizationCandidateBinding {
  readonly variantKey:
    | ExpenseAuthorizationVariantKey
    | ExpenseContextAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly expensesViewScope: "all" | "own";
  readonly expensesApproveScope: "all" | "assigned" | null;
  readonly projectsViewScope: "all" | "assigned" | null;
}

interface AuthorizedExpenseReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly authorizationCandidate: ExpenseAuthorizationCandidateBinding;
}

export interface AuthorizedListExpensesRead extends AuthorizedExpenseReadBase {
  readonly capabilityId: "list_expenses";
  readonly capabilityRevision: "list_expenses:2026-08-22.v1";
  readonly query: ListExpensesInput;
  readonly variantKeys: readonly [ExpenseAuthorizationVariantKey];
}

export interface AuthorizedGetExpenseContextRead extends AuthorizedExpenseReadBase {
  readonly capabilityId: "get_expense_context";
  readonly capabilityRevision: "get_expense_context:2026-08-22.v1";
  readonly query: GetExpenseContextInput;
  readonly variantKeys: readonly [ExpenseContextAuthorizationVariantKey];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
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
  expectedKey: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new ExpenseReadAuthorizationError();
  }
  const ownKeys = Reflect.ownKeys(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, expectedKey);
  if (
    ownKeys.length !== 1 ||
    ownKeys[0] !== expectedKey ||
    !descriptor ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new ExpenseReadAuthorizationError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertMcpActor(actorContext: ActorContext) {
  const auth = actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !CANONICAL_UUID_PATTERN.test(auth.oauthGrantId) ||
    !CANONICAL_UUID_PATTERN.test(auth.oauthClientId) ||
    !GRANT_REVISION_PATTERN.test(auth.grantRevision) ||
    auth.scopeCeiling.length === 0
  ) {
    throw new ExpenseReadAuthorizationError();
  }
  return auth;
}

function declaredPermissions(policy: {
  readonly permissionRequirementGroups: readonly (readonly {
    readonly permission: string;
  }[])[];
}) {
  return sortedUnique(
    policy.permissionRequirementGroups.flatMap((group) =>
      group.map((requirement) => requirement.permission)
    )
  );
}

function canonicalSatisfiedPermissionGroupIndexes(input: {
  readonly policy: {
    readonly permissionRequirementGroups: readonly (readonly {
      readonly permission: string;
      readonly allowedScopes: readonly PermissionScope[];
    }[])[];
  };
  readonly resolvedPermissions: Readonly<Record<string, PermissionScope>>;
}): readonly number[] {
  const indexes = input.policy.permissionRequirementGroups.flatMap(
    (requirements, index) =>
      requirements.every((requirement) => {
        const resolvedScope = input.resolvedPermissions[requirement.permission];
        return (
          resolvedScope !== undefined &&
          requirement.allowedScopes.includes(resolvedScope)
        );
      })
        ? [index]
        : []
  );
  if (indexes.length === 0) throw new ExpenseReadAuthorizationError();
  return Object.freeze(indexes);
}

function scope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "expenses.approve" | "expenses.view" | "projects.view"
) {
  const value = permissions[key];
  if (value === undefined) return null;
  if (key === "expenses.view" && value !== "all" && value !== "own") {
    throw new ExpenseReadAuthorizationError();
  }
  if (key !== "expenses.view" && value !== "all" && value !== "assigned") {
    throw new ExpenseReadAuthorizationError();
  }
  return value as "all" | "assigned" | "own";
}

function bindCandidate(input: {
  readonly candidate:
    | typeof LIST_EXPENSES_CANDIDATE
    | typeof GET_EXPENSE_CONTEXT_CANDIDATE;
  readonly capabilityId: "get_expense_context" | "list_expenses";
  readonly capabilityRevision:
    | "get_expense_context:2026-08-22.v1"
    | "list_expenses:2026-08-22.v1";
  readonly variantKey: string;
  readonly rawAuthorization: unknown;
}) {
  const policy = input.candidate.authorization.variants.find(
    (variant) => variant.key === input.variantKey
  )?.policy;
  if (!policy || !isAuthorizedCapability(input.rawAuthorization)) {
    throw new ExpenseReadAuthorizationError();
  }
  const nominal = input.rawAuthorization as AuthorizedCapability;
  if (
    nominal.satisfiedPermissionGroupIndexes.length === 0 ||
    nominal.satisfiedPermissionGroupIndexes.some(
      (index) =>
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= policy.permissionRequirementGroups.length
    )
  ) {
    throw new ExpenseReadAuthorizationError();
  }
  const resolvedPermissionKeys = Object.keys(nominal.resolvedPermissions).sort(
    (left, right) => left.localeCompare(right)
  );
  const binding = assertP2ReadPolicyBinding({
    authorization: nominal,
    policy,
    expected: {
      capabilityId: input.capabilityId,
      capabilityRevision: input.capabilityRevision,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: policy.requiredOAuthScopes,
      declaredPermissions: declaredPermissions(policy),
      satisfiedPermissionGroupIndexes: nominal.satisfiedPermissionGroupIndexes,
      resolvedPermissionKeys,
    },
  });
  const auth = assertMcpActor(binding.actorContext);
  const expensesViewScope = scope(binding.resolvedPermissions, "expenses.view");
  const expensesApproveScope = scope(
    binding.resolvedPermissions,
    "expenses.approve"
  );
  const projectsViewScope = scope(binding.resolvedPermissions, "projects.view");
  if (expensesViewScope !== "all" && expensesViewScope !== "own") {
    throw new ExpenseReadAuthorizationError();
  }
  const satisfiedPermissionGroupIndexes =
    canonicalSatisfiedPermissionGroupIndexes({
      policy,
      resolvedPermissions: binding.resolvedPermissions,
    });
  const authorizationCandidate = deepFreeze({
    variantKey: input.variantKey as
      | ExpenseAuthorizationVariantKey
      | ExpenseContextAuthorizationVariantKey,
    requiredOAuthScopes: [...binding.requiredOAuthScopes],
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(binding.resolvedPermissions).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    satisfiedPermissionGroupIndexes: [...satisfiedPermissionGroupIndexes],
    expensesViewScope,
    expensesApproveScope:
      expensesApproveScope === "all" || expensesApproveScope === "assigned"
        ? expensesApproveScope
        : null,
    projectsViewScope:
      projectsViewScope === "all" || projectsViewScope === "assigned"
        ? projectsViewScope
        : null,
  });
  return {
    actorContext: binding.actorContext,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
    authorizationCandidate,
  } as const;
}

function canonicalListQuery(value: unknown): ListExpensesInput {
  const parsed = ListExpensesInputSchema.parse(value);
  return deepFreeze({
    ...parsed,
    view:
      parsed.view.kind === "job"
        ? { ...parsed.view, job_ref: { ...parsed.view.job_ref } }
        : { ...parsed.view },
  });
}

function canonicalContextQuery(value: unknown): GetExpenseContextInput {
  const parsed = GetExpenseContextInputSchema.parse(value);
  return deepFreeze({ expense_ref: { ...parsed.expense_ref } });
}

export function authorizeListExpensesRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListExpensesRead {
  try {
    const query = canonicalListQuery(input.query);
    const variantKeys = selectedListExpensesVariantKeys(query);
    const variantKey = variantKeys[0];
    const record = exactAuthorizationRecord(input.authorizations, variantKey);
    const binding = bindCandidate({
      candidate: LIST_EXPENSES_CANDIDATE,
      capabilityId: "list_expenses",
      capabilityRevision: "list_expenses:2026-08-22.v1",
      variantKey,
      rawAuthorization: record[variantKey],
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "list_expenses" as const,
      capabilityRevision: "list_expenses:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      variantKeys: [variantKey] as const,
    });
    AUTHORIZED_LIST_EXPENSE_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof ExpenseReadAuthorizationError) throw error;
    throw new ExpenseReadAuthorizationError();
  }
}

export function authorizeGetExpenseContextRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetExpenseContextRead {
  try {
    const query = canonicalContextQuery(input.query);
    const variantKeys = selectedGetExpenseContextVariantKeys(query);
    const variantKey = variantKeys[0];
    const record = exactAuthorizationRecord(input.authorizations, variantKey);
    const binding = bindCandidate({
      candidate: GET_EXPENSE_CONTEXT_CANDIDATE,
      capabilityId: "get_expense_context",
      capabilityRevision: "get_expense_context:2026-08-22.v1",
      variantKey,
      rawAuthorization: record[variantKey],
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "get_expense_context" as const,
      capabilityRevision: "get_expense_context:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      variantKeys: [variantKey] as const,
    });
    AUTHORIZED_EXPENSE_CONTEXT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof ExpenseReadAuthorizationError) throw error;
    throw new ExpenseReadAuthorizationError();
  }
}

export function isAuthorizedListExpensesRead(
  value: unknown
): value is AuthorizedListExpensesRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_EXPENSE_READS.has(value)
  );
}

export function isAuthorizedGetExpenseContextRead(
  value: unknown
): value is AuthorizedGetExpenseContextRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_EXPENSE_CONTEXT_READS.has(value)
  );
}
