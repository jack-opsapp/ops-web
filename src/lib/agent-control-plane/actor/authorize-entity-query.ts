import "server-only";

import type { AuthorizedCapability } from "./authorize-capability";
import { isAuthorizedCapability } from "./authorize-capability";
import {
  authorizationInternal,
  authorizationUnavailable,
  entityNotFound,
  invalidEntityArgument,
} from "./errors";
import type { ActorContext } from "./resolve-actor-context";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";
import { snapshotExactOwnEnumerableData } from "./exact-own-data-snapshot";

export type EntityKind =
  | "opportunity"
  | "project"
  | "task"
  | "client"
  | "sub_client"
  | "calendar_event"
  | "calendar_user_event";

export type EntityAction = "view" | "edit" | "change_status" | "delete";

export interface CurrentEntityReference {
  readonly kind: EntityKind;
  readonly id: string;
}

export interface CurrentEntityAuthorizationLookup {
  readonly actorUserId: string;
  readonly companyId: string;
  readonly entityKind: EntityKind;
  readonly entityId: string;
  readonly action: EntityAction;
}

declare const TRUSTED_ENTITY_AUTHORIZATION_REPOSITORY: unique symbol;
const TRUSTED_ENTITY_AUTHORIZATION_REPOSITORIES = new WeakSet<object>();

interface TrustedEntityAuthorizationRepositoryBrand {
  readonly [TRUSTED_ENTITY_AUTHORIZATION_REPOSITORY]: true;
}

export interface EntityAuthorizationSupabaseRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

/** Minimal thenable RPC surface implemented by a server Supabase client. */
export interface EntityAuthorizationSupabaseRpcClient {
  rpc(
    functionName: "authorize_agent_entity_as_system",
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<EntityAuthorizationSupabaseRpcResult>;
}

/**
 * Adapter seam for `authorize_agent_entity_as_system`. Implementations must
 * execute this lookup every time; assignment decisions are never cached in an
 * ActorContext or capability proof.
 *
 * This boolean is a privacy-safe preflight only. A domain read must call the
 * private entity predicate again in the same SQL statement that returns data;
 * a prior boolean result cannot authorize a later service-role fetch.
 */
export interface CurrentEntityAuthorizationRepository extends TrustedEntityAuthorizationRepositoryBrand {
  authorizeCurrentEntity(
    lookup: CurrentEntityAuthorizationLookup
  ): Promise<unknown>;
}

/** Concrete service-role adapter for the privacy-safe entity RPC. */
export function createSupabaseCurrentEntityAuthorizationRepository(
  client: EntityAuthorizationSupabaseRpcClient
): CurrentEntityAuthorizationRepository {
  if (
    typeof client !== "object" ||
    client === null ||
    typeof client.rpc !== "function"
  ) {
    throw new TypeError("A Supabase RPC client is required");
  }

  const repository = {
    async authorizeCurrentEntity(
      lookup: CurrentEntityAuthorizationLookup
    ): Promise<unknown> {
      const result = await client.rpc("authorize_agent_entity_as_system", {
        p_actor_user_id: lookup.actorUserId,
        p_company_id: lookup.companyId,
        p_entity_kind: lookup.entityKind,
        p_entity_id: lookup.entityId,
        p_action: lookup.action,
      });
      if (result.error) throw result.error;
      return result.data;
    },
  };
  TRUSTED_ENTITY_AUTHORIZATION_REPOSITORIES.add(repository);
  return Object.freeze(repository) as CurrentEntityAuthorizationRepository;
}

export function isTrustedCurrentEntityAuthorizationRepository(
  value: unknown
): value is CurrentEntityAuthorizationRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_ENTITY_AUTHORIZATION_REPOSITORIES.has(value)
  );
}

declare const AUTHORIZED_ENTITY_QUERY: unique symbol;
const AUTHORIZED_ENTITY_QUERIES = new WeakSet<object>();

