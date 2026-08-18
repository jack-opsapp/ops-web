import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod-v4";

import {
  REGISTERED_ACTOR_PERMISSION_KEYS,
  type ActorAuthoritySnapshot,
} from "@/lib/agent-control-plane/actor/authority-repository";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  validatedMcpPrincipalFixture,
  verifiedInternalPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
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
import {
  createOpsAgentDomainService,
  type CreateOpsAgentDomainServiceInput,
} from "../create-domain-service";
import type {
  DomainCallOptions,
  GetJobConversationContextInput,
  OpsAgentDomainService,
} from "../domain-service";
import {
  createOpsAgentDomainRepositories,
  type CreateOpsAgentDomainRepositoriesInput,
  type OpsAgentDomainRepositories,
} from "../repositories";
import {
  JobConversationContextReadError,
  type JobConversationContextResult,
} from "../get-job-conversation-context";
import {
  createSupabaseJobConversationContextRepository,
  type JobConversationContextRepository,
  type JobConversationContextRpcClient,
  type JobConversationContextRpcRequest,
} from "../job-conversation-context-repository";
import { createSupabaseScheduledJobsRepository } from "../scheduled-jobs-repository";
import { createSupabaseJobReadinessRepository } from "../job-readiness-repository";
import { createSupabaseJobCommunicationContextRepository } from "../job-communication-context-repository";
import { createSupabaseJobParticipantsRepository } from "../job-participants-repository";
import { createOperationalReadCursorCodec } from "../operational-read-cursor";
import { createSupabaseCustomerJobsRepository } from "../customer-jobs-repository";
import { createSupabaseJobSummaryRepository } from "../job-summary-repository";
import { createSupabaseJobHistoryRepository } from "../job-history-repository";
import { createSupabaseCorrespondenceEvidencePageRepository } from "../correspondence-evidence-page-repository";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const REQUIRED_TURN_ID = "55555555-5555-4555-8555-555555555555";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const FIXED_NOW = "2026-08-11T18:00:00.000Z";
const REQUIRED_MCP_SCOPES = [
  "ops.correspondence.read",
  "ops.customer_contacts.read",
  "ops.customers.read",
  "ops.jobs.read",
] as const;
const INPUT = {
  job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
} as const satisfies GetJobConversationContextInput;

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

