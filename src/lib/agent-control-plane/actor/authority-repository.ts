import "server-only";

import { types as nodeTypes } from "node:util";

import {
  ALL_PERMISSIONS,
  type AppPermission,
  type PermissionScope,
} from "@/lib/types/permissions";
import { snapshotExactOwnEnumerableData } from "./exact-own-data-snapshot";

const ArrayConstructor = Array;
const arrayIsArray = Array.isArray;
const isProxy = nodeTypes.isProxy;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const defineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const reflectOwnKeys = Reflect.ownKeys;
const numberIsSafeInteger = Number.isSafeInteger;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (
  pattern: RegExp,
  value: string
) => boolean;
const stringTrim = Function.call.bind(String.prototype.trim) as (
  value: string
) => string;
const setHas = Function.call.bind(Set.prototype.has) as (
  set: ReadonlySet<unknown>,
  value: unknown
) => boolean;
const arrayPushDescriptor = getOwnPropertyDescriptor(Array.prototype, "push");

function authorityDecoderIntrinsicsAreCurrent(): boolean {
  const currentPush = getOwnPropertyDescriptor(Array.prototype, "push");
  return Boolean(
    arrayPushDescriptor &&
    currentPush &&
    "value" in arrayPushDescriptor &&
    "value" in currentPush &&
    currentPush.value === arrayPushDescriptor.value
  );
}

/**
 * The authority RPC evaluates this complete server-owned registry on every
 * request. Tool arguments can never add, remove, or reorder permission keys.
 */
export const REGISTERED_ACTOR_PERMISSION_KEYS: readonly AppPermission[] =
  Object.freeze(
    [...ALL_PERMISSIONS].sort((left, right) => left.localeCompare(right))
  );

const AUTHORITY_ROW_KEYS = [
  "actor_user_id",
  "company_id",
  "is_active",
  "is_admin",
  "role_ids",
  "configured_permissions",
  "effective_permissions",
  "permission_snapshot_revision",
] as const;
const EFFECTIVE_PERMISSION_ROW_KEYS = ["permission", "scope"] as const;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_AUTHORITY_ARRAY_ITEMS = 256;
const MAX_AUTHORITY_REVISION_CHARACTERS = 256;
const REGISTERED_PERMISSION_KEY_SET = new Set<string>(
  REGISTERED_ACTOR_PERMISSION_KEYS
);
const VALID_PERMISSION_SCOPE_SET = new Set<PermissionScope>([
  "all",
  "assigned",
  "own",
]);

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

export interface ActorAuthorityLookup {
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
   * `resolve_agent_actor_authority_as_system(uuid,uuid,text[])` after an MCP
   * grant or the canonical Phase C route has validated actor and company IDs.
   */
  resolveActorAuthority(
    lookup: ActorAuthorityLookup
  ): Promise<ActorAuthoritySnapshot | null>;
}

