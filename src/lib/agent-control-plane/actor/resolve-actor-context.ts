import "server-only";

import { types as nodeTypes } from "node:util";

import type {
  ActorAuthorityRepository,
  ActorAuthoritySnapshot,
} from "./authority-repository";
import {
  isTrustedActorAuthorityRepository,
  REGISTERED_ACTOR_PERMISSION_KEYS,
} from "./authority-repository";
import {
  actorForbidden,
  authorizationInternal,
  authorizationUnavailable,
} from "./errors";
import type {
  ActorMembership,
  ActorAuthentication,
  AuditClientIdentity,
} from "./types";
import {
  isVerifiedActorPrincipal,
  type PhaseCRouteProof,
  type VerifiedActorPrincipal,
} from "./principal-boundary";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";
import {
  snapshotExactOwnEnumerableData,
  snapshotHasExactlyKeys,
} from "./exact-own-data-snapshot";

const ObjectConstructor = Object;
const ArrayConstructor = Array;
const NumberConstructor = Number;
const ReflectObject = Reflect;
const ArrayPrototype = Array.prototype;
const RegExpPrototype = RegExp.prototype;
const StringPrototype = String.prototype;
const SetPrototype = Set.prototype;
const WeakSetPrototype = WeakSet.prototype;
const arrayIsArray = Array.isArray;
const isProxy = nodeTypes.isProxy;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectCreate = Object.create;
const defineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const numberIsSafeInteger = Number.isSafeInteger;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (
  pattern: RegExp,
  value: string
) => boolean;
const stringTrim = Function.call.bind(String.prototype.trim) as (
  value: string
) => string;
const stringToLowerCase = Function.call.bind(String.prototype.toLowerCase) as (
  value: string
) => string;
const stringLocaleCompare = Function.call.bind(
  String.prototype.localeCompare
) as (left: string, right: string) => number;
const setHas = Function.call.bind(Set.prototype.has) as (
  set: ReadonlySet<unknown>,
  value: unknown
) => boolean;
const weakSetAdd = Function.call.bind(WeakSet.prototype.add) as (
  set: WeakSet<object>,
  value: object
) => WeakSet<object>;
const weakSetHas = Function.call.bind(WeakSet.prototype.has) as (
  set: WeakSet<object>,
  value: object
) => boolean;

interface CapturedDataDescriptor {
  readonly value: unknown;
  readonly writable: boolean;
  readonly enumerable: boolean;
  readonly configurable: boolean;
}

function captureDataDescriptor(
  target: object,
  property: PropertyKey
): CapturedDataDescriptor | null {
  const descriptor = getOwnPropertyDescriptor(target, property);
  if (!descriptor || !("value" in descriptor)) return null;
  return objectFreeze({
    value: descriptor.value,
    writable: !!descriptor.writable,
    enumerable: !!descriptor.enumerable,
    configurable: !!descriptor.configurable,
  });
}

function dataDescriptorIsCurrent(
  target: object,
  property: PropertyKey,
  expected: CapturedDataDescriptor | null
): boolean {
  if (!expected) return false;
  const current = getOwnPropertyDescriptor(target, property);
  return !!(
    current &&
    "value" in current &&
    current.value === expected.value &&
    !!current.writable === expected.writable &&
    !!current.enumerable === expected.enumerable &&
    !!current.configurable === expected.configurable
  );
}

