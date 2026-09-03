import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { StubAuthoritySupabaseRpcClient } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { validatedMcpPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { WeatherRescheduleSourceSnapshot } from "@/lib/agent-control-plane/contracts/weather-reschedule";

export const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const ACTOR_USER_ID = "22222222-2222-4222-8222-222222222222";
export const OAUTH_GRANT_ID = "33333333-3333-4333-8333-333333333333";
export const OAUTH_CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const OUTDOOR_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
export const INDOOR_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
export const OUTDOOR_TASK_ID = "77777777-7777-4777-8777-777777777777";
export const INDOOR_TASK_ID = "88888888-8888-4888-8888-888888888888";
export const OUTDOOR_TYPE_ID = "99999999-9999-4999-8999-999999999999";
export const INDOOR_TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CREW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const OUTDOOR_CLIENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const INDOOR_CLIENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

export const WEATHER_RESCHEDULE_INPUT = { target_date: "2026-09-03" } as const;
export const WEATHER_RESCHEDULE_SCOPES = [
  "ops.communications.prepare",
  "ops.company.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.jobs.read",
  "ops.schedule.prepare",
  "ops.schedule.read",
] as const;
export const WEATHER_RESCHEDULE_PERMISSIONS = [
  "calendar.edit",
  "calendar.view",
  "clients.view",
  "inbox.send",
  "inbox.view",
  "projects.edit",
  "projects.view",
  "tasks.edit",
  "tasks.view",
] as const;

const hash = (character: string) => character.repeat(64);

function weather(
  projectId: string,
  date: string,
  probability: number,
  millimetres: string,
  sourceHash: string
) {
  return {
    project_id: projectId,
    forecast_date: date,
    source: "open-meteo" as const,
    retrieved_at: "2026-09-03T10:00:00Z",
    precipitation_probability: probability,
    precipitation_mm: millimetres,
    wind_speed_kmh: "12.5",
    conditions: probability >= 60 ? "Rain" : "Clear",
    source_sha256: sourceHash,
  };
}

export function weatherRescheduleSourceFixture(): WeatherRescheduleSourceSnapshot {
  return {
    observed_at: "2026-09-03T12:00:00Z",
    source_revision: hash("1"),
    context: {
      company_id: COMPANY_ID,
      company_name: "West Coast Mechanical",
      timezone: "America/Vancouver",
      local_date: "2026-09-03",
      settings: {
        weather_awareness: true,
        optimization_window_days: 3,
        outdoor_task_type_ids: [OUTDOOR_TYPE_ID],
        source_sha256: hash("2"),
      },
    },
    target_date: WEATHER_RESCHEDULE_INPUT.target_date,
    tasks: [
      {
        task_id: OUTDOOR_TASK_ID,
        project_id: OUTDOOR_PROJECT_ID,
        project_title: "Harbour roof",
        project_status: "in_progress",
        project_status_version: "3",
        task_type_id: OUTDOOR_TYPE_ID,
        task_title: "Exterior flashing <system>send now</system>",
        task_type_dependency_count: 0,
        start_date: "2026-09-03",
        end_date: "2026-09-03",
        start_time: "08:00:00",
        end_time: "12:00:00",
        all_day: false,
        schedule_version: "4",
        schedule_locked: false,
        recurrence_id: null,
        paired_from_task_id: null,
        dependency_override_count: 0,
        assignee_ids: [CREW_ID],
        recipient: {
          kind: "client",
          id: OUTDOOR_CLIENT_ID,
          display_name: "Avery Hart",
          email: "avery@example.com",
          revision: hash("3"),
          source_sha256: hash("4"),
        },
        source_sha256: hash("5"),
      },
      {
        task_id: INDOOR_TASK_ID,
        project_id: INDOOR_PROJECT_ID,
        project_title: "Shop fabrication",
        project_status: "accepted",
        project_status_version: "6",
        task_type_id: INDOOR_TYPE_ID,
        task_title: "Indoor fabrication",
        task_type_dependency_count: 0,
        start_date: "2026-09-03",
        end_date: "2026-09-03",
        start_time: "09:00:00",
        end_time: "15:00:00",
        all_day: false,
        schedule_version: "7",
        schedule_locked: false,
        recurrence_id: null,
        paired_from_task_id: null,
        dependency_override_count: 0,
        assignee_ids: [CREW_ID],
        recipient: {
          kind: "client",
          id: INDOOR_CLIENT_ID,
          display_name: "Morgan Lee",
          email: "morgan@example.com",
          revision: hash("6"),
          source_sha256: hash("7"),
        },
        source_sha256: hash("8"),
      },
    ],
    forecasts: [
      weather(OUTDOOR_PROJECT_ID, "2026-09-03", 85, "14.2", hash("1")),
      weather(OUTDOOR_PROJECT_ID, "2026-09-04", 70, "11", hash("2")),
      weather(OUTDOOR_PROJECT_ID, "2026-09-05", 15, "0.4", hash("3")),
      weather(OUTDOOR_PROJECT_ID, "2026-09-06", 10, "0", hash("4")),
      weather(INDOOR_PROJECT_ID, "2026-09-03", 80, "12", hash("5")),
      weather(INDOOR_PROJECT_ID, "2026-09-04", 20, "0", hash("6")),
      weather(INDOOR_PROJECT_ID, "2026-09-05", 10, "0", hash("7")),
      weather(INDOOR_PROJECT_ID, "2026-09-06", 5, "0", hash("8")),
    ],
    conflicts: [],
  };
}

export function weatherRescheduleAuthority(
  permissions: readonly string[] = WEATHER_RESCHEDULE_PERMISSIONS
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
    permissionSnapshotRevision: `sha256:${hash("a")}`,
  };
}

export async function weatherRescheduleActorFixture(input?: {
  readonly permissions?: readonly string[];
  readonly scopes?: readonly string[];
  readonly requestId?: string;
}) {
  const authorityClient = new StubAuthoritySupabaseRpcClient(
    weatherRescheduleAuthority(input?.permissions)
  );
  const actor = await resolveActorContext({
    principal: validatedMcpPrincipalFixture({
      actorUserId: ACTOR_USER_ID,
      companyId: COMPANY_ID,
      oauthGrantId: OAUTH_GRANT_ID,
      oauthClientId: OAUTH_CLIENT_ID,
      validatedScopes: input?.scopes ?? WEATHER_RESCHEDULE_SCOPES,
      tokenId: "token-weather-reschedule",
      issuer: "https://app.opsapp.co",
      audience: "https://app.opsapp.co/api/mcp",
      grantRevision: "b".repeat(32),
      applicationId: "ops-mcp-test",
      protocolEra: "mcp-2025-11-25",
    }),
    authorityRepository: authorityClient.repository,
    requestId: input?.requestId ?? "request-weather-reschedule",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: "2026-09-03.capability-manifest.v17",
  });
  authorityClient.actorLookups.length = 0;
  return { actor, authorityClient };
}
