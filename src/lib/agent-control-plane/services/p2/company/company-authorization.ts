import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CompanyContextInputSchema,
  type CompanyContextInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  COMPANY_CONTEXT_CANDIDATE,
  selectedCompanyContextVariantKeys,
  type CompanyContextAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/company";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";

const AUTHORIZED_COMPANY_CONTEXT_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class CompanyContextAuthorizationError extends Error {
  readonly code = "COMPANY_CONTEXT_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("COMPANY_CONTEXT_AUTHORIZATION_INVALID");
    this.name = "CompanyContextAuthorizationError";
  }
}

export interface AuthorizedCompanyContextRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "get_company_context";
  readonly capabilityRevision: "get_company_context:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly ["ops.company.read"];
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly settingsCompanyScope: "all";
  readonly query: CompanyContextInput;
  readonly variantKeys: readonly ["company"];
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
  expectedKeys: readonly CompanyContextAuthorizationVariantKey[]
): Readonly<Record<CompanyContextAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new CompanyContextAuthorizationError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => {
      if (typeof key !== "string" || !expectedKeys.includes(key as never)) {
        return true;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !descriptor.enumerable || !("value" in descriptor);
    })
  ) {
    throw new CompanyContextAuthorizationError();
  }
  return value as Readonly<
    Record<CompanyContextAuthorizationVariantKey, unknown>
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
    throw new CompanyContextAuthorizationError();
  }
  return auth;
}

export function authorizeCompanyContextRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedCompanyContextRead {
  try {
    const query = deepFreeze(CompanyContextInputSchema.parse(input.query));
    const variantKeys = selectedCompanyContextVariantKeys(query);
    const authorizations = exactAuthorizationRecord(
      input.authorizations,
      variantKeys
    );
    const policy = COMPANY_CONTEXT_CANDIDATE.authorization.variants[0]?.policy;
    if (!policy) throw new CompanyContextAuthorizationError();
    const binding = assertP2ReadPolicyBinding({
      authorization: authorizations.company,
      policy,
      expected: {
        capabilityId: "get_company_context",
        capabilityRevision: "get_company_context:2026-08-22.v1",
        capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
        requiredOAuthScopes: ["ops.company.read"],
        declaredPermissions: ["settings.company"],
        satisfiedPermissionGroupIndexes: [0],
        resolvedPermissionKeys: ["settings.company"],
      },
    });
    if (binding.resolvedPermissions["settings.company"] !== "all") {
      throw new CompanyContextAuthorizationError();
    }
    const auth = assertMcpActor(binding.actorContext);
    const proof = deepFreeze({
      actorContext: binding.actorContext,
      capabilityId: "get_company_context" as const,
      capabilityRevision: "get_company_context:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      requiredOAuthScopes: ["ops.company.read"] as const,
      oauthGrantId: auth.oauthGrantId,
      oauthClientId: auth.oauthClientId,
      grantRevision: auth.grantRevision,
      grantedScopeCeiling: sortedUnique(auth.scopeCeiling),
      settingsCompanyScope: "all" as const,
      query,
      variantKeys: ["company"] as const,
    });
    AUTHORIZED_COMPANY_CONTEXT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof CompanyContextAuthorizationError) throw error;
    throw new CompanyContextAuthorizationError();
  }
}

export function isAuthorizedCompanyContextRead(
  value: unknown
): value is AuthorizedCompanyContextRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_COMPANY_CONTEXT_READS.has(value)
  );
}