const NORMALIZATION_INTRINSICS = objectFreeze({
  objectFromEntries: captureDataDescriptor(ObjectConstructor, "fromEntries"),
  objectEntries: captureDataDescriptor(ObjectConstructor, "entries"),
  objectCreate: captureDataDescriptor(ObjectConstructor, "create"),
  objectDefineProperty: captureDataDescriptor(
    ObjectConstructor,
    "defineProperty"
  ),
  objectFreeze: captureDataDescriptor(ObjectConstructor, "freeze"),
  objectGetOwnPropertyDescriptors: captureDataDescriptor(
    ObjectConstructor,
    "getOwnPropertyDescriptors"
  ),
  objectHasOwn: captureDataDescriptor(ObjectConstructor, "hasOwn"),
  reflectOwnKeys: captureDataDescriptor(ReflectObject, "ownKeys"),
  arrayIsArray: captureDataDescriptor(ArrayConstructor, "isArray"),
  arrayFrom: captureDataDescriptor(ArrayConstructor, "from"),
  arrayPush: captureDataDescriptor(ArrayPrototype, "push"),
  arraySort: captureDataDescriptor(ArrayPrototype, "sort"),
  arrayIterator: captureDataDescriptor(ArrayPrototype, Symbol.iterator),
  numberIsSafeInteger: captureDataDescriptor(
    NumberConstructor,
    "isSafeInteger"
  ),
  regexpTest: captureDataDescriptor(RegExpPrototype, "test"),
  stringTrim: captureDataDescriptor(StringPrototype, "trim"),
  stringToLowerCase: captureDataDescriptor(StringPrototype, "toLowerCase"),
  stringLocaleCompare: captureDataDescriptor(StringPrototype, "localeCompare"),
  setHas: captureDataDescriptor(SetPrototype, "has"),
  weakSetAdd: captureDataDescriptor(WeakSetPrototype, "add"),
  weakSetHas: captureDataDescriptor(WeakSetPrototype, "has"),
});

function normalizationIntrinsicsAreCurrent(): boolean {
  return (
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "fromEntries",
      NORMALIZATION_INTRINSICS.objectFromEntries
    ) &&
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "entries",
      NORMALIZATION_INTRINSICS.objectEntries
    ) &&
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "create",
      NORMALIZATION_INTRINSICS.objectCreate
    ) &&
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "defineProperty",
      NORMALIZATION_INTRINSICS.objectDefineProperty
    ) &&
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "freeze",
      NORMALIZATION_INTRINSICS.objectFreeze
    ) &&
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "getOwnPropertyDescriptors",
      NORMALIZATION_INTRINSICS.objectGetOwnPropertyDescriptors
    ) &&
    dataDescriptorIsCurrent(
      ObjectConstructor,
      "hasOwn",
      NORMALIZATION_INTRINSICS.objectHasOwn
    ) &&
    dataDescriptorIsCurrent(
      ReflectObject,
      "ownKeys",
      NORMALIZATION_INTRINSICS.reflectOwnKeys
    ) &&
    dataDescriptorIsCurrent(
      ArrayConstructor,
      "isArray",
      NORMALIZATION_INTRINSICS.arrayIsArray
    ) &&
    dataDescriptorIsCurrent(
      ArrayConstructor,
      "from",
      NORMALIZATION_INTRINSICS.arrayFrom
    ) &&
    dataDescriptorIsCurrent(
      ArrayPrototype,
      "push",
      NORMALIZATION_INTRINSICS.arrayPush
    ) &&
    dataDescriptorIsCurrent(
      ArrayPrototype,
      "sort",
      NORMALIZATION_INTRINSICS.arraySort
    ) &&
    dataDescriptorIsCurrent(
      ArrayPrototype,
      Symbol.iterator,
      NORMALIZATION_INTRINSICS.arrayIterator
    ) &&
    dataDescriptorIsCurrent(
      NumberConstructor,
      "isSafeInteger",
      NORMALIZATION_INTRINSICS.numberIsSafeInteger
    ) &&
    dataDescriptorIsCurrent(
      RegExpPrototype,
      "test",
      NORMALIZATION_INTRINSICS.regexpTest
    ) &&
    dataDescriptorIsCurrent(
      StringPrototype,
      "trim",
      NORMALIZATION_INTRINSICS.stringTrim
    ) &&
    dataDescriptorIsCurrent(
      StringPrototype,
      "toLowerCase",
      NORMALIZATION_INTRINSICS.stringToLowerCase
    ) &&
    dataDescriptorIsCurrent(
      StringPrototype,
      "localeCompare",
      NORMALIZATION_INTRINSICS.stringLocaleCompare
    ) &&
    dataDescriptorIsCurrent(
      SetPrototype,
      "has",
      NORMALIZATION_INTRINSICS.setHas
    ) &&
    dataDescriptorIsCurrent(
      WeakSetPrototype,
      "add",
      NORMALIZATION_INTRINSICS.weakSetAdd
    ) &&
    dataDescriptorIsCurrent(
      WeakSetPrototype,
      "has",
      NORMALIZATION_INTRINSICS.weakSetHas
    )
  );
}

