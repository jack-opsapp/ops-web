import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetCatalogItemInputSchema,
  SearchCatalogItemsInputSchema,
  type GetCatalogItemInput,
  type SearchCatalogItemsInput,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  CATALOG_AUTHORIZATION_VARIANT_KEYS,
  GET_CATALOG_ITEM_CANDIDATE,
  SEARCH_CATALOG_ITEMS_CANDIDATE,
  selectedGetCatalogItemVariantKeys,
  selectedSearchCatalogItemsVariantKeys,
  type CatalogAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/catalog";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";

const AUTHORIZED_SEARCH_CATALOG_READS = new WeakSet<object>();
const AUTHORIZED_GET_CATALOG_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class CatalogReadAuthorizationError extends Error {
  readonly code = "CATALOG_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("CATALOG_READ_AUTHORIZATION_INVALID");
    this.name = "CatalogReadAuthorizationError";
  }
}

export interface CatalogAuthorizationCandidateBinding {
  readonly variantKey: CatalogAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly catalogViewScope: "all" | null;
  readonly catalogProductsViewScope: "all";
  readonly financesViewScope: "all" | null;
}

type CandidateBindings =
  | readonly [CatalogAuthorizationCandidateBinding]
  | readonly [
      CatalogAuthorizationCandidateBinding,
      CatalogAuthorizationCandidateBinding,
    ];
type VariantKeys =
  | readonly [CatalogAuthorizationVariantKey]
  | readonly [CatalogAuthorizationVariantKey, CatalogAuthorizationVariantKey];

interface AuthorizedCatalogReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly authorizationCandidates: CandidateBindings;
  readonly variantKeys: VariantKeys;
}

export interface AuthorizedSearchCatalogItemsRead extends AuthorizedCatalogReadBase {
  readonly capabilityId: "search_catalog_items";
  readonly capabilityRevision: "search_catalog_items:2026-08-22.v1";
  readonly query: SearchCatalogItemsInput;
  readonly authorizationCandidates: readonly [
    CatalogAuthorizationCandidateBinding,
  ];
  readonly variantKeys: readonly ["catalog"];
}

export interface AuthorizedGetCatalogItemRead extends AuthorizedCatalogReadBase {
  readonly capabilityId: "get_catalog_item";
  readonly capabilityRevision: "get_catalog_item:2026-08-22.v1";
  readonly query: GetCatalogItemInput;
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
  values: readonly CatalogAuthorizationVariantKey[]
): VariantKeys {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new CatalogReadAuthorizationError();
}

function canonicalCandidates(
  values: readonly CatalogAuthorizationCandidateBinding[]
): CandidateBindings {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new CatalogReadAuthorizationError();
}

function canonicalSearchQuery(value: unknown): SearchCatalogItemsInput {
  const parsed = SearchCatalogItemsInputSchema.parse(value);
  return deepFreeze({
    ...parsed,
    ...(parsed.query ? { query: { ...parsed.query } } : {}),
    stock_states: [...parsed.stock_states],
    ...(parsed.category_ref
      ? { category_ref: { ...parsed.category_ref } }
      : {}),
  });
}

function canonicalDetailQuery(value: unknown): GetCatalogItemInput {
  const parsed = GetCatalogItemInputSchema.parse(value);
  return deepFreeze({
    item_ref: { ...parsed.item_ref },
    sections: [...parsed.sections],
  });
}

function exactAuthorizationRecord(
  value: unknown,
  expectedVariantKeys: readonly CatalogAuthorizationVariantKey[]
): Readonly<Record<CatalogAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new CatalogReadAuthorizationError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedVariantKeys.length ||
    ownKeys.some((key) => {
      if (typeof key !== "string") return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        !expectedVariantKeys.includes(key as CatalogAuthorizationVariantKey) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new CatalogReadAuthorizationError();
  }
  const canonicalKeys = CATALOG_AUTHORIZATION_VARIANT_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
  if (
    canonicalKeys.length !== expectedVariantKeys.length ||
    canonicalKeys.some((key, index) => key !== expectedVariantKeys[index])
  ) {
    throw new CatalogReadAuthorizationError();
  }
  return value as Readonly<Record<CatalogAuthorizationVariantKey, unknown>>;
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
    throw new CatalogReadAuthorizationError();
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
  key: "catalog.products.view"
): "all";
function exactAllScope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "catalog.view" | "finances.view"
): "all" | null;
function exactAllScope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "catalog.products.view" | "catalog.view" | "finances.view"
): "all" | null {
  const value = permissions[key];
  if (value === undefined) {
    if (key === "catalog.products.view") {
      throw new CatalogReadAuthorizationError();
    }
    return null;
  }
  if (value !== "all") throw new CatalogReadAuthorizationError();
  return value;
}

