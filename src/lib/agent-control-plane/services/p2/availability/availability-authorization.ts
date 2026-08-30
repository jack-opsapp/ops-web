import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  ListTeamAvailabilityInputSchema,
  type ListTeamAvailabilityInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  LIST_TEAM_AVAILABILITY_CANDIDATE,
  selectedTeamAvailabilityVariantKeys,
  type TeamAvailabilityAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/availability";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_TEAM_AVAILABILITY_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class TeamAvailabilityAuthorizationError extends Error {
  readonly code = "TEAM_AVAILABILITY_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("TEAM_AVAILABILITY_AUTHORIZATION_INVALID");
    this.name = "TeamAvailabilityAuthorizationError";
  }
}

export interface AuthorizedTeamAvailabilityRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "list_team_availability";
  readonly capabilityRevision: "list_team_availability:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly ["ops.team.read"];
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly availabilityScope: "company" | "self";
  readonly calendarScope: "all" | "own";
  readonly teamScope: "all" | null;
  readonly itemLimit: number;
  readonly query: ListTeamAvailabilityInput;
  readonly variantKeys: readonly TeamAvailabilityAuthorizationVariantKey[];
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
  expectedKeys: readonly TeamAvailabilityAuthorizationVariantKey[]
): Readonly<Record<TeamAvailabilityAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TeamAvailabilityAuthorizationError();
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
    throw new TeamAvailabilityAuthorizationError();
  }
  return value as Readonly<
    Record<TeamAvailabilityAuthorizationVariantKey, unknown>
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
    throw new TeamAvailabilityAuthorizationError();
  }
  return auth;
}

export function authorizeTeamAvailabilityRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedTeamAvailabilityRead {
  try {
    const query = deepFreeze(
      ListTeamAvailabilityInputSchema.parse(input.query)
    );
    const variantKeys = selectedTeamAvailabilityVariantKeys(query);
    const authorizations = exactAuthorizationRecord(
      input.authorizations,
      variantKeys
    );
    const variant =
      LIST_TEAM_AVAILABILITY_CANDIDATE.authorization.variants.find(
        (candidate) => candidate.key === query.view
      );
    if (!variant) throw new TeamAvailabilityAuthorizationError();
    const declaredPermissions = sortedUnique(
      variant.policy.permissionRequirementGroups.flatMap((group) =>
        group.map((requirement) => requirement.permission)
      )
    );
    const binding = assertP2ReadPolicyBinding({
      authorization: authorizations[query.view],
      policy: variant.policy,
      expected: {
        capabilityId: "list_team_availability",
        capabilityRevision: "list_team_availability:2026-08-22.v1",
        capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
        requiredOAuthScopes: ["ops.team.read"],
        declaredPermissions,
        satisfiedPermissionGroupIndexes: [0],
        resolvedPermissionKeys: declaredPermissions,
      },
    });
    const calendarScope = binding.resolvedPermissions["calendar.view"];
    const teamScope = binding.resolvedPermissions["team.view"] ?? null;
    if (
      (query.view === "company" &&
        (calendarScope !== "all" || teamScope !== "all")) ||
      (query.view === "self" &&
        calendarScope !== "all" &&
        calendarScope !== "own") ||
      (query.view === "self" && teamScope !== null)
    ) {
      throw new TeamAvailabilityAuthorizationError();
    }
    if (calendarScope !== "all" && calendarScope !== "own") {
      throw new TeamAvailabilityAuthorizationError();
    }
    const auth = assertMcpActor(binding.actorContext);
    const proof = deepFreeze({
      actorContext: binding.actorContext,
      capabilityId: "list_team_availability" as const,
      capabilityRevision: "list_team_availability:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      requiredOAuthScopes: ["ops.team.read"] as const,
      oauthGrantId: auth.oauthGrantId,
      oauthClientId: auth.oauthClientId,
      grantRevision: auth.grantRevision,
      grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
      availabilityScope: query.view,
      calendarScope,
      teamScope: query.view === "company" ? ("all" as const) : null,
      itemLimit: query.view === "company" ? query.limit : 1,
      query,
      variantKeys,
    });
    AUTHORIZED_TEAM_AVAILABILITY_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof TeamAvailabilityAuthorizationError) throw error;
    throw new TeamAvailabilityAuthorizationError();
  }
}

export function isAuthorizedTeamAvailabilityRead(
  value: unknown
): value is AuthorizedTeamAvailabilityRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_TEAM_AVAILABILITY_READS.has(value)
  );
}