class StubContextRpcClient implements JobConversationContextRpcClient {
  readonly calls: Array<{
    functionName: Parameters<JobConversationContextRpcClient["rpc"]>[0];
    args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(private readonly results: RpcResult[]) {}

  rpc(
    functionName: Parameters<JobConversationContextRpcClient["rpc"]>[0],
    args: Readonly<Record<string, unknown>>
  ): JobConversationContextRpcRequest {
    this.calls.push({ functionName, args });
    const result = this.results.shift();
    if (!result) throw new Error("Unexpected repository read");
    return Promise.resolve(result);
  }
}

function authority(): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    configuredPermissions: ["clients.view", "inbox.view", "pipeline.view"],
    effectivePermissions: [
      { permission: "clients.view", scope: "all" },
      { permission: "inbox.view", scope: "all" },
      { permission: "pipeline.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext(
  channel: "internal" | "ops_api" | "mcp",
  scopes: readonly string[] = REQUIRED_MCP_SCOPES
): Promise<ActorContext> {
  const principal =
    channel === "mcp"
      ? validatedMcpPrincipalFixture({
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
          oauthGrantId: "grant-domain-service",
          oauthClientId: "client-domain-service",
          validatedScopes: scopes,
          tokenId: "token-domain-service",
          issuer: "https://app.opsapp.co",
          audience: "https://mcp.opsapp.co/mcp",
          grantRevision: "grant-revision:v1",
          applicationId: "external-assistant",
          protocolEra: "2026-07-28",
        })
      : verifiedInternalPrincipalFixture({
          channel,
          firebaseSubject: "firebase-domain-service",
          applicationId: channel === "internal" ? "phase-c" : "ops-api",
          protocolEra: "internal-v1",
        });

  return resolveActorContext({
    principal,
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-domain-service",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

function emptySnapshot() {
  return {
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    requested_job: { kind: "opportunity", id: OPPORTUNITY_ID },
    read_at: "2026-08-11T17:59:00.000Z",
    permission_snapshot_revision: PERMISSION_REVISION,
    source_state_revision: 0,
    last_turn_sequence: 0,
    current_version: null,
    recent_turns: [],
    recent_turns_omitted_count: 0,
    active_evidence: [],
    active_evidence_total: 0,
    participants: [],
    participant_total: 0,
    cross_job_seed: {
      state: "customer_unresolved",
      customer_has_prior_ops_jobs: null,
      visible_prior_job_count: null,
      latest_visible_prior_job: null,
      relationship_continuity: null,
      evidence: null,
    },
    invalidated_evidence_ids: [],
    invalidated_evidence_total: 0,
    required_through: { turn_id: null, state: "not_requested" },
  };
}

function serviceFor(client: StubContextRpcClient): OpsAgentDomainService {
  const operational = trustedOperationalRepositories();
  const repositories = createOpsAgentDomainRepositories({
    jobConversationContext:
      createSupabaseJobConversationContextRepository(client),
    ...operational,
  });
  return createOpsAgentDomainService({
    repositories,
    now: () => new Date(FIXED_NOW),
  });
}

function trustedOperationalRepositories() {
  const cursorCodec = createOperationalReadCursorCodec({
    key: new Uint8Array(32).fill(27),
    keyId: "domain-test-key",
    version: 1,
  });
  const noReadClient = {
    rpc() {
      throw new Error("Unexpected operational repository read");
    },
  };
  return {
    scheduledJobs: createSupabaseScheduledJobsRepository(
      noReadClient,
      cursorCodec
    ),
    jobReadiness: createSupabaseJobReadinessRepository(
      noReadClient,
      cursorCodec
    ),
    jobCommunicationContext:
      createSupabaseJobCommunicationContextRepository(noReadClient),
    jobParticipants: createSupabaseJobParticipantsRepository(noReadClient),
    customerJobs: createSupabaseCustomerJobsRepository(
      noReadClient,
      cursorCodec
    ),
    jobSummary: createSupabaseJobSummaryRepository(noReadClient),
    jobHistory: createSupabaseJobHistoryRepository(noReadClient, cursorCodec),
    correspondenceEvidence:
      createSupabaseCorrespondenceEvidencePageRepository(noReadClient),
  };
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

async function contextErrorFrom(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JobConversationContextReadError);
    return AgentErrorSchema.parse(
      (error as JobConversationContextReadError).toAgentError()
    );
  }
  throw new Error("Expected a conversation context error");
}

describe("OpsAgentDomainService", () => {
  it("returns the same parsed domain result through internal, REST, and MCP forwarders", async () => {
    type ExpectedMethod = (
      actor: ActorContext,
      input: GetJobConversationContextInput,
      options?: DomainCallOptions
    ) => Promise<JobConversationContextResult>;
    expectTypeOf<
      OpsAgentDomainService["getJobConversationContext"]
    >().toEqualTypeOf<ExpectedMethod>();

    const client = new StubContextRpcClient([
      { data: emptySnapshot(), error: null },
      { data: emptySnapshot(), error: null },
      { data: emptySnapshot(), error: null },
    ]);
    const service = serviceFor(client);
    const actors = await Promise.all([
      actorContext("internal"),
      actorContext("ops_api"),
      actorContext("mcp"),
    ]);
    const forwarders = [
      (actor: ActorContext, input: GetJobConversationContextInput) =>
        service.getJobConversationContext(actor, input),
      (actor: ActorContext, input: GetJobConversationContextInput) =>
        service.getJobConversationContext(actor, input),
      (actor: ActorContext, input: GetJobConversationContextInput) =>
        service.getJobConversationContext(actor, input),
    ] as const;

    const results = await Promise.all(
      forwarders.map((forward, index) => forward(actors[index]!, INPUT))
    );
    const ResultSchema = createAgentResultSchema(z.unknown());
    const parsed = results.map((result) => ResultSchema.parse(result));

    expect(parsed[1]).toEqual(parsed[0]);
    expect(parsed[2]).toEqual(parsed[0]);
    expect(parsed[0]).toMatchObject({
      request_id: "request-domain-service",
      generated_at: FIXED_NOW,
      company_id: COMPANY_ID,
      actor: {
        user_id: ACTOR_ID,
        permission_snapshot_revision: PERMISSION_REVISION,
      },
      data: {
        conversation_id: CONVERSATION_ID,
        requested_job: INPUT.job_ref,
      },
    });
    expect(client.calls).toHaveLength(3);
    expect(client.calls[1]!.args).toEqual(client.calls[0]!.args);
    expect(client.calls[2]!.args).toEqual(client.calls[0]!.args);
    expect(client.calls[0]!.args).toMatchObject({
      p_request_id: "request-domain-service",
      p_actor_user_id: ACTOR_ID,
      p_company_id: COMPANY_ID,
      p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
      p_exact_turn_limit: 20,
      p_sections: [
        "memory",
        "recent_turns",
        "participants",
        "gaps",
        "cross_job_seed",
      ],
    });
    expect(client.calls[0]!.args).not.toHaveProperty("auth_channel");
    expect(client.calls[0]!.args).not.toHaveProperty("oauth_token");
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
    ]);
    expect(Object.isFrozen(service)).toBe(true);
    expect(
      CAPABILITY_MANIFEST.filter(
        (capability) => capability.availability.implementation === "available"
      ).map((capability) => capability.name)
    ).toEqual([
      "list_scheduled_jobs",
      "list_job_readiness_issues",
      "get_job_communication_context",
      "get_job_conversation_context",
      "list_customer_jobs",
      "get_job_summary",
      "search_job_history",
      "get_correspondence_evidence",
      "resolve_job_participants",
    ]);
    expect(
      CAPABILITY_MANIFEST.every(
        (capability) =>
          capability.availability.externalExposure ===
          (capability.availability.implementation === "available"
            ? "enabled"
            : "disabled")
      )
    ).toBe(true);
  });

  it("maps strict input rejection once for every channel before any repository read", async () => {
    const client = new StubContextRpcClient([]);
    const service = serviceFor(client);
    const actors = await Promise.all([
      actorContext("internal"),
      actorContext("ops_api"),
      actorContext("mcp"),
    ]);
    const injectedInput = {
      ...INPUT,
      company_id: COMPANY_ID,
      actor_user_id: ACTOR_ID,
      auth_channel: "mcp",
      oauth_scopes: [...REQUIRED_MCP_SCOPES],
      token_id: "caller-token",
      authorization: { adminBypass: true },
    } as unknown as GetJobConversationContextInput;

    const errors = await Promise.all(
      actors.map((actor) =>
        actorErrorFrom(service.getJobConversationContext(actor, injectedInput))
      )
    );

    expect(errors[0]).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: "request-domain-service",
      code: "INVALID_ARGUMENT",
      message: "The input is invalid.",
      retryable: false,
      details: {
        field_issues: [
          {
            path: ["input"],
            code: "INVALID_ARGUMENT",
            message: "The input is invalid.",
          },
        ],
      },
    });
    expect(errors[1]).toEqual(errors[0]);
    expect(errors[2]).toEqual(errors[0]);
    expect(client.calls).toHaveLength(0);
  });

  it("enforces the MCP scope ceiling before any repository read", async () => {
    const client = new StubContextRpcClient([]);
    const service = serviceFor(client);
    const missingScopeActor = await actorContext(
      "mcp",
      REQUIRED_MCP_SCOPES.filter(
        (scope) => scope !== "ops.customer_contacts.read"
      )
    );

    const error = await actorErrorFrom(
      service.getJobConversationContext(missingScopeActor, INPUT)
    );

    expect(error).toMatchObject({
      request_id: "request-domain-service",
      code: "INSUFFICIENT_SCOPE",
      retryable: false,
      details: { required_scope: "ops.customer_contacts.read" },
    });
    expect(client.calls).toHaveLength(0);
  });

  it("rejects a structural actor clone before any repository read", async () => {
    const client = new StubContextRpcClient([]);
    const service = serviceFor(client);
    const actor = await actorContext("internal");

    const error = await actorErrorFrom(
      service.getJobConversationContext({ ...actor } as ActorContext, INPUT)
    );

    expect(error).toMatchObject({
      request_id: "unknown-request",
      code: "INTERNAL",
      retryable: false,
    });
    expect(client.calls).toHaveLength(0);
  });

  it("accepts only factory-minted repository dependencies", () => {
    const read = vi.fn();
    const structuralRepository = {
      read,
    } as unknown as JobConversationContextRepository;

    expect(() =>
      createOpsAgentDomainRepositories({
        jobConversationContext: structuralRepository,
        ...trustedOperationalRepositories(),
      })
    ).toThrow(TypeError);

    const client = new StubContextRpcClient([]);
    const trustedRepository =
      createSupabaseJobConversationContextRepository(client);
    expect(() =>
      createOpsAgentDomainRepositories({
        jobConversationContext: {
          ...trustedRepository,
        } as JobConversationContextRepository,
        ...trustedOperationalRepositories(),
      })
    ).toThrow(TypeError);

    const repositories = createOpsAgentDomainRepositories({
      jobConversationContext: trustedRepository,
      ...trustedOperationalRepositories(),
    });
    expect(Object.isFrozen(repositories)).toBe(true);
    expect(() =>
      createOpsAgentDomainService({
        repositories: {
          ...repositories,
        } as OpsAgentDomainRepositories,
      })
    ).toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(0);
  });

  it("captures every factory dependency once and never rereads caller-owned getters", async () => {
    const pendingSnapshot = {
      ...emptySnapshot(),
      required_through: { turn_id: REQUIRED_TURN_ID, state: "pending" },
    };
    const client = new StubContextRpcClient([
      { data: pendingSnapshot, error: null },
      { data: pendingSnapshot, error: null },
      { data: emptySnapshot(), error: null },
    ]);
    const trustedRepository =
      createSupabaseJobConversationContextRepository(client);
    const structuralRepository = {
      ...trustedRepository,
    } as JobConversationContextRepository;
    let repositoryReads = 0;
    const operational = trustedOperationalRepositories();
    const repositoryInput = Object.defineProperties(
      {},
      {
        jobConversationContext: {
          get() {
            repositoryReads += 1;
            return repositoryReads === 1
              ? trustedRepository
              : structuralRepository;
          },
        },
        scheduledJobs: { value: operational.scheduledJobs },
        jobReadiness: { value: operational.jobReadiness },
        jobCommunicationContext: {
          value: operational.jobCommunicationContext,
        },
        jobParticipants: { value: operational.jobParticipants },
        customerJobs: { value: operational.customerJobs },
        jobSummary: { value: operational.jobSummary },
        jobHistory: { value: operational.jobHistory },
        correspondenceEvidence: {
          value: operational.correspondenceEvidence,
        },
      }
    ) as CreateOpsAgentDomainRepositoriesInput;

    const repositories = createOpsAgentDomainRepositories(repositoryInput);

    expect(repositoryReads).toBe(1);
    expect(repositories.jobConversationContext).toBe(trustedRepository);

    const attackerRepository = {
      read: vi.fn(),
    } as unknown as JobConversationContextRepository;
    const structuralBundle = {
      jobConversationContext: attackerRepository,
      ...operational,
    } as OpsAgentDomainRepositories;
    const trustedCatchUp = vi.fn(async () => undefined);
    const attackerCatchUp = vi.fn(async () => {
      throw new Error("Attacker catch-up must never run");
    });
    const trustedNow = () => new Date(FIXED_NOW);
    const attackerNow = () => new Date("2030-01-01T00:00:00.000Z");
    let bundleReads = 0;
    let catchUpReads = 0;
    let clockReads = 0;
    const factoryInput = Object.defineProperties(
      {},
      {
        repositories: {
          get() {
            bundleReads += 1;
            return bundleReads === 1 ? repositories : structuralBundle;
          },
        },
        catchUpJobConversationMemory: {
          get() {
            catchUpReads += 1;
            return catchUpReads === 1 ? trustedCatchUp : attackerCatchUp;
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

    await expect(
      service.getJobConversationContext(actor, {
        ...INPUT,
        required_through_turn_id: REQUIRED_TURN_ID,
      })
    ).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    const result = await service.getJobConversationContext(actor, INPUT);

    expect(bundleReads).toBe(1);
    expect(catchUpReads).toBe(1);
    expect(clockReads).toBe(1);
    expect(trustedCatchUp).toHaveBeenCalledTimes(1);
    expect(attackerCatchUp).not.toHaveBeenCalled();
    expect(attackerRepository.read).not.toHaveBeenCalled();
    expect(result.generated_at).toBe(FIXED_NOW);
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
    ]);
    expect(client.calls).toHaveLength(3);
  });

  it("preserves privacy-safe not-found errors across all valid channels", async () => {
    const notFound = {
      data: null,
      error: {
        code: "P0002",
        message: "agent_job_conversation_context_not_found",
      },
    };
    const client = new StubContextRpcClient([notFound, notFound, notFound]);
    const service = serviceFor(client);
    const actors = await Promise.all([
      actorContext("internal"),
      actorContext("ops_api"),
      actorContext("mcp"),
    ]);

    const errors = await Promise.all(
      actors.map((actor) =>
        contextErrorFrom(service.getJobConversationContext(actor, INPUT))
      )
    );

    expect(errors[0]).toMatchObject({
      contract_version: "2026-08-07.v1",
      request_id: "request-domain-service",
      code: "NOT_FOUND",
      retryable: false,
    });
    expect(errors[1]).toEqual(errors[0]);
    expect(errors[2]).toEqual(errors[0]);
    expect(client.calls).toHaveLength(3);
  });
});