function bindCandidate(input: {
  readonly candidate:
    | typeof SEARCH_CATALOG_ITEMS_CANDIDATE
    | typeof GET_CATALOG_ITEM_CANDIDATE;
  readonly capabilityId: "get_catalog_item" | "search_catalog_items";
  readonly capabilityRevision:
    | "get_catalog_item:2026-08-22.v1"
    | "search_catalog_items:2026-08-22.v1";
  readonly variantKey: CatalogAuthorizationVariantKey;
  readonly rawAuthorization: unknown;
}) {
  const policy = input.candidate.authorization.variants.find(
    (variant) => variant.key === input.variantKey
  )?.policy;
  if (!policy || !isAuthorizedCapability(input.rawAuthorization)) {
    throw new CatalogReadAuthorizationError();
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
    throw new CatalogReadAuthorizationError();
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
    catalogViewScope: exactAllScope(
      binding.resolvedPermissions,
      "catalog.view"
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
    input.variantKey === "catalog" &&
    (authorizationCandidate.catalogViewScope !== "all" ||
      authorizationCandidate.financesViewScope !== null)
  ) {
    throw new CatalogReadAuthorizationError();
  }
  if (
    input.variantKey === "supplier_costs" &&
    (authorizationCandidate.catalogViewScope !== null ||
      authorizationCandidate.financesViewScope !== "all")
  ) {
    throw new CatalogReadAuthorizationError();
  }
  return Object.freeze({
    actorContext: binding.actorContext,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: sortedUnique(auth.scopeCeiling),
    authorizationCandidate,
  });
}

function bindAll(input: {
  readonly authorizations: unknown;
  readonly candidate:
    | typeof SEARCH_CATALOG_ITEMS_CANDIDATE
    | typeof GET_CATALOG_ITEM_CANDIDATE;
  readonly capabilityId: "get_catalog_item" | "search_catalog_items";
  readonly capabilityRevision:
    | "get_catalog_item:2026-08-22.v1"
    | "search_catalog_items:2026-08-22.v1";
  readonly variantKeys: readonly CatalogAuthorizationVariantKey[];
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
    throw new CatalogReadAuthorizationError();
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

export function authorizeSearchCatalogItemsRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedSearchCatalogItemsRead {
  try {
    const query = canonicalSearchQuery(input.query);
    const variantKeys = selectedSearchCatalogItemsVariantKeys(query);
    const binding = bindAll({
      authorizations: input.authorizations,
      candidate: SEARCH_CATALOG_ITEMS_CANDIDATE,
      capabilityId: "search_catalog_items",
      capabilityRevision: "search_catalog_items:2026-08-22.v1",
      variantKeys,
    });
    if (
      binding.variantKeys.length !== 1 ||
      binding.variantKeys[0] !== "catalog" ||
      binding.authorizationCandidates.length !== 1
    ) {
      throw new CatalogReadAuthorizationError();
    }
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "search_catalog_items" as const,
      capabilityRevision: "search_catalog_items:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
    }) as AuthorizedSearchCatalogItemsRead;
    AUTHORIZED_SEARCH_CATALOG_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof CatalogReadAuthorizationError) throw error;
    throw new CatalogReadAuthorizationError();
  }
}

export function authorizeGetCatalogItemRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetCatalogItemRead {
  try {
    const query = canonicalDetailQuery(input.query);
    const variantKeys = selectedGetCatalogItemVariantKeys(query);
    const binding = bindAll({
      authorizations: input.authorizations,
      candidate: GET_CATALOG_ITEM_CANDIDATE,
      capabilityId: "get_catalog_item",
      capabilityRevision: "get_catalog_item:2026-08-22.v1",
      variantKeys,
    });
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "get_catalog_item" as const,
      capabilityRevision: "get_catalog_item:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
    });
    AUTHORIZED_GET_CATALOG_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof CatalogReadAuthorizationError) throw error;
    throw new CatalogReadAuthorizationError();
  }
}

export function isAuthorizedSearchCatalogItemsRead(
  value: unknown
): value is AuthorizedSearchCatalogItemsRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_SEARCH_CATALOG_READS.has(value)
  );
}

export function isAuthorizedGetCatalogItemRead(
  value: unknown
): value is AuthorizedGetCatalogItemRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_GET_CATALOG_READS.has(value)
  );
}
