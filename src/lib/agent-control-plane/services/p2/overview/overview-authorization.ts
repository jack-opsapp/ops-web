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
  GetOperationalOverviewInputSchema,
  normalizeOperationalOverviewSelections,
  type GetOperationalOverviewInput,
  type OperationalOverviewComponent,
  type OperationalOverviewSelection,
} from "@/lib/agent-control-plane/contracts/operational-overview";
import {
  GET_OPERATIONAL_OVERVIEW_CANDIDATE,
  type OperationalOverviewAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/overview";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_OPERATIONAL_OVERVIEW_READS = new WeakSet<object>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class OperationalOverviewAuthorizationError extends Error {
  readonly code:
    | "OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID"
    | "OPERATIONAL_OVERVIEW_EXPLICIT_COMPONENT_UNAUTHORIZED";

  constructor(code: OperationalOverviewAuthorizationError["code"]) {
    super(code);
    this.name = "OperationalOverviewAuthorizationError";
    this.code = code;
  }
}

export interface AuthorizedOperationalOverviewComponent {
  readonly component: OperationalOverviewComponent;
  readonly origin: "explicit" | "default";
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly [0];
}

export interface AuthorizedOperationalOverviewRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "get_operational_overview";
  readonly capabilityRevision: "get_operational_overview:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly query: GetOperationalOverviewInput;
  readonly selections: readonly OperationalOverviewSelection[];
  readonly authorizedComponents: readonly AuthorizedOperationalOverviewComponent[];
  readonly warnings: readonly Readonly<{
    code: "DEFAULT_COMPONENT_OMITTED";
    component: OperationalOverviewComponent;
  }>[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function isNominalDenial(error: unknown) {
  return (
    error instanceof ActorAccessError &&
    (error.code === "FORBIDDEN" || error.code === "INSUFFICIENT_SCOPE")
  );
}

function variantFor(component: OperationalOverviewComponent) {
  const variant =
    GET_OPERATIONAL_OVERVIEW_CANDIDATE.authorization.variants.find(
      (candidate) => candidate.key === component
    );
  if (!variant) {
    throw new OperationalOverviewAuthorizationError(
      "OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID"
    );
  }
  return variant;
}

function bindComponent(input: {
  readonly component: OperationalOverviewComponent;
  readonly origin: "explicit" | "default";
  readonly authorization: AuthorizedCapability;
}): AuthorizedOperationalOverviewComponent {
  const variant = variantFor(input.component);
  const policy = variant.policy;
  const declaredPermissions = [
    ...new Set(
      policy.permissionRequirementGroups.flatMap((group) =>
        group.map((requirement) => requirement.permission)
      )
    ),
  ].sort();
  const resolvedPermissionKeys = Object.keys(
    input.authorization.resolvedPermissions
  ).sort();
  const binding = assertP2ReadPolicyBinding({
    authorization: input.authorization,
    policy,
    expected: {
      capabilityId: "get_operational_overview",
      capabilityRevision: "get_operational_overview:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: policy.requiredOAuthScopes,
      declaredPermissions,
      satisfiedPermissionGroupIndexes: [0],
      resolvedPermissionKeys,
    },
  });
  if (
    input.authorization.satisfiedPermissionGroupIndexes.length !== 1 ||
    input.authorization.satisfiedPermissionGroupIndexes[0] !== 0 ||
    resolvedPermissionKeys.length !== declaredPermissions.length ||
    resolvedPermissionKeys.some(
      (permission, index) => permission !== declaredPermissions[index]
    )
  ) {
    throw new OperationalOverviewAuthorizationError(
      "OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID"
    );
  }
  return deepFreeze({
    component: input.component,
    origin: input.origin,
    requiredOAuthScopes: [...policy.requiredOAuthScopes],
    resolvedPermissionScopes: Object.fromEntries(
      Object.entries(binding.resolvedPermissions).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )
    ),
    satisfiedPermissionGroupIndexes: [0] as const,
  });
}

export function authorizeOperationalOverviewRead(input: {
  readonly query: unknown;
  readonly actorContext: ActorContext;
}): AuthorizedOperationalOverviewRead {
  if (!isActorContext(input.actorContext)) {
    throw new OperationalOverviewAuthorizationError(
      "OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID"
    );
  }

  let query: GetOperationalOverviewInput;
  let selections: readonly OperationalOverviewSelection[];
  try {
    const parsed = GetOperationalOverviewInputSchema.parse(input.query);
    query = deepFreeze(
      parsed.components === undefined
        ? {}
        : { components: [...parsed.components] }
    );
    selections = normalizeOperationalOverviewSelections(
      query
    ) as readonly OperationalOverviewSelection[];
  } catch {
    throw new OperationalOverviewAuthorizationError(
      "OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID"
    );
  }

  const auth = input.actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !UUID_PATTERN.test(auth.oauthGrantId) ||
    !UUID_PATTERN.test(auth.oauthClientId) ||
    !GRANT_REVISION_PATTERN.test(auth.grantRevision) ||
    auth.scopeCeiling.length === 0
  ) {
    throw new OperationalOverviewAuthorizationError(
      "OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID"
    );
  }

  const authorizedComponents: AuthorizedOperationalOverviewComponent[] = [];
  const warnings: Array<{
    code: "DEFAULT_COMPONENT_OMITTED";
    component: OperationalOverviewComponent;
  }> = [];

  for (const selection of selections) {
    const component =
      selection.component as OperationalOverviewAuthorizationVariantKey;
    const variant = variantFor(component);
    try {
      authorizedComponents.push(
        bindComponent({
          component,
          origin: selection.origin,
          authorization: authorizeCapability({
            actorContext: input.actorContext,
            policy: variant.policy,
          }),
        })
      );
    } catch (error) {
      if (!isNominalDenial(error)) throw error;
      if (selection.origin === "explicit") {
        throw new OperationalOverviewAuthorizationError(
          "OPERATIONAL_OVERVIEW_EXPLICIT_COMPONENT_UNAUTHORIZED"
        );
      }
      warnings.push({
        code: "DEFAULT_COMPONENT_OMITTED",
        component,
      });
    }
  }

  const authorization = deepFreeze({
    actorContext: input.actorContext,
    capabilityId: "get_operational_overview" as const,
    capabilityRevision: "get_operational_overview:2026-08-22.v1" as const,
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
    query,
    selections,
    authorizedComponents,
    warnings,
  }) as AuthorizedOperationalOverviewRead;
  AUTHORIZED_OPERATIONAL_OVERVIEW_READS.add(authorization);
  return authorization;
}

export function isAuthorizedOperationalOverviewRead(
  value: unknown
): value is AuthorizedOperationalOverviewRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_OPERATIONAL_OVERVIEW_READS.has(value)
  );
}
