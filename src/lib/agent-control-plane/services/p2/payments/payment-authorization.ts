import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  ListPaymentsInputSchema,
  type ListPaymentsInput,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import {
  LIST_PAYMENTS_CANDIDATE,
  selectedListPaymentsVariantKeys,
  type PaymentAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/payments";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_LIST_PAYMENT_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class PaymentReadAuthorizationError extends Error {
  readonly code = "PAYMENT_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("PAYMENT_READ_AUTHORIZATION_INVALID");
    this.name = "PaymentReadAuthorizationError";
  }
}

export interface PaymentAuthorizationCandidateBinding {
  readonly variantKey: PaymentAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly financeScope: "all";
  readonly invoiceScope: "all" | "assigned";
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
}

export interface AuthorizedListPaymentsRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "list_payments";
  readonly capabilityRevision: "list_payments:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly authorizationCandidate: PaymentAuthorizationCandidateBinding;
  readonly query: ListPaymentsInput;
  readonly variantKeys: readonly [PaymentAuthorizationVariantKey];
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
  expectedKey: PaymentAuthorizationVariantKey
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new PaymentReadAuthorizationError();
  }
  const keys = Reflect.ownKeys(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, expectedKey);
  if (
    keys.length !== 1 ||
    keys[0] !== expectedKey ||
    !descriptor ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new PaymentReadAuthorizationError();
  }
  return value as Readonly<Record<PaymentAuthorizationVariantKey, unknown>>;
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
    throw new PaymentReadAuthorizationError();
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

function optionalEntityScope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "pipeline.view" | "projects.view"
): "all" | "assigned" | null {
  const value = permissions[key];
  if (value === undefined) return null;
  if (value !== "all" && value !== "assigned") {
    throw new PaymentReadAuthorizationError();
  }
  return value;
}

function bindCandidate(rawAuthorization: unknown) {
  const policy = LIST_PAYMENTS_CANDIDATE.authorization.variants[0]!.policy;
  if (!isAuthorizedCapability(rawAuthorization)) {
    throw new PaymentReadAuthorizationError();
  }
  const nominal = rawAuthorization as AuthorizedCapability;
  if (
    nominal.satisfiedPermissionGroupIndexes.length === 0 ||
    nominal.satisfiedPermissionGroupIndexes.some(
      (index) =>
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= policy.permissionRequirementGroups.length
    )
  ) {
    throw new PaymentReadAuthorizationError();
  }
  const binding = assertP2ReadPolicyBinding({
    authorization: nominal,
    policy,
    expected: {
      capabilityId: "list_payments",
      capabilityRevision: "list_payments:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: policy.requiredOAuthScopes,
      declaredPermissions: declaredPermissions(policy),
      satisfiedPermissionGroupIndexes: nominal.satisfiedPermissionGroupIndexes,
      resolvedPermissionKeys: Object.keys(nominal.resolvedPermissions).sort(
        (left, right) => left.localeCompare(right)
      ),
    },
  });
  const auth = assertMcpActor(binding.actorContext);
  const financeScope = binding.resolvedPermissions["finances.view"];
  const invoiceScope = binding.resolvedPermissions["invoices.view"];
  if (
    financeScope !== "all" ||
    (invoiceScope !== "all" && invoiceScope !== "assigned")
  ) {
    throw new PaymentReadAuthorizationError();
  }
  const authorizationCandidate = deepFreeze({
    variantKey: "payment" as const,
    requiredOAuthScopes: [...binding.requiredOAuthScopes],
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(binding.resolvedPermissions).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    satisfiedPermissionGroupIndexes: [
      ...nominal.satisfiedPermissionGroupIndexes,
    ],
    financeScope: "all" as const,
    invoiceScope,
    pipelineScope: optionalEntityScope(
      binding.resolvedPermissions,
      "pipeline.view"
    ),
    projectsScope: optionalEntityScope(
      binding.resolvedPermissions,
      "projects.view"
    ),
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

function canonicalQuery(value: unknown): ListPaymentsInput {
  const parsed = ListPaymentsInputSchema.parse(value);
  return deepFreeze({
    ...parsed,
    ...(parsed.invoice_ref ? { invoice_ref: { ...parsed.invoice_ref } } : {}),
    ...(parsed.customer_ref
      ? { customer_ref: { ...parsed.customer_ref } }
      : {}),
    ...(parsed.job_ref ? { job_ref: { ...parsed.job_ref } } : {}),
    ...(parsed.payment_date_window
      ? { payment_date_window: { ...parsed.payment_date_window } }
      : {}),
    method_categories: [...parsed.method_categories],
    reconciliation_states: [...parsed.reconciliation_states],
  });
}

export function authorizeListPaymentsRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListPaymentsRead {
  try {
    const query = canonicalQuery(input.query);
    const variantKeys = selectedListPaymentsVariantKeys(query);
    const variantKey = variantKeys[0];
    const record = exactAuthorizationRecord(input.authorizations, variantKey);
    const binding = bindCandidate(record[variantKey]);
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "list_payments" as const,
      capabilityRevision: "list_payments:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      variantKeys,
    });
    AUTHORIZED_LIST_PAYMENT_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof PaymentReadAuthorizationError) throw error;
    throw new PaymentReadAuthorizationError();
  }
}

export function isAuthorizedListPaymentsRead(
  value: unknown
): value is AuthorizedListPaymentsRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_PAYMENT_READS.has(value)
  );
}
