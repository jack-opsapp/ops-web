import { describe, expect, it } from "vitest";
import { z } from "zod-v4";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  AgentErrorSchema,
  createAgentResultSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { AuthorizedScheduledJobsRead } from "../scheduled-jobs-authorization";
import type {
  ScheduledJobsRepository,
  ScheduledJobsSnapshot,
} from "../scheduled-jobs-repository";
import type {
  ScheduledJobsReadError,
  ScheduledJobsResult,
} from "../list-scheduled-jobs";
import { hashOperationalProjection } from "../operational-read-projection";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ONE_ID = "44444444-4444-4444-8444-444444444444";
const TASK_TWO_ID = "55555555-5555-4555-8555-555555555555";
const CREW_ID = "66666666-6666-4666-8666-666666666666";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const FIXED_NOW = "2026-08-12T18:00:00.000Z";
const READ_AT = "2026-08-12T17:59:59.000Z";
const SOURCE_FENCE_VERSION = "revision:41";
const CAPABILITY_ID = "list_scheduled_jobs";
const CURSOR_KEY = new Uint8Array(32).fill(7);

const INPUT = {
  from: "2026-10-31T00:00:00.000Z",
  to: "2026-11-03T00:00:00.000Z",
  task_statuses: ["active"],
  confirmation_states: ["confirmed", "unconfirmed"],
  display_timezone: "America/Vancouver",
  limit: 25,
} as const;

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

class StubScheduledJobsRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(private readonly results: RpcResult[]) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const result = this.results.shift();
    if (!result) throw new Error("Unexpected scheduled-jobs repository read");
    const request = Promise.resolve(result);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
  }
}

function authority(
  permissionSnapshotRevision = PERMISSION_REVISION
): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: ["calendar.view", "projects.view", "tasks.view"],
    effectivePermissions: [
      { permission: "calendar.view", scope: "all" },
      { permission: "projects.view", scope: "all" },
      { permission: "tasks.view", scope: "all" },
    ],
    permissionSnapshotRevision,
  };
}

async function actorContext(permissionSnapshotRevision = PERMISSION_REVISION) {
  return resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-scheduled-jobs",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(
      authority(permissionSnapshotRevision)
    ),
    requestId: "request-scheduled-jobs",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

async function authorizedRead(
  rawInput: unknown = INPUT,
  permissionSnapshotRevision = PERMISSION_REVISION
): Promise<AuthorizedScheduledJobsRead> {
  const actor = await actorContext(permissionSnapshotRevision);
  const resolved = resolveCapabilityAuthorization(CAPABILITY_ID, rawInput);
  const authorization = authorizeCapability({
    actorContext: actor,
    policy: resolved.variants[0]!.policy,
  });
  const { authorizeScheduledJobsRead } = await import(
    "../scheduled-jobs-authorization"
  );
  return authorizeScheduledJobsRead({ authorization, rawInput });
}

function sourceVersion(sourceType: string, sourceId: string, version: string) {
  return {
    source_domain: "operations",
    source_type: sourceType,
    source_id: sourceId,
    version,
  } as const;
}

function evidence(
  evidenceId: string,
  sourceType: string,
  sourceId: string,
  version: string,
  occurredAt: string
) {
  return {
    evidence_id: evidenceId,
    ...sourceVersion(sourceType, sourceId, version),
    occurred_at: occurredAt,
    relationship: "supports" as const,
    locator: `ops://evidence/${evidenceId}`,
    trust: "authoritative_ops" as const,
  };
}

function occurrence(input: {
  taskId: string;
  taskName: string;
  startUtc: string;
  startLocal: string;
  endUtc: string;
  endLocal: string;
  scheduleRevision: number;
  confirmationState: "confirmed" | "unconfirmed";
  locked: boolean;
  startOffsetMinutes?: number;
  endOffsetMinutes?: number;
}) {
  return {
    job_ref: { kind: "project" as const, id: PROJECT_ID },
    occurrence_ref: { kind: "project_task" as const, id: input.taskId },
    title: input.taskName,
    address: "1432 Marine Drive, North Vancouver, BC",
    task_status: "active" as const,
    confirmation_state: input.confirmationState,
    schedule_confirmed_at:
      input.confirmationState === "confirmed"
        ? "2026-08-12T17:30:00.000Z"
        : null,
    schedule_locked: input.locked,
    schedule_version: input.scheduleRevision,
    confirmed_schedule_version:
      input.confirmationState === "confirmed" ? input.scheduleRevision : null,
    task_updated_at: "2026-08-12T17:54:00.000Z",
    project_status: "accepted",
    project_status_version: 9,
    project_updated_at: "2026-08-12T17:55:00.000Z",
    timing_state: "upcoming" as const,
    schedule: {
      all_day: false,
      company_timezone: "America/Vancouver",
      local_start: input.startLocal,
      local_end_inclusive: input.endLocal,
      start_utc: input.startUtc,
      start_utc_offset_minutes: input.startOffsetMinutes ?? -420,
      start_pre_boundary_utc_offset_minutes: null,
      end_utc_exclusive: input.endUtc,
      end_utc_offset_minutes: input.endOffsetMinutes ?? -420,
      end_pre_boundary_utc_offset_minutes: null,
      display: {
        timezone: "America/Vancouver",
        local_start: input.startLocal,
        local_end_exclusive: input.endLocal,
        start_utc_offset_minutes: input.startOffsetMinutes ?? -420,
        end_utc_offset_minutes: input.endOffsetMinutes ?? -420,
      },
    },
    assignments: [
      {
        user_id: CREW_ID,
        display_name: "Maya Chen",
      },
    ],
    assignment_total: 1,
    assignments_omitted_count: 0,
  };
}

