import { describe, expect, it } from "vitest";

import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts";
import {
  createSupabaseActorAuthorityRepository,
  REGISTERED_ACTOR_PERMISSION_KEYS,
  type ActorAuthoritySnapshot,
} from "@/lib/agent-control-plane/actor/authority-repository";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import type { VerifiedActorPrincipal } from "@/lib/agent-control-plane/actor/principal-boundary";
import {
  resolveActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  validatedMcpPrincipalFixture,
  verifiedPhaseCPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "./fixtures/verified-principal-fixtures";
import { StubAuthoritySupabaseRpcClient } from "./fixtures/trusted-repository-fixtures";

const REQUEST = {
  requestId: "request-actor-1",
  causationId: "cause-1",
  policyRevision: "actor-policy:v1",
  capabilityManifestRevision: "capabilities:test-v1",
} as const;
const PHASE_C_ROUTE = {
  assignmentVersion: 7,
  connectionId: "44444444-4444-4444-8444-444444444444",
  opportunityId: "55555555-5555-4555-8555-555555555555",
  internalThreadId: "66666666-6666-4666-8666-666666666666",
  providerThreadId: "provider-thread-1",
  sourceActivityId: "77777777-7777-4777-8777-777777777777",
  sourceTurnId: "88888888-8888-4888-8888-888888888888",
  sourceConversationId: "99999999-9999-4999-8999-999999999999",
} as const;

function authority(
  overrides: Partial<ActorAuthoritySnapshot> = {}
): ActorAuthoritySnapshot {
  return {
    actorUserId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    isActive: true,
    isAdmin: false,
    roleIds: ["33333333-3333-4333-8333-333333333333"],
    configuredPermissions: ["projects.view", "tasks.view"],
    effectivePermissions: [
      { permission: "projects.view", scope: "assigned" },
      { permission: "tasks.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: "sha256:authority-revision-1",
    ...overrides,
  };
}

function internalPrincipal() {
  return verifiedInternalPrincipalFixture({
    channel: "internal",
    firebaseSubject: "firebase-subject-1",
    applicationId: "ops-web",
    protocolEra: "internal-v1",
  });
}

async function rejected(
  operation: () => unknown | Promise<unknown>
): Promise<ActorAccessError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ActorAccessError);
    return error as ActorAccessError;
  }
  throw new Error("Expected actor resolution to fail");
}

