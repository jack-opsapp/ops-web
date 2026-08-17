import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

const phaseCDependencies = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  resolveEmailOpportunityAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: phaseCDependencies.getServiceRoleClient,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess:
    phaseCDependencies.resolveEmailOpportunityAccess,
}));

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  EMPTY_MEMORY_DOCUMENT,
  hashCanonicalJson,
} from "@/lib/agent-control-plane/memory/memory-schema";
import { createSupabaseCorrespondenceEvidencePageRepository } from "@/lib/agent-control-plane/services/correspondence-evidence-page-repository";
import { createOpsAgentDomainService } from "@/lib/agent-control-plane/services/create-domain-service";
import { createSupabaseCustomerJobsRepository } from "@/lib/agent-control-plane/services/customer-jobs-repository";
import type { OpsAgentDomainService } from "@/lib/agent-control-plane/services/domain-service";
import { createSupabaseJobCommunicationContextRepository } from "@/lib/agent-control-plane/services/job-communication-context-repository";
import { createSupabaseJobConversationContextRepository } from "@/lib/agent-control-plane/services/job-conversation-context-repository";
import { createSupabaseJobHistoryRepository } from "@/lib/agent-control-plane/services/job-history-repository";
import { createSupabaseJobParticipantsRepository } from "@/lib/agent-control-plane/services/job-participants-repository";
import { createSupabaseJobReadinessRepository } from "@/lib/agent-control-plane/services/job-readiness-repository";
import { createSupabaseJobSummaryRepository } from "@/lib/agent-control-plane/services/job-summary-repository";
import { createOperationalReadCursorCodec } from "@/lib/agent-control-plane/services/operational-read-cursor";
import { createOpsAgentDomainRepositories } from "@/lib/agent-control-plane/services/repositories";
import { createSupabaseScheduledJobsRepository } from "@/lib/agent-control-plane/services/scheduled-jobs-repository";
import {
  resolvePhaseCEmailActor,
  type PhaseCEmailActorContext,
} from "@/lib/email/phase-c-email-actor";
import {
  createInternalPhaseCAdapter,
  type InternalPhaseCConversationContextRequest,
} from "../internal";
import {
  createPhaseCSourceTurnRepository,
  createSupabasePhaseCSourceTurnReadAdapter,
  type PhaseCSourceTurnRepository,
} from "../phase-c-source-turn-repository";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000003";
const INTERNAL_THREAD_ID = "00000000-0000-4000-8000-000000000004";
const ACTOR_ID = "00000000-0000-4000-8000-000000000005";
const MAILBOX_OWNER_ID = "00000000-0000-4000-8000-000000000006";
const ASSIGNMENT_EVENT_ID = "00000000-0000-4000-8000-000000000007";
const TURN_ID = "00000000-0000-4000-8000-000000000008";
const CONVERSATION_ID = "00000000-0000-4000-8000-00000000000a";
const SOURCE_ACTIVITY_ID = "00000000-0000-4000-8000-00000000000b";
const PROVIDER_THREAD_ID = "provider-thread-1";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const CURSOR_KEY = new Uint8Array(32).fill(29);
const CONTENT_HASH = `sha256:${"d".repeat(64)}`;
const MEMORY_HASH = hashCanonicalJson(EMPTY_MEMORY_DOCUMENT);

type Row = Readonly<Record<string, unknown>>;
type PhaseCTable =
  | "email_connections"
  | "email_threads"
  | "opportunities"
  | "opportunity_assignment_events"
  | "users";