const VALID_PERMISSION_SCOPES = new Set<PermissionScope>([
  "all",
  "assigned",
  "own",
]);
const REGISTERED_PERMISSION_KEY_SET = new Set<string>(
  REGISTERED_ACTOR_PERMISSION_KEYS
);
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EFFECTIVE_PERMISSION_ROW_KEYS = ["permission", "scope"] as const;
declare const RESOLVED_ACTOR_CONTEXT: unique symbol;
const RESOLVED_ACTOR_CONTEXTS = new WeakSet<object>();

interface ActorContextBrand {
  readonly [RESOLVED_ACTOR_CONTEXT]: true;
}

/** Immutable authority minted only after current server-side resolution. */
export interface ActorContext extends ActorContextBrand {
  readonly requestId: string;
  readonly causationId: string | null;
  readonly actorUserId: string;
  readonly companyId: string;
  readonly membership: ActorMembership;
  readonly roleIds: readonly string[];
  readonly adminBypass: boolean;
  readonly configuredPermissions: readonly AppPermission[];
  readonly effectivePermissions: Readonly<
    Partial<Record<AppPermission, PermissionScope>>
  >;
  readonly permissionSnapshotRevision: string;
  readonly auth: ActorAuthentication;
  readonly auditClient: Readonly<AuditClientIdentity>;
  readonly policyRevision: string;
  readonly capabilityManifestRevision: string;
  readonly phaseCRoute: PhaseCRouteProof | null;
}

export interface ResolveActorContextInput {
  readonly principal: VerifiedActorPrincipal;
  readonly authorityRepository: ActorAuthorityRepository;
  readonly requestId: string;
  readonly causationId?: string | null;
  readonly policyRevision: string;
  /** Injected until the Task 4 capability manifest owns this revision. */
  readonly capabilityManifestRevision: string;
}

const RESOLVE_ACTOR_CONTEXT_REQUIRED_KEYS = [
  "principal",
  "authorityRepository",
  "requestId",
  "policyRevision",
  "capabilityManifestRevision",
] as const;
const RESOLVE_ACTOR_CONTEXT_OPTIONAL_KEYS = ["causationId"] as const;
const PRINCIPAL_COMMON_KEYS = [
  "kind",
  "channel",
  "applicationId",
  "protocolEra",
] as const;
const PRINCIPAL_OPTIONAL_KEYS = [
  "firebaseSubject",
  "actorUserId",
  "companyId",
  "oauthGrantId",
  "oauthClientId",
  "validatedScopes",
  "tokenId",
  "issuer",
  "audience",
  "grantRevision",
  "phaseCRoute",
] as const;
const INTERNAL_PRINCIPAL_KEYS = [
  ...PRINCIPAL_COMMON_KEYS,
  "firebaseSubject",
] as const;
const PHASE_C_PRINCIPAL_KEYS = [
  ...PRINCIPAL_COMMON_KEYS,
  "actorUserId",
  "companyId",
  "phaseCRoute",
] as const;
const MCP_PRINCIPAL_KEYS = [
  ...PRINCIPAL_COMMON_KEYS,
  "actorUserId",
  "companyId",
  "oauthGrantId",
  "oauthClientId",
  "validatedScopes",
  "tokenId",
  "issuer",
  "audience",
  "grantRevision",
] as const;
const AUTHORITY_REPOSITORY_KEYS = [
  "resolveInternalAuthority",
  "resolveActorAuthority",
] as const;
const AUTHORITY_SNAPSHOT_KEYS = [
  "actorUserId",
  "companyId",
  "isActive",
  "isAdmin",
  "roleIds",
  "configuredPermissions",
  "effectivePermissions",
  "permissionSnapshotRevision",
] as const;
const PHASE_C_ROUTE_KEYS = [
  "assignmentVersion",
  "connectionId",
  "opportunityId",
  "internalThreadId",
  "providerThreadId",
  "sourceActivityId",
  "sourceTurnId",
  "sourceConversationId",
] as const;

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && stringTrim(value).length > 0;
}