function validSnapshot(): ScheduledJobsSnapshot {
  const occurrences = [
    occurrence({
      taskId: TASK_ONE_ID,
      taskName: "Remove existing fascia",
      startUtc: "2026-11-01T11:30:00.000Z",
      startLocal: "2026-11-01T04:30:00",
      endUtc: "2026-11-01T12:30:00.000Z",
      endLocal: "2026-11-01T05:30:00",
      scheduleRevision: 7,
      confirmationState: "confirmed",
      locked: true,
    }),
    occurrence({
      taskId: TASK_TWO_ID,
      taskName: "Install replacement fascia",
      startUtc: "2026-11-02T17:00:00.000Z",
      startLocal: "2026-11-02T10:00:00",
      endUtc: "2026-11-02T21:00:00.000Z",
      endLocal: "2026-11-02T14:00:00",
      scheduleRevision: 3,
      confirmationState: "unconfirmed",
      locked: false,
    }),
  ];
  const sourceFence = sourceVersion(
    "operational_read_revision",
    "private.agent_operational_read_revisions",
    SOURCE_FENCE_VERSION
  );
  const projections = occurrences.map(
    (item) =>
      ({
        actor_user_id: ACTOR_ID,
        capability_id: CAPABILITY_ID,
        capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
        capability_revision: `${CAPABILITY_ID}:2026-08-07.v1`,
        company_id: COMPANY_ID,
        occurrence: item,
        permission_snapshot_revision: PERMISSION_REVISION,
        read_at: READ_AT,
        source_revision: 41,
      }) as const
  );
  const projectionHashes = projections.map(hashOperationalProjection);
  const projectionSources = occurrences.map((item, index) =>
    sourceVersion(
      "scheduled_job_occurrence_projection",
      item.occurrence_ref.id,
      `scheduled-job-occurrence-projection:v1:${projectionHashes[index]}`
    )
  );
  const sourceVersions = [sourceFence, ...projectionSources];
  const evidenceRefs = [
    {
      ...evidence(
        `evidence:scheduled_job_occurrence_projection:${TASK_ONE_ID}`,
        "scheduled_job_occurrence_projection",
        TASK_ONE_ID,
        projectionSources[0]!.version,
        READ_AT
      ),
      locator: `ops://projects/${PROJECT_ID}/tasks/${TASK_ONE_ID}`,
    },
    {
      ...evidence(
        `evidence:scheduled_job_occurrence_projection:${TASK_TWO_ID}`,
        "scheduled_job_occurrence_projection",
        TASK_TWO_ID,
        projectionSources[1]!.version,
        READ_AT
      ),
      locator: `ops://projects/${PROJECT_ID}/tasks/${TASK_TWO_ID}`,
    },
  ];

  const base = {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_fence: sourceVersions[0],
    company_timezone: "America/Vancouver",
    display_timezone: "America/Vancouver",
    occurrences,
    returned_occurrence_count: 2,
    next_cursor_claims: {
      source_revision: 41,
      start_utc: "2026-11-02T17:00:00.000Z",
      task_id: TASK_TWO_ID,
    },
    has_more: true,
    source_versions: sourceVersions,
    evidence: evidenceRefs,
  };
  const projectionProofs = occurrences.map((item, index) => {
    return {
      occurrence_ref: item.occurrence_ref,
      source_version: sourceVersions[index + 1]!,
      source_content_hash: projectionHashes[index]!,
      evidence_id: `evidence:scheduled_job_occurrence_projection:${item.occurrence_ref.id}`,
      projection: projections[index]!,
    };
  });
  return {
    ...base,
    occurrence_proofs: projectionProofs,
  } as ScheduledJobsSnapshot;
}

function reproofSnapshot(
  snapshot: ScheduledJobsSnapshot
): ScheduledJobsSnapshot {
  const sourceRevision = Number(snapshot.source_fence.version.slice(9));
  const projections = snapshot.occurrences.map(
    (item) =>
      ({
        actor_user_id: ACTOR_ID,
        capability_id: CAPABILITY_ID,
        capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
        capability_revision: `${CAPABILITY_ID}:2026-08-07.v1`,
        company_id: COMPANY_ID,
        occurrence: item,
        permission_snapshot_revision: PERMISSION_REVISION,
        read_at: snapshot.read_at,
        source_revision: sourceRevision,
      }) as const
  );
  const hashes = projections.map(hashOperationalProjection);
  const sources = snapshot.occurrences.map((item, index) =>
    sourceVersion(
      "scheduled_job_occurrence_projection",
      item.occurrence_ref.id,
      `scheduled-job-occurrence-projection:v1:${hashes[index]}`
    )
  );
  const evidenceRefs = snapshot.occurrences.map((item, index) => ({
    ...evidence(
      `evidence:scheduled_job_occurrence_projection:${item.occurrence_ref.id}`,
      "scheduled_job_occurrence_projection",
      item.occurrence_ref.id,
      sources[index]!.version,
      snapshot.read_at
    ),
    locator: `ops://projects/${item.job_ref.id}/tasks/${item.occurrence_ref.id}`,
  }));
  return {
    ...snapshot,
    occurrence_proofs: snapshot.occurrences.map((item, index) => ({
      occurrence_ref: item.occurrence_ref,
      source_version: sources[index]!,
      source_content_hash: hashes[index]!,
      evidence_id: evidenceRefs[index]!.evidence_id,
      projection: projections[index]!,
    })),
    source_versions: [snapshot.source_fence, ...sources],
    evidence: evidenceRefs,
  } as ScheduledJobsSnapshot;
}

