import { describe, expect, it } from "vitest";

import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts";
import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import { defineCapabilityPolicyForManifest } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  authorizeCurrentEntityQuery,
  isAuthorizedEntityQueryContext,
  type AuthorizedEntityQueryContext,
  type EntityAction,
  type EntityKind,
} from "@/lib/agent-control-plane/actor/authorize-entity-query";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";
import {
  StubEntityAuthorizationSupabaseRpcClient,
  trustedAuthorityRepositoryForSnapshot,
} from "./fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "./fixtures/verified-principal-fixtures";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID = "44444444-4444-4444-8444-444444444444";
const MANIFEST_REVISION = "capabilities:test-v1";

function authority(
  permissions: Partial<Record<AppPermission, PermissionScope>>
): ActorAuthoritySnapshot {
  const configuredPermissions = Object.keys(permissions) as AppPermission[];
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["33333333-3333-4333-8333-333333333333"],
    configuredPermissions,
    effectivePermissions: Object.entries(permissions).map(
      ([permission, scope]) => ({
        permission,
        scope: scope as PermissionScope,
      })
    ),
    permissionSnapshotRevision: "sha256:entity-authority-1",
  };
}

async function capability(
  permission: AppPermission,
  scope: PermissionScope = "all"
): Promise<AuthorizedCapability> {
  const actorContext = await resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-subject-1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority({ [permission]: scope })
    ),
    requestId: "request-entity-1",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
  });

  return authorizeCapability({
    actorContext,
    policy: defineCapabilityPolicyForManifest({
      capabilityId: "entity_test",
      capabilityRevision: "entity_test:v1",
      capabilityManifestRevision: MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.jobs.read"],
      permissionRequirementGroups: [
        [
          {
            permission,
            allowedScopes: ["all", "assigned", "own"],
          },
        ],
      ],
    }),
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
  throw new Error("Expected entity authorization to fail");
}

const ENTITY_ACTION_PERMISSION_CASES: readonly (readonly [
  EntityKind,
  EntityAction,
  AppPermission,
])[] = [
  ["opportunity", "view", "pipeline.view"],
  ["opportunity", "edit", "pipeline.edit"],
  ["project", "view", "projects.view"],
  ["project", "edit", "projects.edit"],
  ["task", "view", "tasks.view"],
  ["task", "edit", "tasks.edit"],
  ["task", "change_status", "tasks.change_status"],
  ["client", "view", "clients.view"],
  ["client", "edit", "clients.edit"],
  ["sub_client", "view", "clients.view"],
  ["sub_client", "edit", "clients.edit"],
  ["calendar_event", "view", "calendar.view"],
  ["calendar_event", "edit", "calendar.edit"],
  ["calendar_event", "delete", "calendar.delete"],
  ["calendar_user_event", "view", "calendar.view"],
  ["calendar_user_event", "edit", "calendar.edit"],
  ["calendar_user_event", "delete", "calendar.delete"],
];

describe("authorizeCurrentEntityQuery", () => {
  it.each(ENTITY_ACTION_PERMISSION_CASES)(
    "binds %s:%s to the exact capability permission %s",
    async (entityKind, action, permission) => {
      const authorization = await capability(permission);
      const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();

      const context = await authorizeCurrentEntityQuery({
        capabilityAuthorization: authorization,
        authorizationRepository: rpcClient.repository,
        entity: { kind: entityKind, id: ENTITY_ID },
        action,
      });

      expect(rpcClient.lookups).toEqual([
        {
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          entityKind,
          entityId: ENTITY_ID,
          action,
        },
      ]);
      expect(context).toMatchObject({
        actorContext: authorization.actorContext,
        capabilityId: "entity_test",
        entity: { kind: entityKind, id: ENTITY_ID },
        action,
        permission,
        resolvedScope: "all",
      });
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.entity)).toBe(true);
      expect("assignments" in context).toBe(false);
    }
  );

  it("rechecks live assignment on every query attempt and never caches it", async () => {
    const authorization = await capability("projects.view", "assigned");
    const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();
    rpcClient.decisions = [true, false];
    const input = {
      capabilityAuthorization: authorization,
      authorizationRepository: rpcClient.repository,
      entity: { kind: "project" as const, id: ENTITY_ID },
      action: "view" as const,
    };

    const first = await authorizeCurrentEntityQuery(input);
    const secondError = await rejected(() =>
      authorizeCurrentEntityQuery(input)
    );

    expect(first.resolvedScope).toBe("assigned");
    expect(secondError).toMatchObject({
      code: "NOT_FOUND",
      message: "Resource is not available.",
      retryable: false,
    });
    expect(rpcClient.lookups).toHaveLength(2);
    expect(rpcClient.lookups[0]).toEqual(rpcClient.lookups[1]);
  });

  it("uses one indistinguishable response for missing, cross-company, or newly unassigned entities", async () => {
    const authorization = await capability("projects.view", "assigned");

    for (const deniedReason of [
      "missing",
      "cross-company",
      "newly-unassigned",
    ]) {
      const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();
      rpcClient.decisions = [false];
      const error = await rejected(() =>
        authorizeCurrentEntityQuery({
          capabilityAuthorization: authorization,
          authorizationRepository: rpcClient.repository,
          entity: { kind: "project", id: ENTITY_ID },
          action: "view",
        })
      );

      const publicError = error.toAgentError();
      expect(error.auditReasonForLog()).toBe("entity_access_unavailable");
      expect(publicError).toMatchObject({
        code: "NOT_FOUND",
        message: "Resource is not available.",
        retryable: false,
      });
      expect(AgentErrorSchema.safeParse(publicError).success).toBe(true);
      expect(JSON.stringify(publicError)).not.toContain(ENTITY_ID);
      expect(JSON.stringify(publicError)).not.toContain(deniedReason);
    }
  });

  it("surfaces repository failure without leaking database or entity details", async () => {
    const authorization = await capability("clients.view");
    const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();
    rpcClient.failure = new Error(
      `relation project_tasks failed for ${ENTITY_ID}`
    );

    const error = await rejected(() =>
      authorizeCurrentEntityQuery({
        capabilityAuthorization: authorization,
        authorizationRepository: rpcClient.repository,
        entity: { kind: "client", id: ENTITY_ID },
        action: "view",
      })
    );

    expect(error).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
      retryable: true,
    });
    expect(JSON.stringify(error.toAgentError())).not.toContain("relation");
    expect(JSON.stringify(error.toAgentError())).not.toContain(ENTITY_ID);
  });

  it("rejects invalid IDs and kind-action pairs before the repository call", async () => {
    const authorization = await capability("projects.view");

    for (const invalidInput of [
      { entity: null, action: "view" },
      { entity: { kind: "project" as const, id: "" }, action: "view" },
      {
        entity: { kind: "project" as const, id: "not-a-uuid" },
        action: "view",
      },
      {
        entity: { kind: "project" as const, id: ENTITY_ID },
        action: "delete",
      },
      {
        entity: { kind: "unknown" as EntityKind, id: ENTITY_ID },
        action: "view",
      },
    ]) {
      const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();
      const error = await rejected(() =>
        authorizeCurrentEntityQuery({
          capabilityAuthorization: authorization,
          authorizationRepository: rpcClient.repository,
          entity: invalidInput.entity as never,
          action: invalidInput.action as EntityAction,
        })
      );

      expect(error.code).toBe("INVALID_ARGUMENT");
      expect(AgentErrorSchema.safeParse(error.toAgentError()).success).toBe(
        true
      );
      expect(rpcClient.lookups).toHaveLength(0);
    }
  });

  it("fails closed when the capability manifest omitted the entity's exact permission", async () => {
    const wrongCapability = await capability("tasks.view");
    const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();

    const error = await rejected(() =>
      authorizeCurrentEntityQuery({
        capabilityAuthorization: wrongCapability,
        authorizationRepository: rpcClient.repository,
        entity: { kind: "project", id: ENTITY_ID },
        action: "view",
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
    });
    expect(rpcClient.lookups).toHaveLength(0);
    expect(JSON.stringify(error.toAgentError())).not.toContain("projects.view");
  });

  it("returns privacy-safe not-found when another declared job-kind permission was satisfied", async () => {
    const actorContext = await resolveActorContext({
      principal: verifiedInternalPrincipalFixture({
        channel: "internal",
        firebaseSubject: "firebase-subject-1",
      }),
      authorityRepository: trustedAuthorityRepositoryForSnapshot(
        authority({ "pipeline.view": "assigned" })
      ),
      requestId: "request-entity-alternative-1",
      policyRevision: "actor-policy:v1",
      capabilityManifestRevision: MANIFEST_REVISION,
    });
    const authorization = authorizeCapability({
      actorContext,
      policy: defineCapabilityPolicyForManifest({
        capabilityId: "get_job_summary",
        capabilityRevision: "get_job_summary:v1",
        capabilityManifestRevision: MANIFEST_REVISION,
        requiredOAuthScopes: ["ops.jobs.read"],
        permissionRequirementGroups: [
          [
            {
              permission: "pipeline.view",
              allowedScopes: ["all", "assigned"],
            },
          ],
          [
            {
              permission: "projects.view",
              allowedScopes: ["all", "assigned"],
            },
          ],
        ],
      }),
    });
    const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();

    const error = await rejected(() =>
      authorizeCurrentEntityQuery({
        capabilityAuthorization: authorization,
        authorizationRepository: rpcClient.repository,
        entity: { kind: "project", id: ENTITY_ID },
        action: "view",
      })
    );

    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "Resource is not available.",
    });
    expect(rpcClient.lookups).toHaveLength(0);
  });

  it("does not let a structural repository mint a current-entity proof", async () => {
    const authorization = await capability("projects.view", "assigned");
    const fabricatedRepository = {
      async authorizeCurrentEntity() {
        return true;
      },
    };

    const error = await rejected(() =>
      authorizeCurrentEntityQuery({
        capabilityAuthorization: authorization,
        authorizationRepository: fabricatedRepository as never,
        entity: { kind: "project", id: ENTITY_ID },
        action: "view",
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
      retryable: false,
    });
    expect(error.auditReasonForLog()).toBe(
      "entity_authorization_repository_untrusted"
    );
  });

  it("never treats a truthy malformed entity RPC result as allow", async () => {
    const authorization = await capability("projects.view", "assigned");
    const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();
    rpcClient.decisions = ["false"];

    const error = await rejected(() =>
      authorizeCurrentEntityQuery({
        capabilityAuthorization: authorization,
        authorizationRepository: rpcClient.repository,
        entity: { kind: "project", id: ENTITY_ID },
        action: "view",
      })
    );

    expect(error).toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
      retryable: true,
    });
    expect(error.auditReasonForLog()).toBe(
      "entity_authority_response_malformed"
    );
  });

  it("keeps the entity query context nominal so raw tool data cannot construct it", () => {
    if (false) {
      // @ts-expect-error the current-entity authorization brand is private
      const forged: AuthorizedEntityQueryContext = {
        actorContext: {} as never,
        capabilityId: "entity_test",
        capabilityRevision: "entity_test:v1",
        entity: { kind: "project", id: ENTITY_ID },
        action: "view",
        permission: "projects.view",
        resolvedScope: "all",
      };
      void forged;
    }

    expect(true).toBe(true);
  });

  it("does not transfer capability or entity-query authority through object spread", async () => {
    const authorization = await capability("projects.view");
    const rpcClient = new StubEntityAuthorizationSupabaseRpcClient();
    const forgedCapability = { ...authorization } as AuthorizedCapability;

    const error = await rejected(() =>
      authorizeCurrentEntityQuery({
        capabilityAuthorization: forgedCapability,
        authorizationRepository: rpcClient.repository,
        entity: { kind: "project", id: ENTITY_ID },
        action: "view",
      })
    );
    expect(error.code).toBe("INTERNAL");
    expect(rpcClient.lookups).toHaveLength(0);

    const genuineContext = await authorizeCurrentEntityQuery({
      capabilityAuthorization: authorization,
      authorizationRepository: rpcClient.repository,
      entity: { kind: "project", id: ENTITY_ID },
      action: "view",
    });
    expect(isAuthorizedEntityQueryContext(genuineContext)).toBe(true);
    expect(isAuthorizedEntityQueryContext({ ...genuineContext })).toBe(false);
  });
});
