import "server-only";

import {
  isAuthorizedCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  DeckDesignGeometryInputSchema,
  type DeckDesignGeometryInput,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import {
  DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS,
  GET_DECK_DESIGN_GEOMETRY_CANDIDATE,
  selectedDeckDesignGeometryVariantKeys,
  type DeckDesignGeometryAuthorizationSelection,
  type DeckDesignGeometryAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/deck-design";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_DECK_GEOMETRY_READS = new WeakSet<object>();
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_REVISION_PATTERN = /^[0-9a-f]{32}$/;

export class DeckGeometryReadAuthorizationError extends Error {
  readonly code = "DECK_GEOMETRY_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("DECK_GEOMETRY_READ_AUTHORIZATION_INVALID");
    this.name = "DeckGeometryReadAuthorizationError";
  }
}

export interface DeckDesignGeometryAuthorizationCandidateBinding {
  readonly variantKey: DeckDesignGeometryAuthorizationVariantKey;
  readonly requiredOAuthScopes: readonly string[];
  readonly resolvedPermissionScopes: Readonly<Record<string, PermissionScope>>;
  readonly satisfiedPermissionGroupIndexes: readonly number[];
  readonly calendarScope: PermissionScope | null;
  readonly clientsScope: PermissionScope | null;
  readonly deckBuilderScope: PermissionScope;
  readonly pipelineScope: PermissionScope | null;
  readonly projectsScope: PermissionScope | null;
}

type DeckDesignGeometryAuthorizationCandidateBindings =
  | readonly [DeckDesignGeometryAuthorizationCandidateBinding]
  | readonly [
      DeckDesignGeometryAuthorizationCandidateBinding,
      DeckDesignGeometryAuthorizationCandidateBinding,
    ];

type DeckDesignGeometryAuthorizationVariantKeys =
  | readonly [DeckDesignGeometryAuthorizationVariantKey]
  | readonly [
      DeckDesignGeometryAuthorizationVariantKey,
      DeckDesignGeometryAuthorizationVariantKey,
    ];

function canonicalCandidateBindings(
  values: readonly DeckDesignGeometryAuthorizationCandidateBinding[]
): DeckDesignGeometryAuthorizationCandidateBindings {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) {
    return Object.freeze([values[0]!, values[1]!]);
  }
  throw new DeckGeometryReadAuthorizationError();
}

function canonicalVariantKeys(
  values: readonly DeckDesignGeometryAuthorizationVariantKey[]
): DeckDesignGeometryAuthorizationVariantKeys {
  if (values.length === 1) return Object.freeze([values[0]!]);
  if (values.length === 2) {
    return Object.freeze([values[0]!, values[1]!]);
  }
  throw new DeckGeometryReadAuthorizationError();
}

export interface AuthorizedDeckDesignGeometryRead {
  readonly actorContext: ActorContext;
  readonly capabilityId: "get_deck_design_geometry";
  readonly capabilityRevision: "get_deck_design_geometry:2026-08-22.v1";
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly query: DeckDesignGeometryInput;
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly authorizationCandidates: DeckDesignGeometryAuthorizationCandidateBindings;
  readonly variantKeys: DeckDesignGeometryAuthorizationVariantKeys;
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

function canonicalQuery(value: unknown): DeckDesignGeometryInput {
  const parsed = DeckDesignGeometryInputSchema.parse(value);
  return deepFreeze(
    parsed.source === "job_artifact"
      ? { ...parsed, job_ref: { ...parsed.job_ref } }
      : { ...parsed, site_visit_ref: { ...parsed.site_visit_ref } }
  );
}

function exactAuthorizationRecord(
  value: unknown,
  selection: DeckDesignGeometryAuthorizationSelection
): {
  readonly record: Readonly<Record<string, unknown>>;
  readonly variantKeys: DeckDesignGeometryAuthorizationVariantKeys;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new DeckGeometryReadAuthorizationError();
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length < 1 ||
    ownKeys.length > 2 ||
    ownKeys.some((key) => {
      if (typeof key !== "string") return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !descriptor.enumerable || !("value" in descriptor);
    })
  ) {
    throw new DeckGeometryReadAuthorizationError();
  }
  const actualKeys = ownKeys as DeckDesignGeometryAuthorizationVariantKey[];
  const required = new Set(selection.required);
  const alternatives = new Set(selection.alternatives.flat());
  const jobSelection = selection.required.length > 0;
  if (
    (jobSelection &&
      (selection.alternatives.length !== 0 ||
        actualKeys.length !== selection.required.length ||
        actualKeys.some((key) => !required.has(key)))) ||
    (!jobSelection &&
      (selection.alternatives.length === 0 ||
        actualKeys.some((key) => !alternatives.has(key))))
  ) {
    throw new DeckGeometryReadAuthorizationError();
  }

