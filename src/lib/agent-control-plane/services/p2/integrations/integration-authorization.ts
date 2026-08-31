import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetIntegrationHealthInputSchema,
  type GetIntegrationHealthInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  GET_INTEGRATION_HEALTH_CANDIDATE,
  INTEGRATION_HEALTH_AUTHORIZATION_VARIANT_KEYS,
  selectedIntegrationHealthVariantKeys,
  type IntegrationHealthAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/integrations";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_INTEGRATION_HEALTH_READS = new WeakSet<object>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class IntegrationHealthAuthorizationError extends Error {
  readonly code = "INTEGRATION_HEALTH_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("INTEGRATION_HEALTH_AUTHORIZATION_INVALID");
    this.name = "IntegrationHealthAuthorizationError";
  }
}

export interface IntegrationHealthAuthorizationCandidateBinding {
  readonly variantKey: IntegrationHealthAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly ["ops.integrations.read"];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly settingsIntegrationsScope: "all";
  readonly accountingScope: "all" | null;
  readonly emailScope: "all" | "own" | null;
}

type VariantKeys =
  | readonly ["accounting"]
  | readonly ["mailbox"]
  | readonly ["accounting", "mailbox"];
type CandidateBindings =
  | readonly [IntegrationHealthAuthorizationCandidateBinding]
  | readonly [
      IntegrationHealthAuthorizationCandidateBinding,
      IntegrationHealthAuthorizationCandidateBinding,
    ];

export interface AuthorizedIntegrationHealthRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "get_integration_health";
  readonly capabilityRevision: "get_integration_health:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly requiredOAuthScopes: readonly ["ops.integrations.read"];
  readonly query: GetIntegrationHealthInput;
  readonly variantKeys: VariantKeys;
  readonly authorizationCandidates: CandidateBindings;
  readonly settingsIntegrationsScope: "all";
  readonly accountingScope: "all" | null;
  readonly emailScope: "all" | "own" | null;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalVariantKeys(
  values: readonly IntegrationHealthAuthorizationVariantKey[]
): VariantKeys {
  if (values.length === 1 && values[0] === "accounting") {
    return Object.freeze(["accounting"]);
  }
  if (values.length === 1 && values[0] === "mailbox") {
    return Object.freeze(["mailbox"]);
  }
  if (
    values.length === 2 &&
    values[0] === "accounting" &&
    values[1] === "mailbox"
  ) {
    return Object.freeze(["accounting", "mailbox"] as const);
  }
  throw new IntegrationHealthAuthorizationError();
}

function canonicalCandidates(
  values: readonly IntegrationHealthAuthorizationCandidateBinding[]
): CandidateBindings {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) return Object.freeze([values[0]!, values[1]!]);
  throw new IntegrationHealthAuthorizationError();
}

function exactAuthorizationRecord(
  value: unknown,
  expected: readonly IntegrationHealthAuthorizationVariantKey[]
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new IntegrationHealthAuthorizationError();
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => {
      if (typeof key !== "string" || !expected.includes(key as never))
        return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !descriptor.enumerable || !("value" in descriptor);
    })
  ) {
    throw new IntegrationHealthAuthorizationError();
  }
  const canonical = INTEGRATION_HEALTH_AUTHORIZATION_VARIANT_KEYS.filter(
    (key) => Object.prototype.hasOwnProperty.call(value, key)
  );
  if (canonical.some((key, index) => key !== expected[index])) {
    throw new IntegrationHealthAuthorizationError();
  }
  return value as Readonly<
    Record<IntegrationHealthAuthorizationVariantKey, unknown>
  >;
}