function snapshotExactDenseArray(value: unknown): readonly unknown[] | null {
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
    const lengthValue =
      lengthDescriptor && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : null;
    if (
      typeof lengthValue !== "number" ||
      !numberIsSafeInteger(lengthValue) ||
      lengthValue < 0 ||
      keys.length !== lengthValue + 1
    ) {
      return null;
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (typeof keys[index] !== "string") return null;
    }

    const snapshot = new ArrayConstructor(lengthValue) as unknown[];
    for (let index = 0; index < lengthValue; index += 1) {
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

function defineMutableArrayValue<T>(
  target: T[],
  index: number,
  value: T
): void {
  defineProperty(target, String(index), {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function sortStringsInPlace(values: string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    let insertionIndex = index;
    while (
      insertionIndex > 0 &&
      stringLocaleCompare(values[insertionIndex - 1], current) > 0
    ) {
      defineMutableArrayValue(
        values,
        insertionIndex,
        values[insertionIndex - 1]
      );
      insertionIndex -= 1;
    }
    defineMutableArrayValue(values, insertionIndex, current);
  }
}

interface NormalizedPermissionRow {
  readonly permission: AppPermission;
  readonly scope: PermissionScope;
}

function sortPermissionRowsInPlace(values: NormalizedPermissionRow[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    let insertionIndex = index;
    while (
      insertionIndex > 0 &&
      stringLocaleCompare(
        values[insertionIndex - 1].permission,
        current.permission
      ) > 0
    ) {
      defineMutableArrayValue(
        values,
        insertionIndex,
        values[insertionIndex - 1]
      );
      insertionIndex -= 1;
    }
    defineMutableArrayValue(values, insertionIndex, current);
  }
}

function normalizeAuthority(snapshot: ActorAuthoritySnapshot): {
  actorUserId: string;
  companyId: string;
  roleIds: readonly string[];
  configuredPermissions: readonly AppPermission[];
  effectivePermissions: Readonly<Record<string, PermissionScope>>;
} | null {
  const roleIdValues = snapshotExactDenseArray(snapshot.roleIds);
  const configuredPermissionValues = snapshotExactDenseArray(
    snapshot.configuredPermissions
  );
  const effectivePermissionRows = snapshotExactDenseArray(
    snapshot.effectivePermissions
  );
  if (
    snapshot.isActive !== true ||
    typeof snapshot.isAdmin !== "boolean" ||
    typeof snapshot.actorUserId !== "string" ||
    !regexpTest(CANONICAL_UUID_PATTERN, snapshot.actorUserId) ||
    typeof snapshot.companyId !== "string" ||
    !regexpTest(CANONICAL_UUID_PATTERN, snapshot.companyId) ||
    !nonBlank(snapshot.permissionSnapshotRevision) ||
    !roleIdValues ||
    !configuredPermissionValues ||
    !effectivePermissionRows
  ) {
    return null;
  }

  const normalizedRoleIds = new ArrayConstructor() as string[];
  const seenRoleIds = objectCreate(null) as Record<string, true>;
  for (let index = 0; index < roleIdValues.length; index += 1) {
    const roleId = roleIdValues[index];
    if (!nonBlank(roleId)) return null;
    const normalizedRoleId = stringToLowerCase(stringTrim(roleId));
    if (objectHasOwn(seenRoleIds, normalizedRoleId)) continue;
    defineProperty(seenRoleIds, normalizedRoleId, {
      configurable: false,
      enumerable: true,
      value: true,
      writable: false,
    });
    defineMutableArrayValue(
      normalizedRoleIds,
      normalizedRoleIds.length,
      normalizedRoleId
    );
  }
  sortStringsInPlace(normalizedRoleIds);

  const configuredPermissions = new ArrayConstructor() as AppPermission[];
  const seenConfiguredPermissions = objectCreate(null) as Record<string, true>;
  for (let index = 0; index < configuredPermissionValues.length; index += 1) {
    const rawPermission = configuredPermissionValues[index];
    if (typeof rawPermission !== "string") return null;
    const permission = rawPermission;
    if (
      stringTrim(permission) !== permission ||
      !setHas(REGISTERED_PERMISSION_KEY_SET, permission) ||
      objectHasOwn(seenConfiguredPermissions, permission)
    ) {
      return null;
    }
    defineProperty(seenConfiguredPermissions, permission, {
      configurable: false,
      enumerable: true,
      value: true,
      writable: false,
    });
    defineMutableArrayValue(
      configuredPermissions,
      configuredPermissions.length,
      permission as AppPermission
    );
  }
  sortStringsInPlace(configuredPermissions);

  const normalizedPermissionRows =
    new ArrayConstructor() as NormalizedPermissionRow[];
  const seenPermissions = objectCreate(null) as Record<string, true>;
  for (let index = 0; index < effectivePermissionRows.length; index += 1) {
    const row = effectivePermissionRows[index];
    const rowSnapshot = snapshotExactOwnEnumerableData(
      row,
      EFFECTIVE_PERMISSION_ROW_KEYS
    );
    if (!rowSnapshot) return null;
    const permissionValue = rowSnapshot.permission;
    const scopeValue = rowSnapshot.scope;
    if (
      typeof permissionValue !== "string" ||
      stringTrim(permissionValue) !== permissionValue ||
      !setHas(REGISTERED_PERMISSION_KEY_SET, permissionValue) ||
      typeof scopeValue !== "string" ||
      !setHas(VALID_PERMISSION_SCOPES, scopeValue as PermissionScope) ||
      objectHasOwn(seenPermissions, permissionValue)
    ) {
      return null;
    }
    defineProperty(seenPermissions, permissionValue, {
      configurable: false,
      enumerable: true,
      value: true,
      writable: false,
    });
    defineMutableArrayValue(
      normalizedPermissionRows,
      normalizedPermissionRows.length,
      objectFreeze({
        permission: permissionValue as AppPermission,
        scope: scopeValue as PermissionScope,
      })
    );
  }
  sortPermissionRowsInPlace(normalizedPermissionRows);

  const sortedPermissions = objectCreate(null) as Record<
    string,
    PermissionScope
  >;
  for (let index = 0; index < normalizedPermissionRows.length; index += 1) {
    const row = normalizedPermissionRows[index];
    defineProperty(sortedPermissions, row.permission, {
      configurable: false,
      enumerable: true,
      value: row.scope,
      writable: false,
    });
  }

  return {
    actorUserId: snapshot.actorUserId,
    companyId: snapshot.companyId,
    roleIds: objectFreeze(normalizedRoleIds),
    configuredPermissions: objectFreeze(configuredPermissions),
    effectivePermissions: objectFreeze(sortedPermissions),
  };
}

function authenticationFor(
  principal: Readonly<Record<string, unknown>>
): ActorAuthentication {
  if (principal.kind !== "mcp") {
    return objectFreeze({
      channel: principal.channel as "internal" | "ops_api",
      scopeCeiling: null,
    });
  }

  const scopeValues = snapshotExactDenseArray(principal.validatedScopes);
  if (!scopeValues) throw new TypeError("MCP scope snapshot is invalid");
  const scopeCeiling = new ArrayConstructor(scopeValues.length) as string[];
  for (let index = 0; index < scopeValues.length; index += 1) {
    const scope = scopeValues[index];
    if (typeof scope !== "string") {
      throw new TypeError("MCP scope snapshot is invalid");
    }
    defineProperty(scopeCeiling, String(index), {
      configurable: false,
      enumerable: true,
      value: scope,
      writable: false,
    });
  }

  return objectFreeze({
    channel: "mcp" as const,
    scopeCeiling: objectFreeze(scopeCeiling),
    oauthGrantId: principal.oauthGrantId as string,
    oauthClientId: principal.oauthClientId as string,
    tokenId: principal.tokenId as string,
    issuer: principal.issuer as string,
    audience: principal.audience as string,
    grantRevision: principal.grantRevision as string,
  });
}

function snapshotVerifiedPrincipal(
  principal: unknown
): Readonly<Record<string, unknown>> | null {
  const snapshot = snapshotExactOwnEnumerableData(
    principal,
    PRINCIPAL_COMMON_KEYS,
    PRINCIPAL_OPTIONAL_KEYS
  );
  if (!snapshot) return null;
  const expectedKeys =
    snapshot.kind === "internal"
      ? INTERNAL_PRINCIPAL_KEYS
      : snapshot.kind === "phase_c"
        ? PHASE_C_PRINCIPAL_KEYS
        : snapshot.kind === "mcp"
          ? MCP_PRINCIPAL_KEYS
          : null;
  return expectedKeys && snapshotHasExactlyKeys(snapshot, expectedKeys)
    ? snapshot
    : null;
}

function snapshotPhaseCRoute(
  principal: Readonly<Record<string, unknown>>
): PhaseCRouteProof | null {
  if (principal.kind !== "phase_c") return null;
  const route = snapshotExactOwnEnumerableData(
    principal.phaseCRoute,
    PHASE_C_ROUTE_KEYS
  );
  if (!route) return null;
  const assignmentVersion = route.assignmentVersion;
  const providerThreadId = route.providerThreadId;
  if (
    !numberIsSafeInteger(assignmentVersion) ||
    (assignmentVersion as number) < 0 ||
    typeof providerThreadId !== "string" ||
    providerThreadId.length < 1
  ) {
    return null;
  }
  const uuidKeys = [
    "connectionId",
    "opportunityId",
    "internalThreadId",
    "sourceActivityId",
    "sourceTurnId",
    "sourceConversationId",
  ] as const;
  for (let index = 0; index < uuidKeys.length; index += 1) {
    const key = uuidKeys[index];
    const value = route[key];
    if (
      typeof value !== "string" ||
      !regexpTest(CANONICAL_UUID_PATTERN, value)
    ) {
      return null;
    }
  }
  return objectFreeze({
    assignmentVersion: assignmentVersion as number,
    connectionId: route.connectionId as string,
    opportunityId: route.opportunityId as string,
    internalThreadId: route.internalThreadId as string,
    providerThreadId,
    sourceActivityId: route.sourceActivityId as string,
    sourceTurnId: route.sourceTurnId as string,
    sourceConversationId: route.sourceConversationId as string,
  });
}

export async function resolveActorContext(
  input: ResolveActorContextInput
): Promise<ActorContext> {
  const inputSnapshot = snapshotExactOwnEnumerableData(
    input,
    RESOLVE_ACTOR_CONTEXT_REQUIRED_KEYS,
    RESOLVE_ACTOR_CONTEXT_OPTIONAL_KEYS
  );
  if (!inputSnapshot) {
    throw authorizationInternal(
      "unknown-request",
      "actor_context_input_invalid"
    );
  }

  const requestIdValue = inputSnapshot.requestId;
  const requestId =
    typeof requestIdValue === "string" ? stringTrim(requestIdValue) : "";
  if (!requestId) {
    throw authorizationInternal(
      "unknown-request",
      "actor_context_input_invalid"
    );
  }
  const principal = inputSnapshot.principal;
  const principalSnapshot = snapshotVerifiedPrincipal(principal);
  const authorityRepository = inputSnapshot.authorityRepository;
  const repositorySnapshot = snapshotExactOwnEnumerableData(
    authorityRepository,
    AUTHORITY_REPOSITORY_KEYS
  );
  const policyRevisionValue = inputSnapshot.policyRevision;
  const capabilityManifestRevisionValue =
    inputSnapshot.capabilityManifestRevision;
  const causationIdValue = inputSnapshot.causationId;

  if (!isVerifiedActorPrincipal(principal) || !principalSnapshot) {
    throw actorForbidden(requestId, "principal_source_untrusted");
  }
  if (
    !isTrustedActorAuthorityRepository(authorityRepository) ||
    !repositorySnapshot ||
    typeof repositorySnapshot.resolveInternalAuthority !== "function" ||
    typeof repositorySnapshot.resolveActorAuthority !== "function"
  ) {
    throw authorizationInternal(
      requestId,
      "actor_authority_repository_untrusted"
    );
  }
  if (
    !nonBlank(policyRevisionValue) ||
    !nonBlank(capabilityManifestRevisionValue)
  ) {
    throw authorizationUnavailable(requestId, "authority_revision_missing");
  }
  if (
    causationIdValue !== undefined &&
    causationIdValue !== null &&
    typeof causationIdValue !== "string"
  ) {
    throw authorizationInternal(requestId, "actor_context_input_invalid");
  }

  const policyRevision = stringTrim(policyRevisionValue);
  const capabilityManifestRevision = stringTrim(
    capabilityManifestRevisionValue
  );
  const causationId =
    typeof causationIdValue === "string"
      ? stringTrim(causationIdValue) || null
      : null;
  const principalKind = principalSnapshot.kind;
  const expectedActorUserId =
    principalKind === "internal"
      ? null
      : (principalSnapshot.actorUserId as string);
  const expectedCompanyId =
    principalKind === "internal"
      ? null
      : (principalSnapshot.companyId as string);
  const authentication = authenticationFor(principalSnapshot);
  const phaseCRoute = snapshotPhaseCRoute(principalSnapshot);
  if (principalKind === "phase_c" && !phaseCRoute) {
    throw actorForbidden(requestId, "phase_c_route_untrusted");
  }
  const auditClient = objectFreeze({
    applicationId: principalSnapshot.applicationId as string | null,
    protocolEra: principalSnapshot.protocolEra as string | null,
  });
  const resolveInternalAuthority =
    repositorySnapshot.resolveInternalAuthority as ActorAuthorityRepository["resolveInternalAuthority"];
  const resolveActorAuthority =
    repositorySnapshot.resolveActorAuthority as ActorAuthorityRepository["resolveActorAuthority"];

  let snapshot: ActorAuthoritySnapshot | null;
  try {
    snapshot =
      principalKind === "internal"
        ? await reflectApply(resolveInternalAuthority, authorityRepository, [
            {
              firebaseSubject: principalSnapshot.firebaseSubject as string,
              registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
            },
          ])
        : await reflectApply(resolveActorAuthority, authorityRepository, [
            {
              actorUserId: expectedActorUserId as string,
              companyId: expectedCompanyId as string,
              registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
            },
          ]);
  } catch {
    throw authorizationUnavailable(requestId, "authority_lookup_failed");
  }

  if (!normalizationIntrinsicsAreCurrent()) {
    throw authorizationUnavailable(
      requestId,
      "authority_normalization_intrinsics_changed"
    );
  }

  if (!snapshot) {
    throw actorForbidden(requestId, "actor_authority_unavailable");
  }
  const snapshotValues = snapshotExactOwnEnumerableData(
    snapshot,
    AUTHORITY_SNAPSHOT_KEYS
  );
  if (!snapshotValues) {
    throw authorizationUnavailable(requestId, "authority_snapshot_malformed");
  }
  const authoritySnapshot = objectFreeze({
    actorUserId: snapshotValues.actorUserId,
    companyId: snapshotValues.companyId,
    isActive: snapshotValues.isActive,
    isAdmin: snapshotValues.isAdmin,
    roleIds: snapshotValues.roleIds,
    configuredPermissions: snapshotValues.configuredPermissions,
    effectivePermissions: snapshotValues.effectivePermissions,
    permissionSnapshotRevision: snapshotValues.permissionSnapshotRevision,
  }) as ActorAuthoritySnapshot;
  if (authoritySnapshot.isActive === false) {
    throw actorForbidden(requestId, "actor_authority_unavailable");
  }

  let normalized: ReturnType<typeof normalizeAuthority>;
  try {
    normalized = normalizeAuthority(authoritySnapshot);
  } catch {
    throw authorizationUnavailable(requestId, "authority_snapshot_malformed");
  }
  if (!normalized) {
    throw authorizationUnavailable(requestId, "authority_snapshot_malformed");
  }

  if (
    principalKind !== "internal" &&
    (normalized.actorUserId !== expectedActorUserId ||
      normalized.companyId !== expectedCompanyId)
  ) {
    throw actorForbidden(requestId, "grant_authority_mismatch");
  }

  const membership = objectFreeze({
    userActive: true as const,
    companyActive: true as const,
  });

  const context = {
    requestId,
    causationId,
    actorUserId: normalized.actorUserId,
    companyId: normalized.companyId,
    membership,
    roleIds: normalized.roleIds,
    adminBypass: authoritySnapshot.isAdmin,
    configuredPermissions: normalized.configuredPermissions,
    effectivePermissions: normalized.effectivePermissions,
    permissionSnapshotRevision: authoritySnapshot.permissionSnapshotRevision,
    auth: authentication,
    auditClient,
    policyRevision,
    capabilityManifestRevision,
    phaseCRoute,
  };
  weakSetAdd(RESOLVED_ACTOR_CONTEXTS, context);
  return objectFreeze(context) as ActorContext;
}

export function isActorContext(value: unknown): value is ActorContext {
  return (
    typeof value === "object" &&
    value !== null &&
    weakSetHas(RESOLVED_ACTOR_CONTEXTS, value)
  );
}
