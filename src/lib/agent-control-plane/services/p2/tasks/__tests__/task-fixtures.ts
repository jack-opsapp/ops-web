import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  GetTaskContextInputSchema,
  ListTasksInputSchema,
  TaskSummarySchema,
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
} from "../task-authorization";

export const TASK_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
export const TASK_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
export const TASK_ID = "33333333-3333-4333-8333-333333333333";
export const TASK_GRANT_ID = "44444444-4444-4444-8444-444444444444";
export const TASK_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
export const TASK_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
export const TASK_MEMBER_ID = "77777777-7777-4777-8777-777777777777";
export const TASK_PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
export const TASK_READ_AT = "2026-08-23T12:00:00.000Z";
export const TASK_SOURCE_REVISIONS = Object.freeze([
  { domain: "legacy_operational", source_revision: 8 },
  { domain: "tasks", source_revision: 13 },
] as const);

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: TASK_ACTOR_ID,
    companyId: TASK_COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["88888888-8888-4888-8888-888888888888"],
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
    permissionSnapshotRevision: TASK_PERMISSION_REVISION,
  };
}

async function taskActorContext() {
  return resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: TASK_ACTOR_ID,
      companyId: TASK_COMPANY_ID,
      oauthGrantId: TASK_GRANT_ID,
      oauthClientId: TASK_CLIENT_ID,
      validatedScopes: [
        "ops.financial_documents.read",
        "ops.schedule.read",
        "ops.tasks.read",
      ],
      tokenId: "99999999-9999-4999-8999-999999999999",
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

async function candidateAuthorizations(
  candidate: typeof LIST_TASKS_CANDIDATE | typeof GET_TASK_CONTEXT_CANDIDATE,
  keys: readonly string[]
) {
  const actorContext = await taskActorContext();
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

export async function listTasksAuthorization(rawQuery: unknown = {}) {
  const query = ListTasksInputSchema.parse(rawQuery);
  const keys = selectedListTasksVariantKeys(query);
  return authorizeListTasksRead({
    query,
    authorizations: await candidateAuthorizations(LIST_TASKS_CANDIDATE, keys),
  });
}

export async function taskContextAuthorization(
  rawQuery: unknown = {
    task_ref: TASK_ID,
  }
) {
  const query = GetTaskContextInputSchema.parse(rawQuery);
  const keys = selectedGetTaskContextVariantKeys(query);
  return authorizeGetTaskContextRead({
    query,
    authorizations: await candidateAuthorizations(
      GET_TASK_CONTEXT_CANDIDATE,
      keys
    ),
  });
}

export function taskSummary() {
  return TaskSummarySchema.parse({
    task_ref: { kind: "task", id: TASK_ID },
    job_ref: { kind: "project", id: TASK_PROJECT_ID },
    job_title: "Carly Hunter deck",
    title: "Install back-deck glass",
    task_type: { state: "recorded", display_name: "Installation" },
    priority: { state: "recorded", rank: 3 },
    state: "active",
    schedule_summary: {
      state: "scheduled",
      starts_on: "2026-08-25",
      ends_on: "2026-08-26",
      confirmation: "current",
    },
    assignees: [
      {
        team_member_ref: { kind: "team_member", id: TASK_MEMBER_ID },
        display_name: "Carly Hunter",
        content_kind: "untrusted_business_data",
      },
    ],
    content_kind: "untrusted_business_data",
  });
}