  const canonicalKeys = DECK_DESIGN_GEOMETRY_AUTHORIZATION_VARIANT_KEYS.filter(
    (key) => Object.prototype.hasOwnProperty.call(value, key)
  );
  if (canonicalKeys.length !== actualKeys.length) {
    throw new DeckGeometryReadAuthorizationError();
  }
  return {
    record: value as Readonly<Record<string, unknown>>,
    variantKeys: canonicalVariantKeys(canonicalKeys),
  };
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
    throw new DeckGeometryReadAuthorizationError();
  }
  return auth;
}

function declaredPermissions(policy: {
  readonly permissionRequirementGroups: readonly (readonly {
    readonly permission: string;
  }[])[];
}): readonly string[] {
  return sortedUnique(
    policy.permissionRequirementGroups.flatMap((group) =>
      group.map((requirement) => requirement.permission)
    )
  );
}

function bindPolicy(input: {
  readonly variantKey: DeckDesignGeometryAuthorizationVariantKey;
  readonly rawAuthorization: unknown;
}) {
  const policy = GET_DECK_DESIGN_GEOMETRY_CANDIDATE.authorization.variants.find(
    (variant) => variant.key === input.variantKey
  )?.policy;
  if (!policy || !isAuthorizedCapability(input.rawAuthorization)) {
    throw new DeckGeometryReadAuthorizationError();
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
    throw new DeckGeometryReadAuthorizationError();
  }
  const resolvedPermissionKeys = Object.keys(nominal.resolvedPermissions).sort(
    (left, right) => left.localeCompare(right)
  );
  const binding = assertP2ReadPolicyBinding({
    authorization: nominal,
    policy,
    expected: {
      capabilityId: "get_deck_design_geometry",
      capabilityRevision: "get_deck_design_geometry:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      requiredOAuthScopes: policy.requiredOAuthScopes,
      declaredPermissions: declaredPermissions(policy),
      satisfiedPermissionGroupIndexes: nominal.satisfiedPermissionGroupIndexes,
      resolvedPermissionKeys,
    },
  });
  const deckBuilderScope = binding.resolvedPermissions["deck_builder.view"];
  if (!deckBuilderScope) throw new DeckGeometryReadAuthorizationError();
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
    calendarScope: binding.resolvedPermissions["calendar.view"] ?? null,
    clientsScope: binding.resolvedPermissions["clients.view"] ?? null,
    deckBuilderScope,
    pipelineScope: binding.resolvedPermissions["pipeline.view"] ?? null,
    projectsScope: binding.resolvedPermissions["projects.view"] ?? null,
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

export function authorizeDeckDesignGeometryRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedDeckDesignGeometryRead {
  try {
    const query = canonicalQuery(input.query);
    const selection = selectedDeckDesignGeometryVariantKeys(query);
    const { record, variantKeys } = exactAuthorizationRecord(
      input.authorizations,
      selection
    );
    const bindings = variantKeys.map((variantKey) =>
      bindPolicy({
        variantKey,
        rawAuthorization: record[variantKey],
      })
    );
    const first = bindings[0];
    if (
      !first ||
      bindings.length > 2 ||
      bindings.some(
        (binding) =>
          binding.actorContext !== first.actorContext ||
          binding.oauthGrantId !== first.oauthGrantId ||
          binding.oauthClientId !== first.oauthClientId ||
          binding.grantRevision !== first.grantRevision
      )
    ) {
      throw new DeckGeometryReadAuthorizationError();
    }
    const authorizationCandidates = canonicalCandidateBindings(
      bindings.map((binding) => binding.authorizationCandidate)
    );
    const authorization = deepFreeze({
      actorContext: first.actorContext,
      capabilityId: "get_deck_design_geometry" as const,
      capabilityRevision: "get_deck_design_geometry:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      oauthGrantId: first.oauthGrantId,
      oauthClientId: first.oauthClientId,
      grantRevision: first.grantRevision,
      grantedScopeCeiling: first.grantedScopeCeiling,
      authorizationCandidates,
      variantKeys,
    });
    AUTHORIZED_DECK_GEOMETRY_READS.add(authorization);
    return authorization;
  } catch (error) {
    if (error instanceof DeckGeometryReadAuthorizationError) throw error;
    throw new DeckGeometryReadAuthorizationError();
  }
}

export function isAuthorizedDeckDesignGeometryRead(
  value: unknown
): value is AuthorizedDeckDesignGeometryRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_DECK_GEOMETRY_READS.has(value)
  );
}
