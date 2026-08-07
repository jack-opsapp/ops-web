import "server-only";

import {
  ALL_PERMISSIONS,
  type AppPermission,
  type PermissionScope,
} from "@/lib/types/permissions";

/**
 * The authority RPC evaluates this complete server-owned registry on every
 * request. Tool arguments can never add, remove, or reorder permission keys.
 */
export const REGISTERED_ACTOR_PERMISSION_KEYS: readonly AppPermission[] =
  Object.freeze(
    [...ALL_PERMISSIONS].sort((left, right) => left.localeCompare(right))
  );

export interface EffectivePermissionRow {
  readonly permission: string;
  readonly scope: PermissionScope;
}

/** Canonical, current row returned by the service-role authority boundary. */
export interface ActorAuthoritySnapshot {
  readonly actorUserId: string;
  readonly companyId: string;
  readonly isActive: boolean;
  readonly isAdmin: boolean;
  readonly roleIds: readonly string[];
  /**
   * Keys explicitly present in a role or override, including revokes and inert
   * overrides. This prevents a legacy fallback from reviving a revoked key.
   */
  readonly configuredPermissions: readonly AppPermission[];
  readonly effectivePermissions: readonly EffectivePermissionRow[];
  /** Opaque validated database output; the resolver must not recompute it. */
  readonly permissionSnapshotRevision: string;
}

export interface InternalAuthorityLookup {
  readonly firebaseSubject: string;
  readonly registeredPermissionKeys: readonly AppPermission[];
}

export interface McpAuthorityLookup {
  readonly actorUserId: string;
  readonly companyId: string;
  readonly registeredPermissionKeys: readonly AppPermission[];
}

declare const TRUSTED_ACTOR_AUTHORITY_REPOSITORY: unique symbol;
const TRUSTED_ACTOR_AUTHORITY_REPOSITORIES = new WeakSet<object>();

interface TrustedActorAuthorityRepositoryBrand {
  readonly [TRUSTED_ACTOR_AUTHORITY_REPOSITORY]: true;
}

export interface AgentAuthoritySupabaseRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

/** Minimal thenable RPC surface implemented by a server Supabase client. */
export interface AgentAuthoritySupabaseRpcClient {
  rpc(
    functionName:
      | "resolve_agent_actor_authority_as_system"
      | "resolve_agent_actor_authority_for_subject_as_system",
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<AgentAuthoritySupabaseRpcResult>;
}

/**
 * Adapter seam for current actor authority. Implementations resolve Firebase
 * subjects without email fallback and call the service-role authority RPC.
 */
export interface ActorAuthorityRepository extends TrustedActorAuthorityRepositoryBrand {
  /**
   * One direct call to
   * `resolve_agent_actor_authority_for_subject_as_system(text,text[])`.
   * Implementations must not split subject resolution and authority resolution
   * into separate reads.
   */
  resolveInternalAuthority(
    lookup: InternalAuthorityLookup
  ): Promise<ActorAuthoritySnapshot | null>;
  /**
   * One direct call to
   * `resolve_agent_actor_authority_as_system(uuid,uuid,text[])` after the MCP
   * principal's actor and company grant claims have been validated.
   */
  resolveMcpAuthority(
    lookup: McpAuthorityLookup
  ): Promise<ActorAuthoritySnapshot | null>;
}

function authoritySnapshotFromRpcData(
  data: unknown
): ActorAuthoritySnapshot | null {
  if (!Array.isArray(data)) {
    throw new TypeError("Actor authority RPC returned a non-array result");
  }
  if (data.length === 0) return null;
  if (data.length !== 1) {
    throw new TypeError("Actor authority RPC returned multiple rows");
  }
  const row = data[0];
  if (typeof row !== "object" || row === null) {
    throw new TypeError("Actor authority RPC returned a malformed row");
  }
  const record = row as Record<string, unknown>;
  return {
    actorUserId: record.actor_user_id as string,
    companyId: record.company_id as string,
    isActive: record.is_active as boolean,
    isAdmin: record.is_admin as boolean,
    roleIds: record.role_ids as readonly string[],
    configuredPermissions:
      record.configured_permissions as readonly AppPermission[],
    effectivePermissions:
      record.effective_permissions as readonly EffectivePermissionRow[],
    permissionSnapshotRevision: record.permission_snapshot_revision as string,
  };
}

/**
 * Concrete service-role Supabase adapter. Raw structural repositories never
 * receive the runtime trust brand consumed by resolveActorContext.
 */
export function createSupabaseActorAuthorityRepository(
  client: AgentAuthoritySupabaseRpcClient
): ActorAuthorityRepository {
  if (
    typeof client !== "object" ||
    client === null ||
    typeof client.rpc !== "function"
  ) {
    throw new TypeError("A Supabase RPC client is required");
  }

  const repository = {
    async resolveInternalAuthority(
      lookup: InternalAuthorityLookup
    ): Promise<ActorAuthoritySnapshot | null> {
      const result = await client.rpc(
        "resolve_agent_actor_authority_for_subject_as_system",
        {
          p_firebase_subject: lookup.firebaseSubject,
          p_registered_permission_keys: [...lookup.registeredPermissionKeys],
        }
      );
      if (result.error) throw result.error;
      return authoritySnapshotFromRpcData(result.data);
    },

    async resolveMcpAuthority(
      lookup: McpAuthorityLookup
    ): Promise<ActorAuthoritySnapshot | null> {
      const result = await client.rpc(
        "resolve_agent_actor_authority_as_system",
        {
          p_actor_user_id: lookup.actorUserId,
          p_company_id: lookup.companyId,
          p_registered_permission_keys: [...lookup.registeredPermissionKeys],
        }
      );
      if (result.error) throw result.error;
      return authoritySnapshotFromRpcData(result.data);
    },
  };
  TRUSTED_ACTOR_AUTHORITY_REPOSITORIES.add(repository);
  return Object.freeze(repository) as ActorAuthorityRepository;
}

export function isTrustedActorAuthorityRepository(
  value: unknown
): value is ActorAuthorityRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_ACTOR_AUTHORITY_REPOSITORIES.has(value)
  );
}