function snapshotExactDenseDataArray(
  value: unknown,
  maximumItems: number
): readonly unknown[] | null {
  if (!arrayIsArray(value)) return null;

  try {
    if (isProxy(value)) return null;

    const descriptors = getOwnPropertyDescriptors(value);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = reflectOwnKeys(descriptors);
    const lengthDescriptor = descriptorRecord.length;
    const length =
      lengthDescriptor && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : null;
    if (
      typeof length !== "number" ||
      !numberIsSafeInteger(length) ||
      length < 0 ||
      length > maximumItems ||
      !lengthDescriptor ||
      lengthDescriptor.enumerable ||
      keys.length !== length + 1
    ) {
      return null;
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (typeof keys[index] !== "string") return null;
    }

    const snapshot: unknown[] = new ArrayConstructor(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptorRecord[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      defineProperty(snapshot, String(index), {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return objectFreeze(snapshot);
  } catch {
    return null;
  }
}

// Role identifiers are opaque catalog keys, not tenancy claims: the seven
// global OPS roles are seeded as zero-prefix sentinel UUIDs (version and
// variant nibbles 0), which the strict RFC-4122 canonical pattern rejects.
// Requiring hex UUID *shape* keeps injection defense; requiring version
// nibbles here would (and, until the 2026-08-18 MCP mount E2E, silently did)
// reject every OPS user's authority row. Actor and company identifiers keep
// the strict canonical check.
const ROLE_UUID_SHAPE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function snapshotRoleUuidArray(value: unknown): readonly string[] | null {
  const values = snapshotExactDenseDataArray(value, MAX_AUTHORITY_ARRAY_ITEMS);
  if (!values) return null;
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (
      typeof item !== "string" ||
      !regexpTest(ROLE_UUID_SHAPE_PATTERN, item)
    ) {
      return null;
    }
  }
  return values as readonly string[];
}

function snapshotConfiguredPermissions(
  value: unknown
): readonly AppPermission[] | null {
  const values = snapshotExactDenseDataArray(value, MAX_AUTHORITY_ARRAY_ITEMS);
  if (!values) return null;
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (
      typeof item !== "string" ||
      !setHas(REGISTERED_PERMISSION_KEY_SET, item)
    ) {
      return null;
    }
  }
  return values as readonly AppPermission[];
}

function snapshotEffectivePermissions(
  value: unknown
): readonly EffectivePermissionRow[] | null {
  const rows = snapshotExactDenseDataArray(value, MAX_AUTHORITY_ARRAY_ITEMS);
  if (!rows) return null;

  const snapshot: EffectivePermissionRow[] = new ArrayConstructor(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const values = snapshotExactOwnEnumerableData(
      row,
      EFFECTIVE_PERMISSION_ROW_KEYS
    );
    const permission = values?.permission;
    const scope = values?.scope;
    if (
      !values ||
      typeof permission !== "string" ||
      !setHas(REGISTERED_PERMISSION_KEY_SET, permission) ||
      typeof scope !== "string" ||
      !setHas(VALID_PERMISSION_SCOPE_SET, scope as PermissionScope)
    ) {
      return null;
    }
    defineProperty(snapshot, String(index), {
      configurable: false,
      enumerable: true,
      value: objectFreeze({ permission, scope: scope as PermissionScope }),
      writable: false,
    });
  }
  return objectFreeze(snapshot);
}

function authoritySnapshotFromRpcData(
  data: unknown
): ActorAuthoritySnapshot | null {
  const rows = snapshotExactDenseDataArray(data, 1);
  if (!rows) {
    throw new TypeError("Actor authority RPC returned a malformed result");
  }
  if (rows.length === 0) return null;

  const values = snapshotExactOwnEnumerableData(rows[0], AUTHORITY_ROW_KEYS);
  const actorUserId = values?.actor_user_id;
  const companyId = values?.company_id;
  const isActive = values?.is_active;
  const isAdmin = values?.is_admin;
  const roleIds = snapshotRoleUuidArray(values?.role_ids);
  const configuredPermissions = snapshotConfiguredPermissions(
    values?.configured_permissions
  );
  const effectivePermissions = snapshotEffectivePermissions(
    values?.effective_permissions
  );
  const permissionSnapshotRevision = values?.permission_snapshot_revision;
  if (
    !values ||
    typeof actorUserId !== "string" ||
    !regexpTest(CANONICAL_UUID_PATTERN, actorUserId) ||
    typeof companyId !== "string" ||
    !regexpTest(CANONICAL_UUID_PATTERN, companyId) ||
    typeof isActive !== "boolean" ||
    typeof isAdmin !== "boolean" ||
    !roleIds ||
    !configuredPermissions ||
    !effectivePermissions ||
    typeof permissionSnapshotRevision !== "string" ||
    permissionSnapshotRevision.length < 1 ||
    permissionSnapshotRevision.length > MAX_AUTHORITY_REVISION_CHARACTERS ||
    stringTrim(permissionSnapshotRevision) !== permissionSnapshotRevision
  ) {
    throw new TypeError("Actor authority RPC returned a malformed row");
  }

  return objectFreeze({
    actorUserId,
    companyId,
    isActive,
    isAdmin,
    roleIds,
    configuredPermissions,
    effectivePermissions,
    permissionSnapshotRevision,
  });
}

function snapshotRpcResult(value: unknown): AgentAuthoritySupabaseRpcResult {
  if (typeof value !== "object" || value === null || isProxy(value)) {
    throw new TypeError("Actor authority RPC returned a malformed envelope");
  }
  try {
    const descriptors = getOwnPropertyDescriptors(value);
    const descriptorRecord = descriptors as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const dataDescriptor = descriptorRecord.data;
    const errorDescriptor = descriptorRecord.error;
    if (
      !dataDescriptor ||
      !("value" in dataDescriptor) ||
      !dataDescriptor.enumerable ||
      !errorDescriptor ||
      !("value" in errorDescriptor) ||
      !errorDescriptor.enumerable
    ) {
      throw new TypeError("Actor authority RPC returned a malformed envelope");
    }
    return objectFreeze({
      data: dataDescriptor.value,
      error: errorDescriptor.value,
    });
  } catch {
    throw new TypeError("Actor authority RPC returned a malformed envelope");
  }
}

/**
 * Concrete service-role Supabase adapter. Raw structural repositories never
 * receive the runtime trust brand consumed by resolveActorContext.
 */
export function createSupabaseActorAuthorityRepository(
  client: AgentAuthoritySupabaseRpcClient
): ActorAuthorityRepository {
  const rpc =
    typeof client === "object" && client !== null ? client.rpc : undefined;
  if (
    typeof client !== "object" ||
    client === null ||
    typeof rpc !== "function"
  ) {
    throw new TypeError("A Supabase RPC client is required");
  }

  const repository = {
    async resolveInternalAuthority(
      lookup: InternalAuthorityLookup
    ): Promise<ActorAuthoritySnapshot | null> {
      const rawResult = await rpc.call(
        client,
        "resolve_agent_actor_authority_for_subject_as_system",
        Object.freeze({
          p_firebase_subject: lookup.firebaseSubject,
          p_registered_permission_keys: Object.freeze([
            ...lookup.registeredPermissionKeys,
          ]),
        })
      );
      if (!authorityDecoderIntrinsicsAreCurrent()) {
        throw new TypeError("Actor authority decoder intrinsics changed");
      }
      const result = snapshotRpcResult(rawResult);
      if (result.error) throw result.error;
      return authoritySnapshotFromRpcData(result.data);
    },

    async resolveActorAuthority(
      lookup: ActorAuthorityLookup
    ): Promise<ActorAuthoritySnapshot | null> {
      const rawResult = await rpc.call(
        client,
        "resolve_agent_actor_authority_as_system",
        Object.freeze({
          p_actor_user_id: lookup.actorUserId,
          p_company_id: lookup.companyId,
          p_registered_permission_keys: Object.freeze([
            ...lookup.registeredPermissionKeys,
          ]),
        })
      );
      if (!authorityDecoderIntrinsicsAreCurrent()) {
        throw new TypeError("Actor authority decoder intrinsics changed");
      }
      const result = snapshotRpcResult(rawResult);
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