function phaseCRows(): Readonly<Record<PhaseCTable, readonly Row[]>> {
  return {
    email_connections: [
      {
        id: CONNECTION_ID,
        company_id: COMPANY_ID,
        provider: "gmail",
        type: "company",
        user_id: MAILBOX_OWNER_ID,
        email: "dispatch@example.com",
        status: "active",
        sync_enabled: true,
      },
    ],
    email_threads: [
      {
        id: INTERNAL_THREAD_ID,
        company_id: COMPANY_ID,
        connection_id: CONNECTION_ID,
        provider_thread_id: PROVIDER_THREAD_ID,
        opportunity_id: OPPORTUNITY_ID,
      },
    ],
    opportunities: [
      {
        id: OPPORTUNITY_ID,
        company_id: COMPANY_ID,
        assigned_to: ACTOR_ID,
        assignment_version: 7,
        deleted_at: null,
      },
    ],
    opportunity_assignment_events: [
      {
        id: ASSIGNMENT_EVENT_ID,
        company_id: COMPANY_ID,
        opportunity_id: OPPORTUNITY_ID,
        created_at: "2026-08-14T17:00:00.000Z",
      },
    ],
    users: [
      {
        id: ACTOR_ID,
        company_id: COMPANY_ID,
        first_name: "Jackson",
        last_name: "Sweet",
        email: "jackson@example.com",
        is_active: true,
        deleted_at: null,
      },
      {
        id: MAILBOX_OWNER_ID,
        company_id: COMPANY_ID,
        first_name: "Mailbox",
        last_name: "Owner",
        email: "dispatch@example.com",
        is_active: true,
        deleted_at: null,
      },
    ],
  };
}

