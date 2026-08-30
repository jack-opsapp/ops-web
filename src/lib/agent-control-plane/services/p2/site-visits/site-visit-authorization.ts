import "server-only";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  GetSiteVisitContextInputSchema,
  ListSiteVisitsInputSchema,
  type GetSiteVisitContextInput,
  type ListSiteVisitsInput,
} from "@/lib/agent-control-plane/contracts/site-visits";
import {
  GET_SITE_VISIT_CONTEXT_CANDIDATE,
  LIST_SITE_VISITS_CANDIDATE,
  selectedGetSiteVisitContextVariantKeys,
  selectedListSiteVisitsVariantKeys,
  type GetSiteVisitContextAuthorizationVariantKey,
  type ListSiteVisitsAuthorizationVariantKey,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/site-visits";
import type { PermissionScope } from "@/lib/types/permissions";
import { assertP2ReadPolicyBinding } from "../shared/authorize-read";
import { canonicalizeAgentMachineStringSet } from "@/lib/agent-control-plane/canonical-order";

const AUTHORIZED_LIST_SITE_VISITS_READS = new WeakSet<object>();
const AUTHORIZED_SITE_VISIT_CONTEXT_READS = new WeakSet<object>();

export class SiteVisitReadAuthorizationError extends Error {
  readonly code = "SITE_VISIT_READ_AUTHORIZATION_INVALID" as const;

  constructor() {
    super("SITE_VISIT_READ_AUTHORIZATION_INVALID");
    this.name = "SiteVisitReadAuthorizationError";
  }
}

interface AuthorizedSiteVisitReadBase {
  readonly actorContext: ActorContext;
  readonly capabilityManifestRevision: "2026-08-22.capability-manifest.v8";
  readonly requiredOAuthScopes: readonly string[];
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly grantRevision: string;
  readonly grantedScopeCeiling: readonly string[];
  readonly calendarScope: "all" | "own" | null;
  readonly clientsScope: "all" | "assigned" | null;
  readonly deckBuilderScope: "all" | "assigned" | null;
  readonly pipelineScope: "all" | "assigned";
  readonly photosScope: "all" | "assigned" | null;
}

export interface AuthorizedListSiteVisitsRead extends AuthorizedSiteVisitReadBase {
  readonly capabilityId: "list_site_visits";
  readonly capabilityRevision: "list_site_visits:2026-08-22.v1";
  readonly query: ListSiteVisitsInput;
  readonly variantKeys: readonly ListSiteVisitsAuthorizationVariantKey[];
}

export interface AuthorizedGetSiteVisitContextRead extends AuthorizedSiteVisitReadBase {
  readonly capabilityId: "get_site_visit_context";
  readonly capabilityRevision: "get_site_visit_context:2026-08-22.v1";
  readonly query: GetSiteVisitContextInput;
  readonly variantKeys: readonly GetSiteVisitContextAuthorizationVariantKey[];
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
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new SiteVisitReadAuthorizationError();
  }
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const expected = [...expectedKeys].sort((left, right) =>
    left.localeCompare(right)
  );
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new SiteVisitReadAuthorizationError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function scopedPermission<T extends "all" | "assigned" | "own">(
  permissions: Readonly<Record<string, PermissionScope>>,
  key:
    | "calendar.view"
    | "clients.view"
    | "deck_builder.view"
    | "photos.view"
    | "pipeline.view",
  allowed: readonly T[]
): T {
  const value = permissions[key];
  if (!allowed.includes(value as T)) {
    throw new SiteVisitReadAuthorizationError();
  }
  return value as T;
}

function assertSameScope<T extends string>(current: T | null, next: T): T {
  if (current !== null && current !== next) {
    throw new SiteVisitReadAuthorizationError();
  }
  return next;
}

function assertMcpActor(actorContext: ActorContext) {
  const auth = actorContext.auth;
  if (
    auth.channel !== "mcp" ||
    !auth.oauthGrantId ||
    !auth.oauthClientId ||
    !auth.grantRevision ||
    auth.scopeCeiling.length === 0
  ) {
    throw new SiteVisitReadAuthorizationError();
  }
  return auth;
}

function bindVariants(input: {
  readonly candidate:
    | typeof LIST_SITE_VISITS_CANDIDATE
    | typeof GET_SITE_VISIT_CONTEXT_CANDIDATE;
  readonly capabilityId: "get_site_visit_context" | "list_site_visits";
  readonly capabilityRevision:
    | "get_site_visit_context:2026-08-22.v1"
    | "list_site_visits:2026-08-22.v1";
  readonly variantKeys: readonly string[];
  readonly authorizations: unknown;
}) {
  const authorizations = exactAuthorizationRecord(
    input.authorizations,
    input.variantKeys
  );
  const policies = new Map(
    input.candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );

  let actorContext: ActorContext | null = null;
  let calendarScope: "all" | "own" | null = null;
  let clientsScope: "all" | "assigned" | null = null;
  let deckBuilderScope: "all" | "assigned" | null = null;
  let pipelineScope: "all" | "assigned" | null = null;
  let photosScope: "all" | "assigned" | null = null;
  const requiredOAuthScopes: string[] = [];

  for (const key of input.variantKeys) {
    const policy = policies.get(key);
    if (!policy) throw new SiteVisitReadAuthorizationError();
    const declaredPermissions = sortedUnique(
      policy.permissionRequirementGroups.flatMap((group) =>
        group.map((requirement) => requirement.permission)
      )
    );
    const binding = assertP2ReadPolicyBinding({
      authorization: authorizations[key],
      policy,
      expected: {
        capabilityId: input.capabilityId,
        capabilityRevision: input.capabilityRevision,
        capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
        requiredOAuthScopes: policy.requiredOAuthScopes,
        declaredPermissions,
        satisfiedPermissionGroupIndexes: [0],
        resolvedPermissionKeys: declaredPermissions,
      },
    });
    if (actorContext !== null && binding.actorContext !== actorContext) {
      throw new SiteVisitReadAuthorizationError();
    }
    actorContext ??= binding.actorContext;
    requiredOAuthScopes.push(...binding.requiredOAuthScopes);

    if (
      key === "booked_appointments" ||
      key === "visit_history" ||
      key === "opportunity"
    ) {
      calendarScope = assertSameScope(
        calendarScope,
        scopedPermission(binding.resolvedPermissions, "calendar.view", [
          "all",
          "own",
        ])
      );
      clientsScope = assertSameScope(
        clientsScope,
        scopedPermission(binding.resolvedPermissions, "clients.view", [
          "all",
          "assigned",
        ])
      );
      pipelineScope = assertSameScope(
        pipelineScope,
        scopedPermission(binding.resolvedPermissions, "pipeline.view", [
          "all",
          "assigned",
        ])
      );
    } else if (key === "unlinked_history" || key === "unlinked") {
      pipelineScope = assertSameScope(
        pipelineScope,
        scopedPermission(binding.resolvedPermissions, "pipeline.view", ["all"])
      );
    } else if (key === "opportunity_artifacts") {
      photosScope = assertSameScope(
        photosScope,
        scopedPermission(binding.resolvedPermissions, "photos.view", [
          "all",
          "assigned",
        ])
      );
    } else if (key === "unlinked_artifacts") {
      photosScope = assertSameScope(
        photosScope,
        scopedPermission(binding.resolvedPermissions, "photos.view", ["all"])
      );
    } else if (key === "opportunity_decks") {
      deckBuilderScope = assertSameScope(
        deckBuilderScope,
        scopedPermission(binding.resolvedPermissions, "deck_builder.view", [
          "all",
          "assigned",
        ])
      );
      photosScope = assertSameScope(
        photosScope,
        scopedPermission(binding.resolvedPermissions, "photos.view", [
          "all",
          "assigned",
        ])
      );
    } else if (key === "unlinked_decks") {
      deckBuilderScope = assertSameScope(
        deckBuilderScope,
        scopedPermission(binding.resolvedPermissions, "deck_builder.view", [
          "all",
        ])
      );
      photosScope = assertSameScope(
        photosScope,
        scopedPermission(binding.resolvedPermissions, "photos.view", ["all"])
      );
    } else {
      throw new SiteVisitReadAuthorizationError();
    }
  }

  if (!actorContext || !pipelineScope) {
    throw new SiteVisitReadAuthorizationError();
  }
  const auth = assertMcpActor(actorContext);
  return {
    actorContext,
    requiredOAuthScopes: sortedUnique(requiredOAuthScopes),
    calendarScope,
    clientsScope,
    deckBuilderScope,
    pipelineScope,
    photosScope,
    oauthGrantId: auth.oauthGrantId,
    oauthClientId: auth.oauthClientId,
    grantRevision: auth.grantRevision,
    grantedScopeCeiling: canonicalizeAgentMachineStringSet(auth.scopeCeiling),
  } as const;
}

export function authorizeListSiteVisitsRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedListSiteVisitsRead {
  try {
    const query = deepFreeze(ListSiteVisitsInputSchema.parse(input.query));
    const variantKeys = selectedListSiteVisitsVariantKeys(query);
    const binding = bindVariants({
      candidate: LIST_SITE_VISITS_CANDIDATE,
      capabilityId: "list_site_visits",
      capabilityRevision: "list_site_visits:2026-08-22.v1",
      variantKeys,
      authorizations: input.authorizations,
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "list_site_visits" as const,
      capabilityRevision: "list_site_visits:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_LIST_SITE_VISITS_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof SiteVisitReadAuthorizationError) throw error;
    throw new SiteVisitReadAuthorizationError();
  }
}

export function authorizeGetSiteVisitContextRead(input: {
  readonly query: unknown;
  readonly authorizations: unknown;
}): AuthorizedGetSiteVisitContextRead {
  try {
    const query = deepFreeze(GetSiteVisitContextInputSchema.parse(input.query));
    const variantKeys = selectedGetSiteVisitContextVariantKeys(query);
    const binding = bindVariants({
      candidate: GET_SITE_VISIT_CONTEXT_CANDIDATE,
      capabilityId: "get_site_visit_context",
      capabilityRevision: "get_site_visit_context:2026-08-22.v1",
      variantKeys,
      authorizations: input.authorizations,
    });
    const proof = deepFreeze({
      ...binding,
      capabilityId: "get_site_visit_context" as const,
      capabilityRevision: "get_site_visit_context:2026-08-22.v1" as const,
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8" as const,
      query,
      variantKeys: [...variantKeys],
    });
    AUTHORIZED_SITE_VISIT_CONTEXT_READS.add(proof);
    return proof;
  } catch (error) {
    if (error instanceof SiteVisitReadAuthorizationError) throw error;
    throw new SiteVisitReadAuthorizationError();
  }
}

export function isAuthorizedListSiteVisitsRead(
  value: unknown
): value is AuthorizedListSiteVisitsRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_LIST_SITE_VISITS_READS.has(value)
  );
}

export function isAuthorizedGetSiteVisitContextRead(
  value: unknown
): value is AuthorizedGetSiteVisitContextRead {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_SITE_VISIT_CONTEXT_READS.has(value)
  );
}
