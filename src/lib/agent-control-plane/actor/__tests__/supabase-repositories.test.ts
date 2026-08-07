import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseActorAuthorityRepository,
  isTrustedActorAuthorityRepository,
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
  it("translates both trusted lookup forms to their exact service RPC contracts", async () => {
    const rpc = vi.fn(async () => ({ data: [AUTHORITY_ROW], error: null }));
    const repository = createSupabaseActorAuthorityRepository({ rpc });

    const internal = await repository.resolveInternalAuthority({
      firebaseSubject: "firebase-subject-1",
      registeredPermissionKeys: ["projects.view", "tasks.view"],
    });
    const mcp = await repository.resolveMcpAuthority({
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
      repository.resolveMcpAuthority({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        registeredPermissionKeys: ["projects.view"],
      })
    ).rejects.toBeTruthy();
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