interface AuthorizedEntityQueryBrand {
  readonly [AUTHORIZED_ENTITY_QUERY]: true;
}

/**
 * Nominal context for a same-statement authorized domain query. It carries no
 * assignment snapshot; the domain repository must evaluate current entity
 * access again while selecting the row.
 */
export interface AuthorizedEntityQueryContext extends AuthorizedEntityQueryBrand {
  readonly actorContext: ActorContext;
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly entity: Readonly<CurrentEntityReference>;
  readonly action: EntityAction;
  readonly permission: AppPermission;
  readonly resolvedScope: PermissionScope;
}

export interface AuthorizeCurrentEntityQueryInput {
  readonly capabilityAuthorization: AuthorizedCapability;
  readonly authorizationRepository: CurrentEntityAuthorizationRepository;
  readonly entity: CurrentEntityReference;
  readonly action: EntityAction;
}

const AUTHORIZE_ENTITY_QUERY_INPUT_KEYS = [
  "capabilityAuthorization",
  "authorizationRepository",
  "entity",
  "action",
] as const;
const AUTHORIZED_CAPABILITY_KEYS = [
  "actorContext",
  "capabilityId",
  "capabilityRevision",
  "capabilityManifestRevision",
  "declaredPermissions",
  "resolvedPermissions",
  "satisfiedPermissionGroupIndexes",
  "satisfiedOAuthScopes",
] as const;
const ENTITY_AUTHORIZATION_REPOSITORY_KEYS = [
  "authorizeCurrentEntity",
] as const;
const ENTITY_REFERENCE_KEYS = ["kind", "id"] as const;

const ENTITY_ACTION_PERMISSION: Readonly<
  Record<EntityKind, Readonly<Partial<Record<EntityAction, AppPermission>>>>
