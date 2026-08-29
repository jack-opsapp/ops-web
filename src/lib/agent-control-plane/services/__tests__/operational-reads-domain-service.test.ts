import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod-v4";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import {
  resolveActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  AgentErrorSchema,
  createAgentResultSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_REVISION,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V1 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import {
  createOpsAgentDomainService,
  type CreateOpsAgentDomainServiceInput,
} from "../create-domain-service";
import type {
  DomainCallOptions,
  JobReadinessIssuesInput,
  ListScheduledJobsInput,
  OpsAgentDomainService,
} from "../domain-service";
import type { JobReadinessResult } from "../list-job-readiness-issues";
import type { ScheduledJobsResult } from "../list-scheduled-jobs";
import {
  createOpsAgentDomainRepositories,
  type CreateOpsAgentDomainRepositoriesInput,
  type OpsAgentDomainRepositories,
} from "../repositories";
import type { JobReadinessRepository } from "../job-readiness-repository";
import type { ScheduledJobsRepository } from "../scheduled-jobs-repository";
import { createSupabaseJobConversationContextRepository } from "../job-conversation-context-repository";
import { createSupabaseJobCommunicationContextRepository } from "../job-communication-context-repository";
import { createSupabaseJobParticipantsRepository } from "../job-participants-repository";
import { createSupabaseCustomerJobsRepository } from "../customer-jobs-repository";
import { createSupabaseJobSummaryRepository } from "../job-summary-repository";
import { createSupabaseJobHistoryRepository } from "../job-history-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "../correspondence-evidence-page-repository";
import { createSupabaseCustomerDiscoveryRepository } from "../customer-discovery-repository";
import { createSupabaseJobDiscoveryRepository } from "../job-discovery-repository";
import { hashOperationalProjection } from "../operational-read-projection";
import { READINESS_RULES } from "../readiness-rules";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const PERMISSION_REVISION = `sha256:${"c".repeat(64)}`;
const FIXED_NOW = "2026-08-12T18:00:00.000Z";

const SCHEDULE_SCOPES = ["ops.jobs.read", "ops.schedule.read"] as const;
const READINESS_SCOPES = [
  "ops.customers.read",
  "ops.jobs.read",
  "ops.photos.read",
  "ops.schedule.read",
] as const;
const ALL_OPERATIONAL_SCOPES = Array.from(
  new Set([...SCHEDULE_SCOPES, ...READINESS_SCOPES])
).sort();

const SCHEDULE_INPUT = {
  from: "2026-08-17T00:00:00.000Z",
  to: "2026-08-24T00:00:00.000Z",
} as const satisfies ListScheduledJobsInput;