function largeScheduledSnapshot(
  allOccurrences: readonly ReturnType<typeof occurrence>[],
  startIndex = 0
): ScheduledJobsSnapshot {
  const retained = allOccurrences.slice(startIndex);
  const sourceFence = sourceVersion(
    "operational_read_revision",
    "private.agent_operational_read_revisions",
    SOURCE_FENCE_VERSION
  );
  const projections = retained.map(
    (item) =>
      ({
        actor_user_id: ACTOR_ID,
        capability_id: CAPABILITY_ID,
        capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
        capability_revision: `${CAPABILITY_ID}:2026-08-07.v1`,
        company_id: COMPANY_ID,
        occurrence: item,
        permission_snapshot_revision: PERMISSION_REVISION,
        read_at: READ_AT,
        source_revision: 41,
      }) as const
  );
  const projectionHashes = projections.map(hashOperationalProjection);
  const projectionSources = retained.map((item, index) =>
    sourceVersion(
      "scheduled_job_occurrence_projection",
      item.occurrence_ref.id,
      `scheduled-job-occurrence-projection:v1:${projectionHashes[index]}`
    )
  );
  const projectionEvidence = retained.map((item, index) => ({
    ...evidence(
      `evidence:scheduled_job_occurrence_projection:${item.occurrence_ref.id}`,
      "scheduled_job_occurrence_projection",
      item.occurrence_ref.id,
      projectionSources[index]!.version,
      READ_AT
    ),
    locator: `ops://projects/${item.job_ref.id}/tasks/${item.occurrence_ref.id}`,
  }));

  return {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_fence: sourceFence,
    company_timezone: "America/Vancouver",
    display_timezone: "America/Vancouver",
    occurrences: retained,
    occurrence_proofs: retained.map((item, index) => ({
      occurrence_ref: item.occurrence_ref,
      source_version: projectionSources[index]!,
      source_content_hash: projectionHashes[index]!,
      evidence_id: projectionEvidence[index]!.evidence_id,
      projection: projections[index]!,
    })),
    returned_occurrence_count: retained.length,
    next_cursor_claims: null,
    has_more: false,
    source_versions: [sourceFence, ...projectionSources],
    evidence: projectionEvidence,
  } as ScheduledJobsSnapshot;
}

async function repositoryFor(client: StubScheduledJobsRpcClient) {
  const [
    { createOperationalReadCursorCodec },
    { createSupabaseScheduledJobsRepository },
  ] = await Promise.all([
    import("../operational-read-cursor"),
    import("../scheduled-jobs-repository"),
  ]);
  return createSupabaseScheduledJobsRepository(
    client,
    createOperationalReadCursorCodec({
      key: CURSOR_KEY,
      keyId: "test-key-1",
      version: 1,
      now: () => new Date(FIXED_NOW),
    })
  );
}

async function resultFor(input: {
  authorization: AuthorizedScheduledJobsRead;
  repository: ScheduledJobsRepository;
  signal?: AbortSignal;
}): Promise<ScheduledJobsResult> {
  const { listScheduledJobs } = await import("../list-scheduled-jobs");
  return listScheduledJobs({
    ...input,
    now: () => new Date(FIXED_NOW),
  });
}

async function repositoryErrorFrom(promise: Promise<unknown>) {
  const { ScheduledJobsRepositoryError } = await import(
    "../scheduled-jobs-repository"
  );
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduledJobsRepositoryError);
    return error as InstanceType<typeof ScheduledJobsRepositoryError>;
  }
  throw new Error("Expected a scheduled-jobs repository error");
}

async function serviceErrorFrom(promise: Promise<unknown>) {
  const { ScheduledJobsReadError: ErrorClass } = await import(
    "../list-scheduled-jobs"
  );
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorClass);
    return error as ScheduledJobsReadError;
  }
  throw new Error("Expected a scheduled-jobs service error");
}

