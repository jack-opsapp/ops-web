import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseActorAuthorityRepository,
  isTrustedActorAuthorityRepository,
  type ActorAuthoritySnapshot,
  type AgentAuthoritySupabaseRpcClient,
} from "@/lib/agent-control-plane/actor/authority-repository";
import {
  createSupabaseCurrentEntityAuthorizationRepository,
  isTrustedCurrentEntityAuthorizationRepository,
  type EntityAuthorizationSupabaseRpcClient,
} from "@/lib/agent-control-plane/actor/authorize-entity-query";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID = "44444444-4444-4444-8444-444444444444";

const AUTHORITY_ROW = {
  actor_user_id: ACTOR_ID,
  company_id: COMPANY_ID,
  is_active: true,
  is_admin: false,
  role_ids: ["33333333-3333-4333-8333-333333333333"],
  configured_permissions: ["projects.view"],
  effective_permissions: [{ permission: "projects.view", scope: "assigned" }],
  permission_snapshot_revision: "sha256:authority-1",
};

describe("Supabase actor authority repository", () => {
  it("attaches the caller's deadline signal to the authority RPC", async () => {
    const signal = new AbortController().signal;
    const result = { data: [AUTHORITY_ROW], error: null };
    const request = Promise.resolve(result);
    const abortSignal = vi.fn(async (receivedSignal: AbortSignal) => {
      expect(receivedSignal).toBe(signal);
      return await request;
    });
    const rpc = vi.fn(() => Object.assign(request, { abortSignal }));
    const repository = createSupabaseActorAuthorityRepository({ rpc });

    await repository.resolveActorAuthority(
      {
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        registeredPermissionKeys: ["projects.view"],
      },
      signal
    );

    expect(abortSignal).toHaveBeenCalledOnce();
  });

  it("fails closed when a deadline-bound authority client cannot cancel", async () => {
    const repository = createSupabaseActorAuthorityRepository({
      rpc: () => Promise.resolve({ data: [AUTHORITY_ROW], error: null }),
    });

    await expect(
      repository.resolveActorAuthority(
        {
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          registeredPermissionKeys: ["projects.view"],
        },
        new AbortController().signal
      )
    ).rejects.toThrow(
      "Actor authority RPC cannot honor the requested deadline"
    );
  });

  it("translates both trusted lookup forms to their exact service RPC contracts", async () => {
    const rpc = vi.fn(async () => ({ data: [AUTHORITY_ROW], error: null }));
    const repository = createSupabaseActorAuthorityRepository({ rpc });

    const internal = await repository.resolveInternalAuthority({
      firebaseSubject: "firebase-subject-1",
      registeredPermissionKeys: ["projects.view", "tasks.view"],
    });
    const mcp = await repository.resolveActorAuthority({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      registeredPermissionKeys: ["projects.view"],
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "resolve_agent_actor_authority_for_subject_as_system",
      {
        p_firebase_subject: "firebase-subject-1",
        p_registered_permission_keys: ["projects.view", "tasks.view"],
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "resolve_agent_actor_authority_as_system",
      {
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_registered_permission_keys: ["projects.view"],
      }
    );
    expect(internal).toEqual({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      isActive: true,
      isAdmin: false,
      roleIds: AUTHORITY_ROW.role_ids,
      configuredPermissions: AUTHORITY_ROW.configured_permissions,
      effectivePermissions: AUTHORITY_ROW.effective_permissions,
      permissionSnapshotRevision: "sha256:authority-1",
    });
    expect(mcp).toEqual(internal);
    expect(Object.isFrozen(repository)).toBe(true);
    expect(isTrustedActorAuthorityRepository(repository)).toBe(true);
    expect(isTrustedActorAuthorityRepository({ ...repository })).toBe(false);
  });

  it.each([
    { data: null, error: null, label: "a non-array result" },
    {
      data: [AUTHORITY_ROW, AUTHORITY_ROW],
      error: null,
      label: "multiple rows",
    },
    { data: [null], error: null, label: "a malformed row" },
    {
      data: [AUTHORITY_ROW],
      error: new Error("database unavailable"),
      label: "an RPC error",
    },
  ])("fails closed for $label", async (result) => {
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        return result;
      },
    });

    await expect(
      repository.resolveActorAuthority({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        registeredPermissionKeys: ["projects.view"],
      })
    ).rejects.toBeTruthy();
  });

  it("accepts the seeded global sentinel role ids every OPS user carries", async () => {
    // The seven global OPS roles are zero-prefix sentinel UUIDs (version and
    // variant nibbles 0). Regression for the 2026-08-18 MCP mount E2E find:
    // the strict RFC-4122 canonical check here rejected every real user's
    // authority row. Role ids are opaque catalog keys — shape-only checking.
    const rpc = vi.fn(async () => ({
      data: [
        {
          ...AUTHORITY_ROW,
          role_ids: [
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-0000000000a1",
          ],
        },
      ],
      error: null,
    }));
    const repository = createSupabaseActorAuthorityRepository({ rpc });
    const snapshot = await repository.resolveActorAuthority({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      registeredPermissionKeys: ["projects.view"],
    });
    expect(snapshot?.roleIds).toEqual([
      "00000000-0000-0000-0000-000000000002",
      "00000000-0000-0000-0000-0000000000a1",
    ]);
  });

  it("accepts lowercase PostgreSQL UUID actor and company identities", async () => {
    const postgresActorId = "d1111111-1111-4111-d111-111111111111";
    const postgresCompanyId = "00000000-0000-0000-0000-000000000001";
    const rpc = vi.fn(async () => ({
      data: [
        {
          ...AUTHORITY_ROW,
          actor_user_id: postgresActorId,
          company_id: postgresCompanyId,
        },
      ],
      error: null,
    }));
    const repository = createSupabaseActorAuthorityRepository({ rpc });

    await expect(
      repository.resolveActorAuthority({
        actorUserId: postgresActorId,
        companyId: postgresCompanyId,
        registeredPermissionKeys: ["projects.view"],
      })
    ).resolves.toMatchObject({
      actorUserId: postgresActorId,
      companyId: postgresCompanyId,
    });
  });

  it("rejects an accessor-backed admin field without invoking it", async () => {
    let adminReads = 0;
    const hostileRow = {
      actor_user_id: ACTOR_ID,
      company_id: COMPANY_ID,
      is_active: true,
      role_ids: AUTHORITY_ROW.role_ids,
      configured_permissions: AUTHORITY_ROW.configured_permissions,
      effective_permissions: AUTHORITY_ROW.effective_permissions,
      permission_snapshot_revision: AUTHORITY_ROW.permission_snapshot_revision,
    } as Record<string, unknown>;
    Object.defineProperty(hostileRow, "is_admin", {
      enumerable: true,
      get() {
        adminReads += 1;
        return true;
      },
    });
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        return { data: [hostileRow], error: null };
      },
    });

    await expect(
      repository.resolveActorAuthority({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        registeredPermissionKeys: ["projects.view"],
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(adminReads).toBe(0);
  });

  it("rejects proxy, accessor, symbol, extra, hidden, and sparse RPC shapes", async () => {
    let arrayReads = 0;
    const extraRow = { ...AUTHORITY_ROW, private_extra: true };
    const symbolRow = { ...AUTHORITY_ROW } as Record<PropertyKey, unknown>;
    symbolRow[Symbol("private-row")] = true;
    const hiddenRow = { ...AUTHORITY_ROW };
    Object.defineProperty(hiddenRow, "private_hidden", {
      enumerable: false,
      value: true,
    });
    const sparseArray = new Array(1);
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      configurable: true,
      enumerable: true,
      get() {
        arrayReads += 1;
        return AUTHORITY_ROW;
      },
    });
    const extraArray = [AUTHORITY_ROW] as unknown[] & Record<string, unknown>;
    extraArray.private_extra = true;
    const symbolArray = [AUTHORITY_ROW] as unknown[] &
      Record<PropertyKey, unknown>;
    symbolArray[Symbol("private-array")] = true;
    const hiddenArray = [AUTHORITY_ROW];
    Object.defineProperty(hiddenArray, "private_hidden", {
      enumerable: false,
      value: true,
    });

    for (const data of [
      new Proxy([AUTHORITY_ROW], {}),
      [new Proxy(AUTHORITY_ROW, {})],
      [extraRow],
      [symbolRow],
      [hiddenRow],
      sparseArray,
      accessorArray,
      extraArray,
      symbolArray,
      hiddenArray,
    ]) {
      const repository = createSupabaseActorAuthorityRepository({
        async rpc() {
          return { data, error: null };
        },
      });

      await expect(
        repository.resolveActorAuthority({
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          registeredPermissionKeys: ["projects.view"],
        })
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(arrayReads).toBe(0);
  });

  it("rejects malformed canonical fields and over-budget authority arrays", async () => {
    const malformedRows = [
      {
        ...AUTHORITY_ROW,
        actor_user_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      { ...AUTHORITY_ROW, company_id: "not-a-uuid" },
      { ...AUTHORITY_ROW, is_active: "true" },
      { ...AUTHORITY_ROW, is_admin: 1 },
      { ...AUTHORITY_ROW, role_ids: ["not-a-uuid"] },
      { ...AUTHORITY_ROW, configured_permissions: ["not.registered"] },
      {
        ...AUTHORITY_ROW,
        effective_permissions: [
          { permission: "projects.view", scope: "administrator" },
        ],
      },
      {
        ...AUTHORITY_ROW,
        role_ids: Array.from(
          { length: 257 },
          () => "33333333-3333-4333-8333-333333333333"
        ),
      },
      {
        ...AUTHORITY_ROW,
        configured_permissions: Array.from(
          { length: 257 },
          () => "projects.view"
        ),
      },
      {
        ...AUTHORITY_ROW,
        effective_permissions: Array.from({ length: 257 }, () => ({
          permission: "projects.view",
          scope: "assigned",
        })),
      },
    ];

    for (const row of malformedRows) {
      const repository = createSupabaseActorAuthorityRepository({
        async rpc() {
          return { data: [row], error: null };
        },
      });

      await expect(
        repository.resolveActorAuthority({
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          registeredPermissionKeys: ["projects.view"],
        })
      ).rejects.toBeInstanceOf(TypeError);
    }
  });

  it("returns a deeply immutable authority snapshot detached from RPC data", async () => {
    const mutableRoleIds = [...AUTHORITY_ROW.role_ids];
    const mutableConfiguredPermissions = [
      ...AUTHORITY_ROW.configured_permissions,
    ];
    const mutableEffectivePermission = {
      permission: "projects.view",
      scope: "assigned",
    };
    const row = {
      ...AUTHORITY_ROW,
      role_ids: mutableRoleIds,
      configured_permissions: mutableConfiguredPermissions,
      effective_permissions: [mutableEffectivePermission],
    };
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        return { data: [row], error: null };
      },
    });

    const snapshot = await repository.resolveActorAuthority({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      registeredPermissionKeys: ["projects.view"],
    });
    mutableRoleIds[0] = "99999999-9999-4999-8999-999999999999";
    mutableConfiguredPermissions[0] = "tasks.view";
    mutableEffectivePermission.scope = "all";

    expect(snapshot).toEqual({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      isActive: true,
      isAdmin: false,
      roleIds: ["33333333-3333-4333-8333-333333333333"],
      configuredPermissions: ["projects.view"],
      effectivePermissions: [
        { permission: "projects.view", scope: "assigned" },
      ],
      permissionSnapshotRevision: "sha256:authority-1",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.roleIds)).toBe(true);
    expect(Object.isFrozen(snapshot?.configuredPermissions)).toBe(true);
    expect(Object.isFrozen(snapshot?.effectivePermissions)).toBe(true);
    expect(Object.isFrozen(snapshot?.effectivePermissions[0])).toBe(true);
  });

  it("fails closed when an awaited RPC mutates an array intrinsic before decoding", async () => {
    const originalPushDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "push"
    );
    if (!originalPushDescriptor || !("value" in originalPushDescriptor)) {
      throw new Error("Array.prototype.push descriptor is unavailable");
    }
    const originalPush =
      originalPushDescriptor.value as typeof Array.prototype.push;
    const forgedRow = { ...AUTHORITY_ROW, is_admin: true };
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        Object.defineProperty(Array.prototype, "push", {
          ...originalPushDescriptor,
          value(this: unknown[], value: unknown) {
            return Reflect.apply(originalPush, this, [
              value === AUTHORITY_ROW ? forgedRow : value,
            ]);
          },
        });
        return { data: [AUTHORITY_ROW], error: null };
      },
    });

    let resolution: ActorAuthoritySnapshot | null | undefined;
    let caught: unknown;
    try {
      resolution = await repository.resolveActorAuthority({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        registeredPermissionKeys: ["projects.view"],
      });
    } catch (error) {
      caught = error;
    } finally {
      Object.defineProperty(Array.prototype, "push", originalPushDescriptor);
    }

    expect(resolution).toBeUndefined();
    expect(caught).toBeInstanceOf(TypeError);
  });

  it("rejects an accessor-backed RPC envelope without invoking it", async () => {
    let dataReads = 0;
    let errorReads = 0;
    const response = {};
    Object.defineProperties(response, {
      data: {
        enumerable: true,
        get() {
          dataReads += 1;
          return [AUTHORITY_ROW];
        },
      },
      error: {
        enumerable: true,
        get() {
          errorReads += 1;
          return null;
        },
      },
    });
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        return response as never;
      },
    });

    await expect(
      repository.resolveActorAuthority({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        registeredPermissionKeys: ["projects.view"],
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(dataReads).toBe(0);
    expect(errorReads).toBe(0);
  });

  it("maps no authority rows to null", async () => {
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        return { data: [], error: null };
      },
    });

    await expect(
      repository.resolveInternalAuthority({
        firebaseSubject: "firebase-subject-1",
        registeredPermissionKeys: ["projects.view"],
      })
    ).resolves.toBeNull();
  });

  it("rejects a structural value whose rpc member is not callable", () => {
    expect(() =>
      createSupabaseActorAuthorityRepository({ rpc: true } as never)
    ).toThrow(TypeError);

    if (false) {
      // @ts-expect-error only the concrete factory can mint the repository brand
      const forgedClient: AgentAuthoritySupabaseRpcClient = { rpc: true };
      void forgedClient;
    }
  });
});