function bindCandidate(input: {
  readonly variantKey: IntegrationHealthAuthorizationVariantKey;
  readonly rawAuthorization: unknown;
}) {
  const policy = GET_INTEGRATION_HEALTH_CANDIDATE.authorization.variants.find(
    (variant) => variant.key === input.variantKey
  )?.policy;
  if (!policy || !isAuthorizedCapability(input.rawAuthorization)) {
    throw new IntegrationHealthAuthorizationError();
  }
  const nominal = input.rawAuthorization as AuthorizedCapability;
  if (
    nominal.satisfiedPermissionGroupIndexes.length !== 1 ||
    nominal.satisfiedPermissionGroupIndexes[0] !== 0
  ) {
    throw new IntegrationHealthAuthorizationError();
  }
  const declaredPermissions = policy.permissionRequirementGroups
    .flatMap((group) => group.map((requirement) => requirement.permission))
    .sort();
  const resolvedPermissionKeys = Object.keys(
    nominal.resolvedPermissions
  ).sort();
  const binding = assertP2ReadPolicyBinding({
    authorization: nominal,
    policy,
    expected: {
      capabilityId: "get_integration_health",
      capabilityRevision: "get_integration_health:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: policy.requiredOAuthScopes,
      declaredPermissions,
      satisfiedPermissionGroupIndexes: [0],
      resolvedPermissionKeys,
    },
  });
  const auth = binding.actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !UUID_PATTERN.test(auth.oauthGrantId) ||
    !UUID_PATTERN.test(auth.oauthClientId) ||
    !GRANT_REVISION_PATTERN.test(auth.grantRevision) ||
    auth.scopeCeiling.length === 0
  ) {
    throw new IntegrationHealthAuthorizationError();
  }
  const settingsScope = binding.resolvedPermissions["settings.integrations"];
  const accountingScope = binding.resolvedPermissions["accounting.view"];
  const emailScope = binding.resolvedPermissions["email.view"];
  if (
    settingsScope !== "all" ||
    (input.variantKey === "accounting" &&
      (accountingScope !== "all" || emailScope !== undefined)) ||
    (input.variantKey === "mailbox" &&
      (!(["all", "own"] as const).includes(emailScope as "all" | "own") ||
        accountingScope !== undefined))
  ) {
    throw new IntegrationHealthAuthorizationError();
  }
  const candidate = deepFreeze({
    variantKey: input.variantKey,
    requiredOAuthScopes: ["ops.integrations.read"] as const,
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(binding.resolvedPermissions).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    satisfiedPermissionGroupIndexes: [0],
    settingsIntegrationsScope: "all" as const,
    accountingScope:
      input.variantKey === "accounting" ? ("all" as const) : null,
    emailScope:
      input.variantKey === "mailbox" ? (emailScope as "all" | "own") : null,
  });
  return Object.freeze({
    actorContext: binding.actorContext,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
    candidate,
  });
}

export function authorizeIntegrationHealthRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedIntegrationHealthRead {
  try {
    const parsed = GetIntegrationHealthInputSchema.parse(input.query);
    const query = deepFreeze({
      integrations: parsed.integrations.map((selection) => ({ ...selection })),
    });
    const variantKeys = canonicalVariantKeys(
      selectedIntegrationHealthVariantKeys(query)
    );
    const record = exactAuthorizationRecord(input.authorizations, variantKeys);
    const bindings = variantKeys.map((variantKey) =>
      bindCandidate({ variantKey, rawAuthorization: record[variantKey] })
    );
    const first = bindings[0];
    if (
      !first ||
      bindings.some(
        (binding) =>
          binding.actorContext !== first.actorContext ||
          binding.oauthGrantId !== first.oauthGrantId ||
          binding.oauthClientId !== first.oauthClientId ||
          binding.grantRevision !== first.grantRevision ||
          JSON.stringify(binding.grantedScopeCeiling) !==
            JSON.stringify(first.grantedScopeCeiling)
      )
    ) {
      throw new IntegrationHealthAuthorizationError();
    }
    const candidates = canonicalCandidates(
      bindings.map((binding) => binding.candidate)
    );
    const accountingCandidate = candidates.find(
      (candidate) => candidate.variantKey === "accounting"
    );
    const mailboxCandidate = candidates.find(
      (candidate) => candidate.variantKey === "mailbox"
    );
    const authorization = deepFreeze({
      actorContext: first.actorContext,
      capabilityId: "get_integration_health" as const,
      capabilityRevision: "get_integration_health:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      oauthGrantId: first.oauthGrantId,
      oauthClientId: first.oauthClientId,
      grantRevision: first.grantRevision,
      grantedScopeCeiling: first.grantedScopeCeiling,
      requiredOAuthScopes: ["ops.integrations.read"] as const,
      query,
      variantKeys,
      authorizationCandidates: candidates,
      settingsIntegrationsScope: "all" as const,
      accountingScope: accountingCandidate?.accountingScope ?? null,
      emailScope: mailboxCandidate?.emailScope ?? null,
    }) as AuthorizedIntegrationHealthRead;
    AUTHORIZED_INTEGRATION_HEALTH_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof IntegrationHealthAuthorizationError) throw error;
    throw new IntegrationHealthAuthorizationError();
  }
}

export function isAuthorizedIntegrationHealthRead(
  value: unknown
): value is AuthorizedIntegrationHealthRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_INTEGRATION_HEALTH_READS.has(value)
  );
}