describe("listScheduledJobs", () => {
  it("returns an empty terminal page with only the source fence proof", async () => {
    const snapshot = validSnapshot();
    const emptySnapshot: ScheduledJobsSnapshot = {
      ...snapshot,
      occurrences: [],
      occurrence_proofs: [],
      returned_occurrence_count: 0,
      next_cursor_claims: null,
      has_more: false,
      source_versions: [snapshot.source_fence],
      evidence: [],
    };
    const result = await resultFor({
      authorization: await authorizedRead(),
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: emptySnapshot, error: null }])
      ),
    });

    expect(result.data.occurrences).toEqual([]);
    expect(result.data.returned_occurrence_count).toBe(0);
    expect(result.freshness.source_versions).toEqual([
      emptySnapshot.source_fence,
    ]);
    expect(result.evidence).toEqual([]);
    expect(result.page).toEqual({ next_cursor: null, has_more: false });
  });

  it("stays within 60k and resumes at the first omitted occurrence without losing a row", async () => {
    const allOccurrences = Array.from({ length: 16 }, (_, index) => ({
      ...occurrence({
        taskId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        taskName: `Occurrence ${index + 1} ${"T".repeat(980)}`,
        startUtc: "2026-11-02T17:00:00.000Z",
        startLocal: "2026-11-02T10:00:00",
        endUtc: "2026-11-02T18:00:00.000Z",
        endLocal: "2026-11-02T11:00:00",
        scheduleRevision: index + 1,
        confirmationState: "unconfirmed",
        locked: false,
      }),
      address: "A".repeat(2_000),
    }));
    const firstClient = new StubScheduledJobsRpcClient([
      { data: largeScheduledSnapshot(allOccurrences), error: null },
    ]);
    const first = await resultFor({
      authorization: await authorizedRead(),
      repository: await repositoryFor(firstClient),
    });

    expect(JSON.stringify(first).length).toBeLessThanOrEqual(60_000);
    expect(first.data.occurrences.length).toBeGreaterThan(0);
    expect(first.data.occurrences.length).toBeLessThan(allOccurrences.length);
    expect(first.page).toMatchObject({ has_more: true });
    expect(first.page!.next_cursor!.length).toBeLessThanOrEqual(512);

    const consumed = first.data.occurrences.length;
    const secondClient = new StubScheduledJobsRpcClient([
      {
        data: largeScheduledSnapshot(allOccurrences, consumed),
        error: null,
      },
    ]);
    const second = await resultFor({
      authorization: await authorizedRead({
        ...INPUT,
        cursor: first.page!.next_cursor!,
      }),
      repository: await repositoryFor(secondClient),
    });

    expect(JSON.stringify(second).length).toBeLessThanOrEqual(60_000);
    expect(
      [...first.data.occurrences, ...second.data.occurrences].map(
        (item) => item.occurrence_ref.id
      )
    ).toEqual(allOccurrences.map((item) => item.occurrence_ref.id));
    expect(second.page).toEqual({ next_cursor: null, has_more: false });
    expect(secondClient.calls[0]!.args).toMatchObject({
      p_cursor_task_id:
        first.data.occurrences[first.data.occurrences.length - 1]!
          .occurrence_ref.id,
    });
  });

  it("returns bounded task occurrences with exact provenance, public-safe crew fields, and a stable continuation cursor", async () => {
    const snapshot = validSnapshot();
    const client = new StubScheduledJobsRpcClient([
      { data: snapshot, error: null },
      { data: snapshot, error: null },
    ]);
    const repository = await repositoryFor(client);
    const authorization = await authorizedRead();

    const first = await resultFor({ authorization, repository });
    const second = await resultFor({ authorization, repository });
    const ResultSchema = createAgentResultSchema(z.unknown());

    expect(ResultSchema.parse(first)).toEqual(first);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      contract_version: "2026-08-07.v1",
      request_id: "request-scheduled-jobs",
      generated_at: FIXED_NOW,
      company_id: COMPANY_ID,
      actor: {
        user_id: ACTOR_ID,
        permission_snapshot_revision: PERMISSION_REVISION,
      },
      freshness: {
        read_at: READ_AT,
        stale_after: null,
        source_versions: snapshot.source_versions,
      },
      data: {
        company_timezone: "America/Vancouver",
        display_timezone: "America/Vancouver",
        occurrences: snapshot.occurrences,
        returned_occurrence_count: 2,
      },
      page: {
        next_cursor: expect.stringMatching(/^ops_cursor:v1:/),
        has_more: true,
      },
      evidence: snapshot.evidence,
      warnings: [],
    });
    expect(first.data.occurrences).toHaveLength(2);
    expect(first.data.occurrences[0]!.schedule).toMatchObject({
      start_utc: "2026-11-01T11:30:00.000Z",
      start_utc_offset_minutes: -420,
      local_start: "2026-11-01T04:30:00",
      end_utc_exclusive: "2026-11-01T12:30:00.000Z",
      end_utc_offset_minutes: -420,
      local_end_inclusive: "2026-11-01T05:30:00",
      company_timezone: "America/Vancouver",
    });
    expect(first.data.occurrences[1]).toMatchObject({
      task_status: "active",
      timing_state: "upcoming",
      confirmation_state: "unconfirmed",
      schedule_confirmed_at: null,
      schedule_locked: false,
      schedule_version: 3,
    });
    expect(first.data.occurrences.length).toBeLessThanOrEqual(50);
    expect(first.evidence.length).toBeLessThanOrEqual(100);
    expect(first.freshness.source_versions.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(first)).not.toMatch(
      /email|phone|hourly|payroll|emergency_contact/i
    );
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]).toEqual(client.calls[1]);
    expect(client.calls[0]).toMatchObject({
      functionName: "read_agent_scheduled_jobs_as_system",
      args: {
        p_request_id: "request-scheduled-jobs",
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_permission_snapshot_revision: PERMISSION_REVISION,
        p_capability_id: CAPABILITY_ID,
        p_calendar_scope: "all",
        p_projects_scope: "all",
        p_tasks_scope: "all",
        p_from: INPUT.from,
        p_to: INPUT.to,
        p_task_statuses: ["active"],
        p_confirmation_states: ["confirmed", "unconfirmed"],
        p_display_timezone: "America/Vancouver",
        p_cursor_source_revision: null,
        p_cursor_start_utc: null,
        p_cursor_task_id: null,
        p_limit: 25,
      },
    });
    expect(client.calls[0]!.args).not.toHaveProperty("auth_channel");
    expect(client.calls[0]!.args).not.toHaveProperty("oauth_token");
    expect(client.calls[0]!.args).not.toHaveProperty("admin_bypass");
  });

  it("freezes authorized filter arrays so mutation cannot change the RPC query", async () => {
    const authorization = await authorizedRead();
    expect(Object.isFrozen(authorization.query.task_statuses)).toBe(true);
    expect(Object.isFrozen(authorization.query.confirmation_states)).toBe(true);
    expect(() =>
      (authorization.query.task_statuses as string[]).push("completed")
    ).toThrow(TypeError);
    expect(() =>
      (authorization.query.confirmation_states as string[]).splice(0, 1)
    ).toThrow(TypeError);
    const client = new StubScheduledJobsRpcClient([
      { data: validSnapshot(), error: null },
    ]);

    await resultFor({
      authorization,
      repository: await repositoryFor(client),
    });

    expect(client.calls[0]!.args).toMatchObject({
      p_task_statuses: ["active"],
      p_confirmation_states: ["confirmed", "unconfirmed"],
    });
  });

  it("materializes a requested display timezone separately across a civil-date boundary", async () => {
    const snapshot = validSnapshot();
    const displayed = reproofSnapshot({
      ...snapshot,
      display_timezone: "Asia/Tokyo",
      occurrences: [
        {
          ...snapshot.occurrences[0]!,
          schedule: {
            ...snapshot.occurrences[0]!.schedule,
            display: {
              timezone: "Asia/Tokyo",
              local_start: "2026-11-01T20:30:00.000",
              local_end_exclusive: "2026-11-01T21:30:00.000",
              start_utc_offset_minutes: 540,
              end_utc_offset_minutes: 540,
            },
          },
        },
        {
          ...snapshot.occurrences[1]!,
          schedule: {
            ...snapshot.occurrences[1]!.schedule,
            display: {
              timezone: "Asia/Tokyo",
              local_start: "2026-11-03T02:00:00.000",
              local_end_exclusive: "2026-11-03T06:00:00.000",
              start_utc_offset_minutes: 540,
              end_utc_offset_minutes: 540,
            },
          },
        },
      ],
    } as ScheduledJobsSnapshot);

    const result = await resultFor({
      authorization: await authorizedRead({
        ...INPUT,
        display_timezone: "Asia/Tokyo",
      }),
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: displayed, error: null }])
      ),
    });

    expect(result.data.occurrences[1]!.schedule.display).toEqual({
      timezone: "Asia/Tokyo",
      local_start: "2026-11-03T02:00:00.000",
      local_end_exclusive: "2026-11-03T06:00:00.000",
      start_utc_offset_minutes: 540,
      end_utc_offset_minutes: 540,
    });
    expect(result.data.occurrences[1]!.schedule.local_start).toBe(
      "2026-11-02T10:00:00"
    );
  });

  it.each([
    {
      name: "company UTC offset",
      mutate: (
        schedule: ScheduledJobsSnapshot["occurrences"][number]["schedule"]
      ) => ({
        ...schedule,
        start_utc_offset_minutes: -480,
      }),
    },
    {
      name: "nested display timezone",
      mutate: (
        schedule: ScheduledJobsSnapshot["occurrences"][number]["schedule"]
      ) => ({
        ...schedule,
        display: { ...schedule.display, timezone: "America/Toronto" },
      }),
    },
  ])(
    "rejects a self-hashed proof with inconsistent $name",
    async ({ mutate }) => {
      const snapshot = validSnapshot();
      const malformed = reproofSnapshot({
        ...snapshot,
        occurrences: [
          {
            ...snapshot.occurrences[0]!,
            schedule: mutate(snapshot.occurrences[0]!.schedule),
          },
          snapshot.occurrences[1]!,
        ],
      } as ScheduledJobsSnapshot);
      const client = new StubScheduledJobsRpcClient([
        { data: malformed, error: null },
      ]);

      const error = await repositoryErrorFrom(
        (await repositoryFor(client)).read({
          authorization: await authorizedRead(),
        })
      );

      expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
      expect(client.calls).toHaveLength(1);
    }
  );

  it.each([
    {
      name: "occurrences",
      mutate: (snapshot: ScheduledJobsSnapshot) => ({
        ...snapshot,
        occurrences: Array.from({ length: 51 }, (_, index) => ({
          ...snapshot.occurrences[0]!,
          occurrence_ref: {
            kind: "project_task" as const,
            id: `task-overflow-${index}`,
          },
        })),
        returned_occurrence_count: 51,
      }),
    },
    {
      name: "evidence",
      mutate: (snapshot: ScheduledJobsSnapshot) => ({
        ...snapshot,
        evidence: Array.from({ length: 101 }, (_, index) =>
          evidence(
            `evidence:overflow:${index}`,
            "project_task",
            `task-overflow-${index}`,
            `revision:${index}`,
            "2026-08-12T17:00:00.000Z"
          )
        ),
      }),
    },
    {
      name: "source versions",
      mutate: (snapshot: ScheduledJobsSnapshot) => ({
        ...snapshot,
        source_versions: Array.from({ length: 101 }, (_, index) =>
          sourceVersion(
            "project_task",
            `task-overflow-${index}`,
            `revision:${index}`
          )
        ),
      }),
    },
  ])(
    "rejects an RPC snapshot whose $name exceed the prompt-safe envelope bound",
    async ({ mutate }) => {
      const client = new StubScheduledJobsRpcClient([
        { data: mutate(validSnapshot()), error: null },
      ]);
      const repository = await repositoryFor(client);
      const authorization = await authorizedRead();

      const error = await repositoryErrorFrom(
        repository.read({ authorization })
      );

      expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
      expect(error.message).toBe("SCHEDULED_JOBS_INVALID");
      expect(client.calls).toHaveLength(1);
    }
  );

  it("rejects a company-local fold that SQL has not already resolved into a self-consistent proof", async () => {
    const snapshot = validSnapshot();
    const ambiguous = {
      ...snapshot,
      occurrences: [
        {
          ...snapshot.occurrences[0]!,
          schedule: {
            ...snapshot.occurrences[0]!.schedule,
            local_start: "2026-11-01T01:30:00",
            local_end_inclusive: "2026-11-01T02:30:00",
            start_utc: "2026-11-01T08:30:00.000Z",
            end_utc_exclusive: "2026-11-01T10:30:00.000Z",
            display: {
              ...snapshot.occurrences[0]!.schedule.display,
              local_start: "2026-11-01T01:30:00",
              local_end_exclusive: "2026-11-01T02:30:00",
            },
          },
        },
      ],
    };
    const client = new StubScheduledJobsRpcClient([
      { data: ambiguous, error: null },
    ]);
    const repository = await repositoryFor(client);
    const authorization = await authorizedRead();

    const error = await repositoryErrorFrom(repository.read({ authorization }));

    expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
    expect(client.calls).toHaveLength(1);
  });

  it("accepts permanent UTC-7 Vancouver after the 2026 law change without inventing a fall fold", async () => {
    const snapshot = validSnapshot();
    const allDayOccurrence = {
      ...snapshot.occurrences[0]!,
      schedule: {
        ...snapshot.occurrences[0]!.schedule,
        all_day: true,
        local_start: "2026-11-01T00:00:00",
        local_end_inclusive: "2026-11-01T23:59:59.999999",
        start_utc: "2026-11-01T07:00:00.000Z",
        start_utc_offset_minutes: -420,
        start_pre_boundary_utc_offset_minutes: -420,
        end_utc_exclusive: "2026-11-02T07:00:00.000Z",
        end_utc_offset_minutes: -420,
        end_pre_boundary_utc_offset_minutes: -420,
        display: {
          timezone: "America/Vancouver",
          local_start: "2026-11-01T00:00:00.000",
          local_end_exclusive: "2026-11-02T00:00:00.000",
          start_utc_offset_minutes: -420,
          end_utc_offset_minutes: -420,
        },
      },
    };
    const allDay = reproofSnapshot({
      ...snapshot,
      occurrences: [allDayOccurrence, snapshot.occurrences[1]!],
    } as ScheduledJobsSnapshot);
    const client = new StubScheduledJobsRpcClient([
      { data: allDay, error: null },
    ]);
    const repository = await repositoryFor(client);

    const result = await resultFor({
      authorization: await authorizedRead(),
      repository,
    });

    expect(
      Date.parse(result.data.occurrences[0]!.schedule.end_utc_exclusive) -
        Date.parse(result.data.occurrences[0]!.schedule.start_utc)
    ).toBe(24 * 60 * 60 * 1_000);
  });

  it("accepts a 23-hour all-day occurrence across the spring DST transition", async () => {
    const snapshot = validSnapshot();
    const springOccurrence = {
      ...snapshot.occurrences[0]!,
      timing_state: "past_due" as const,
      schedule: {
        ...snapshot.occurrences[0]!.schedule,
        all_day: true,
        local_start: "2026-03-08T00:00:00",
        local_end_inclusive: "2026-03-08T23:59:59.999999",
        start_utc: "2026-03-08T08:00:00.000Z",
        start_utc_offset_minutes: -480,
        start_pre_boundary_utc_offset_minutes: -480,
        end_utc_exclusive: "2026-03-09T07:00:00.000Z",
        end_utc_offset_minutes: -420,
        end_pre_boundary_utc_offset_minutes: -420,
        display: {
          timezone: "America/Vancouver",
          local_start: "2026-03-08T00:00:00.000",
          local_end_exclusive: "2026-03-09T00:00:00.000",
          start_utc_offset_minutes: -480,
          end_utc_offset_minutes: -420,
        },
      },
    };
    const spring = reproofSnapshot({
      ...snapshot,
      occurrences: [springOccurrence],
      returned_occurrence_count: 1,
      next_cursor_claims: null,
      has_more: false,
    } as ScheduledJobsSnapshot);
    const result = await resultFor({
      authorization: await authorizedRead({
        ...INPUT,
        from: "2026-03-07T00:00:00.000Z",
        to: "2026-03-10T00:00:00.000Z",
      }),
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: spring, error: null }])
      ),
    });

    expect(
      Date.parse(result.data.occurrences[0]!.schedule.end_utc_exclusive) -
        Date.parse(result.data.occurrences[0]!.schedule.start_utc)
    ).toBe(23 * 60 * 60 * 1_000);
  });

  it("accepts an all-day civil-date boundary whose local midnight is skipped", async () => {
    const snapshot = validSnapshot();
    const gapOccurrence = {
      ...snapshot.occurrences[0]!,
      schedule: {
        ...snapshot.occurrences[0]!.schedule,
        all_day: true,
        company_timezone: "America/Santiago",
        local_start: "2026-09-06T00:00:00",
        local_end_inclusive: "2026-09-06T23:59:59.999999",
        start_utc: "2026-09-06T04:00:00.000Z",
        start_utc_offset_minutes: -180,
        start_pre_boundary_utc_offset_minutes: -240,
        end_utc_exclusive: "2026-09-07T03:00:00.000Z",
        end_utc_offset_minutes: -180,
        end_pre_boundary_utc_offset_minutes: -180,
        display: {
          timezone: "America/Santiago",
          local_start: "2026-09-06T01:00:00.000",
          local_end_exclusive: "2026-09-07T00:00:00.000",
          start_utc_offset_minutes: -180,
          end_utc_offset_minutes: -180,
        },
      },
    };
    const gap = reproofSnapshot({
      ...snapshot,
      company_timezone: "America/Santiago",
      display_timezone: "America/Santiago",
      occurrences: [gapOccurrence],
      returned_occurrence_count: 1,
      next_cursor_claims: null,
      has_more: false,
    } as ScheduledJobsSnapshot);

    const result = await resultFor({
      authorization: await authorizedRead({
        ...INPUT,
        from: "2026-09-05T00:00:00.000Z",
        to: "2026-09-08T00:00:00.000Z",
        display_timezone: "America/Santiago",
      }),
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: gap, error: null }])
      ),
    });

    expect(result.data.occurrences[0]!.schedule.start_utc).toBe(
      "2026-09-06T04:00:00.000Z"
    );
  });

  it("accepts only the first representable instant of a folded all-day midnight", async () => {
    const snapshot = validSnapshot();
    const firstFoldOccurrence = {
      ...snapshot.occurrences[0]!,
      schedule: {
        ...snapshot.occurrences[0]!.schedule,
        all_day: true,
        company_timezone: "America/Havana",
        local_start: "2026-11-01T00:00:00",
        local_end_inclusive: "2026-11-01T23:59:59.999999",
        start_utc: "2026-11-01T04:00:00.000Z",
        start_utc_offset_minutes: -240,
        start_pre_boundary_utc_offset_minutes: -240,
        end_utc_exclusive: "2026-11-02T05:00:00.000Z",
        end_utc_offset_minutes: -300,
        end_pre_boundary_utc_offset_minutes: -300,
        display: {
          timezone: "America/Havana",
          local_start: "2026-11-01T00:00:00.000",
          local_end_exclusive: "2026-11-02T00:00:00.000",
          start_utc_offset_minutes: -240,
          end_utc_offset_minutes: -300,
        },
      },
    };
    const firstFold = reproofSnapshot({
      ...snapshot,
      company_timezone: "America/Havana",
      display_timezone: "America/Havana",
      occurrences: [firstFoldOccurrence],
      returned_occurrence_count: 1,
      next_cursor_claims: null,
      has_more: false,
    } as ScheduledJobsSnapshot);
    const authorization = await authorizedRead({
      ...INPUT,
      from: "2026-10-31T00:00:00.000Z",
      to: "2026-11-03T00:00:00.000Z",
      display_timezone: "America/Havana",
    });

    const result = await resultFor({
      authorization,
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: firstFold, error: null }])
      ),
    });
    expect(result.data.occurrences[0]!.schedule.start_utc).toBe(
      "2026-11-01T04:00:00.000Z"
    );

    const secondFold = reproofSnapshot({
      ...firstFold,
      occurrences: [
        {
          ...firstFoldOccurrence,
          schedule: {
            ...firstFoldOccurrence.schedule,
            start_utc: "2026-11-01T05:00:00.000Z",
            start_utc_offset_minutes: -300,
            start_pre_boundary_utc_offset_minutes: -240,
            display: {
              ...firstFoldOccurrence.schedule.display,
              start_utc_offset_minutes: -300,
            },
          },
        },
      ],
    } as ScheduledJobsSnapshot);
    const error = await repositoryErrorFrom(
      (
        await repositoryFor(
          new StubScheduledJobsRpcClient([{ data: secondFold, error: null }])
        )
      ).read({ authorization })
    );

    expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
  });

  it("rejects an all-day proof whose exclusive end is noon instead of next local midnight", async () => {
    const snapshot = validSnapshot();
    const malformedOccurrence = {
      ...snapshot.occurrences[0]!,
      schedule: {
        ...snapshot.occurrences[0]!.schedule,
        all_day: true,
        local_start: "2026-11-01T00:00:00",
        local_end_inclusive: "2026-11-01T23:59:59.999999",
        start_utc: "2026-11-01T07:00:00.000Z",
        start_pre_boundary_utc_offset_minutes: -420,
        end_utc_exclusive: "2026-11-01T20:00:00.000Z",
        end_pre_boundary_utc_offset_minutes: -420,
        display: {
          ...snapshot.occurrences[0]!.schedule.display,
          local_start: "2026-11-01T00:00:00.000",
          local_end_exclusive: "2026-11-01T13:00:00.000",
        },
      },
    };
    const malformed = reproofSnapshot({
      ...snapshot,
      occurrences: [malformedOccurrence],
      returned_occurrence_count: 1,
      next_cursor_claims: null,
      has_more: false,
    } as ScheduledJobsSnapshot);
    const client = new StubScheduledJobsRpcClient([
      { data: malformed, error: null },
    ]);

    const error = await repositoryErrorFrom(
      (await repositoryFor(client)).read({
        authorization: await authorizedRead(),
      })
    );

    expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
    expect(client.calls).toHaveLength(1);
  });

  it("accepts an occurrence that starts before the window and overlaps its half-open lower boundary", async () => {
    const snapshot = validSnapshot();
    const spanningOccurrence = {
      ...snapshot.occurrences[0]!,
      schedule: {
        ...snapshot.occurrences[0]!.schedule,
        local_start: "2026-10-30T16:00:00",
        local_end_inclusive: "2026-10-30T18:00:00",
        start_utc: "2026-10-30T23:00:00.000Z",
        end_utc_exclusive: "2026-10-31T01:00:00.000Z",
        display: {
          ...snapshot.occurrences[0]!.schedule.display,
          local_start: "2026-10-30T16:00:00",
          local_end_exclusive: "2026-10-30T18:00:00",
        },
      },
    };
    const spanning = reproofSnapshot({
      ...snapshot,
      occurrences: [spanningOccurrence, snapshot.occurrences[1]!],
    } as ScheduledJobsSnapshot);
    const result = await resultFor({
      authorization: await authorizedRead(),
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: spanning, error: null }])
      ),
    });

    expect(result.data.occurrences[0]!.occurrence_ref.id).toBe(TASK_ONE_ID);
  });

  it("accepts a timed overnight occurrence only when its local end materializes on the next day", async () => {
    const snapshot = validSnapshot();
    const overnightOccurrence = {
      ...snapshot.occurrences[1]!,
      schedule: {
        ...snapshot.occurrences[1]!.schedule,
        local_start: "2026-11-02T22:00:00",
        local_end_inclusive: "2026-11-03T02:00:00",
        start_utc: "2026-11-03T05:00:00.000Z",
        end_utc_exclusive: "2026-11-03T09:00:00.000Z",
        display: {
          ...snapshot.occurrences[1]!.schedule.display,
          local_start: "2026-11-02T22:00:00",
          local_end_exclusive: "2026-11-03T02:00:00",
        },
      },
    };
    const overnight = reproofSnapshot({
      ...snapshot,
      occurrences: [snapshot.occurrences[0]!, overnightOccurrence],
      next_cursor_claims: {
        source_revision: 41,
        start_utc: overnightOccurrence.schedule.start_utc,
        task_id: TASK_TWO_ID,
      },
    } as ScheduledJobsSnapshot);
    const result = await resultFor({
      authorization: await authorizedRead({
        ...INPUT,
        to: "2026-11-04T00:00:00.000Z",
      }),
      repository: await repositoryFor(
        new StubScheduledJobsRpcClient([{ data: overnight, error: null }])
      ),
    });

    expect(result.data.occurrences[1]!.schedule).toMatchObject({
      local_start: "2026-11-02T22:00:00",
      local_end_inclusive: "2026-11-03T02:00:00",
    });
  });

  it.each([
    [
      "title",
      (item: ScheduledJobsSnapshot["occurrences"][number]) => ({
        ...item,
        title: "Changed title",
      }),
    ],
    [
      "address",
      (item: ScheduledJobsSnapshot["occurrences"][number]) => ({
        ...item,
        address: "999 Changed Road",
      }),
    ],
    [
      "schedule",
      (item: ScheduledJobsSnapshot["occurrences"][number]) => ({
        ...item,
        schedule: {
          ...item.schedule,
          end_utc_exclusive: "2026-11-01T13:30:00.000Z",
          local_end_inclusive: "2026-11-01T05:30:00",
        },
      }),
    ],
    [
      "assignment",
      (item: ScheduledJobsSnapshot["occurrences"][number]) => ({
        ...item,
        assignments: [
          { ...item.assignments[0]!, display_name: "Changed Name" },
        ],
      }),
    ],
    [
      "project state",
      (item: ScheduledJobsSnapshot["occurrences"][number]) => ({
        ...item,
        project_status_version: item.project_status_version + 1,
      }),
    ],
  ])(
    "rejects %s claim drift from its exact projection proof",
    async (_name, mutate) => {
      const snapshot = validSnapshot();
      const client = new StubScheduledJobsRpcClient([
        {
          data: {
            ...snapshot,
            occurrences: [
              mutate(snapshot.occurrences[0]!),
              snapshot.occurrences[1]!,
            ],
          },
          error: null,
        },
      ]);
      const repository = await repositoryFor(client);

      const error = await repositoryErrorFrom(
        repository.read({ authorization: await authorizedRead() })
      );

      expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
    }
  );

  it("maps a source-fence mismatch during continuation to a typed stale-context error", async () => {
    const currentFence = sourceVersion(
      "operational_read_revision",
      "private.agent_operational_read_revisions",
      "revision:42"
    );
    const client = new StubScheduledJobsRpcClient([
      {
        data: null,
        error: {
          code: "40001",
          message: "agent_operational_read_cursor_stale",
          details: JSON.stringify(currentFence),
        },
      },
    ]);
    const repository = await repositoryFor(client);
    const firstPageAuthorization = await authorizedRead();
    const firstPageClient = new StubScheduledJobsRpcClient([
      { data: validSnapshot(), error: null },
    ]);
    const firstPageRepository = await repositoryFor(firstPageClient);
    const firstPage = await resultFor({
      authorization: firstPageAuthorization,
      repository: firstPageRepository,
    });
    const cursor = firstPage.page!.next_cursor!;
    const authorization = await authorizedRead({
      ...INPUT,
      cursor,
    });

    const error = await serviceErrorFrom(
      resultFor({ authorization, repository })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: "request-scheduled-jobs",
      code: "STALE_CONTEXT",
      message: "The schedule changed during pagination.",
      retryable: true,
      details: { current_source_versions: [currentFence] },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.args).toMatchObject({
      p_cursor_source_revision: 41,
      p_cursor_start_utc: "2026-11-02T17:00:00.000Z",
      p_cursor_task_id: TASK_TWO_ID,
    });
    expect(client.calls[0]!.args).not.toHaveProperty("p_cursor");
  });

  it("maps a signed cursor's current permission change to stale context before any RPC", async () => {
    const firstClient = new StubScheduledJobsRpcClient([
      { data: validSnapshot(), error: null },
    ]);
    const first = await resultFor({
      authorization: await authorizedRead(),
      repository: await repositoryFor(firstClient),
    });
    const currentPermissionRevision = `sha256:${"d".repeat(64)}`;
    const authorization = await authorizedRead(
      { ...INPUT, cursor: first.page!.next_cursor! },
      currentPermissionRevision
    );
    const client = new StubScheduledJobsRpcClient([]);

    const error = await serviceErrorFrom(
      resultFor({
        authorization,
        repository: await repositoryFor(client),
      })
    );

    expect(error.toAgentError()).toMatchObject({
      code: "STALE_CONTEXT",
      details: {
        current_source_versions: [
          {
            source_domain: "authorization",
            source_type: "actor_permission_snapshot",
            source_id: ACTOR_ID,
            version: currentPermissionRevision,
          },
        ],
      },
    });
    expect(client.calls).toHaveLength(0);
  });

  it.each([
    {
      name: "signature",
      cursor: (value: string) => `${value.slice(0, -1)}x`,
      input: (value: typeof INPUT) => value,
    },
    {
      name: "filter binding",
      cursor: (value: string) => value,
      input: (value: typeof INPUT) => ({
        ...value,
        confirmation_states: ["confirmed" as const],
      }),
    },
    {
      name: "timezone binding",
      cursor: (value: string) => value,
      input: (value: typeof INPUT) => ({
        ...value,
        display_timezone: "America/Toronto",
      }),
    },
  ])(
    "rejects a continuation cursor with mismatched $name before the RPC",
    async ({ cursor: mutateCursor, input: mutateInput }) => {
      const firstPageClient = new StubScheduledJobsRpcClient([
        { data: validSnapshot(), error: null },
      ]);
      const firstPageRepository = await repositoryFor(firstPageClient);
      const firstPage = await resultFor({
        authorization: await authorizedRead(),
        repository: firstPageRepository,
      });
      const client = new StubScheduledJobsRpcClient([]);
      const repository = await repositoryFor(client);
      const cursor = mutateCursor(firstPage.page!.next_cursor!);
      const authorization = await authorizedRead({
        ...mutateInput(INPUT),
        cursor,
      });

      const error = await repositoryErrorFrom(
        repository.read({ authorization })
      );

      expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
      expect(client.calls).toHaveLength(0);
    }
  );

  it("rejects a cloned authorization proof before the RPC boundary", async () => {
    const client = new StubScheduledJobsRpcClient([]);
    const repository = await repositoryFor(client);
    const authorization = await authorizedRead();

    const error = await repositoryErrorFrom(
      repository.read({
        authorization: { ...authorization } as AuthorizedScheduledJobsRead,
      })
    );

    expect(error.code).toBe("SCHEDULED_JOBS_INVALID");
    expect(client.calls).toHaveLength(0);
  });

  it("passes a live abort signal to the RPC and fails an already-aborted read without materializing data", async () => {
    const snapshot = validSnapshot();
    const client = new StubScheduledJobsRpcClient([
      { data: snapshot, error: null },
    ]);
    const repository = await repositoryFor(client);
    const authorization = await authorizedRead();
    const liveController = new AbortController();

    await resultFor({
      authorization,
      repository,
      signal: liveController.signal,
    });

    expect(client.abortSignals).toEqual([liveController.signal]);

    const abortedController = new AbortController();
    abortedController.abort("caller cancelled");
    const error = await serviceErrorFrom(
      resultFor({
        authorization,
        repository,
        signal: abortedController.signal,
      })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toMatchObject({
      request_id: "request-scheduled-jobs",
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
    expect(client.calls).toHaveLength(1);
  });

  it("maps unexpected database failures to a privacy-safe typed error", async () => {
    const client = new StubScheduledJobsRpcClient([
      {
        data: null,
        error: {
          code: "XX000",
          message: "secret database path /private/project_tasks leaked row 123",
        },
      },
    ]);
    const repository = await repositoryFor(client);
    const authorization = await authorizedRead();

    const error = await serviceErrorFrom(
      resultFor({ authorization, repository })
    );
    const agentError = AgentErrorSchema.parse(error.toAgentError());

    expect(agentError).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: "request-scheduled-jobs",
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Schedule context is temporarily unavailable.",
      retryable: true,
    });
    expect(JSON.stringify(agentError)).not.toMatch(/secret|project_tasks|123/i);
  });
});
