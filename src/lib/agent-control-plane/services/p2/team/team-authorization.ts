import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  ListTeamMembersInputSchema,
  type ListTeamMembersInput,
} from "@/lib/agent-control-plane/contracts/company-operations";
import {
  LIST_TEAM_MEMBERS_CANDIDATE,
  selectedTeamDirectoryVariantKeys,
  type TeamDirectoryAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/team";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_TEAM_DIRECTORY_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class TeamDirectoryAuthorizationError extends Error {
  readonly code = "TEAM_DIRECTORY_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("TEAM_DIRECTORY_AUTHORIZATION_INVALID");
    this.name = "TeamDirectoryAuthorizationError";
  }
}

export interface AuthorizedTeamDirectoryRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "list_team_members";
  readonly capabilityRevision: "list_team_members:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly ["ops.team.read"];
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly teamScope: "all";
  readonly query: ListTeamMembersInput;
  readonly variantKeys: readonly ["team"];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function exactAuthorizationRecord(
  value: unknown,
  expectedKeys: readonly TeamDirectoryAuthorizationVariantKey[]
): Readonly<Record<TeamDirectoryAuthorizationVariantKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TeamDirectoryAuthorizationError();
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
    throw new TeamDirectoryAuthorizationError();
  }
  return value as Readonly<
    Record<TeamDirectoryAuthorizationVariantKey, unknown>
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
    throw new TeamDirectoryAuthorizationError();
  }
  return auth;
}

export function authorizeTeamDirectoryRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedTeamDirectoryRead {
  try {
    const query = deepFreeze(ListTeamMembersInputSchema.parse(input.query));
    const variantKeys = selectedTeamDirectoryVariantKeys(query);
    const authorizations = exactAuthorizationRecord(
      input.authorizations,
      variantKeys
    );
    const policy =
      LIST_TEAM_MEMBERS_CANDIDATE.authorization.variants[0]?.policy;
    if (!policy) throw new TeamDirectoryAuthorizationError();
    const binding = assertP2ReadPolicyBinding({
      authorization: authorizations.team,
      policy,
      expected: {
        capabilityId: "list_team_members",
        capabilityRevision: "list_team_members:2026-08-22.v1",
        capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
        requiredOAuthScopes: ["ops.team.read"],
        declaredPermissions: ["team.view"],
        satisfiedPermissionGroupIndexes: [0],
        resolvedPermissionKeys: ["team.view"],
      },
    });
    if (binding.resolvedPermissions["team.view"] !== "all") {
      throw new TeamDirectoryAuthorizationError();
    }
    const auth = assertMcpActor(binding.actorContext);
    const proof = deepFreeze({
      actorContext: binding.actorContext,
      capabilityId: "list_team_members" as const,
      capabilityRevision: "list_team_members:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      requiredOAuthScopes: ["ops.team.read"] as const,
      oauthGrantId: auth.oauthGrantId,
      oauthClientId: auth.oauthClientId,
      grantRevision: auth.grantRevision,
      grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
      teamScope: "all" as const,
      query,
      variantKeys: ["team"] as const,
    });
    AUTHORIZED_TEAM_DIRECTORY_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof TeamDirectoryAuthorizationError) throw error;
    throw new TeamDirectoryAuthorizationError();
  }
}

export function isAuthorizedTeamDirectoryRead(
  value: unknown
): value is AuthorizedTeamDirectoryRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_TEAM_DIRECTORY_READS.has(value)
  );
}
