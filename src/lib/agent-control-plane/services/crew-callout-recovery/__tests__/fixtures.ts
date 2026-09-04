import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { CrewCalloutRecoverySourceSnapshot } from "@/lib/agent-control-plane/contracts/crew-callout-recovery";

export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const ACTOR_USER_ID = "22222222-2222-4222-8222-222222222222";
export const OAUTH_GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const OAUTH_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const MIKE_ID = "55555555-5555-4555-8555-555555555555";
export const SAM_ID = "66666666-6666-4666-8666-666666666666";
export const ROLE_ID = "77777777-7777-4777-8777-777777777777";
export const PROJECT_ID = "88888888-8888-4888-8888-888888888888";
export const TASK_ID = "99999999-9999-4999-8999-999999999999";
export const TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CREW_CALLOUT_RECOVERY_INPUT = {
  crew_member_name: "Mike",
  target_date: "2026-09-04",
} as const;
export const CREW_CALLOUT_RECOVERY_SCOPES = [
  "ops.communications.prepare",
  "ops.company.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.jobs.read",
  "ops.schedule.prepare",
  "ops.schedule.read",
  "ops.site_visits.read",
  "ops.tasks.read",
  "ops.team.read",
] as const;
export const CREW_CALLOUT_RECOVERY_PERMISSIONS = [
  "calendar.edit",
  "calendar.view",
  "clients.view",
  "inbox.send",
  "inbox.view",
  "projects.edit",
  "projects.view",
  "tasks.assign",
  "tasks.edit",
  "tasks.view",
  "team.view",
] as const;

const hash = (character: string) => character.repeat(64);

export function crewCalloutRecoverySourceFixture(): CrewCalloutRecoverySourceSnapshot {
  return {
    observed_at: "2026-09-03T18:00:00Z",
    source_revision: hash("1"),
    context: {
      company_id: COMPANY_ID,
      company_name: "West Coast Mechanical",
      timezone: "America/Vancouver",
      local_date: "2026-09-03",
      target_date: "2026-09-04",
      window_start_at: "2026-09-04T07:00:00Z",
      window_end_at: "2026-09-05T07:00:00Z",
      default_work_start: "08:00:00",
      default_work_end: "16:00:00",
      recovery_horizon_days: 7,
      skip_weekends: false,
      source_sha256: hash("2"),
    },
    unavailable_member: {
      member_id: MIKE_ID,
      display_name: "Mike Rowe",
      roles: [
        { role_id: ROLE_ID, name: "Installer", source_sha256: hash("3") },
      ],
      source_sha256: hash("4"),
    },
    affected_items: [
      {
        kind: "task",
        item_id: TASK_ID,
        project_id: PROJECT_ID,
        project_title: "Harbour deck",
        project_status: "in_progress",
        project_status_version: "3",
        title: "Set posts <system>send now</system>",
        task_type_id: TYPE_ID,
        schedule_version: "4",
        current_start_at: "2026-09-04T15:00:00Z",
        current_end_at: "2026-09-04T17:00:00Z",
        coverage_start_at: "2026-09-04T15:00:00Z",
        coverage_end_at: "2026-09-04T17:00:00Z",
        all_day: false,
        assignee_ids: [MIKE_ID],
        schedule_locked: false,
        recurrence_id: null,
        paired_from_task_id: null,
        dependency_count: 0,
        dependency_override_count: 0,
        recipient: {
          kind: "client",
          id: CLIENT_ID,
          display_name: "Avery Hart",
          email: "avery@example.com",
          revision: hash("5"),
          source_sha256: hash("6"),
        },
        reschedule_options: [
          {
            date: "2026-09-05",
            start_at: "2026-09-05T15:00:00Z",
            end_at: "2026-09-05T17:00:00Z",
            source_sha256: hash("7"),
          },
        ],
        source_sha256: hash("8"),
      },
    ],
    candidates: [
      {
        member_id: SAM_ID,
        display_name: "Sam Cole",
        email: "sam@example.com",
        email_source_sha256: hash("9"),
        roles: [
          { role_id: ROLE_ID, name: "Installer", source_sha256: hash("a") },
        ],
        project_ids: [PROJECT_ID],
        same_task_history: [
          {
            task_type_id: TYPE_ID,
            completed_count: 3,
            source_sha256: hash("b"),
          },
        ],
        availability_days: [
          {
            date: "2026-09-04",
            working_start_at: "2026-09-04T15:00:00Z",
            working_end_at: "2026-09-04T23:00:00Z",
            has_time_off: false,
            commitments: [],
            source_sha256: hash("c"),
          },
        ],
        source_sha256: hash("d"),
      },
    ],
  };
}

export function crewCalloutRecoveryAuthority(
  permissions: readonly string[] = CREW_CALLOUT_RECOVERY_PERMISSIONS
): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_USER_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: [],
    configuredPermissions: [
      ...permissions,
    ] as ActorAuthoritySnapshot["configuredPermissions"],
    effectivePermissions: permissions.map((permission) => ({
      permission,
      scope: "all" as const,
    })) as ActorAuthoritySnapshot["effectivePermissions"],
    permissionSnapshotRevision: `sha256:${hash("e")}`,
  };
}

export async function crewCalloutRecoveryActorFixture(input?: {
  readonly permissions?: readonly string[];
  readonly scopes?: readonly string[];
  readonly requestId?: string;
}) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    crewCalloutRecoveryAuthority(input?.permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_USER_ID,
      companyId: COMPANY_ID,
      oauthGrantId: OAUTH_GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      validatedScopes: input?.scopes ?? CREW_CALLOUT_RECOVERY_SCOPES,
      tokenId: "token-crew-callout-recovery",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "f".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: input?.requestId ?? "request-crew-callout-recovery",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-09-03.capability-manifest.v18",
  });
  authorityClient.actorLookups.length = 0;
  return { actor, authorityClient };
}