describe("Supabase current-entity authorization repository", () => {
  it("translates the current entity lookup to the exact service RPC contract", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const repository = createSupabaseCurrentEntityAuthorizationRepository({
      rpc,
    });

    await expect(
      repository.authorizeCurrentEntity({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        entityKind: "task",
        entityId: ENTITY_ID,
        action: "change_status",
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("authorize_agent_entity_as_system", {
      p_actor_user_id: ACTOR_ID,
      p_company_id: COMPANY_ID,
      p_entity_kind: "task",
      p_entity_id: ENTITY_ID,
      p_action: "change_status",
    });
    expect(Object.isFrozen(repository)).toBe(true);
    expect(isTrustedCurrentEntityAuthorizationRepository(repository)).toBe(
      true
    );
    expect(
      isTrustedCurrentEntityAuthorizationRepository({ ...repository })
    ).toBe(false);
  });

  it("propagates the RPC result for exact-boolean validation by the authorizer", async () => {
    const repository = createSupabaseCurrentEntityAuthorizationRepository({
      async rpc() {
        return { data: "false", error: null };
      },
    });

    await expect(
      repository.authorizeCurrentEntity({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        entityKind: "project",
        entityId: ENTITY_ID,
        action: "view",
      })
    ).resolves.toBe("false");
  });

  it("throws the RPC error and rejects a non-callable client", async () => {
    const rpcError = new Error("database unavailable");
    const repository = createSupabaseCurrentEntityAuthorizationRepository({
      async rpc() {
        return { data: false, error: rpcError };
      },
    });

    await expect(
      repository.authorizeCurrentEntity({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        entityKind: "project",
        entityId: ENTITY_ID,
        action: "view",
      })
    ).rejects.toBe(rpcError);
    expect(() =>
      createSupabaseCurrentEntityAuthorizationRepository({
        rpc: "not-a-function",
      } as never)
    ).toThrow(TypeError);

    if (false) {
      const forgedClient: EntityAuthorizationSupabaseRpcClient = {
        // @ts-expect-error an RPC client must expose the exact callable contract
        rpc: "not-a-function",
      };
      void forgedClient;
    }
  });
});
