import { describe, expect, it } from "vitest";

import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts";
import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  authorizeCapability,
  type AuthorizedCapability,
} from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  defineCapabilityPolicyForManifest,
  type ManifestCapabilityPolicy,
  type ManifestCapabilityPolicyDefinition,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { AppPermission, PermissionScope } from "@/lib/types/permissions";
import { trustedAuthorityRepositoryForSnapshot } from "./fixtures/trusted-repository-fixtures";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "./fixtures/verified-principal-fixtures";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const MANIFEST_REVISION = "capabilities:test-v1";

function authority(
  permissions: Record<string, PermissionScope>,
  isAdmin = false
): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin,
    roleIds: ["33333333-3333-4333-8333-333333333333"],
    configuredPermissions: Object.keys(permissions),
    effectivePermissions: Object.entries(permissions).map(
      ([permission, scope]) => ({ permission, scope })
    ),
    permissionSnapshotRevision: "sha256:capability-authority-1",
  };
}

async function actor(input: {
  permissions: Record<string, PermissionScope>;
  scopes?: readonly string[];
  isAdmin?: boolean;
}) {
  const principal = input.scopes
    ? validatedMcpPrincipalFixture({
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        oauthGrantId: "grant-1",
        oauthClientId: "client-1",
        validatedScopes: input.scopes,
        tokenId: "token-1",
        issuer: "https://auth.opsapp.co",
        audience: "https://mcp.opsapp.co/mcp",
        grantRevision: "grant-revision-1",
      })
    : verifiedInternalPrincipalFixture({
        channel: "internal",
        firebaseSubject: "firebase-subject-1",
      });

  return resolveActorContext({
    principal,
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(input.permissions, input.isAdmin)
    ),
    requestId: "request-capability-1",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
  });
}