function phaseCDatabase(
  rows: Readonly<Record<PhaseCTable, readonly Row[]>> = phaseCRows()
): SupabaseClient {
  return {
    async rpc(functionName: string, args: Record<string, unknown>) {
      if (functionName !== "read_phase_c_routed_actor_fence_as_system") {
        return { data: null, error: { message: "unexpected rpc" } };
      }
      const connection = rows.email_connections.find(
        (row) =>
          row.id === args.p_connection_id &&
          row.company_id === args.p_company_id &&
          row.provider === args.p_connection_provider &&
          row.status === "active" &&
          row.sync_enabled !== false
      );
      const opportunity = rows.opportunities.find(
        (row) =>
          row.id === args.p_opportunity_id &&
          row.company_id === args.p_company_id &&
          row.assigned_to === args.p_actor_user_id &&
          row.assignment_version === args.p_assignment_version &&
          row.deleted_at === null
      );
      const thread = rows.email_threads.find(
        (row) =>
          row.id === args.p_internal_thread_id &&
          row.company_id === args.p_company_id &&
          row.connection_id === args.p_connection_id &&
          row.provider_thread_id === args.p_provider_thread_id &&
          row.opportunity_id === args.p_opportunity_id
      );
      const owner =
        typeof connection?.user_id === "string"
          ? connection.user_id.replace(/^ +| +$/gu, "")
          : null;
      const connectionAllowed =
        connection?.type === "company" ||
        (connection?.type === "individual" &&
          owner === args.p_actor_user_id &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            owner ?? ""
          ));
      const actor = rows.users.find(
        (row) =>
          row.id === args.p_actor_user_id &&
          row.company_id === args.p_company_id &&
          row.is_active === true &&
          row.deleted_at === null
      );
      if (
        !connection ||
        !opportunity ||
        !thread ||
        !connectionAllowed ||
        !actor
      ) {
        return { data: [], error: null };
      }
      return {
        data: [
          {
            actor_user_id: args.p_actor_user_id,
            company_id: args.p_company_id,
            connection_id: args.p_connection_id,
            opportunity_id: args.p_opportunity_id,
            internal_thread_id: args.p_internal_thread_id,
            provider_thread_id: args.p_provider_thread_id,
            assignment_version: args.p_assignment_version,
            connection_type: connection.type,
            connection_provider: connection.provider,
            connection_email: connection.email,
          },
        ],
        error: null,
      };
    },
    from(table: PhaseCTable) {
      const filters: Array<{
        readonly column: string;
        readonly value: unknown;
      }> = [];
      let descending = false;
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        is(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        order(_column: string, options?: { readonly ascending?: boolean }) {
          descending = options?.ascending === false;
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          let matches = rows[table].filter((row) =>
            filters.every(({ column, value }) => row[column] === value)
          );
          if (descending) matches = [...matches].reverse();
          return { data: matches[0] ?? null, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

async function routedActor(
  rows: Readonly<Record<PhaseCTable, readonly Row[]>> = phaseCRows()
): Promise<PhaseCEmailActorContext> {
  phaseCDependencies.getServiceRoleClient.mockReturnValue(phaseCDatabase(rows));
  phaseCDependencies.resolveEmailOpportunityAccess.mockResolvedValue({
    allowed: true,
  });
  const resolution = await resolvePhaseCEmailActor({
    companyId: COMPANY_ID,
    connectionId: CONNECTION_ID,
    opportunityId: OPPORTUNITY_ID,
    internalThreadId: INTERNAL_THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
  });
  if (resolution.kind !== "resolved") {
    throw new Error(`Expected routed actor: ${resolution.reason}`);
  }
  return resolution.context;
}

function authority(
  overrides: Partial<ActorAuthoritySnapshot> = {}
): ActorAuthoritySnapshot {
  return {
    actorUserId: ACTOR_ID,
    companyId: COMPANY_ID,
    isActive: true,
    isAdmin: false,
    roleIds: ["00000000-0000-4000-8000-000000000009"],
    configuredPermissions: ["clients.view", "inbox.view", "pipeline.view"],
    effectivePermissions: [
      { permission: "clients.view", scope: "all" },
      { permission: "inbox.view", scope: "all" },
      { permission: "pipeline.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
    ...overrides,
  };
}

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    requested_job: { kind: "opportunity", id: OPPORTUNITY_ID },
    read_at: "2026-08-14T17:59:00.000Z",
    permission_snapshot_revision: PERMISSION_REVISION,
    source_state_revision: 1,
    last_turn_sequence: 1,
    current_version: {
      id: "00000000-0000-4000-8000-00000000000c",
      version_number: 1,
      turn_high_watermark_id: TURN_ID,
      turn_high_watermark_sequence: 1,
      source_state_revision: 1,
      memory_document: EMPTY_MEMORY_DOCUMENT,
      memory_document_hash: MEMORY_HASH,
      generator_revision: "phase-c-memory:v1",
      created_at: "2026-08-14T17:45:00.000Z",
    },
    recent_turns: [
      {
        id: TURN_ID,
        turn_sequence: 1,
        source_state_revision: 1,
        side: "user",
        participant_id: "client:primary",
        participant_resolution_status: "resolved",
        participant_resolution_revision: "job-participant-side:v2",
        direction: "inbound",
        channel: "email",
        delivered_at: "2026-08-14T17:30:00.000Z",
        ingested_at: "2026-08-14T17:31:00.000Z",
        source_connection_id: CONNECTION_ID,
        provider_message_id: "provider-message-1",
        provider_delivery_source_id: SOURCE_ACTIVITY_ID,
        provider_delivery_source_sha256: CONTENT_HASH,
        source_activity_id: SOURCE_ACTIVITY_ID,
        source_correspondence_event_id: null,
        subject: "Estimate request",
        recipient_identities: ["dispatch@example.com"],
        cc_recipient_identities: [],
        normalized_plain_text: "Can you send the estimate?",
        original_content_hash: CONTENT_HASH,
        attachment_evidence_ids: [],
        evidence_source_revision: "job-conversation-turn-projection:v1:1",
        evidence_content_hash: CONTENT_HASH,
        redaction_kinds: [],
      },
    ],
    recent_turns_omitted_count: 0,
    active_evidence: [
      {
        evidence_id: `job_conversation_turn:${TURN_ID}`,
        purposes: ["triggering_turn"],
        relationships: ["supports"],
        source_domain: "job_conversation",
        source_type: "delivered_email_turn",
        source_id: TURN_ID,
        source_revision: "job-conversation-evidence-projection:v2:1",
        source_content_hash: CONTENT_HASH,
        occurred_at: "2026-08-14T17:30:00.000Z",
        trust: "delivered_correspondence",
        locator: `ops://job-conversations/${CONVERSATION_ID}/turns/${TURN_ID}`,
        excerpt: "Can you send the estimate?",
        excerpt_truncated: false,
        participant_id: "client:primary",
        participant_resolution_status: "resolved",
        participant_resolution_revision: "job-participant-side:v2",
        redaction_kinds: [],
      },
    ],
    active_evidence_total: 1,
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
    required_through: { turn_id: TURN_ID, state: "summarized" },
    ...overrides,
  };
}

function domainHarness(
  options: {
    readonly contextRow?: Record<string, unknown>;
    readonly sourceTurnResponse?: {
      readonly data: unknown;
      readonly error: unknown;
    };
  } = {}
) {
  const contextCalls: Readonly<Record<string, unknown>>[] = [];
  const contextFunctionNames: string[] = [];
  const sourceTurnCalls: Readonly<Record<string, unknown>>[] = [];
  const domainRpcClient = {
    async rpc(name: string, args: Readonly<Record<string, unknown>>) {
      contextFunctionNames.push(name);
      contextCalls.push(args);
      return { data: options.contextRow ?? readyRow(), error: null };
    },
  };
  const cursorCodec = createOperationalReadCursorCodec({
    key: CURSOR_KEY,
    keyId: "phase-c-adapter",
    version: 1,
    now: () => new Date("2026-08-14T18:00:00.000Z"),
  });
  const repositories = createOpsAgentDomainRepositories({
    jobConversationContext:
      createSupabaseJobConversationContextRepository(domainRpcClient),
    scheduledJobs: createSupabaseScheduledJobsRepository(
      domainRpcClient,
      cursorCodec
    ),
    jobReadiness: createSupabaseJobReadinessRepository(
      domainRpcClient,
      cursorCodec
    ),
    jobCommunicationContext:
      createSupabaseJobCommunicationContextRepository(domainRpcClient),
    jobParticipants: createSupabaseJobParticipantsRepository(domainRpcClient),
    customerJobs: createSupabaseCustomerJobsRepository(
      domainRpcClient,
      cursorCodec
    ),
    jobSummary: createSupabaseJobSummaryRepository(domainRpcClient),
    jobHistory: createSupabaseJobHistoryRepository(
      domainRpcClient,
      cursorCodec
    ),
    correspondenceEvidence:
      createSupabaseCorrespondenceEvidencePageRepository(domainRpcClient),
  });
  const service = createOpsAgentDomainService({
    repositories,
    now: () => new Date("2026-08-14T18:00:00.000Z"),
  });
  const sourceTurnRepository = createPhaseCSourceTurnRepository(
    createSupabasePhaseCSourceTurnReadAdapter({
      async rpc(_name, args) {
        sourceTurnCalls.push(args);
        return (
          options.sourceTurnResponse ?? {
            data: [
              {
                turn_id: TURN_ID,
                conversation_id: CONVERSATION_ID,
              },
            ],
            error: null,
          }
        );
      },
    })
  );
  return {
    service,
    contextCalls,
    contextFunctionNames,
    sourceTurnCalls,
    sourceTurnRepository,
  };
}

describe("internal Phase C adapter", () => {
  it("derives actor, company, mailbox, and opportunity from the canonical routed context", async () => {
    expectTypeOf<
      keyof InternalPhaseCConversationContextRequest
    >().toEqualTypeOf<"routedActor" | "sourceActivityId">();
    const {
      service,
      contextCalls,
      contextFunctionNames,
      sourceTurnCalls,
      sourceTurnRepository,
    } = domainHarness();
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });
    expect(Object.isFrozen(adapter)).toBe(true);

    const result = await adapter.getJobConversationContext({
      routedActor: await routedActor(),
      sourceActivityId: SOURCE_ACTIVITY_ID,
    });

    expect(result).toMatchObject({
      company_id: COMPANY_ID,
      actor: {
        user_id: ACTOR_ID,
        permission_snapshot_revision: PERMISSION_REVISION,
      },
      data: {
        conversation_id: CONVERSATION_ID,
        requested_job: { kind: "opportunity", id: OPPORTUNITY_ID },
      },
    });
    expect(result.data.sections).toContainEqual(
      expect.objectContaining({
        kind: "freshness_and_gaps",
        required_through: { turn_id: TURN_ID, state: "summarized" },
      })
    );
    expect(result.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(sourceTurnCalls).toEqual([
      {
        p_company_id: COMPANY_ID,
        p_opportunity_id: OPPORTUNITY_ID,
        p_actor_user_id: ACTOR_ID,
        p_assignment_version: 7,
        p_connection_id: CONNECTION_ID,
        p_internal_thread_id: INTERNAL_THREAD_ID,
        p_provider_thread_id: PROVIDER_THREAD_ID,
        p_source_activity_id: SOURCE_ACTIVITY_ID,
      },
    ]);
    expect(contextCalls).toEqual([
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_job_kind: "opportunity",
        p_job_id: OPPORTUNITY_ID,
        p_required_through_turn_id: TURN_ID,
        p_phase_c_assignment_version: 7,
        p_phase_c_connection_id: CONNECTION_ID,
        p_phase_c_internal_thread_id: INTERNAL_THREAD_ID,
        p_phase_c_provider_thread_id: PROVIDER_THREAD_ID,
        p_phase_c_source_activity_id: SOURCE_ACTIVITY_ID,
        p_phase_c_source_turn_id: TURN_ID,
        p_phase_c_source_conversation_id: CONVERSATION_ID,
      }),
    ]);
    expect(contextFunctionNames).toEqual([
      "read_agent_phase_c_job_conversation_context_as_system",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
  });

  it("rejects structural copies of routed authority before any domain read", async () => {
    const { service, contextCalls, sourceTurnCalls, sourceTurnRepository } =
      domainHarness();
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });
    const copy = { ...(await routedActor()) };

    await expect(
      adapter.getJobConversationContext({
        routedActor: copy as PhaseCEmailActorContext,
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(contextCalls).toEqual([]);
    expect(sourceTurnCalls).toEqual([]);
  });

  it("contains hostile request shapes without invoking accessors or leaking trap details", async () => {
    const { service, contextCalls, sourceTurnCalls, sourceTurnRepository } =
      domainHarness();
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });
    const trustedActor = await routedActor();
    const base = {
      routedActor: trustedActor,
      sourceActivityId: SOURCE_ACTIVITY_ID,
    };
    let routedActorReads = 0;
    const accessorRequest = {
      sourceActivityId: SOURCE_ACTIVITY_ID,
    } as Record<string, unknown>;
    Object.defineProperty(accessorRequest, "routedActor", {
      enumerable: true,
      get() {
        routedActorReads += 1;
        throw new Error("private accessor details");
      },
    });
    const withSymbol = { ...base } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("request-secret")] = true;
    const withNonEnumerable = { ...base };
    Object.defineProperty(withNonEnumerable, "hidden", {
      enumerable: false,
      value: "private-value",
    });

    for (const request of [
      accessorRequest,
      { ...base, extra: "private-value" },
      withSymbol,
      withNonEnumerable,
      new Proxy(base, {}),
      new Proxy(base, {
        getOwnPropertyDescriptor() {
          throw new Error("private descriptor details");
        },
      }),
    ]) {
      let caught: unknown;
      try {
        await adapter.getJobConversationContext(request as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ActorAccessError);
      expect(caught).toMatchObject({
        code: "FORBIDDEN",
        message: "Access is not available.",
      });
      expect(
        JSON.stringify((caught as ActorAccessError).toAgentError())
      ).not.toContain("private");
    }

    expect(routedActorReads).toBe(0);
    expect(sourceTurnCalls).toEqual([]);
    expect(contextCalls).toEqual([]);
  });

  it("rejects a noncanonical source activity before any source or domain read", async () => {
    const { service, contextCalls, sourceTurnCalls, sourceTurnRepository } =
      domainHarness();
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });

    const trustedActor = await routedActor();
    for (const sourceActivityId of [
      "activity-latest",
      "00000000-0000-0000-0000-000000000000",
      SOURCE_ACTIVITY_ID.toUpperCase(),
    ]) {
      await expect(
        adapter.getJobConversationContext({
          routedActor: trustedActor,
          sourceActivityId,
        })
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "The input is invalid.",
      });
    }
    expect(contextCalls).toEqual([]);
    expect(sourceTurnCalls).toEqual([]);
  });

  it("rechecks current actor-company authority and fails closed on a routed mismatch", async () => {
    const { service, contextCalls, sourceTurnRepository } = domainHarness();
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(
        authority({ actorUserId: MAILBOX_OWNER_ID })
      ),
      sourceTurnRepository,
    });

    await expect(
      adapter.getJobConversationContext({
        routedActor: await routedActor(),
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(contextCalls).toEqual([]);
  });

  it("does not let broad actor authority bypass a stale assignment fence", async () => {
    const { service, contextCalls, sourceTurnCalls, sourceTurnRepository } =
      domainHarness({
        sourceTurnResponse: { data: [], error: null },
      });
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(
        authority({
          isAdmin: true,
          configuredPermissions: [
            "clients.view",
            "inbox.view",
            "pipeline.view",
          ],
          effectivePermissions: [
            { permission: "clients.view", scope: "all" },
            { permission: "inbox.view", scope: "all" },
            { permission: "pipeline.view", scope: "all" },
          ],
        })
      ),
      sourceTurnRepository,
    });

    await expect(
      adapter.getJobConversationContext({
        routedActor: await routedActor(),
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
    expect(sourceTurnCalls).toEqual([
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_assignment_version: 7,
      }),
    ]);
    expect(contextCalls).toEqual([]);
  });

  it("does not authorize domain work after personal mailbox ownership transfers without an assignment-version change", async () => {
    const initialRows = phaseCRows();
    const personalRows: Readonly<Record<PhaseCTable, readonly Row[]>> = {
      ...initialRows,
      email_connections: [
        {
          ...initialRows.email_connections[0],
          type: "individual",
          user_id: ACTOR_ID,
        },
      ],
    };
    const routed = await routedActor(personalRows);
    expect(routed).toMatchObject({
      actorUserId: ACTOR_ID,
      assignmentVersion: 7,
      connectionType: "individual",
    });

    const { service, contextCalls } = domainHarness();
    const sourceTurnCalls: Readonly<Record<string, unknown>>[] = [];
    let currentOwnerUserId = ACTOR_ID;
    const sourceTurnRepository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({
        async rpc(_name, args) {
          sourceTurnCalls.push(args);
          return {
            data:
              args.p_actor_user_id === currentOwnerUserId
                ? [
                    {
                      turn_id: TURN_ID,
                      conversation_id: CONVERSATION_ID,
                    },
                  ]
                : [],
            error: null,
          };
        },
      })
    );
    currentOwnerUserId = MAILBOX_OWNER_ID;
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });

    await expect(
      adapter.getJobConversationContext({
        routedActor: routed,
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
    });
    expect(sourceTurnCalls).toEqual([
      expect.objectContaining({
        p_actor_user_id: ACTOR_ID,
        p_assignment_version: 7,
      }),
    ]);
    expect(contextCalls).toEqual([]);
  });

  it("resolves source context for a legacy padded canonical personal-mailbox owner", async () => {
    const initialRows = phaseCRows();
    const personalRows: Readonly<Record<PhaseCTable, readonly Row[]>> = {
      ...initialRows,
      email_connections: [
        {
          ...initialRows.email_connections[0],
          type: "individual",
          user_id: `  ${ACTOR_ID}  `,
        },
      ],
    };
    const routed = await routedActor(personalRows);
    expect(routed).toMatchObject({
      actorUserId: ACTOR_ID,
      connectionType: "individual",
    });

    const { service, sourceTurnRepository, contextCalls } = domainHarness();
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });

    await expect(
      adapter.getJobConversationContext({
        routedActor: routed,
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).resolves.toMatchObject({
      data: {
        conversation_id: CONVERSATION_ID,
        requested_job: { kind: "opportunity", id: OPPORTUNITY_ID },
      },
    });
    expect(contextCalls).toHaveLength(1);
  });

  it("contains an unavailable source proof before actor or conversation reads", async () => {
    const { service, contextCalls, sourceTurnCalls, sourceTurnRepository } =
      domainHarness({
        sourceTurnResponse: { data: [], error: null },
      });
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });

    await expect(
      adapter.getJobConversationContext({
        routedActor: await routedActor(),
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Authorization is temporarily unavailable.",
    });
    expect(sourceTurnCalls).toHaveLength(1);
    expect(contextCalls).toEqual([]);
  });

  it.each([
    "provider source id",
    "provider source hash",
    "provider",
    "sender",
    "to recipients",
    "cc recipients",
    "provider thread",
    "provider message",
    "direction",
  ])(
    "does not authorize domain work when the source RPC rejects a mismatched %s",
    async () => {
      const { service, contextCalls, sourceTurnCalls, sourceTurnRepository } =
        domainHarness({
          sourceTurnResponse: { data: [], error: null },
        });
      const adapter = createInternalPhaseCAdapter({
        domainService: service,
        authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
        sourceTurnRepository,
      });

      await expect(
        adapter.getJobConversationContext({
          routedActor: await routedActor(),
          sourceActivityId: SOURCE_ACTIVITY_ID,
        })
      ).rejects.toMatchObject({
        code: "TEMPORARILY_UNAVAILABLE",
        message: "Authorization is temporarily unavailable.",
      });
      expect(sourceTurnCalls).toHaveLength(1);
      expect(contextCalls).toEqual([]);
    }
  );

  it("rejects a domain conversation that differs from the immutable source turn", async () => {
    const mismatchedConversationId = "00000000-0000-4000-8000-00000000000f";
    const { service, sourceTurnRepository, contextCalls } = domainHarness({
      contextRow: readyRow({ conversation_id: mismatchedConversationId }),
    });
    const adapter = createInternalPhaseCAdapter({
      domainService: service,
      authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
      sourceTurnRepository,
    });

    await expect(
      adapter.getJobConversationContext({
        routedActor: await routedActor(),
        sourceActivityId: SOURCE_ACTIVITY_ID,
      })
    ).rejects.toMatchObject({
      code: "INTERNAL",
      message: "Conversation context could not be read.",
    });
    expect(contextCalls).toHaveLength(1);
  });

  it("accepts only the exact domain service minted by the shared factory", () => {
    const fake = {
      getJobConversationContext: vi.fn(),
    } as unknown as OpsAgentDomainService;

    const { sourceTurnRepository } = domainHarness();
    expect(() =>
      createInternalPhaseCAdapter({
        domainService: fake,
        authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
        sourceTurnRepository,
      })
    ).toThrow(TypeError);
  });

  it("accepts only the exact source-turn repository minted by its fixed boundary", () => {
    const { service } = domainHarness();
    const fake = {
      resolve: vi.fn(),
    } as PhaseCSourceTurnRepository;

    expect(() =>
      createInternalPhaseCAdapter({
        domainService: service,
        authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
        sourceTurnRepository: fake,
      })
    ).toThrow(TypeError);
  });
});
