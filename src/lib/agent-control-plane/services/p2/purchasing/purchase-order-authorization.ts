import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetPurchaseOrderInputSchema,
  ListPurchaseOrdersInputSchema,
  type GetPurchaseOrderInput,
  type ListPurchaseOrdersInput,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  PURCHASE_ORDER_AUTHORIZATION_VARIANT_KEYS,
  GET_PURCHASE_ORDER_CANDIDATE,
  LIST_PURCHASE_ORDERS_CANDIDATE,
  selectedGetPurchaseOrderVariantKeys,
  selectedListPurchaseOrdersVariantKeys,
  type PurchaseOrderAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/purchasing";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_LIST_PURCHASE_ORDER_READS = new WeakSet<object>();
const AUTHORIZED_GET_PURCHASE_ORDER_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class PurchaseOrderReadAuthorizationError extends Error {
  readonly code = "PURCHASE_ORDER_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("PURCHASE_ORDER_READ_AUTHORIZATION_INVALID");
    this.name = "PurchaseOrderReadAuthorizationError";
  }
}

export interface PurchaseOrderAuthorizationCandidateBinding {
  readonly variantKey: PurchaseOrderAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly orderViewScope: "all" | null;
  readonly catalogProductsViewScope: "all" | null;
  readonly financesViewScope: "all" | null;
}

type CandidateBindings =
  | readonly [PurchaseOrderAuthorizationCandidateBinding]
  | readonly [
      PurchaseOrderAuthorizationCandidateBinding,
      PurchaseOrderAuthorizationCandidateBinding,
    ];
type VariantKeys =
  | readonly [PurchaseOrderAuthorizationVariantKey]
  | readonly [
      PurchaseOrderAuthorizationVariantKey,
      PurchaseOrderAuthorizationVariantKey,
    ];

interface AuthorizedPurchaseOrderReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly authorizationCandidates: CandidateBindings;
  readonly variantKeys: VariantKeys;
}

export interface AuthorizedListPurchaseOrdersRead extends AuthorizedPurchaseOrderReadBase {
  readonly capabilityId: "list_purchase_orders";
  readonly capabilityRevision: "list_purchase_orders:2026-08-22.v1";
  readonly query: ListPurchaseOrdersInput;
}

export interface AuthorizedGetPurchaseOrderRead extends AuthorizedPurchaseOrderReadBase {
  readonly capabilityId: "get_purchase_order";
  readonly capabilityRevision: "get_purchase_order:2026-08-22.v1";
  readonly query: GetPurchaseOrderInput;
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
    [...new Set(values)].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0
    )
  );
}

function canonicalVariantKeys(
  values: readonly PurchaseOrderAuthorizationVariantKey[]
): VariantKeys {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new PurchaseOrderReadAuthorizationError();
}

function canonicalCandidates(
  values: readonly PurchaseOrderAuthorizationCandidateBinding[]
): CandidateBindings {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new PurchaseOrderReadAuthorizationError();
}

function canonicalListQuery(value: unknown): ListPurchaseOrdersInput {
  const parsed = ListPurchaseOrdersInputSchema.parse(value);
  return deepFreeze({
    ...parsed,
    statuses: [...parsed.statuses],
    sections: [...parsed.sections],
    ...(parsed.supplier ? { supplier: { ...parsed.supplier } } : {}),
    ...(parsed.delivery_window
      ? { delivery_window: { ...parsed.delivery_window } }
      : {}),
  });
}

function canonicalDetailQuery(value: unknown): GetPurchaseOrderInput {
  const parsed = GetPurchaseOrderInputSchema.parse(value);
  return deepFreeze({
    purchase_order_ref: { ...parsed.purchase_order_ref },
    sections: [...parsed.sections],
  });
}

function exactAuthorizationRecord(
  value: unknown,
  expectedVariantKeys: readonly PurchaseOrderAuthorizationVariantKey[]
): Readonly<Record<PurchaseOrderAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new PurchaseOrderReadAuthorizationError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedVariantKeys.length ||
    ownKeys.some((key) => {
      if (typeof key !== "string") return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        !expectedVariantKeys.includes(
          key as PurchaseOrderAuthorizationVariantKey
        ) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new PurchaseOrderReadAuthorizationError();
  }
  const canonicalKeys = PURCHASE_ORDER_AUTHORIZATION_VARIANT_KEYS.filter(
    (key) => Object.prototype.hasOwnProperty.call(value, key)
  );
  if (
    canonicalKeys.length !== expectedVariantKeys.length ||
    canonicalKeys.some((key, index) => key !== expectedVariantKeys[index])
  ) {
    throw new PurchaseOrderReadAuthorizationError();
  }
  return value as Readonly<
    Record<PurchaseOrderAuthorizationVariantKey, unknown>
  >;
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
    throw new PurchaseOrderReadAuthorizationError();
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

function exactAllScope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "catalog.orders.view" | "catalog.products.view" | "finances.view"
): "all" | null {
  const value = permissions[key];
  if (value === undefined) return null;
  if (value !== "all") throw new PurchaseOrderReadAuthorizationError();
  return value;
}