function policy(
  overrides: Partial<ManifestCapabilityPolicyDefinition> = {}
): ManifestCapabilityPolicy {
  return defineCapabilityPolicyForManifest({
    capabilityId: "get_job_summary",
    capabilityRevision: "get_job_summary:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
    requiredOAuthScopes: ["ops.jobs.read"],
    permissionRequirementGroups: [
      [
        {
          permission: "projects.view",
          allowedScopes: ["all", "assigned"],
        },
      ],
    ],
    ...overrides,
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
  throw new Error("Expected authorization to fail");
}

describe("authorizeCapability", () => {
  it("authorizes internal actors from current OPS permissions and freezes the proof", async () => {
    const context = await actor({
      permissions: { "projects.view": "assigned" },
    });
    const manifestPolicy = policy();

    const authorization = authorizeCapability({
      actorContext: context,
      policy: manifestPolicy,
    });

    expect(authorization).toMatchObject({
      actorContext: context,
      capabilityId: "get_job_summary",
      capabilityRevision: "get_job_summary:v1",
      capabilityManifestRevision: MANIFEST_REVISION,
      declaredOAuthScopes: ["ops.jobs.read"],
      resolvedPermissions: { "projects.view": "assigned" },
      satisfiedOAuthScopes: [],
    });
    expect(authorization.declaredOAuthScopes).not.toBe(
      manifestPolicy.requiredOAuthScopes
    );
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.declaredOAuthScopes)).toBe(true);
    expect(Object.isFrozen(authorization.resolvedPermissions)).toBe(true);
    expect(Object.isFrozen(authorization.satisfiedOAuthScopes)).toBe(true);
  });

  it("enforces the MCP OAuth ceiling before OPS permissions", async () => {
    const context = await actor({
      permissions: { "projects.view": "all" },
      scopes: ["ops.schedule.read"],
    });

    const error = await rejected(() =>
      authorizeCapability({ actorContext: context, policy: policy() })
    );

    expect(error).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
      message: "Additional authorization is required.",
      retryable: false,
      requiredScope: "ops.jobs.read",
      wwwAuthenticate:
        'Bearer error="insufficient_scope", scope="ops.jobs.read"',
    });
    expect(AgentErrorSchema.safeParse(error.toAgentError()).success).toBe(true);
  });

  it("does not let admin bypass exceed the MCP OAuth ceiling", async () => {
    const context = await actor({
      permissions: { "projects.view": "all" },
      scopes: ["ops.schedule.read"],
      isAdmin: true,
    });

    const error = await rejected(() =>
      authorizeCapability({ actorContext: context, policy: policy() })
    );

    expect(error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it.each([
    { channel: "internal" as const, scopes: undefined },
    { channel: "mcp" as const, scopes: ["ops.jobs.read"] },
  ])(
    "honors current OPS admin bypass for $channel after the OAuth ceiling",
    async ({ scopes }) => {
      const context = await actor({
        permissions: {},
        scopes,
        isAdmin: true,
      });

      const authorization = authorizeCapability({
        actorContext: context,
        policy: policy({
          permissionRequirementGroups: [
            [
              {
                permission: "projects.view",
                allowedScopes: ["own", "assigned"],
              },
            ],
          ],
        }),
      });

      expect(authorization.resolvedPermissions).toEqual({
        "projects.view": "assigned",
      });
    }
  );

  it("fails with a generic forbidden error when OPS permission is absent or too narrow", async () => {
    for (const permissions of [
      {},
      { "projects.view": "own" as const },
    ] as Record<string, PermissionScope>[]) {
      const context = await actor({
        permissions,
        scopes: ["ops.jobs.read"],
      });
      const error = await rejected(() =>
        authorizeCapability({ actorContext: context, policy: policy() })
      );

      expect(error).toMatchObject({
        code: "FORBIDDEN",
        message: "Access is not available.",
      });
      const publicError = error.toAgentError();
      expect(AgentErrorSchema.safeParse(publicError).success).toBe(true);
      expect(publicError).not.toHaveProperty("details");
      expect(JSON.stringify(publicError)).not.toContain("projects.view");
    }
  });

  it("requires both financial OAuth and the exact project financial permission", async () => {
    const financialPolicy = policy({
      requiredOAuthScopes: ["ops.jobs.read", "ops.financials.read"],
      permissionRequirementGroups: [
        [
          {
            permission: "projects.view",
            allowedScopes: ["all", "assigned"],
          },
          {
            permission: "projects.view_financials",
            allowedScopes: ["all"],
          },
        ],
      ],
    });
    const withoutFinancialPermission = await actor({
      permissions: { "projects.view": "all" },
      scopes: ["ops.jobs.read", "ops.financials.read"],
    });
    expect(
      (
        await rejected(() =>
          authorizeCapability({
            actorContext: withoutFinancialPermission,
            policy: financialPolicy,
          })
        )
      ).code
    ).toBe("FORBIDDEN");

    const fullyAuthorized = await actor({
      permissions: {
        "projects.view": "assigned",
        "projects.view_financials": "all",
      },
      scopes: ["ops.financials.read", "ops.jobs.read"],
    });
    const authorization = authorizeCapability({
      actorContext: fullyAuthorized,
      policy: financialPolicy,
    });

    expect(authorization.resolvedPermissions).toEqual({
      "projects.view": "assigned",
      "projects.view_financials": "all",
    });
    expect(authorization.satisfiedOAuthScopes).toEqual([
      "ops.financials.read",
      "ops.jobs.read",
    ]);
    expect(authorization.declaredOAuthScopes).toEqual([
      "ops.financials.read",
      "ops.jobs.read",
    ]);
  });

  it("authorizes one complete job-kind permission group without requiring both", async () => {
    const jobPolicy = policy({
      permissionRequirementGroups: [
        [{ permission: "pipeline.view", allowedScopes: ["all", "assigned"] }],
        [{ permission: "projects.view", allowedScopes: ["all", "assigned"] }],
      ],
    });
    const opportunityActor = await actor({
      permissions: { "pipeline.view": "assigned" },
    });

    const authorization = authorizeCapability({
      actorContext: opportunityActor,
      policy: jobPolicy,
    });

    expect(authorization.resolvedPermissions).toEqual({
      "pipeline.view": "assigned",
    });
    expect(authorization.declaredPermissions).toEqual([
      "pipeline.view",
      "projects.view",
    ]);
    expect(authorization.satisfiedPermissionGroupIndexes).toEqual([0]);

    const unauthorizedActor = await actor({ permissions: {} });
    expect(
      (
        await rejected(() =>
          authorizeCapability({
            actorContext: unauthorizedActor,
            policy: jobPolicy,
          })
        )
      ).code
    ).toBe("FORBIDDEN");
  });

  it("rejects a capability from a different injected manifest revision", async () => {
    const context = await actor({
      permissions: { "projects.view": "all" },
    });
    const error = await rejected(() =>
      authorizeCapability({
        actorContext: context,
        policy: policy({ capabilityManifestRevision: "capabilities:stale" }),
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
      retryable: false,
    });
    expect(JSON.stringify(error.toAgentError())).not.toContain("stale");
  });

  it("rejects a raw structural policy that removes every OAuth and OPS requirement", async () => {
    const context = await actor({
      permissions: {},
      scopes: [],
    });

    const error = await rejected(() =>
      authorizeCapability({
        actorContext: context,
        policy: {
          capabilityId: "get_job_financials",
          capabilityRevision: "attacker-selected",
          capabilityManifestRevision: context.capabilityManifestRevision,
          requiredOAuthScopes: [],
          permissionRequirementGroups: [],
        } as never,
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
      retryable: false,
    });
    expect(error.auditReasonForLog()).toBe(
      "capability_policy_source_untrusted"
    );
  });

  it("fails safely for structurally malformed raw capability policies", async () => {
    const context = await actor({
      permissions: { "projects.view": "all" },
    });

    for (const malformedPolicy of [
      null,
      { ...policy(), requiredOAuthScopes: null },
      { ...policy(), permissionRequirementGroups: [null] },
    ]) {
      const error = await rejected(() =>
        authorizeCapability({
          actorContext: context,
          policy: malformedPolicy as never,
        })
      );

      expect(error).toMatchObject({
        code: "INTERNAL",
        message: "Authorization could not be evaluated.",
      });
      expect(AgentErrorSchema.safeParse(error.toAgentError()).success).toBe(
        true
      );
    }
  });

  it("rejects malformed OAuth scope tokens at manifest definition time", () => {
    for (const malformedScope of [
      "ops.jobs.read ops.schedule.read",
      'ops.jobs.read"\r\nX-Injected: true',
    ]) {
      expect(() => policy({ requiredOAuthScopes: [malformedScope] })).toThrow(
        TypeError
      );
    }
  });

  it("does not let admin bypass authorize an unregistered manifest permission", async () => {
    const context = await actor({ permissions: {}, isAdmin: true });
    const error = await rejected(() =>
      authorizeCapability({
        actorContext: context,
        policy: {
          capabilityId: "get_job_summary",
          capabilityRevision: "get_job_summary:v1",
          capabilityManifestRevision: MANIFEST_REVISION,
          requiredOAuthScopes: ["ops.jobs.read"],
          permissionRequirementGroups: [
            [
              {
                permission: "unregistered.permission" as AppPermission,
                allowedScopes: ["all"],
              },
            ],
          ],
        } as never,
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
    });
    expect(error.auditReasonForLog()).toBe(
      "capability_policy_source_untrusted"
    );
  });

  it("keeps the capability proof nominal so raw tool data cannot construct it", () => {
    if (false) {
      // @ts-expect-error the authorization brand is module-private
      const forged: AuthorizedCapability = {
        actorContext: {} as never,
        capabilityId: "get_job_summary",
        capabilityRevision: "get_job_summary:v1",
        capabilityManifestRevision: MANIFEST_REVISION,
        declaredOAuthScopes: [],
        resolvedPermissions: {},
        declaredPermissions: [],
        satisfiedPermissionGroupIndexes: [],
        satisfiedOAuthScopes: [],
      };
      void forged;
    }

    expect(true).toBe(true);
  });

  it("rejects a structural ActorContext copy that lacks the server-owned brand", async () => {
    const context = await actor({
      permissions: { "projects.view": "all" },
    });
    const structuralCopy = JSON.parse(JSON.stringify(context));

    const error = await rejected(() =>
      authorizeCapability({
        actorContext: structuralCopy,
        policy: policy(),
      })
    );

    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Authorization could not be evaluated.",
    });

    const spreadError = await rejected(() =>
      authorizeCapability({
        actorContext: { ...context },
        policy: policy(),
      })
    );
    expect(spreadError.code).toBe("INTERNAL");
  });
});
