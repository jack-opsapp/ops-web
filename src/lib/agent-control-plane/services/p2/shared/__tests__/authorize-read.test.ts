import { describe, expect, it, vi } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import {
  activateCapabilityPolicyForManifest,
  defineCapabilityPolicyForManifest,
  type ManifestCapabilityPolicy,
} from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  assertP2ReadPolicyBinding,
  P2ReadAuthorizationError,
} from "../authorize-read";
import {
  executeP2CompositeRead,
  P2ComponentAuthorizationDeniedError,
  P2CompositeAuthorizationError,
} from "../composite-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const MANIFEST_REVISION = "2026-08-22.capability-manifest.v8";

function policy(): ManifestCapabilityPolicy {
  return activateCapabilityPolicyForManifest(
    defineCapabilityPolicyForManifest({
      capabilityId: "list_tasks",
      capabilityRevision: "list_tasks:2026-08-22.v1",
      capabilityManifestRevision: MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.tasks.read"],
      permissionRequirementGroups: [
        [
          {
            permission: "projects.view",
            allowedScopes: ["all", "assigned"],
          },
          { permission: "tasks.view", allowedScopes: ["all", "assigned"] },
        ],
      ],
    })
  );
}

async function authorization() {
  const snapshot: ActorAuthoritySnapshot = {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["33333333-3333-4333-8333-333333333333"],
    configuredPermissions: ["projects.view", "tasks.view"],
    effectivePermissions: [
      { permission: "projects.view", scope: "assigned" },
      { permission: "tasks.view", scope: "all" },
    ],
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
  const actorContext = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: "grant-1",
      oauthClientId: "client-1",
      validatedScopes: ["ops.tasks.read"],
      tokenId: "token-1",
      issuer: "https://auth.opsapp.co",
      audience: "https://mcp.opsapp.co/mcp",
      grantRevision: "grant-revision-1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(snapshot),
    requestId: "request-p2-kernel-1",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: MANIFEST_REVISION,
  });
  const manifestPolicy = policy();
  return {
    manifestPolicy,
    value: authorizeCapability({ actorContext, policy: manifestPolicy }),
  };
}

const EXPECTED_BINDING = {
  capabilityId: "list_tasks",
  capabilityRevision: "list_tasks:2026-08-22.v1",
  capabilityManifestRevision: MANIFEST_REVISION,
  requiredOAuthScopes: ["ops.tasks.read"],
  declaredPermissions: ["projects.view", "tasks.view"],
  satisfiedPermissionGroupIndexes: [0],
  resolvedPermissionKeys: ["projects.view", "tasks.view"],
} as const;

describe("P2 read authorization boundary", () => {
  it("accepts only the nominal manifest policy and capability proof with exact consent binding", async () => {
    const input = await authorization();
    const binding = assertP2ReadPolicyBinding({
      authorization: input.value,
      policy: input.manifestPolicy,
      expected: EXPECTED_BINDING,
    });

    expect(binding).toEqual({
      actorContext: input.value.actorContext,
      capabilityId: "list_tasks",
      capabilityRevision: "list_tasks:2026-08-22.v1",
      capabilityManifestRevision: MANIFEST_REVISION,
      requiredOAuthScopes: ["ops.tasks.read"],
      resolvedPermissions: {
        "projects.view": "assigned",
        "tasks.view": "all",
      },
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.requiredOAuthScopes)).toBe(true);
    expect(Object.isFrozen(binding.resolvedPermissions)).toBe(true);

    expect(() =>
      assertP2ReadPolicyBinding({
        authorization: { ...input.value },
        policy: input.manifestPolicy,
        expected: EXPECTED_BINDING,
      })
    ).toThrow(P2ReadAuthorizationError);
    expect(() =>
      assertP2ReadPolicyBinding({
        authorization: input.value,
        policy: { ...input.manifestPolicy },
        expected: EXPECTED_BINDING,
      })
    ).toThrow(P2ReadAuthorizationError);
  });

  it("rejects any declared or satisfied OAuth-policy mismatch", async () => {
    const input = await authorization();
    expect(() =>
      assertP2ReadPolicyBinding({
        authorization: input.value,
        policy: input.manifestPolicy,
        expected: {
          ...EXPECTED_BINDING,
          requiredOAuthScopes: ["ops.jobs.read"],
        },
      })
    ).toThrowError("P2_READ_AUTHORIZATION_INVALID");
  });
});

describe("P2 composite authorization", () => {
  it("authorizes every selection before the first read and fails an explicit component with zero reads", async () => {
    const read = vi.fn(async (component: string) => `${component}:value`);
    const authorize = vi.fn(async (selection: { component: string }) => {
      if (selection.component === "schedule") {
        throw new P2ComponentAuthorizationDeniedError();
      }
      return `${selection.component}:authority`;
    });

    await expect(
      executeP2CompositeRead({
        selections: [
          { component: "leads", origin: "explicit" },
          { component: "schedule", origin: "explicit" },
        ],
        authorize,
        read,
      })
    ).rejects.toBeInstanceOf(P2CompositeAuthorizationError);
    expect(read).not.toHaveBeenCalled();
  });

  it("omits an unauthorized default with one fixed warning and no read or inferred value", async () => {
    const read = vi.fn(async (component: string) => `${component}:value`);
    const result = await executeP2CompositeRead({
      selections: [
        { component: "leads", origin: "explicit" },
        { component: "schedule", origin: "default" },
      ],
      authorize: async (selection) => {
        if (selection.component === "schedule") {
          throw new P2ComponentAuthorizationDeniedError();
        }
        return `${selection.component}:authority`;
      },
      read,
    });

    expect(result).toEqual({
      components: [{ component: "leads", value: "leads:value" }],
      warnings: [{ code: "DEFAULT_COMPONENT_OMITTED", component: "schedule" }],
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("leads", "leads:authority");
  });

  it("propagates a default component's internal authorization failure with zero reads", async () => {
    const internalFailure = new Error("authorization repository unavailable");
    const read = vi.fn(async (component: string) => `${component}:value`);
    const operation = executeP2CompositeRead({
      selections: [
        { component: "leads", origin: "explicit" },
        { component: "schedule", origin: "default" },
      ],
      authorize: async (selection) => {
        if (selection.component === "schedule") throw internalFailure;
        return `${selection.component}:authority`;
      },
      read,
    });

    await expect(operation).rejects.toBe(internalFailure);
    expect(read).not.toHaveBeenCalled();
  });
});
