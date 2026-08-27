import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CustomerContextInputSchema,
  type CustomerContextInput,
} from "@/lib/agent-control-plane/contracts/customer-context";
import {
  CUSTOMER_CONTEXT_CANDIDATE,
  selectedCustomerContextVariantKeys,
  type CustomerContextAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/customer-context";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";

const AUTHORIZED_CUSTOMER_CONTEXT_READS = new WeakSet<object>();

export class CustomerContextAuthorizationError extends Error {
  readonly code = "CUSTOMER_CONTEXT_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("CUSTOMER_CONTEXT_AUTHORIZATION_INVALID");
    this.name = "CustomerContextAuthorizationError";
  }
}

export interface AuthorizedCustomerContextRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "get_customer_context";
  readonly capabilityRevision: "get_customer_context:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly string[];
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly clientsScope: "all" | "assigned";
  readonly pipelineScope: "all" | "assigned" | null;
  readonly projectsScope: "all" | "assigned" | null;
  readonly query: CustomerContextInput;
  readonly variantKeys: readonly CustomerContextAuthorizationVariantKey[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalQuery(input: unknown): CustomerContextInput {
  const parsed = CustomerContextInputSchema.parse(input);
  return deepFreeze({
    customer_ref: { ...parsed.customer_ref },
    sections: [...parsed.sections].sort((left, right) =>
      left.localeCompare(right)
    ),
    ...(parsed.contact_purpose
      ? { contact_purpose: parsed.contact_purpose }
      : {}),
    ...(parsed.job_kinds
      ? {
          job_kinds: [...parsed.job_kinds].sort((left, right) =>
            left.localeCompare(right)
          ),
        }
      : {}),
  }) as CustomerContextInput;
}

function exactAuthorizationRecord(
  value: unknown,
  expectedKeys: readonly CustomerContextAuthorizationVariantKey[]
): Readonly<Record<CustomerContextAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new CustomerContextAuthorizationError();
  }
  const actualKeys = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const canonicalExpected = [...expectedKeys].sort((left, right) =>
    left.localeCompare(right)
  );
  if (
    actualKeys.length !== canonicalExpected.length ||
    actualKeys.some((key, index) => key !== canonicalExpected[index])
  ) {
    throw new CustomerContextAuthorizationError();
  }
  return value as Readonly<
    Record<CustomerContextAuthorizationVariantKey, unknown>
  >;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].sort((left, right) => left.localeCompare(right))
  );
}

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

function assertMcpActor(actorContext: ActorContext) {
  const auth = actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !CANONICAL_UUID_PATTERN.test(auth.oauthGrantId) ||
    !CANONICAL_UUID_PATTERN.test(auth.oauthClientId) ||
    !GRANT_REVISION_PATTERN.test(auth.grantRevision) ||
    auth.scopeCeiling.length === 0
  ) {
    throw new CustomerContextAuthorizationError();
  }
  return auth;
}

function scope(
  permissions: Readonly<Record<string, PermissionScope>>,
  key: "clients.view" | "pipeline.view" | "projects.view"
): "all" | "assigned" {
  const value = permissions[key];
  if (value !== "all" && value !== "assigned") {
    throw new CustomerContextAuthorizationError();
  }
  return value;
}

export function authorizeCustomerContextRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedCustomerContextRead {
  try {
    const query = canonicalQuery(input.query);
    const variantKeys = selectedCustomerContextVariantKeys(query);
    const authorizations = exactAuthorizationRecord(
      input.authorizations,
      variantKeys
    );
    const policies = new Map(
      CUSTOMER_CONTEXT_CANDIDATE.authorization.variants.map((variant) => [
        variant.key as CustomerContextAuthorizationVariantKey,
        variant.policy,
      ])
    );

    let actorContext: ActorContext | null = null;
    let clientsScope: "all" | "assigned" | null = null;
    let pipelineScope: "all" | "assigned" | null = null;
    let projectsScope: "all" | "assigned" | null = null;
    const requiredOAuthScopes: string[] = [];

    for (const key of variantKeys) {
      const policy = policies.get(key);
      if (!policy) throw new CustomerContextAuthorizationError();
      const declaredPermissions = sortedUnique(
        policy.permissionRequirementGroups.flatMap((group) =>
          group.map((requirement) => requirement.permission)
        )
      );
      const binding = assertP2ReadPolicyBinding({
        authorization: authorizations[key],
        policy,
        expected: {
          capabilityId: "get_customer_context",
          capabilityRevision: "get_customer_context:2026-08-22.v1",
          capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
          requiredOAuthScopes: policy.requiredOAuthScopes,
          declaredPermissions,
          satisfiedPermissionGroupIndexes: [0],
          resolvedPermissionKeys: declaredPermissions,
        },
      });
      if (actorContext && binding.actorContext !== actorContext) {
        throw new CustomerContextAuthorizationError();
      }
      actorContext ??= binding.actorContext;
      requiredOAuthScopes.push(...binding.requiredOAuthScopes);
      const selectedClientsScope = scope(
        binding.resolvedPermissions,
        "clients.view"
      );
      if (clientsScope && clientsScope !== selectedClientsScope) {
        throw new CustomerContextAuthorizationError();
      }
      clientsScope ??= selectedClientsScope;
      if (key === "jobs_opportunity") {
        pipelineScope = scope(binding.resolvedPermissions, "pipeline.view");
      }
      if (key === "jobs_project") {
        projectsScope = scope(binding.resolvedPermissions, "projects.view");
      }
    }

    if (!actorContext || !clientsScope) {
      throw new CustomerContextAuthorizationError();
    }
    const mcpAuth = assertMcpActor(actorContext);
    const proof = deepFreeze({
      actorContext,
      capabilityId: "get_customer_context" as const,
      capabilityRevision: "get_customer_context:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      requiredOAuthScopes: sortedUnique(requiredOAuthScopes),
      oauthGrantId: mcpAuth.oauthGrantId,
      oauthClientId: mcpAuth.oauthClientId,
      grantRevision: mcpAuth.grantRevision,
      grantedScopeCeiling: sortedUnique(mcpAuth.scopeCeiling),
      clientsScope,
      pipelineScope,
      projectsScope,
      query,
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_CUSTOMER_CONTEXT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof CustomerContextAuthorizationError) throw error;
    throw new CustomerContextAuthorizationError();
  }
}

export function isAuthorizedCustomerContextRead(
  value: unknown
): value is AuthorizedCustomerContextRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_CUSTOMER_CONTEXT_READS.has(value)
  );
}