> = Object.freeze({
  opportunity: Object.freeze({
    view: "pipeline.view",
    edit: "pipeline.edit",
  }),
  project: Object.freeze({
    view: "projects.view",
    edit: "projects.edit",
  }),
  task: Object.freeze({
    view: "tasks.view",
    edit: "tasks.edit",
    change_status: "tasks.change_status",
  }),
  client: Object.freeze({
    view: "clients.view",
    edit: "clients.edit",
  }),
  sub_client: Object.freeze({
    view: "clients.view",
    edit: "clients.edit",
  }),
  calendar_event: Object.freeze({
    view: "calendar.view",
    edit: "calendar.edit",
    delete: "calendar.delete",
  }),
  calendar_user_event: Object.freeze({
    view: "calendar.view",
    edit: "calendar.edit",
    delete: "calendar.delete",
  }),
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function permissionFor(
  kind: EntityKind,
  action: EntityAction
): AppPermission | null {
  if (!Object.prototype.hasOwnProperty.call(ENTITY_ACTION_PERMISSION, kind)) {
    return null;
  }
  return ENTITY_ACTION_PERMISSION[kind][action] ?? null;
}

export async function authorizeCurrentEntityQuery(
  input: AuthorizeCurrentEntityQueryInput
): Promise<AuthorizedEntityQueryContext> {
  const inputSnapshot = snapshotExactOwnEnumerableData(
    input,
    AUTHORIZE_ENTITY_QUERY_INPUT_KEYS
  );
  if (!inputSnapshot) {
    throw authorizationInternal(
      "unknown-request",
      "entity_authorization_input_invalid"
    );
  }

  const capabilityAuthorization = inputSnapshot.capabilityAuthorization;
  const authorizationRepository = inputSnapshot.authorizationRepository;
  const entitySnapshot = snapshotExactOwnEnumerableData(
    inputSnapshot.entity,
    ENTITY_REFERENCE_KEYS
  );
  const actionValue = inputSnapshot.action;
  const capabilitySnapshot = snapshotExactOwnEnumerableData(
    capabilityAuthorization,
    AUTHORIZED_CAPABILITY_KEYS
  );
  const repositorySnapshot = snapshotExactOwnEnumerableData(
    authorizationRepository,
    ENTITY_AUTHORIZATION_REPOSITORY_KEYS
  );

  if (!isAuthorizedCapability(capabilityAuthorization) || !capabilitySnapshot) {
    throw authorizationInternal(
      "unknown-request",
      "entity_capability_authorization_untrusted"
    );
  }

  const actorContext = capabilitySnapshot.actorContext as ActorContext;
  if (
    !isTrustedCurrentEntityAuthorizationRepository(authorizationRepository) ||
    !repositorySnapshot ||
    typeof repositorySnapshot.authorizeCurrentEntity !== "function"
  ) {
    throw authorizationInternal(
      actorContext.requestId,
      "entity_authorization_repository_untrusted"
    );
  }
  const entityKind = entitySnapshot?.kind;
  const entityIdValue = entitySnapshot?.id;
  if (
    !entitySnapshot ||
    typeof entityKind !== "string" ||
    typeof entityIdValue !== "string" ||
    typeof actionValue !== "string"
  ) {
    throw invalidEntityArgument(actorContext.requestId, ["entity"]);
  }
  const action = actionValue as EntityAction;
  const permission = permissionFor(entityKind as EntityKind, action);
  if (!permission) {
    throw invalidEntityArgument(actorContext.requestId, ["entity", "action"]);
  }

  const entityId = entityIdValue.trim().toLowerCase();
  if (!UUID_PATTERN.test(entityId)) {
    throw invalidEntityArgument(actorContext.requestId, ["entity", "id"]);
  }

  const resolvedPermissions =
    capabilitySnapshot.resolvedPermissions as Readonly<
      Record<string, PermissionScope>
    >;
  const declaredPermissions =
    capabilitySnapshot.declaredPermissions as readonly string[];
  const resolvedScope = resolvedPermissions[permission];
  if (!resolvedScope) {
    if (declaredPermissions.includes(permission)) {
      throw entityNotFound(actorContext.requestId, "entity_access_unavailable");
    }
    throw authorizationInternal(
      actorContext.requestId,
      "entity_permission_missing_from_capability"
    );
  }

  const authorizeCurrentEntity =
    repositorySnapshot.authorizeCurrentEntity as CurrentEntityAuthorizationRepository["authorizeCurrentEntity"];
  const actorUserId = actorContext.actorUserId;
  const companyId = actorContext.companyId;
  const capabilityId = capabilitySnapshot.capabilityId as string;
  const capabilityRevision = capabilitySnapshot.capabilityRevision as string;

  let allowed: unknown;
  try {
    allowed = await authorizeCurrentEntity.call(authorizationRepository, {
      actorUserId,
      companyId,
      entityKind: entityKind as EntityKind,
      entityId,
      action,
    });
  } catch {
    throw authorizationUnavailable(
      actorContext.requestId,
      "entity_authority_lookup_failed"
    );
  }

  if (allowed !== true && allowed !== false) {
    throw authorizationUnavailable(
      actorContext.requestId,
      "entity_authority_response_malformed"
    );
  }

  if (allowed !== true) {
    throw entityNotFound(actorContext.requestId, "entity_access_unavailable");
  }

  const queryContext = {
    actorContext,
    capabilityId,
    capabilityRevision,
    entity: Object.freeze({ kind: entityKind as EntityKind, id: entityId }),
    action,
    permission,
    resolvedScope,
  };
  AUTHORIZED_ENTITY_QUERIES.add(queryContext);
  return Object.freeze(queryContext) as AuthorizedEntityQueryContext;
}

export function isAuthorizedEntityQueryContext(
  value: unknown
): value is AuthorizedEntityQueryContext {
  return (
    typeof value === "object" &&
    value !== null &&
    AUTHORIZED_ENTITY_QUERIES.has(value)
  );
}
