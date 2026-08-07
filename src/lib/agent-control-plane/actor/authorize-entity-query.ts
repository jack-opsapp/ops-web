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

export async function authorizeCurrentEntityQuery({
  capabilityAuthorization,
  authorizationRepository,
  entity,
  action,
}: AuthorizeCurrentEntityQueryInput): Promise<AuthorizedEntityQueryContext> {
  if (!isAuthorizedCapability(capabilityAuthorization)) {
    throw authorizationInternal(
      "unknown-request",
      "entity_capability_authorization_untrusted"
    );
  }

  const { actorContext } = capabilityAuthorization;
  if (!isTrustedCurrentEntityAuthorizationRepository(authorizationRepository)) {
    throw authorizationInternal(
      actorContext.requestId,
      "entity_authorization_repository_untrusted"
    );
  }
  if (
    typeof entity !== "object" ||
    entity === null ||
    typeof entity.kind !== "string" ||
    typeof entity.id !== "string" ||
    typeof action !== "string"
  ) {
    throw invalidEntityArgument(actorContext.requestId, ["entity"]);
  }
  const permission = permissionFor(entity.kind, action);
  if (!permission) {
    throw invalidEntityArgument(actorContext.requestId, ["entity", "action"]);
  }

  const entityId = entity.id.trim().toLowerCase();
  if (!UUID_PATTERN.test(entityId)) {
    throw invalidEntityArgument(actorContext.requestId, ["entity", "id"]);
  }

  const resolvedScope = capabilityAuthorization.resolvedPermissions[permission];
  if (!resolvedScope) {
    if (capabilityAuthorization.declaredPermissions.includes(permission)) {
      throw entityNotFound(actorContext.requestId, "entity_access_unavailable");
    }
    throw authorizationInternal(
      actorContext.requestId,
      "entity_permission_missing_from_capability"
    );
  }

  let allowed: unknown;
  try {
    allowed = await authorizationRepository.authorizeCurrentEntity({
      actorUserId: actorContext.actorUserId,
      companyId: actorContext.companyId,
      entityKind: entity.kind,
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
    capabilityId: capabilityAuthorization.capabilityId,
    capabilityRevision: capabilityAuthorization.capabilityRevision,
    entity: Object.freeze({ kind: entity.kind, id: entityId }),
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
