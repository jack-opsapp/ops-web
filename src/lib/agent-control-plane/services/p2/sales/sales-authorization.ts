import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetSalesDocumentInputSchema,
  ListSalesDocumentsInputSchema,
  type GetSalesDocumentInput,
  type ListSalesDocumentsInput,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import {
  GET_SALES_DOCUMENT_CANDIDATE,
  LIST_SALES_DOCUMENTS_CANDIDATE,
  SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS,
  selectedGetSalesDocumentVariantKeys,
  selectedListSalesDocumentsVariantKeys,
  type SalesDocumentAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/sales";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_LIST_SALES_DOCUMENT_READS = new WeakSet<object>();
const AUTHORIZED_GET_SALES_DOCUMENT_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class SalesDocumentReadAuthorizationError extends Error {
  readonly code = "SALES_DOCUMENT_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("SALES_DOCUMENT_READ_AUTHORIZATION_INVALID");
    this.name = "SalesDocumentReadAuthorizationError";
  }
}

export interface SalesDocumentAuthorizationCandidateBinding {
  readonly variantKey: SalesDocumentAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly documentScope: "all" | "assigned";
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly projectFinancialsScope: "all" | null;
}

type CandidateBindings =
  | readonly [SalesDocumentAuthorizationCandidateBinding]
  | readonly [
      SalesDocumentAuthorizationCandidateBinding,
      SalesDocumentAuthorizationCandidateBinding,
    ];
type VariantKeys =
  | readonly [SalesDocumentAuthorizationVariantKey]
  | readonly [
      SalesDocumentAuthorizationVariantKey,
      SalesDocumentAuthorizationVariantKey,
    ];

interface AuthorizedSalesDocumentReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly authorizationCandidates: CandidateBindings;
  readonly variantKeys: VariantKeys;
}

export interface AuthorizedListSalesDocumentsRead extends AuthorizedSalesDocumentReadBase {
  readonly capabilityId: "list_sales_documents";
  readonly capabilityRevision: "list_sales_documents:2026-08-22.v1";
  readonly query: ListSalesDocumentsInput;
}