function bindCandidate(input: {
  readonly candidate:
    | typeof LIST_PURCHASE_ORDERS_CANDIDATE
    | typeof GET_PURCHASE_ORDER_CANDIDATE;
  readonly capabilityId: "get_purchase_order" | "list_purchase_orders";
  readonly capabilityRevision:
    | "get_purchase_order:2026-08-22.v1"
    | "list_purchase_orders:2026-08-22.v1";
  readonly variantKey: PurchaseOrderAuthorizationVariantKey;
  readonly rawAuthorization: unknown;
}) {
  const policy = input.candidate.authorization.variants.find(
    (variant) => variant.key === input.variantKey
  )?.policy;
  if (!policy || !isAuthorizedCapability(input.rawAuthorization)) {
    throw new PurchaseOrderReadAuthorizationError();
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
    throw new PurchaseOrderReadAuthorizationError();
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
  const authorizationCandidate = deepFreeze({
    variantKey: input.variantKey,
    requiredOAuthScopes: [...binding.requiredOAuthScopes],
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(binding.resolvedPermissions).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    satisfiedPermissionGroupIndexes: [
      ...nominal.satisfiedPermissionGroupIndexes,
    ],
    orderViewScope: exactAllScope(
      binding.resolvedPermissions,
      "catalog.orders.view"
    ),
    catalogProductsViewScope: exactAllScope(
      binding.resolvedPermissions,
      "catalog.products.view"
    ),
    financesViewScope: exactAllScope(
      binding.resolvedPermissions,
      "finances.view"
    ),
  });
  if (
    input.variantKey === "orders" &&
    (authorizationCandidate.orderViewScope !== "all" ||
      authorizationCandidate.catalogProductsViewScope !== null ||
      authorizationCandidate.financesViewScope !== null)
  ) {
    throw new PurchaseOrderReadAuthorizationError();
  }
  if (
    input.variantKey === "costs" &&
    (authorizationCandidate.orderViewScope !== null ||
      authorizationCandidate.catalogProductsViewScope !== "all" ||
      authorizationCandidate.financesViewScope !== "all")
  ) {
    throw new PurchaseOrderReadAuthorizationError();
  }
  return Object.freeze({
    actorContext: binding.actorContext,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
    authorizationCandidate,
  });
}

function bindAll(input: {
  readonly authorizations: unknown;
  readonly candidate:
    | typeof LIST_PURCHASE_ORDERS_CANDIDATE
    | typeof GET_PURCHASE_ORDER_CANDIDATE;
  readonly capabilityId: "get_purchase_order" | "list_purchase_orders";
  readonly capabilityRevision:
    | "get_purchase_order:2026-08-22.v1"
    | "list_purchase_orders:2026-08-22.v1";
  readonly variantKeys: readonly PurchaseOrderAuthorizationVariantKey[];
}) {
  const variantKeys = canonicalVariantKeys(input.variantKeys);
  const record = exactAuthorizationRecord(input.authorizations, variantKeys);
  const bindings = variantKeys.map((variantKey) =>
    bindCandidate({
      candidate: input.candidate,
      capabilityId: input.capabilityId,
      capabilityRevision: input.capabilityRevision,
      variantKey,
      rawAuthorization: record[variantKey],
    })
  );
  const first = bindings[0];
  if (
    !first ||
    bindings.some(
      (binding) =>
        binding.actorContext !== first.actorContext ||
        binding.oauthGrantId !== first.oauthGrantId ||
        binding.oauthClientId !== first.oauthClientId ||
        binding.grantRevision !== first.grantRevision
    )
  ) {
    throw new PurchaseOrderReadAuthorizationError();
  }
  return {
    actorContext: first.actorContext,
    oauthGrantId: first.oauthGrantId,
    oauthClientId: first.oauthClientId,
    grantRevision: first.grantRevision,
    grantedScopeCeiling: first.grantedScopeCeiling,
    authorizationCandidates: canonicalCandidates(
      bindings.map((binding) => binding.authorizationCandidate)
    ),
    variantKeys,
  } as const;
}

export function authorizeListPurchaseOrdersRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListPurchaseOrdersRead {
  try {
    const query = canonicalListQuery(input.query);
    const variantKeys = selectedListPurchaseOrdersVariantKeys(query);
    const binding = bindAll({
      authorizations: input.authorizations,
      candidate: LIST_PURCHASE_ORDERS_CANDIDATE,
      capabilityId: "list_purchase_orders",
      capabilityRevision: "list_purchase_orders:2026-08-22.v1",
      variantKeys,
    });
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "list_purchase_orders" as const,
      capabilityRevision: "list_purchase_orders:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
    }) as AuthorizedListPurchaseOrdersRead;
    AUTHORIZED_LIST_PURCHASE_ORDER_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof PurchaseOrderReadAuthorizationError) throw error;
    throw new PurchaseOrderReadAuthorizationError();
  }
}

export function authorizeGetPurchaseOrderRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetPurchaseOrderRead {
  try {
    const query = canonicalDetailQuery(input.query);
    const variantKeys = selectedGetPurchaseOrderVariantKeys(query);
    const binding = bindAll({
      authorizations: input.authorizations,
      candidate: GET_PURCHASE_ORDER_CANDIDATE,
      capabilityId: "get_purchase_order",
      capabilityRevision: "get_purchase_order:2026-08-22.v1",
      variantKeys,
    });
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "get_purchase_order" as const,
      capabilityRevision: "get_purchase_order:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
    });
    AUTHORIZED_GET_PURCHASE_ORDER_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof PurchaseOrderReadAuthorizationError) throw error;
    throw new PurchaseOrderReadAuthorizationError();
  }
}

export function isAuthorizedListPurchaseOrdersRead(
  value: unknown
): value is AuthorizedListPurchaseOrdersRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_PURCHASE_ORDER_READS.has(value)
  );
}

export function isAuthorizedGetPurchaseOrderRead(
  value: unknown
): value is AuthorizedGetPurchaseOrderRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_GET_PURCHASE_ORDER_READS.has(value)
  );
}