const READINESS_INPUT = {
  from: "2026-08-17T00:00:00.000Z",
  to: "2026-08-31T00:00:00.000Z",
} as const satisfies JobReadinessIssuesInput;

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: [
      "calendar.view",
      "clients.view",
      "photos.view",
      "projects.view",
      "tasks.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "all" },
      { permission: "clients.view", scope: "all" },
      { permission: "photos.view", scope: "all" },
      { permission: "projects.view", scope: "all" },
      { permission: "tasks.view", scope: "all" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext(
  channel: "internal" | "ops_api" | "mcp",
  scopes: readonly string[] = ALL_OPERATIONAL_SCOPES
): Promise<ActorContext> {
  const principal =
    channel === "mcp"
      ? validatedMcpPrincipalFixture({
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          oauthGrantId: "grant-operational-reads",
          oauthClientId: "client-operational-reads",
          validatedScopes: scopes,
          tokenId: "token-operational-reads",
          issuer: "https://app.opsapp.co",
          audience: "https://mcp.opsapp.co/mcp",
          grantRevision: "grant-revision:v1",
          applicationId: "external-assistant",
          protocolEra: "2026-07-28",
        })
      : verifiedInternalPrincipalFixture({
          channel,
          firebaseSubject: `firebase-operational-reads-${channel}`,
          applicationId: channel === "internal" ? "phase-c" : "ops-api",
          protocolEra: "internal-v1",
        });

  return resolveActorContext({
    principal,
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-operational-reads",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

function sourceFence(version: string) {
  return {
    source_domain: "operations",
    source_type: "operational_read_revision",
    source_id: "private.agent_operational_read_revisions",
    version,
  } as const;
}

function scheduleSnapshot() {
  const fence = sourceFence("revision:61");
  const readAt = "2026-08-12T17:59:59.000Z";
  const occurrence = {
    job_ref: { kind: "project" as const, id: PROJECT_ID },
    occurrence_ref: { kind: "project_task" as const, id: TASK_ID },
    title: "Install replacement fascia",
    address: "1432 Marine Drive, North Vancouver, BC",
    task_status: "active" as const,
    confirmation_state: "confirmed" as const,
    schedule_confirmed_at: "2026-08-12T17:30:00.000Z",
    schedule_locked: true,
    schedule_version: 7,
    confirmed_schedule_version: 7,
    task_updated_at: "2026-08-12T17:54:00.000Z",
    project_status: "accepted" as const,
    project_status_version: 9,
    project_updated_at: "2026-08-12T17:55:00.000Z",
    timing_state: "upcoming" as const,
    schedule: {
      all_day: false,
      company_timezone: "America/Vancouver",
      local_start: "2026-08-19T09:00:00",
      local_end_inclusive: "2026-08-19T13:00:00",
      start_utc: "2026-08-19T16:00:00.000Z",
      end_utc_exclusive: "2026-08-19T20:00:00.000Z",
      start_utc_offset_minutes: -420,
      end_utc_offset_minutes: -420,
      start_pre_boundary_utc_offset_minutes: null,
      end_pre_boundary_utc_offset_minutes: null,
      display: {
        timezone: "America/Vancouver",
        local_start: "2026-08-19T09:00:00",
        local_end_exclusive: "2026-08-19T13:00:00",
        start_utc_offset_minutes: -420,
        end_utc_offset_minutes: -420,
      },
    },
    assignments: [{ user_id: ACTOR_ID, display_name: "Maya Chen" }],
    assignment_total: 1,
    assignments_omitted_count: 0,
  };
  const projection = {
    actor_user_id: ACTOR_ID,
    capability_id: "list_scheduled_jobs",
    capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
    capability_revision: "list_scheduled_jobs:2026-08-07.v1",
    company_id: COMPANY_ID,
    occurrence,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: readAt,
    source_revision: 61,
  } as const;
  const contentHash = hashOperationalProjection(projection);
  const projectionSource = {
    source_domain: "operations",
    source_type: "scheduled_job_occurrence_projection",
    source_id: TASK_ID,
    version: `scheduled-job-occurrence-projection:v1:${contentHash}`,
  } as const;
  const evidenceId = `evidence:scheduled_job_occurrence_projection:${TASK_ID}`;
  return {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: readAt,
    source_fence: fence,
    company_timezone: "America/Vancouver",
    display_timezone: "America/Vancouver",
    occurrences: [occurrence],
    occurrence_proofs: [
      {
        occurrence_ref: { kind: "project_task" as const, id: TASK_ID },
        source_version: projectionSource,
        source_content_hash: contentHash,
        evidence_id: evidenceId,
        projection,
      },
    ],
    returned_occurrence_count: 1,
    next_cursor_claims: null,
    has_more: false,
    source_versions: [fence, projectionSource],
    evidence: [
      {
        evidence_id: evidenceId,
        ...projectionSource,
        occurred_at: readAt,
        relationship: "supports" as const,
        locator: `ops://projects/${PROJECT_ID}/tasks/${TASK_ID}`,
        trust: "authoritative_ops" as const,
      },
    ],
  };
}

function readinessSnapshot() {
  const fence = sourceFence("revision:61");
  const readAt = "2026-08-12T17:59:59.000Z";
  const ruleCodes = READINESS_RULES.map((rule) => rule.code);
  const ruleRevisions = READINESS_RULES.map((rule) => rule.revision);
  const rawSources = {
    site_photos: {
      available: true as const,
      active_remote_by_source: {
        site_visit: 0,
        in_progress: 0,
        completion: 0,
        other: 0,
        measurement: 0,
        deck_design: 0,
      },
      structured_row_count: 0,
      tombstone_count: 0,
      malformed_or_local_count: 0,
      legacy_remote_count: 0,
    },
    customer_record: { resolved: true },
    schedule: {
      eligible_occurrence_count: 1,
      unconfirmed_occurrence_count: 0,
      unconfirmed_occurrence_refs: [],
    },
    crew: {
      eligible_occurrence_count: 1,
      unassigned_occurrence_count: 0,
      unassigned_occurrence_refs: [],
    },
    address: {
      available: true as const,
      project_address: "1432 Marine Drive, North Vancouver, BC",
    },
  };
  const projection = {
    actor_user_id: ACTOR_ID,
    capability_id: "list_job_readiness_issues",
    capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
    capability_revision: "list_job_readiness_issues:2026-08-07.v1",
    company_id: COMPANY_ID,
    job: {
      job_ref: { kind: "project" as const, id: PROJECT_ID },
      title: "North Shore fascia replacement",
      first_scheduled_start_utc: "2026-08-19T16:00:00.000Z",
      evaluated_occurrence_refs: [
        { kind: "project_task" as const, id: TASK_ID },
      ],
      raw_sources: rawSources,
      requested_rule_codes: ruleCodes,
    },
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: readAt,
    rule_revisions: ruleRevisions,
    source_revision: 61,
  } as const;
  const contentHash = hashOperationalProjection(projection);
  const readinessSource = {
    source_domain: "operations",
    source_type: "job_readiness_projection",
    source_id: PROJECT_ID,
    version: `job-readiness-projection:v1:${contentHash}`,
  } as const;
  const evidenceId = `evidence:job_readiness_projection:${PROJECT_ID}`;
  const readinessEvidence = {
    evidence_id: evidenceId,
    ...readinessSource,
    occurred_at: readAt,
    relationship: "supports" as const,
    locator: `ops://projects/${PROJECT_ID}/readiness`,
    trust: "authoritative_ops" as const,
  };
  return {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: readAt,
    source_fence: fence,
    candidates: [
      {
        job_ref: { kind: "project" as const, id: PROJECT_ID },
        title: "North Shore fascia replacement",
        first_scheduled_start_utc: "2026-08-19T16:00:00.000Z",
        evaluated_occurrence_refs: [
          { kind: "project_task" as const, id: TASK_ID },
        ],
        raw_sources: rawSources,
        rule_sources: ruleCodes.map((ruleCode) => ({
          rule_code: ruleCode,
          source_versions: [readinessSource],
          evidence_ids: [evidenceId],
        })),
        projection_proof: {
          source_version: readinessSource,
          source_content_hash: contentHash,
          evidence_id: evidenceId,
          projection,
        },
      },
    ],
    scanned_candidate_count: 1,
    next_scan_cursor_claims: null,
    scan_has_more: false,
    source_versions: [fence, readinessSource],
    evidence: [readinessEvidence],
  };
}

function rpcClient(results: unknown[]) {
  const calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  return {
    calls,
    rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
      calls.push({ functionName, args });
      const result = results.shift();
      if (result === undefined) throw new Error("Unexpected repository read");
      return Promise.resolve({ data: result, error: null });
    },
  };
}

async function trustedRepositories(input?: {
  schedules?: unknown[];
  readiness?: unknown[];
}) {
  const [
    { createOperationalReadCursorCodec },
    { createSupabaseScheduledJobsRepository },
    { createSupabaseJobReadinessRepository },
  ] = await Promise.all([
    import("../operational-read-cursor"),
    import("../scheduled-jobs-repository"),
    import("../job-readiness-repository"),
  ]);
  const cursorCodec = createOperationalReadCursorCodec({
    key: new Uint8Array(32).fill(11),
    keyId: "test-key-1",
    version: 1,
  });
  const scheduleClient = rpcClient(input?.schedules ?? []);
  const readinessClient = rpcClient(input?.readiness ?? []);
  const noCommunicationReadClient = {
    rpc() {
      throw new Error("Unexpected communication repository read");
    },
  };
  const repositories = createOpsAgentDomainRepositories({
    jobConversationContext: createSupabaseJobConversationContextRepository({
      rpc() {
        throw new Error("Unexpected conversation repository read");
      },
    }),
    scheduledJobs: createSupabaseScheduledJobsRepository(
      scheduleClient,
      cursorCodec
    ),
    jobReadiness: createSupabaseJobReadinessRepository(
      readinessClient,
      cursorCodec
    ),
    jobCommunicationContext: createSupabaseJobCommunicationContextRepository(
      noCommunicationReadClient
    ),
    jobParticipants: createSupabaseJobParticipantsRepository(
      noCommunicationReadClient
    ),
    customerJobs: createSupabaseCustomerJobsRepository(
      noCommunicationReadClient,
      cursorCodec
    ),
    jobSummary: createSupabaseJobSummaryRepository(noCommunicationReadClient),
    jobHistory: createSupabaseJobHistoryRepository(
      noCommunicationReadClient,
      cursorCodec
    ),
    correspondenceEvidence: createSupabaseCorrespondenceEvidencePageRepository(
      noCommunicationReadClient
    ),
    customerDiscovery: createSupabaseCustomerDiscoveryRepository(
      noCommunicationReadClient,
      cursorCodec
    ),
    jobDiscovery: createSupabaseJobDiscoveryRepository(
      noCommunicationReadClient,
      cursorCodec
    ),
  } as CreateOpsAgentDomainRepositoriesInput);
  return { repositories, scheduleClient, readinessClient };
}

async function actorErrorFrom(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ActorAccessError);
    return AgentErrorSchema.parse((error as ActorAccessError).toAgentError());
  }
  throw new Error("Expected an actor access error");
}

describe("operational reads domain facade", () => {
  it("exposes exactly the implemented domain methods and all eleven reads", async () => {
    type ExpectedScheduleMethod = (
      actor: ActorContext,
      input: ListScheduledJobsInput,
      options?: DomainCallOptions
    ) => Promise<ScheduledJobsResult>;
    type ExpectedReadinessMethod = (
      actor: ActorContext,
      input: JobReadinessIssuesInput,
      options?: DomainCallOptions
    ) => Promise<JobReadinessResult>;
    expectTypeOf<
      OpsAgentDomainService["listScheduledJobs"]
    >().toEqualTypeOf<ExpectedScheduleMethod>();
    expectTypeOf<
      OpsAgentDomainService["listJobReadinessIssues"]
    >().toEqualTypeOf<ExpectedReadinessMethod>();

    const { repositories } = await trustedRepositories();
    const service = createOpsAgentDomainService({ repositories });

    expect(Object.keys(service)).toEqual([
      "getJobConversationContext",
      "listScheduledJobs",
      "listJobReadinessIssues",
      "getJobCommunicationContext",
      "resolveJobParticipants",
      "listCustomerJobs",
      "getJobSummary",
      "searchJobHistory",
      "getCorrespondenceEvidence",
      "searchCustomers",
      "searchJobs",
    ]);
    expect(Object.isFrozen(service)).toBe(true);
    expect(Object.keys(service)).not.toEqual(
      expect.arrayContaining([
        "transport",
        "headers",
        "token",
        "tenant",
        "authorization",
        "policy",
        "repository",
      ])
    );
    expect(MCP_EXPOSURE_V1.toolIds).toEqual([
      "list_scheduled_jobs",
      "list_job_readiness_issues",
      "get_job_communication_context",
      "get_job_conversation_context",
      "list_customer_jobs",
      "get_job_summary",
      "search_job_history",
      "get_correspondence_evidence",
      "search_customers",
      "search_jobs",
      "resolve_job_participants",
    ]);
    for (const capabilityName of [
      "list_scheduled_jobs",
      "list_job_readiness_issues",
      "get_job_communication_context",
      "resolve_job_participants",
    ] as const) {
      const capability = CAPABILITY_MANIFEST.find(
        (entry) => entry.name === capabilityName
      );
      expect(capability?.availability).toEqual({
        implementation: "available",
      });
      expect(MCP_EXPOSURE_V1.toolIds).toContain(capabilityName);
    }
  });

  it("returns identical parsed schedule and readiness results for distinct internal, OPS API, and MCP actors", async () => {
    const schedule = scheduleSnapshot();
    const readiness = readinessSnapshot();
    const { repositories, scheduleClient, readinessClient } =
      await trustedRepositories({
        schedules: [schedule, schedule, schedule],
        readiness: [readiness, readiness, readiness],
      });
    const service = createOpsAgentDomainService({
      repositories,
      now: () => new Date(FIXED_NOW),
    });
    const actors = await Promise.all([
      actorContext("internal"),
      actorContext("ops_api"),
      actorContext("mcp"),
    ]);

    const schedules = await Promise.all(
      actors.map((actor) => service.listScheduledJobs(actor, SCHEDULE_INPUT))
    );
    const readinessResults = await Promise.all(
      actors.map((actor) =>
        service.listJobReadinessIssues(actor, READINESS_INPUT)
      )
    );
    const ResultSchema = createAgentResultSchema(z.unknown());
    const parsedSchedules = schedules.map((result) =>
      ResultSchema.parse(result)
    );
    const parsedReadiness = readinessResults.map((result) =>
      ResultSchema.parse(result)
    );

    expect(parsedSchedules[1]).toEqual(parsedSchedules[0]);
    expect(parsedSchedules[2]).toEqual(parsedSchedules[0]);
    expect(parsedReadiness[1]).toEqual(parsedReadiness[0]);
    expect(parsedReadiness[2]).toEqual(parsedReadiness[0]);
    expect(scheduleClient.calls).toHaveLength(3);
    expect(readinessClient.calls).toHaveLength(3);
    expect(scheduleClient.calls[1]!.args).toEqual(
      scheduleClient.calls[0]!.args
    );
    expect(scheduleClient.calls[2]!.args).toEqual(
      scheduleClient.calls[0]!.args
    );
    expect(readinessClient.calls[1]!.args).toEqual(
      readinessClient.calls[0]!.args
    );
    expect(readinessClient.calls[2]!.args).toEqual(
      readinessClient.calls[0]!.args
    );
  });

  it.each([
    {
      capability: "schedule",
      missingScope: "ops.schedule.read",
      invoke: (service: OpsAgentDomainService, actor: ActorContext) =>
        service.listScheduledJobs(actor, SCHEDULE_INPUT),
    },
    {
      capability: "readiness",
      missingScope: "ops.customers.read",
      invoke: (service: OpsAgentDomainService, actor: ActorContext) =>
        service.listJobReadinessIssues(actor, READINESS_INPUT),
    },
  ])(
    "enforces the missing MCP scope for $capability before any repository read",
    async ({ missingScope, invoke }) => {
      const { repositories, scheduleClient, readinessClient } =
        await trustedRepositories();
      const service = createOpsAgentDomainService({ repositories });
      const actor = await actorContext(
        "mcp",
        ALL_OPERATIONAL_SCOPES.filter((scope) => scope !== missingScope)
      );

      const error = await actorErrorFrom(invoke(service, actor));

      expect(error).toMatchObject({
        request_id: "request-operational-reads",
        code: "INSUFFICIENT_SCOPE",
        retryable: false,
        details: { required_scope: missingScope },
      });
      expect(scheduleClient.calls).toHaveLength(0);
      expect(readinessClient.calls).toHaveLength(0);
    }
  );

  it.each([
    {
      capability: "schedule",
      validInput: SCHEDULE_INPUT,
      invoke: (
        service: OpsAgentDomainService,
        actor: ActorContext,
        input: unknown
      ) => service.listScheduledJobs(actor, input as ListScheduledJobsInput),
    },
    {
      capability: "readiness",
      validInput: READINESS_INPUT,
      invoke: (
        service: OpsAgentDomainService,
        actor: ActorContext,
        input: unknown
      ) =>
        service.listJobReadinessIssues(actor, input as JobReadinessIssuesInput),
    },
  ])(
    "strictly rejects injected trust fields in $capability input for every channel before reads",
    async ({ validInput, invoke }) => {
      const { repositories, scheduleClient, readinessClient } =
        await trustedRepositories();
      const service = createOpsAgentDomainService({ repositories });
      const actors = await Promise.all([
        actorContext("internal"),
        actorContext("ops_api"),
        actorContext("mcp"),
      ]);
      const injected = {
        ...validInput,
        company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        actor_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        auth_channel: "mcp",
        oauth_scopes: ALL_OPERATIONAL_SCOPES,
        authorization: { adminBypass: true },
        policy: { requiredPermissions: [] },
        repository: { read: vi.fn() },
        source_fence: "attacker-selected",
      };

      const errors = await Promise.all(
        actors.map((actor) => actorErrorFrom(invoke(service, actor, injected)))
      );

      expect(errors[0]).toMatchObject({
        request_id: "request-operational-reads",
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
      expect(errors[1]).toEqual(errors[0]);
      expect(errors[2]).toEqual(errors[0]);
      expect(scheduleClient.calls).toHaveLength(0);
      expect(readinessClient.calls).toHaveLength(0);
    }
  );

  it("captures each repository and service dependency exactly once before trust validation", async () => {
    const [
      { createOperationalReadCursorCodec },
      { createSupabaseScheduledJobsRepository },
      { createSupabaseJobReadinessRepository },
    ] = await Promise.all([
      import("../operational-read-cursor"),
      import("../scheduled-jobs-repository"),
      import("../job-readiness-repository"),
    ]);
    const cursorCodec = createOperationalReadCursorCodec({
      key: new Uint8Array(32).fill(13),
      keyId: "test-key-1",
      version: 1,
    });
    const scheduleClient = rpcClient([scheduleSnapshot()]);
    const readinessClient = rpcClient([readinessSnapshot()]);
    const trustedScheduledJobs = createSupabaseScheduledJobsRepository(
      scheduleClient,
      cursorCodec
    );
    const trustedJobReadiness = createSupabaseJobReadinessRepository(
      readinessClient,
      cursorCodec
    );
    const noTask12ReadClient = {
      rpc() {
        throw new Error("Unexpected communication repository read");
      },
    };
    const trustedJobCommunicationContext =
      createSupabaseJobCommunicationContextRepository(noTask12ReadClient);
    const trustedJobParticipants =
      createSupabaseJobParticipantsRepository(noTask12ReadClient);
    const trustedCustomerJobs = createSupabaseCustomerJobsRepository(
      noTask12ReadClient,
      cursorCodec
    );
    const trustedJobSummary =
      createSupabaseJobSummaryRepository(noTask12ReadClient);
    const trustedJobHistory = createSupabaseJobHistoryRepository(
      noTask12ReadClient,
      cursorCodec
    );
    const trustedCorrespondenceEvidence =
      createSupabaseCorrespondenceEvidencePageRepository(noTask12ReadClient);
    const trustedCustomerDiscovery = createSupabaseCustomerDiscoveryRepository(
      noTask12ReadClient,
      cursorCodec
    );
    const trustedJobDiscovery = createSupabaseJobDiscoveryRepository(
      noTask12ReadClient,
      cursorCodec
    );
    const attackerScheduledJobs = {
      read: vi.fn(async () => {
        throw new Error("Attacker schedule repository must never run");
      }),
    } as unknown as ScheduledJobsRepository;
    const attackerJobReadiness = {
      read: vi.fn(async () => {
        throw new Error("Attacker readiness repository must never run");
      }),
    } as unknown as JobReadinessRepository;
    let scheduleRepositoryReads = 0;
    let readinessRepositoryReads = 0;
    const repositoryInput = Object.defineProperties(
      {},
      {
        jobConversationContext: {
          value: createSupabaseJobConversationContextRepository({
            rpc() {
              throw new Error("Unexpected conversation repository read");
            },
          }),
        },
        scheduledJobs: {
          get() {
            scheduleRepositoryReads += 1;
            return scheduleRepositoryReads === 1
              ? trustedScheduledJobs
              : attackerScheduledJobs;
          },
        },
        jobReadiness: {
          get() {
            readinessRepositoryReads += 1;
            return readinessRepositoryReads === 1
              ? trustedJobReadiness
              : attackerJobReadiness;
          },
        },
        jobCommunicationContext: {
          value: trustedJobCommunicationContext,
        },
        jobParticipants: {
          value: trustedJobParticipants,
        },
        customerJobs: { value: trustedCustomerJobs },
        jobSummary: { value: trustedJobSummary },
        jobHistory: { value: trustedJobHistory },
        correspondenceEvidence: {
          value: trustedCorrespondenceEvidence,
        },
        customerDiscovery: { value: trustedCustomerDiscovery },
        jobDiscovery: { value: trustedJobDiscovery },
      }
    ) as CreateOpsAgentDomainRepositoriesInput;
    const repositories = createOpsAgentDomainRepositories(repositoryInput);

    expect(scheduleRepositoryReads).toBe(1);
    expect(readinessRepositoryReads).toBe(1);
    expect(repositories.scheduledJobs).toBe(trustedScheduledJobs);
    expect(repositories.jobReadiness).toBe(trustedJobReadiness);

    const attackerBundle = {
      jobConversationContext: repositories.jobConversationContext,
      scheduledJobs: attackerScheduledJobs,
      jobReadiness: attackerJobReadiness,
    } as OpsAgentDomainRepositories;
    const trustedNow = () => new Date(FIXED_NOW);
    const attackerNow = () => new Date("2030-01-01T00:00:00.000Z");
    let bundleReads = 0;
    let clockReads = 0;
    const factoryInput = Object.defineProperties(
      {},
      {
        repositories: {
          get() {
            bundleReads += 1;
            return bundleReads === 1 ? repositories : attackerBundle;
          },
        },
        now: {
          get() {
            clockReads += 1;
            return clockReads === 1 ? trustedNow : attackerNow;
          },
        },
      }
    ) as CreateOpsAgentDomainServiceInput;
    const service = createOpsAgentDomainService(factoryInput);
    const actor = await actorContext("internal");

    const scheduleResult = await service.listScheduledJobs(
      actor,
      SCHEDULE_INPUT
    );
    const readinessResult = await service.listJobReadinessIssues(
      actor,
      READINESS_INPUT
    );

    expect(bundleReads).toBe(1);
    expect(clockReads).toBe(1);
    expect(scheduleResult.generated_at).toBe(FIXED_NOW);
    expect(readinessResult.generated_at).toBe(FIXED_NOW);
    expect(attackerScheduledJobs.read).not.toHaveBeenCalled();
    expect(attackerJobReadiness.read).not.toHaveBeenCalled();
    expect(scheduleClient.calls).toHaveLength(1);
    expect(readinessClient.calls).toHaveLength(1);
  });
});
