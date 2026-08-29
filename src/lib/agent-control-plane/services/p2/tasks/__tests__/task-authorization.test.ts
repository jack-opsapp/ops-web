import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetTaskContextInputSchema,
  ListTasksInputSchema,
} from "@/lib/agent-control-plane/contracts/tasks";
import {
  GET_TASK_CONTEXT_CANDIDATE,
  LIST_TASKS_CANDIDATE,
  selectedGetTaskContextVariantKeys,
  selectedListTasksVariantKeys,
} from "@/lib/agent-control-plane/registry/read-capabilities/p2/tasks";
import {
  authorizeGetTaskContextRead,
  authorizeListTasksRead,
  isAuthorizedGetTaskContextRead,
  isAuthorizedListTasksRead,
  TaskReadAuthorizationError,
} from "../task-authorization";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["66666666-6666-4666-8666-666666666666"],
    configuredPermissions: [
      "calendar.view",
      "estimates.view",
      "projects.view",
      "projects.view_financials",
      "tasks.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "own" },
      { permission: "estimates.view", scope: "assigned" },
      { permission: "projects.view", scope: "assigned" },
      { permission: "projects.view_financials", scope: "all" },
      { permission: "tasks.view", scope: "all" },
    ],
    permissionSnapshotRevision: `sha256:${"a".repeat(64)}`,
  };
}

async function context() {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      validatedScopes: [
        "ops.financial_documents.read",
        "ops.schedule.read",
        "ops.tasks.read",
      ],
      tokenId: "77777777-7777-4777-8777-777777777777",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-task-read",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
  });
}

async function authorizations(
  candidate: typeof LIST_TASKS_CANDIDATE | typeof GET_TASK_CONTEXT_CANDIDATE,
  keys: readonly string[]
) {
  const actorContext = await context();
  const policies = new Map(
    candidate.authorization.variants.map((variant) => [
      variant.key,
      variant.policy,
    ])
  );
  return Object.fromEntries(
    keys.map((key) => [
      key,
      authorizeCapability({ actorContext, policy: policies.get(key)! }),
    ])
  );
}

describe("P2 task candidate policies", () => {
  it("keeps list and detail reads dark, immutable, bounded, and compositional", () => {
    expect(LIST_TASKS_CANDIDATE).toMatchObject({
      name: "list_tasks",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      availability: { implementation: "available" },
      bounds: { maxResultItems: 25, maxOutputCharacters: 60_000 },
    });
    expect(GET_TASK_CONTEXT_CANDIDATE).toMatchObject({
      name: "get_task_context",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      availability: { implementation: "available" },
      bounds: { maxResultItems: 1, maxOutputCharacters: 60_000 },
    });
    expect(Object.isFrozen(LIST_TASKS_CANDIDATE)).toBe(true);
    expect(Object.isFrozen(GET_TASK_CONTEXT_CANDIDATE)).toBe(true);
  });

  it("selects schedule and financial variants only for their exact inputs", () => {
    expect(
      selectedListTasksVariantKeys(
        ListTasksInputSchema.parse({
          view: {
            kind: "schedule_window",
            starts_at: "2026-08-23T00:00:00.000Z",
            ends_before: "2026-08-24T00:00:00.000Z",
          },
        })
      )
    ).toEqual(["base", "schedule"]);
    expect(
      selectedGetTaskContextVariantKeys(
        GetTaskContextInputSchema.parse({
          task_ref: TASK_ID,
          sections: ["financial_origin", "material_readiness", "schedule"],
        })
      )
    ).toEqual(["base", "financial_origin", "schedule"]);
  });
});

describe("P2 task nominal authorization", () => {
  it("mints exact list authority with the tasks/projects AND intersection and schedule branch", async () => {
    const query = ListTasksInputSchema.parse({
      view: {
        kind: "schedule_window",
        starts_at: "2026-08-23T00:00:00.000Z",
        ends_before: "2026-08-24T00:00:00.000Z",
      },
    });
    const keys = selectedListTasksVariantKeys(query);
    const proof = authorizeListTasksRead({
      query,
      authorizations: await authorizations(LIST_TASKS_CANDIDATE, keys),
    });

    expect(isAuthorizedListTasksRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      capabilityId: "list_tasks",
      requiredOAuthScopes: ["ops.schedule.read", "ops.tasks.read"],
      tasksScope: "all",
      projectsScope: "assigned",
      calendarScope: "own",
      oauthGrantId: GRANT_ID,
      oauthClientId: CLIENT_ID,
      grantRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      variantKeys: ["base", "schedule"],
    });
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it("mints exact detail authority and never lets financial or schedule components borrow base authority", async () => {
    const query = GetTaskContextInputSchema.parse({
      task_ref: TASK_ID,
      sections: ["financial_origin", "schedule"],
    });
    const keys = selectedGetTaskContextVariantKeys(query);
    const exact = await authorizations(GET_TASK_CONTEXT_CANDIDATE, keys);
    const proof = authorizeGetTaskContextRead({ query, authorizations: exact });

    expect(isAuthorizedGetTaskContextRead(proof)).toBe(true);
    expect(proof).toMatchObject({
      requiredOAuthScopes: [
        "ops.financial_documents.read",
        "ops.schedule.read",
        "ops.tasks.read",
      ],
      tasksScope: "all",
      projectsScope: "assigned",
      calendarScope: "own",
      estimatesScope: "assigned",
      projectFinancialsScope: "all",
    });

    for (const invalid of [
      { base: exact.base, schedule: exact.schedule },
      { ...exact, financial_origin: exact.base },
      { ...exact, schedule: { ...exact.schedule } },
    ]) {
      expect(() =>
        authorizeGetTaskContextRead({ query, authorizations: invalid })
      ).toThrow(TaskReadAuthorizationError);
    }
  });
});