export interface AuthorizedGetSalesDocumentRead extends AuthorizedSalesDocumentReadBase {
  readonly capabilityId: "get_sales_document";
  readonly capabilityRevision: "get_sales_document:2026-08-22.v1";
  readonly query: GetSalesDocumentInput;
  readonly authorizationCandidates: readonly [
    SalesDocumentAuthorizationCandidateBinding,
  ];
  readonly variantKeys: readonly [SalesDocumentAuthorizationVariantKey];
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

function canonicalVariantKeys(
  values: readonly SalesDocumentAuthorizationVariantKey[]
): VariantKeys {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new SalesDocumentReadAuthorizationError();
}

function canonicalCandidates(
  values: readonly SalesDocumentAuthorizationCandidateBinding[]
): CandidateBindings {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new SalesDocumentReadAuthorizationError();
}

function canonicalListQuery(value: unknown): ListSalesDocumentsInput {
  const parsed = ListSalesDocumentsInputSchema.parse(value);
  return deepFreeze({
    ...parsed,
    document_kinds: [...parsed.document_kinds],
    ...(parsed.customer_ref
      ? { customer_ref: { ...parsed.customer_ref } }
      : {}),
    ...(parsed.job_ref ? { job_ref: { ...parsed.job_ref } } : {}),
  });
}

function canonicalDetailQuery(value: unknown): GetSalesDocumentInput {
  const parsed = GetSalesDocumentInputSchema.parse(value);
  return deepFreeze({
    document_ref: { ...parsed.document_ref },
  });
}

function exactAuthorizationRecord(
  value: unknown,
  expectedVariantKeys: readonly SalesDocumentAuthorizationVariantKey[]
): Readonly<Record<SalesDocumentAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new SalesDocumentReadAuthorizationError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedVariantKeys.length ||
    ownKeys.some((key) => {
      if (typeof key !== "string") return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        !expectedVariantKeys.includes(
          key as SalesDocumentAuthorizationVariantKey
        ) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new SalesDocumentReadAuthorizationError();
  }
  const canonicalKeys = SALES_DOCUMENT_AUTHORIZATION_VARIANT_KEYS.filter(
    (key) => Object.prototype.hasOwnProperty.call(value, key)
  );
  if (
    canonicalKeys.length !== expectedVariantKeys.length ||
    canonicalKeys.some((key, index) => key !== expectedVariantKeys[index])
  ) {
    throw new SalesDocumentReadAuthorizationError();
  }
  return value as Readonly<
    Record<SalesDocumentAuthorizationVariantKey, unknown>
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
    throw new SalesDocumentReadAuthorizationError();
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

function documentScope(
  variantKey: SalesDocumentAuthorizationVariantKey,
  permissions: Readonly<Record<string, PermissionScope>>
): "all" | "assigned" {
  const value =
    permissions[variantKey === "estimate" ? "estimates.view" : "invoices.view"];
  if (value !== "all" && value !== "assigned") {
    throw new SalesDocumentReadAuthorizationError();
  }
  return value;
}

function optionalScope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "pipeline.view" | "projects.view"
): "all" | "assigned" | null {
  const value = permissions[key];
  if (value === undefined) return null;
  if (value !== "all" && value !== "assigned") {
    throw new SalesDocumentReadAuthorizationError();
  }
  return value;
}

function bindCandidate(input: {
  readonly candidate:
    | typeof LIST_SALES_DOCUMENTS_CANDIDATE
    | typeof GET_SALES_DOCUMENT_CANDIDATE;
  readonly capabilityId: "get_sales_document" | "list_sales_documents";
  readonly capabilityRevision:
    | "get_sales_document:2026-08-22.v1"
    | "list_sales_documents:2026-08-22.v1";
  readonly variantKey: SalesDocumentAuthorizationVariantKey;
  readonly rawAuthorization: unknown;
}) {
  const policy = input.candidate.authorization.variants.find(
    (variant) => variant.key === input.variantKey
  )?.policy;
  if (!policy || !isAuthorizedCapability(input.rawAuthorization)) {
    throw new SalesDocumentReadAuthorizationError();
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
    throw new SalesDocumentReadAuthorizationError();
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
  const projectFinancials =
    binding.resolvedPermissions["projects.view_financials"];
  if (projectFinancials !== undefined && projectFinancials !== "all") {
    throw new SalesDocumentReadAuthorizationError();
  }
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
    documentScope: documentScope(input.variantKey, binding.resolvedPermissions),
    pipelineScope: optionalScope(binding.resolvedPermissions, "pipeline.view"),
    projectsScope: optionalScope(binding.resolvedPermissions, "projects.view"),
    projectFinancialsScope: projectFinancials ?? null,
  });
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
  readonly query: ListSalesDocumentsInput | GetSalesDocumentInput;
  readonly authorizations: unknown;
  readonly candidate:
    | typeof LIST_SALES_DOCUMENTS_CANDIDATE
    | typeof GET_SALES_DOCUMENT_CANDIDATE;
  readonly capabilityId: "get_sales_document" | "list_sales_documents";
  readonly capabilityRevision:
    | "get_sales_document:2026-08-22.v1"
    | "list_sales_documents:2026-08-22.v1";
  readonly variantKeys: readonly SalesDocumentAuthorizationVariantKey[];
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
    throw new SalesDocumentReadAuthorizationError();
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

export function authorizeListSalesDocumentsRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListSalesDocumentsRead {
  try {
    const query = canonicalListQuery(input.query);
    const variantKeys = selectedListSalesDocumentsVariantKeys(query);
    const binding = bindAll({
      query,
      authorizations: input.authorizations,
      candidate: LIST_SALES_DOCUMENTS_CANDIDATE,
      capabilityId: "list_sales_documents",
      capabilityRevision: "list_sales_documents:2026-08-22.v1",
      variantKeys,
    });
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "list_sales_documents" as const,
      capabilityRevision: "list_sales_documents:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
    });
    AUTHORIZED_LIST_SALES_DOCUMENT_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof SalesDocumentReadAuthorizationError) throw error;
    throw new SalesDocumentReadAuthorizationError();
  }
}

export function authorizeGetSalesDocumentRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetSalesDocumentRead {
  try {
    const query = canonicalDetailQuery(input.query);
    const variantKeys = selectedGetSalesDocumentVariantKeys(query);
    const binding = bindAll({
      query,
      authorizations: input.authorizations,
      candidate: GET_SALES_DOCUMENT_CANDIDATE,
      capabilityId: "get_sales_document",
      capabilityRevision: "get_sales_document:2026-08-22.v1",
      variantKeys,
    });
    if (
      binding.variantKeys.length !== 1 ||
      binding.authorizationCandidates.length !== 1
    ) {
      throw new SalesDocumentReadAuthorizationError();
    }
    const authorization = deepFreeze({
      ...binding,
      capabilityId: "get_sales_document" as const,
      capabilityRevision: "get_sales_document:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
    }) as AuthorizedGetSalesDocumentRead;
    AUTHORIZED_GET_SALES_DOCUMENT_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof SalesDocumentReadAuthorizationError) throw error;
    throw new SalesDocumentReadAuthorizationError();
  }
}

export function isAuthorizedListSalesDocumentsRead(
  value: unknown
): value is AuthorizedListSalesDocumentsRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_SALES_DOCUMENT_READS.has(value)
  );
}

export function isAuthorizedGetSalesDocumentRead(
  value: unknown
): value is AuthorizedGetSalesDocumentRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_GET_SALES_DOCUMENT_READS.has(value)
  );
}