describe("resolveActorContext", () => {
  it("binds every authority lookup to one immutable sorted AppPermission registry", () => {
    expect(REGISTERED_ACTOR_PERMISSION_KEYS.length).toBeGreaterThan(0);
    expect(REGISTERED_ACTOR_PERMISSION_KEYS.length).toBeLessThanOrEqual(256);
    expect(REGISTERED_ACTOR_PERMISSION_KEYS).toEqual(
      [...REGISTERED_ACTOR_PERMISSION_KEYS].sort((left, right) =>
        left.localeCompare(right)
      )
    );
    expect(new Set(REGISTERED_ACTOR_PERMISSION_KEYS).size).toBe(
      REGISTERED_ACTOR_PERMISSION_KEYS.length
    );
    expect(
      REGISTERED_ACTOR_PERMISSION_KEYS.every(
        (permission) =>
          permission.length <= 128 &&
          permission === permission.toLowerCase() &&
          /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(permission)
      )
    ).toBe(true);
  });

  it("preserves explicit configuration provenance and its opaque database revision", async () => {
    const fallbackRepository = new StubAuthoritySupabaseRpcClient(authority());
    fallbackRepository.internalResult = authority({
      configuredPermissions: ["pipeline.manage"],
      effectivePermissions: [
        { permission: "pipeline.manage", scope: "all" },
        { permission: "pipeline.view", scope: "all" },
      ],
      permissionSnapshotRevision: "sha256:fallback-provenance",
    });
    const explicitRepository = new StubAuthoritySupabaseRpcClient(authority());
    explicitRepository.internalResult = authority({
      configuredPermissions: ["pipeline.manage", "pipeline.view"],
      effectivePermissions: [
        { permission: "pipeline.manage", scope: "all" },
        { permission: "pipeline.view", scope: "all" },
      ],
      permissionSnapshotRevision: "sha256:explicit-provenance",
    });

    const fallback = await resolveActorContext({
      principal: internalPrincipal(),
      authorityRepository: fallbackRepository.repository,
      ...REQUEST,
    });
    const explicit = await resolveActorContext({
      principal: internalPrincipal(),
      authorityRepository: explicitRepository.repository,
      ...REQUEST,
    });

    expect(fallback.effectivePermissions).toEqual(
      explicit.effectivePermissions
    );
    expect(fallback.configuredPermissions).toEqual(["pipeline.manage"]);
    expect(explicit.configuredPermissions).toEqual([
      "pipeline.manage",
      "pipeline.view",
    ]);
    expect(fallback.permissionSnapshotRevision).toBe(
      "sha256:fallback-provenance"
    );
    expect(explicit.permissionSnapshotRevision).toBe(
      "sha256:explicit-provenance"
    );
  });

  it("builds a frozen server-owned context from current canonical authority", async () => {
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    repository.internalResult = authority({
      roleIds: [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ],
      effectivePermissions: [
        { permission: "tasks.view", scope: "all" },
        { permission: "projects.view", scope: "assigned" },
      ],
      configuredPermissions: ["tasks.view", "projects.view"],
    });

    const context = await resolveActorContext({
      principal: internalPrincipal(),
      authorityRepository: repository.repository,
      ...REQUEST,
    });

    expect(context).toMatchObject({
      requestId: "request-actor-1",
      causationId: "cause-1",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      membership: { userActive: true, companyActive: true },
      adminBypass: false,
      roleIds: [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ],
      effectivePermissions: {
        "projects.view": "assigned",
        "tasks.view": "all",
      },
      configuredPermissions: ["projects.view", "tasks.view"],
      permissionSnapshotRevision: "sha256:authority-revision-1",
      policyRevision: "actor-policy:v1",
      capabilityManifestRevision: "capabilities:test-v1",
      auditClient: {
        applicationId: "ops-web",
        protocolEra: "internal-v1",
      },
      auth: { channel: "internal", scopeCeiling: null },
    });
    expect(repository.internalLookups).toEqual([
      {
        firebaseSubject: "firebase-subject-1",
        registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
      },
    ]);
    expect(Object.isFrozen(REGISTERED_ACTOR_PERMISSION_KEYS)).toBe(true);
    expect(REGISTERED_ACTOR_PERMISSION_KEYS).toContain("pipeline.view");
    expect(REGISTERED_ACTOR_PERMISSION_KEYS).toContain("inbox.view");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.membership)).toBe(true);
    expect(Object.isFrozen(context.roleIds)).toBe(true);
    expect(Object.isFrozen(context.effectivePermissions)).toBe(true);
    expect(Object.getPrototypeOf(context.effectivePermissions)).toBeNull();
    expect(Object.isFrozen(context.configuredPermissions)).toBe(true);
    expect(Object.isFrozen(context.auth)).toBe(true);
    expect("assignments" in context).toBe(false);
    expect(() =>
      (context.roleIds as string[]).push("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    ).toThrow(TypeError);
  });

  it("preserves the opaque canonical permission revision instead of recomputing it", async () => {
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    repository.internalResult = authority({
      permissionSnapshotRevision: "db-owned:opaque-revision-9",
    });

    const context = await resolveActorContext({
      principal: internalPrincipal(),
      authorityRepository: repository.repository,
      ...REQUEST,
    });

    expect(context.permissionSnapshotRevision).toBe(
      "db-owned:opaque-revision-9"
    );
  });

  it("fails closed when canonical authority is absent or inactive", async () => {
    for (const currentAuthority of [null, authority({ isActive: false })]) {
      const repository = new StubAuthoritySupabaseRpcClient(authority());
      repository.internalResult = currentAuthority;

      const error = await rejected(() =>
        resolveActorContext({
          principal: internalPrincipal(),
          authorityRepository: repository.repository,
          ...REQUEST,
        })
      );

      expect(error).toMatchObject({
        code: "FORBIDDEN",
        message: "Access is not available.",
        retryable: false,
      });
      expect(AgentErrorSchema.safeParse(error.toAgentError()).success).toBe(
        true
      );
      expect(JSON.stringify(error.toAgentError())).not.toContain("inactive");
      expect(JSON.stringify(error.toAgentError())).not.toContain(
        "11111111-1111-4111-8111-111111111111"
      );
    }
  });

  it("surfaces authority lookup failures as retryable and privacy-safe", async () => {
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    repository.failure = new Error(
      "relation user_permission_overrides does not exist for secret-company"
    );

    const error = await rejected(() =>
      resolveActorContext({
        principal: internalPrincipal(),
        authorityRepository: repository.repository,
        ...REQUEST,
      })
    );

    expect(error).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
      retryable: true,
    });
    const publicError = error.toAgentError();
    expect(AgentErrorSchema.safeParse(publicError).success).toBe(true);
    expect(JSON.stringify(publicError)).not.toContain("relation");
    expect(JSON.stringify(publicError)).not.toContain("secret-company");
  });

  it("rejects malformed canonical permission snapshots instead of guessing", async () => {
    const malformedSnapshots: ActorAuthoritySnapshot[] = [
      authority({ permissionSnapshotRevision: "" }),
      authority({ isActive: "true" as never }),
      authority({ actorUserId: null as never }),
      authority({ roleIds: null as never }),
      authority({ configuredPermissions: null as never }),
      authority({ effectivePermissions: [null] as never }),
      authority({
        effectivePermissions: [
          { permission: "projects.view", scope: "all" },
          { permission: "projects.view", scope: "assigned" },
        ],
      }),
      authority({
        effectivePermissions: [
          { permission: "projects.view", scope: "invalid" as "all" },
        ],
      }),
      authority({ configuredPermissions: ["not.registered"] as never }),
      authority({
        configuredPermissions: ["projects.view", "projects.view"],
      }),
    ];

    for (const malformed of malformedSnapshots) {
      const repository = new StubAuthoritySupabaseRpcClient(authority());
      repository.internalResult = malformed;
      const error = await rejected(() =>
        resolveActorContext({
          principal: internalPrincipal(),
          authorityRepository: repository.repository,
          ...REQUEST,
        })
      );

      expect(error).toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        message: "Authorization is temporarily unavailable.",
      });
    }
  });

  it("contains hostile authority snapshot traps as a safe unavailable result", async () => {
    const hostileRoleIds = new Proxy(["33333333-3333-4333-8333-333333333333"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("private authority snapshot details");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    repository.internalResult = authority({ roleIds: hostileRoleIds });

    const error = await rejected(() =>
      resolveActorContext({
        principal: internalPrincipal(),
        authorityRepository: repository.repository,
        ...REQUEST,
      })
    );

    expect(error).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
    });
    expect(JSON.stringify(error.toAgentError())).not.toContain("private");
  });

  it("never widens permission scope through an accessor-backed authority row", async () => {
    let scopeReads = 0;
    const hostilePermission = { permission: "projects.view" } as Record<
      string,
      unknown
    >;
    Object.defineProperty(hostilePermission, "scope", {
      enumerable: true,
      get() {
        scopeReads += 1;
        return scopeReads === 1 ? "assigned" : "all";
      },
    });
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    repository.internalResult = authority({
      configuredPermissions: ["projects.view"],
      effectivePermissions: [hostilePermission as never],
    });

    const error = await rejected(() =>
      resolveActorContext({
        principal: internalPrincipal(),
        authorityRepository: repository.repository,
        ...REQUEST,
      })
    );

    expect(error).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
    });
    expect(scopeReads).toBe(0);
  });

  it("rejects proxy, symbol, extra, and hidden authority permission rows", async () => {
    const withSymbol = {
      permission: "projects.view",
      scope: "assigned",
    } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("private-permission")] = "all";
    const withHidden = {
      permission: "projects.view",
      scope: "assigned",
    };
    Object.defineProperty(withHidden, "hidden", {
      enumerable: false,
      value: "all",
    });

    for (const permissionRow of [
      new Proxy({ permission: "projects.view", scope: "assigned" }, {}),
      withSymbol,
      { permission: "projects.view", scope: "assigned", extra: "all" },
      withHidden,
    ]) {
      const repository = new StubAuthoritySupabaseRpcClient(authority());
      repository.internalResult = authority({
        configuredPermissions: ["projects.view"],
        effectivePermissions: [permissionRow as never],
      });

      const error = await rejected(() =>
        resolveActorContext({
          principal: internalPrincipal(),
          authorityRepository: repository.repository,
          ...REQUEST,
        })
      );

      expect(error).toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        message: "Authorization is temporarily unavailable.",
      });
    }
  });

  it("rejects malformed actor and company identifiers from authority", async () => {
    for (const malformed of [
      authority({ actorUserId: "not-a-uuid" }),
      authority({ companyId: "not-a-uuid" }),
      authority({
        actorUserId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      }),
    ]) {
      const repository = new StubAuthoritySupabaseRpcClient(authority());
      repository.internalResult = malformed;

      const error = await rejected(() =>
        resolveActorContext({
          principal: internalPrincipal(),
          authorityRepository: repository.repository,
          ...REQUEST,
        })
      );

      expect(error).toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        message: "Authorization is temporarily unavailable.",
      });
    }
  });

  it("accepts lowercase PostgreSQL UUID actor and company identities", async () => {
    const actorUserId = "d1111111-1111-4111-d111-111111111111";
    const companyId = "00000000-0000-0000-0000-000000000001";
    const currentAuthority = authority({ actorUserId, companyId });
    const repository = new StubAuthoritySupabaseRpcClient(currentAuthority);
    repository.mcpResult = currentAuthority;
    const principal = validatedMcpPrincipalFixture({
      actorUserId,
      companyId,
      oauthGrantId: "grant-1",
      oauthClientId: "client-1",
      validatedScopes: ["ops.jobs.read"],
      tokenId: "token-1",
      issuer: "https://auth.opsapp.co",
      audience: "https://mcp.opsapp.co/mcp",
      grantRevision: "grant-revision-4",
    });

    await expect(
      resolveActorContext({
        principal,
        authorityRepository: repository.repository,
        ...REQUEST,
      })
    ).resolves.toMatchObject({ actorUserId, companyId });
  });

  it("carries only a validated MCP grant seam and rechecks current actor membership", async () => {
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    const principal = validatedMcpPrincipalFixture({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      oauthGrantId: "grant-1",
      oauthClientId: "client-1",
      validatedScopes: ["ops.jobs.read", "ops.schedule.read", "ops.jobs.read"],
      tokenId: "token-1",
      issuer: "https://auth.opsapp.co",
      audience: "https://mcp.opsapp.co/mcp",
      grantRevision: "grant-revision-4",
      applicationId: "claude",
      protocolEra: "2026-07-28",
    });

    const context = await resolveActorContext({
      principal,
      authorityRepository: repository.repository,
      ...REQUEST,
    });

    expect(repository.actorLookups).toEqual([
      {
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
      },
    ]);
    expect(context.auth).toEqual({
      channel: "mcp",
      scopeCeiling: ["ops.jobs.read", "ops.schedule.read"],
      oauthGrantId: "grant-1",
      oauthClientId: "client-1",
      tokenId: "token-1",
      issuer: "https://auth.opsapp.co",
      audience: "https://mcp.opsapp.co/mcp",
      grantRevision: "grant-revision-4",
    });
    expect(context.auditClient).toEqual({
      applicationId: "claude",
      protocolEra: "2026-07-28",
    });
  });

  it("rechecks routed Phase C actor and company authority with an internal ceiling", async () => {
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    const principal = verifiedPhaseCPrincipalFixture({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
      ...PHASE_C_ROUTE,
    });

    const context = await resolveActorContext({
      principal,
      authorityRepository: repository.repository,
      ...REQUEST,
    });

    expect(repository.actorLookups).toEqual([
      {
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        registeredPermissionKeys: REGISTERED_ACTOR_PERMISSION_KEYS,
      },
    ]);
    expect(context.auth).toEqual({
      channel: "internal",
      scopeCeiling: null,
    });
    expect(context.auditClient).toEqual({
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    });
    expect(context.phaseCRoute).toEqual(PHASE_C_ROUTE);
    expect(Object.isFrozen(context.phaseCRoute)).toBe(true);
  });

  it("fails closed when an MCP authority snapshot does not match its validated grant", async () => {
    for (const mismatch of [
      authority({ actorUserId: "99999999-9999-4999-8999-999999999999" }),
      authority({ companyId: "99999999-9999-4999-8999-999999999999" }),
    ]) {
      const repository = new StubAuthoritySupabaseRpcClient(authority());
      repository.mcpResult = mismatch;
      const principal = validatedMcpPrincipalFixture({
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        oauthGrantId: "grant-1",
        oauthClientId: "client-1",
        validatedScopes: ["ops.jobs.read"],
        tokenId: "token-1",
        issuer: "https://auth.opsapp.co",
        audience: "https://mcp.opsapp.co/mcp",
        grantRevision: "grant-revision-4",
      });

      const error = await rejected(() =>
        resolveActorContext({
          principal,
          authorityRepository: repository.repository,
          ...REQUEST,
        })
      );

      expect(error).toMatchObject({
        code: "FORBIDDEN",
        message: "Access is not available.",
      });
    }
  });

  it("does not allow a structurally similar unverified principal", async () => {
    const unverifiedPrincipal = {
      kind: "internal",
      channel: "internal",
      firebaseSubject: "attacker-controlled",
      applicationId: null,
      protocolEra: null,
    } as const;
    if (false) {
      // A tool payload can reproduce strings, but not the module-private brand.
      // @ts-expect-error unverified objects cannot become authority principals
      const unverified: VerifiedActorPrincipal = unverifiedPrincipal;
      void unverified;
    }

    const repository = new StubAuthoritySupabaseRpcClient(authority());
    const error = await rejected(() =>
      resolveActorContext({
        principal: unverifiedPrincipal as never,
        authorityRepository: repository.repository,
        ...REQUEST,
      })
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(repository.internalLookups).toHaveLength(0);
  });

  it("does not let a structural repository mint current admin authority", async () => {
    const fabricatedRepository = {
      async resolveInternalAuthority() {
        return authority({
          isAdmin: true,
          configuredPermissions: [],
          effectivePermissions: [],
        });
      },
      async resolveActorAuthority() {
        return null;
      },
    };

    const error = await rejected(() =>
      resolveActorContext({
        principal: internalPrincipal(),
        authorityRepository: fabricatedRepository as never,
        ...REQUEST,
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
      retryable: false,
    });
    expect(error.auditReasonForLog()).toBe(
      "actor_authority_repository_untrusted"
    );
  });

  it("rejects accessor-backed principal and repository seams without invoking them", async () => {
    const trustedRepository = new StubAuthoritySupabaseRpcClient(authority());
    const fabricatedRepository = {
      async resolveInternalAuthority() {
        return authority({ isAdmin: true });
      },
      async resolveActorAuthority() {
        return authority({ isAdmin: true });
      },
    };
    let principalReads = 0;
    let repositoryReads = 0;
    const hostileInput = {
      ...REQUEST,
    } as Record<string, unknown>;
    Object.defineProperties(hostileInput, {
      principal: {
        enumerable: true,
        get() {
          principalReads += 1;
          return principalReads === 1
            ? internalPrincipal()
            : {
                kind: "internal",
                channel: "internal",
                firebaseSubject: "attacker-subject",
                applicationId: "attacker-client",
                protocolEra: "attacker-era",
              };
        },
      },
      authorityRepository: {
        enumerable: true,
        get() {
          repositoryReads += 1;
          return repositoryReads === 1
            ? trustedRepository.repository
            : fabricatedRepository;
        },
      },
    });

    const error = await rejected(() =>
      resolveActorContext(hostileInput as never)
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
    });
    expect(principalReads).toBe(0);
    expect(repositoryReads).toBe(0);
    expect(trustedRepository.internalLookups).toEqual([]);
    expect(JSON.stringify(error.toAgentError())).not.toContain("attacker");
  });

  it("rejects non-exact or proxy input before any authority lookup", async () => {
    const repository = new StubAuthoritySupabaseRpcClient(authority());
    const base = {
      principal: internalPrincipal(),
      authorityRepository: repository.repository,
      ...REQUEST,
    };
    const withSymbol = { ...base } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("secret-input")] = "private-value";
    const withNonEnumerable = { ...base };
    Object.defineProperty(withNonEnumerable, "hidden", {
      enumerable: false,
      value: "private-value",
    });
    const descriptorTrap = new Proxy(base, {
      getOwnPropertyDescriptor() {
        throw new Error("private descriptor details");
      },
    });

    for (const malformed of [
      { ...base, extra: "private-value" },
      withSymbol,
      withNonEnumerable,
      new Proxy(base, {}),
      descriptorTrap,
    ]) {
      const error = await rejected(() =>
        resolveActorContext(malformed as never)
      );
      expect(error).toMatchObject({
        code: "INTERNAL",
        message: "Authorization could not be evaluated.",
      });
      expect(JSON.stringify(error.toAgentError())).not.toContain("private");
    }

    expect(repository.internalLookups).toEqual([]);
  });

  it("keeps one captured actor and capability snapshot across an authority await", async () => {
    let releaseLookup:
      | ((result: {
          data: readonly Readonly<Record<string, unknown>>[];
          error: null;
        }) => void)
      | undefined;
    const pendingLookup = new Promise<{
      data: readonly Readonly<Record<string, unknown>>[];
      error: null;
    }>((resolve) => {
      releaseLookup = resolve;
    });
    const repository = createSupabaseActorAuthorityRepository({
      rpc() {
        return pendingLookup;
      },
    });
    const originalPrincipal = validatedMcpPrincipalFixture({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      oauthGrantId: "grant-original",
      oauthClientId: "client-original",
      validatedScopes: ["ops.jobs.read"],
      tokenId: "token-original",
      issuer: "https://auth.opsapp.co",
      audience: "https://mcp.opsapp.co/mcp",
      grantRevision: "grant-revision-original",
      applicationId: "claude-original",
      protocolEra: "2026-07-28",
    });
    const mutableInput = {
      principal: originalPrincipal as VerifiedActorPrincipal,
      authorityRepository: repository,
      requestId: "request-original",
      causationId: "cause-original" as string | null,
      policyRevision: "policy-original",
      capabilityManifestRevision: "manifest-original",
    };

    const resolution = resolveActorContext(mutableInput);
    mutableInput.principal = verifiedPhaseCPrincipalFixture({
      actorUserId: "11111111-1111-4111-8111-111111111111",
      companyId: "22222222-2222-4222-8222-222222222222",
      applicationId: "phase-c-mutated",
      protocolEra: "mutated-era",
      ...PHASE_C_ROUTE,
    });
    mutableInput.causationId = "cause-mutated";
    mutableInput.policyRevision = "policy-mutated";
    mutableInput.capabilityManifestRevision = "manifest-mutated";
    const snapshot = authority();
    releaseLookup?.({
      data: [
        {
          actor_user_id: snapshot.actorUserId,
          company_id: snapshot.companyId,
          is_active: snapshot.isActive,
          is_admin: snapshot.isAdmin,
          role_ids: snapshot.roleIds,
          configured_permissions: snapshot.configuredPermissions,
          effective_permissions: snapshot.effectivePermissions,
          permission_snapshot_revision: snapshot.permissionSnapshotRevision,
        },
      ],
      error: null,
    });

    await expect(resolution).resolves.toMatchObject({
      requestId: "request-original",
      causationId: "cause-original",
      policyRevision: "policy-original",
      capabilityManifestRevision: "manifest-original",
      auth: {
        channel: "mcp",
        oauthGrantId: "grant-original",
      },
      auditClient: {
        applicationId: "claude-original",
        protocolEra: "2026-07-28",
      },
    });
  });

  it("fails closed when an authority await replaces Object.fromEntries", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "fromEntries"
    );
    if (!originalDescriptor || !("value" in originalDescriptor)) {
      throw new Error("Object.fromEntries descriptor is unavailable");
    }
    const snapshot = authority({
      configuredPermissions: ["projects.view"],
      effectivePermissions: [
        { permission: "projects.view", scope: "assigned" },
      ],
    });
    const repository = createSupabaseActorAuthorityRepository({
      async rpc() {
        Object.defineProperty(Object, "fromEntries", {
          ...originalDescriptor,
          value() {
            return { "projects.view": "all" };
          },
        });
        return {
          data: [
            {
              actor_user_id: snapshot.actorUserId,
              company_id: snapshot.companyId,
              is_active: snapshot.isActive,
              is_admin: snapshot.isAdmin,
              role_ids: snapshot.roleIds,
              configured_permissions: snapshot.configuredPermissions,
              effective_permissions: snapshot.effectivePermissions,
              permission_snapshot_revision: snapshot.permissionSnapshotRevision,
            },
          ],
          error: null,
        };
      },
    });

    let resolution: ActorContext | undefined;
    let caught: unknown;
    try {
      resolution = await resolveActorContext({
        principal: internalPrincipal(),
        authorityRepository: repository,
        ...REQUEST,
      });
    } catch (error) {
      caught = error;
    } finally {
      Object.defineProperty(Object, "fromEntries", originalDescriptor);
    }

    expect(resolution).toBeUndefined();
    expect(caught).toBeInstanceOf(ActorAccessError);
    expect(caught).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
    });
  });

  it("keeps ActorContext nominal so caller data cannot construct authority", () => {
    if (false) {
      // @ts-expect-error only resolveActorContext can mint the private brand
      const forged: ActorContext = {
        requestId: "request-forged",
        causationId: null,
        actorUserId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        membership: { userActive: true, companyActive: true },
        roleIds: [],
        adminBypass: false,
        configuredPermissions: [],
        effectivePermissions: {},
        permissionSnapshotRevision: "revision-forged",
        auth: { channel: "internal", scopeCeiling: null },
        auditClient: { applicationId: null, protocolEra: null },
        policyRevision: "policy-forged",
        capabilityManifestRevision: "manifest-forged",
        phaseCRoute: null,
      };
      void forged;
    }

    expect(true).toBe(true);
  });
});
