import { describe, expect, it, vi } from "vitest";
import { z } from "zod-v4";

import {
  REGISTERED_ACTOR_PERMISSION_KEYS,
  type ActorAuthoritySnapshot,
} from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { EMPTY_MEMORY_DOCUMENT } from "@/lib/agent-control-plane/memory/memory-schema";
import {
  AgentErrorSchema,
  createAgentResultSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import {
  verifiedInternalPrincipalFixture,
  verifiedPhaseCPrincipalFixture,
} from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { authorizeJobConversationContextRead } from "../job-conversation-context-authorization";
import { createSupabaseJobConversationContextRepository } from "../job-conversation-context-repository";
import {
  getJobConversationContext,
  JobConversationContextReadError,
  MAX_JOB_CONVERSATION_CONTEXT_CHARACTERS,
} from "../get-job-conversation-context";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TURN_ONE = "66666666-6666-4666-8666-666666666661";
const TURN_TWO = "66666666-6666-4666-8666-666666666662";
const TURN_THREE = "66666666-6666-4666-8666-666666666663";
const CONNECTION_ID = "77777777-7777-4777-8777-777777777777";
const PROVIDER_SOURCE_ID = "88888888-8888-4888-8888-888888888888";
const ACTIVITY_ID = "99999999-9999-4999-8999-999999999999";
const INTERNAL_THREAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const PROVIDER_THREAD_ID = "provider-thread-phase-c";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const CONTENT_HASH = `sha256:${"b".repeat(64)}`;
const SOURCE_HASH = `sha256:${"c".repeat(64)}`;
const EVIDENCE_PROJECTION_HASH = `sha256:${"d".repeat(64)}`;
const PARTICIPANT_PROJECTION_HASH = `sha256:${"e".repeat(64)}`;
const CROSS_JOB_PROJECTION_HASH = `sha256:${"f".repeat(64)}`;

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

async function authorizedRead(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const actorContext = await resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-subject-context",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-context-1",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
  const rawInput = {
    job_ref: { kind: "opportunity", id: OPPORTUNITY_ID },
    ...overrides,
  };
  const resolved = resolveCapabilityAuthorization(
    "get_job_conversation_context",
    rawInput
  );
  expect(resolved.variants).toHaveLength(1);
  const authorization = authorizeCapability({
    actorContext,
    policy: resolved.variants[0]!.policy,
  });
  return authorizeJobConversationContextRead({ authorization, rawInput });
}

async function authorizedPhaseCRead(requiredThroughTurnId = TURN_THREE) {
  const actorContext = await resolveActorContext({
    principal: verifiedPhaseCPrincipalFixture({
      actorUserId: ACTOR_ID,
      companyId: COMPANY_ID,
      assignmentVersion: 7,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: INTERNAL_THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      sourceActivityId: ACTIVITY_ID,
      sourceTurnId: TURN_THREE,
      sourceConversationId: CONVERSATION_ID,
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-phase-c-context-1",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
  const rawInput = {
    job_ref: { kind: "opportunity" as const, id: OPPORTUNITY_ID },
    required_through_turn_id: requiredThroughTurnId,
  };
  const resolved = resolveCapabilityAuthorization(
    "get_job_conversation_context",
    rawInput
  );
  const authorization = authorizeCapability({
    actorContext,
    policy: resolved.variants[0]!.policy,
  });
  return authorizeJobConversationContextRead({ authorization, rawInput });
}

function turn(
  id: string,
  turnSequence: number,
  text = `Exact delivered turn ${turnSequence}`
) {
  return {
    id,
    turn_sequence: turnSequence,
    source_state_revision: turnSequence,
    side: turnSequence % 2 === 1 ? "user" : "assistant",
    participant_id:
      turnSequence % 2 === 1 ? "client:customer-1" : `ops_user:${ACTOR_ID}`,
    participant_resolution_status: "resolved",
    participant_resolution_revision: "job-participant-side:v1",
    direction: turnSequence % 2 === 1 ? "inbound" : "outbound",
    channel: "email",
    delivered_at: `2026-08-0${turnSequence}T12:00:00.000Z`,
    ingested_at: `2026-08-0${turnSequence}T12:01:00.000Z`,
    source_connection_id: CONNECTION_ID,
    provider_message_id: `provider-message-${turnSequence}`,
    provider_delivery_source_id: PROVIDER_SOURCE_ID,
    provider_delivery_source_sha256: SOURCE_HASH,
    source_activity_id: ACTIVITY_ID,
    source_correspondence_event_id: null,
    subject: `Subject ${turnSequence}`,
    recipient_identities: ["ops@example.com"],
    cc_recipient_identities: [],
    normalized_plain_text: text,
    original_content_hash: CONTENT_HASH,
    attachment_evidence_ids: [],
    evidence_source_revision: `job-conversation-turn-projection:v1:${turnSequence}`,
    evidence_content_hash: CONTENT_HASH,
    redaction_kinds: [],
  };
}

function snapshot(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    requested_job: { kind: "opportunity", id: OPPORTUNITY_ID },
    read_at: "2026-08-11T12:00:00.000Z",
    permission_snapshot_revision: PERMISSION_REVISION,
    source_state_revision: 3,
    last_turn_sequence: 3,
    current_version: {
      id: VERSION_ID,
      version_number: 2,
      turn_high_watermark_id: TURN_THREE,
      turn_high_watermark_sequence: 3,
      source_state_revision: 3,
      memory_document: {
        ...EMPTY_MEMORY_DOCUMENT,
        facts: [
          {
            statement: "The client approved cedar.",
            evidence: [
              {
                evidence_id: `job_conversation_turn:${TURN_ONE}`,
                relationship: "supports",
              },
            ],
          },
        ],
      },
      memory_document_hash: CONTENT_HASH,
      generator_revision: "phase-c-memory:v1",
      created_at: "2026-08-11T11:59:00.000Z",
    },
    recent_turns: [turn(TURN_ONE, 1), turn(TURN_TWO, 2), turn(TURN_THREE, 3)],
    recent_turns_omitted_count: 0,
    active_evidence: [
      {
        evidence_id: `job_conversation_turn:${TURN_ONE}`,
        purposes: ["active_memory_claim"],
        relationships: ["supports"],
        source_domain: "job_conversation",
        source_type: "delivered_email_turn",
        source_id: TURN_ONE,
        source_revision: "job-conversation-evidence-projection:v2:1",
        source_content_hash: EVIDENCE_PROJECTION_HASH,
        occurred_at: "2026-08-01T12:00:00.000Z",
        trust: "delivered_correspondence",
        locator: `ops://job-conversations/${CONVERSATION_ID}/turns/${TURN_ONE}`,
        excerpt: "Exact delivered turn 1",
        excerpt_truncated: false,
        participant_id: "client:customer-1",
        participant_resolution_status: "resolved",
        participant_resolution_revision: "job-participant-side:v1",
        redaction_kinds: [],
      },
    ],
    active_evidence_total: 1,
    participants: [
      {
        participant_id: "client:customer-1",
        side: "user",
        participant_resolution_status: "resolved",
        participant_resolution_revision: "job-participant-side:v1",
        evidence_ids: [`job_conversation_turn:${TURN_ONE}`],
        evidence_id_total: 1,
        redaction_kinds: [],
        primary_evidence: {
          evidence_id: `job_conversation_turn:${TURN_ONE}`,
          source_domain: "job_conversation",
          source_type: "delivered_email_participant_resolution",
          source_id: TURN_ONE,
          source_revision: "job-conversation-participant-projection:v1:1",
          source_content_hash: PARTICIPANT_PROJECTION_HASH,
          occurred_at: "2026-08-01T12:00:00.000Z",
          relationship: "supports",
          locator: `ops://job-conversations/${CONVERSATION_ID}/turns/${TURN_ONE}#participant`,
          trust: "delivered_correspondence",
        },
      },
    ],
    participant_total: 1,
    cross_job_seed: {
      state: "available",
      customer_has_prior_ops_jobs: true,
      visible_prior_job_count: 2,
      latest_visible_prior_job: {
        date: "2026-07-15",
        status: "completed",
      },
      relationship_continuity: {
        marker: "returning_customer",
        evidence_id: `customer_job_history:${CLIENT_ID}`,
      },
      evidence: {
        evidence_id: `customer_job_history:${CLIENT_ID}`,
        source_domain: "customer_jobs",
        source_type: "visible_prior_job_snapshot",
        source_id: CLIENT_ID,
        source_revision: `customer-job-history-projection:v1:${CROSS_JOB_PROJECTION_HASH}`,
        source_content_hash: CROSS_JOB_PROJECTION_HASH,
        occurred_at: "2026-08-11T12:00:00.000Z",
        relationship: "supports",
        locator: `ops://customers/${CLIENT_ID}/jobs`,
        trust: "authoritative_ops",
      },
    },
    invalidated_evidence_ids: [],
    invalidated_evidence_total: 0,
    required_through: { turn_id: null, state: "not_requested" },
    ...overrides,
  };
}

class StubContextRpcClient {
  readonly calls: {
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }[] = [];
  readonly results: unknown[];

  constructor(...results: unknown[]) {
    this.results = [...results];
  }

  async rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    return { data: this.results.shift(), error: null };
  }
}

describe("getJobConversationContext", () => {
  it("binds Phase C reads to the exact routed source proof and v7 context RPC", async () => {
    const authorization = await authorizedPhaseCRead();
    const client = new StubContextRpcClient(
      snapshot({
        required_through: { turn_id: TURN_THREE, state: "pending" },
      })
    );

    await createSupabaseJobConversationContextRepository(client).read({
      authorization,
    });

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_phase_c_job_conversation_context_as_system",
        args: expect.objectContaining({
          p_capability_manifest_revision: "2026-08-20.capability-manifest.v7",
          p_job_kind: "opportunity",
          p_job_id: OPPORTUNITY_ID,
          p_required_through_turn_id: TURN_THREE,
          p_phase_c_assignment_version: 7,
          p_phase_c_connection_id: CONNECTION_ID,
          p_phase_c_internal_thread_id: INTERNAL_THREAD_ID,
          p_phase_c_provider_thread_id: PROVIDER_THREAD_ID,
          p_phase_c_source_activity_id: ACTIVITY_ID,
          p_phase_c_source_turn_id: TURN_THREE,
          p_phase_c_source_conversation_id: CONVERSATION_ID,
        }),
      },
    ]);
  });

  it("rejects a Phase C read whose requested watermark differs from its source turn", async () => {
    const authorization = await authorizedPhaseCRead(TURN_TWO);
    const client = new StubContextRpcClient(snapshot());

    await expect(
      createSupabaseJobConversationContextRepository(client).read({
        authorization,
      })
    ).rejects.toMatchObject({ code: "JOB_CONVERSATION_CONTEXT_INVALID" });
    expect(client.calls).toEqual([]);
  });

  it("returns the canonical ordered prompt bundle with exact turns and source evidence", async () => {
    const authorization = await authorizedRead();
    const client = new StubContextRpcClient(snapshot());
    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
      now: () => new Date("2026-08-11T12:00:01.000Z"),
    });

    expect(result.data.sections.map((section) => section.kind)).toEqual([
      "memory",
      "recent_turns",
      "source_evidence",
      "participants",
      "cross_job_seed",
      "freshness_and_gaps",
    ]);
    expect(result.data.sections[1]).toMatchObject({
      kind: "recent_turns",
      turns: [
        { turn_id: TURN_ONE, normalized_plain_text: "Exact delivered turn 1" },
        { turn_id: TURN_TWO, normalized_plain_text: "Exact delivered turn 2" },
        {
          turn_id: TURN_THREE,
          normalized_plain_text: "Exact delivered turn 3",
        },
      ],
    });
    expect(result.data.sections[2]).toMatchObject({
      kind: "source_evidence",
      evidence: [
        {
          evidence_id: `job_conversation_turn:${TURN_ONE}`,
          source_revision: "job-conversation-evidence-projection:v2:1",
          source_content_hash: EVIDENCE_PROJECTION_HASH,
          excerpt: "Exact delivered turn 1",
          excerpt_truncated: false,
        },
      ],
    });
    expect(result.data.sections[1]).toMatchObject({
      kind: "recent_turns",
      turns: [
        {
          turn_id: TURN_ONE,
          source_revision: "job-conversation-turn-projection:v1:1",
          source_content_hash: CONTENT_HASH,
        },
        expect.anything(),
        expect.anything(),
      ],
    });
    expect(result).toMatchObject({
      contract_version: "2026-08-07.v1",
      request_id: "request-context-1",
      generated_at: "2026-08-11T12:00:01.000Z",
      company_id: COMPANY_ID,
      actor: {
        user_id: ACTOR_ID,
        permission_snapshot_revision: PERMISSION_REVISION,
      },
      freshness: {
        read_at: "2026-08-11T12:00:00.000Z",
        memory_version: 2,
        turn_high_watermark_id: TURN_THREE,
      },
      warnings: [],
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence_id: `job_conversation_turn:${TURN_ONE}`,
          version: "job-conversation-participant-projection:v1:1",
          source_type: "delivered_email_participant_resolution",
        }),
        expect.objectContaining({
          evidence_id: `customer_job_history:${CLIENT_ID}`,
          version: `customer-job-history-projection:v1:${CROSS_JOB_PROJECTION_HASH}`,
          source_type: "visible_prior_job_snapshot",
        }),
      ])
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_JOB_CONVERSATION_CONTEXT_CHARACTERS
    );
    expect(createAgentResultSchema(z.unknown()).safeParse(result).success).toBe(
      true
    );
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      functionName: "read_agent_job_conversation_context_as_system",
      args: {
        p_request_id: "request-context-1",
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_permission_snapshot_revision: PERMISSION_REVISION,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_id: "get_job_conversation_context",
        p_capability_revision: "get_job_conversation_context:2026-08-07.v1",
        p_capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
        p_job_kind: "opportunity",
        p_job_id: OPPORTUNITY_ID,
        p_exact_turn_limit: 20,
        p_sections: [
          "memory",
          "recent_turns",
          "participants",
          "gaps",
          "cross_job_seed",
        ],
      },
    });
  });

  it("catches memory up through the triggering turn and then rereads current authorized data", async () => {
    const authorization = await authorizedRead({
      required_through_turn_id: TURN_THREE,
    });
    const client = new StubContextRpcClient(
      snapshot({
        current_version: null,
        active_evidence: [],
        required_through: { turn_id: TURN_THREE, state: "pending" },
      }),
      snapshot({
        required_through: { turn_id: TURN_THREE, state: "summarized" },
        active_evidence: [
          {
            ...snapshot().active_evidence[0],
            evidence_id: `job_conversation_turn:${TURN_THREE}`,
            purposes: ["triggering_turn"],
            source_id: TURN_THREE,
            source_revision: "job-conversation-evidence-projection:v2:3",
            occurred_at: "2026-08-03T12:00:00.000Z",
            excerpt: "Exact delivered turn 3",
          },
        ],
      })
    );
    const catchUpMemory = vi.fn().mockResolvedValue(undefined);

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
      catchUpMemory,
      now: () => new Date("2026-08-11T12:00:01.000Z"),
    });

    expect(catchUpMemory).toHaveBeenCalledOnce();
    expect(catchUpMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        requiredThroughTurnId: TURN_THREE,
      })
    );
    expect(client.calls).toHaveLength(2);
    expect(result.freshness.turn_high_watermark_id).toBe(TURN_THREE);
  });

  it("returns a typed stale error with exact current markers when catch-up cannot satisfy the trigger", async () => {
    const authorization = await authorizedRead({
      required_through_turn_id: TURN_THREE,
    });
    const pending = snapshot({
      current_version: {
        ...snapshot().current_version,
        version_number: 1,
        turn_high_watermark_id: TURN_TWO,
        turn_high_watermark_sequence: 2,
      },
      required_through: { turn_id: TURN_THREE, state: "pending" },
    });
    const client = new StubContextRpcClient(pending, pending);

    try {
      await getJobConversationContext({
        authorization,
        repository: createSupabaseJobConversationContextRepository(client),
        catchUpMemory: vi.fn().mockResolvedValue(undefined),
      });
      throw new Error("Expected stale context");
    } catch (error) {
      expect(error).toMatchObject({
        name: "JobConversationContextReadError",
        code: "STALE_CONTEXT",
        currentMemoryVersion: 1,
        currentTurnHighWatermarkId: TURN_TWO,
      } satisfies Partial<JobConversationContextReadError>);
      expect(
        AgentErrorSchema.safeParse(
          (error as JobConversationContextReadError).toAgentError()
        ).success
      ).toBe(true);
    }
  });

  it("drops oldest optional exact turns before exceeding the complete 60k result budget", async () => {
    const authorization = await authorizedRead();
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [
          turn(TURN_ONE, 1, "A".repeat(20_000)),
          turn(TURN_TWO, 2, "B".repeat(20_000)),
          turn(TURN_THREE, 3, "C".repeat(20_000)),
        ],
        active_evidence: [
          {
            ...snapshot().active_evidence[0],
            excerpt: "A".repeat(4_000),
            excerpt_truncated: true,
          },
        ],
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });
    const recent = result.data.sections.find(
      (section) => section.kind === "recent_turns"
    );
    const freshness = result.data.sections.find(
      (section) => section.kind === "freshness_and_gaps"
    );

    expect(recent).toMatchObject({
      kind: "recent_turns",
      turns: [{ turn_id: TURN_TWO }, { turn_id: TURN_THREE }],
    });
    expect(freshness).toMatchObject({
      kind: "freshness_and_gaps",
      gaps: [
        expect.objectContaining({ code: "RECENT_TURNS_CHARACTER_BUDGET" }),
      ],
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_JOB_CONVERSATION_CONTEXT_CHARACTERS
    );
  });

  it("never returns a memory claim after its exact active evidence is unavailable", async () => {
    const authorization = await authorizedRead();
    const client = new StubContextRpcClient(
      snapshot({
        active_evidence: [],
        active_evidence_total: 1,
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });
    const memory = result.data.sections.find(
      (section) => section.kind === "memory"
    );
    const freshness = result.data.sections.find(
      (section) => section.kind === "freshness_and_gaps"
    );

    expect(memory).toMatchObject({
      kind: "memory",
      memory_document: { facts: [] },
      memory_projection: {
        excluded_evidence_ids: [`job_conversation_turn:${TURN_ONE}`],
      },
    });
    expect(freshness).toMatchObject({
      kind: "freshness_and_gaps",
      gaps: expect.arrayContaining([
        expect.objectContaining({ code: "MEMORY_EVIDENCE_UNAVAILABLE" }),
        expect.objectContaining({ code: "SOURCE_EVIDENCE_QUERY_BOUND" }),
      ]),
    });
  });

  it("accepts a capped invalidation projection while preserving the exact total and removing affected claims", async () => {
    const authorization = await authorizedRead({ sections: ["memory"] });
    const invalidatedEvidenceIds = [
      `job_conversation_turn:${TURN_ONE}`,
      ...Array.from({ length: 99 }, (_, index) => {
        const suffix = (index + 1).toString(16).padStart(12, "0");
        return `job_conversation_turn:cccccccc-cccc-4ccc-8ccc-${suffix}`;
      }),
    ];
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [],
        active_evidence: [],
        active_evidence_total: 0,
        invalidated_evidence_ids: invalidatedEvidenceIds,
        invalidated_evidence_total: 101,
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });
    const memory = result.data.sections.find(
      (section) => section.kind === "memory"
    );
    const freshness = result.data.sections.find(
      (section) => section.kind === "freshness_and_gaps"
    );

    expect(memory).toMatchObject({
      kind: "memory",
      memory_document: { facts: [] },
    });
    expect(freshness).toMatchObject({
      kind: "freshness_and_gaps",
      gaps: expect.arrayContaining([
        expect.objectContaining({
          code: "MEMORY_EVIDENCE_INVALIDATED",
          omitted_count: 101,
        }),
      ]),
    });
  });

  it("returns participants when they are the only requested source section", async () => {
    const authorization = await authorizedRead({ sections: ["participants"] });
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [],
        active_evidence: [],
        active_evidence_total: 0,
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });

    expect(result.data.sections.map((section) => section.kind)).toEqual([
      "source_evidence",
      "participants",
      "freshness_and_gaps",
    ]);
    expect(result.data.sections[1]).toMatchObject({
      kind: "participants",
      participants: [
        expect.objectContaining({
          participant_id: "client:customer-1",
          primary_evidence: expect.objectContaining({
            source_revision: "job-conversation-participant-projection:v1:1",
            source_content_hash: PARTICIPANT_PROJECTION_HASH,
          }),
        }),
      ],
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        evidence_id: `job_conversation_turn:${TURN_ONE}`,
        version: "job-conversation-participant-projection:v1:1",
      }),
    ]);
    expect(result.freshness.source_versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: TURN_ONE,
          version: "job-conversation-participant-projection:v1:1",
        }),
      ])
    );
    expect(client.calls[0]?.args.p_sections).toEqual(["participants"]);
  });

  it("returns a versioned actor-scoped proof when cross-job seed is the only requested source section", async () => {
    const authorization = await authorizedRead({
      sections: ["cross_job_seed"],
    });
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [],
        active_evidence: [],
        active_evidence_total: 0,
        participants: [],
        participant_total: 0,
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });

    expect(result.data.sections.map((section) => section.kind)).toEqual([
      "source_evidence",
      "cross_job_seed",
      "freshness_and_gaps",
    ]);
    expect(result.data.sections[1]).toMatchObject({
      kind: "cross_job_seed",
      seed: {
        evidence: {
          evidence_id: `customer_job_history:${CLIENT_ID}`,
          source_content_hash: CROSS_JOB_PROJECTION_HASH,
        },
      },
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        evidence_id: `customer_job_history:${CLIENT_ID}`,
        version: `customer-job-history-projection:v1:${CROSS_JOB_PROJECTION_HASH}`,
        trust: "authoritative_ops",
      }),
    ]);
    expect(result.freshness.source_versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: CLIENT_ID,
          version: `customer-job-history-projection:v1:${CROSS_JOB_PROJECTION_HASH}`,
        }),
      ])
    );
  });

  it("keeps a versioned proof when the resolved customer has no visible prior jobs", async () => {
    const authorization = await authorizedRead({
      sections: ["cross_job_seed"],
    });
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [],
        active_evidence: [],
        active_evidence_total: 0,
        participants: [],
        participant_total: 0,
        cross_job_seed: {
          state: "available",
          customer_has_prior_ops_jobs: false,
          visible_prior_job_count: 0,
          latest_visible_prior_job: null,
          relationship_continuity: null,
          evidence: { ...snapshot().cross_job_seed.evidence },
        },
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });

    expect(result.data.sections[1]).toMatchObject({
      kind: "cross_job_seed",
      seed: {
        state: "available",
        customer_has_prior_ops_jobs: false,
        visible_prior_job_count: 0,
        evidence: {
          evidence_id: `customer_job_history:${CLIENT_ID}`,
          source_content_hash: CROSS_JOB_PROJECTION_HASH,
        },
      },
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        evidence_id: `customer_job_history:${CLIENT_ID}`,
        version: `customer-job-history-projection:v1:${CROSS_JOB_PROJECTION_HASH}`,
      }),
    ]);
  });

  it("represents a job without a resolved customer as unknown instead of false history", async () => {
    const authorization = await authorizedRead({
      sections: ["cross_job_seed"],
    });
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [],
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
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });

    expect(result.data.sections[1]).toMatchObject({
      kind: "cross_job_seed",
      seed: {
        state: "customer_unresolved",
        customer_has_prior_ops_jobs: null,
        visible_prior_job_count: null,
        evidence: null,
      },
    });
    expect(result.evidence).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CROSS_JOB_CUSTOMER_UNRESOLVED" }),
      ])
    );
  });

  it("drops complete participant claim-and-proof pairs when their bounded SQL result still exceeds 60k", async () => {
    const authorization = await authorizedRead({ sections: ["participants"] });
    let nextEvidenceId = 1;
    const participants = Array.from({ length: 50 }, (_, participantIndex) => {
      const evidenceIds = Array.from({ length: 50 }, () => {
        const suffix = (nextEvidenceId++).toString(16).padStart(12, "0");
        return `job_conversation_turn:bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`;
      });
      const sourceId = evidenceIds[0]!.slice("job_conversation_turn:".length);
      return {
        participant_id: `client:${"x".repeat(480)}:${participantIndex}`,
        side: "user",
        participant_resolution_status: "resolved",
        participant_resolution_revision: "job-participant-side:v1",
        evidence_ids: evidenceIds,
        evidence_id_total: evidenceIds.length,
        redaction_kinds: [],
        primary_evidence: {
          evidence_id: evidenceIds[0],
          source_domain: "job_conversation",
          source_type: "delivered_email_participant_resolution",
          source_id: sourceId,
          source_revision: "job-conversation-participant-projection:v1:1",
          source_content_hash: PARTICIPANT_PROJECTION_HASH,
          occurred_at: "2026-08-01T12:00:00.000Z",
          relationship: "supports",
          locator: `ops://job-conversations/${CONVERSATION_ID}/turns/${sourceId}#participant`,
          trust: "delivered_correspondence",
        },
      };
    });
    const client = new StubContextRpcClient(
      snapshot({
        recent_turns: [],
        active_evidence: [],
        active_evidence_total: 0,
        participants,
        participant_total: participants.length,
      })
    );

    const result = await getJobConversationContext({
      authorization,
      repository: createSupabaseJobConversationContextRepository(client),
    });
    const participantSection = result.data.sections.find(
      (section) => section.kind === "participants"
    );
    const freshness = result.data.sections.find(
      (section) => section.kind === "freshness_and_gaps"
    );

    expect(participantSection).toMatchObject({ kind: "participants" });
    if (!participantSection || participantSection.kind !== "participants") {
      throw new Error("Expected participants");
    }
    expect(participantSection.participants.length).toBeGreaterThan(0);
    expect(participantSection.participants.length).toBeLessThan(50);
    expect(result.evidence).toHaveLength(
      participantSection.participants.length
    );
    expect(
      participantSection.participants.every((participant) =>
        result.evidence.some(
          (evidence) =>
            evidence.evidence_id === participant.primary_evidence.evidence_id
        )
      )
    ).toBe(true);
    expect(freshness).toMatchObject({
      kind: "freshness_and_gaps",
      gaps: expect.arrayContaining([
        expect.objectContaining({ code: "PARTICIPANT_QUERY_BOUND" }),
      ]),
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      MAX_JOB_CONVERSATION_CONTEXT_CHARACTERS
    );
  });

  it("fails closed on a tenant or requested-job mismatch from the service-role RPC", async () => {
    const authorization = await authorizedRead();
    for (const malformed of [
      snapshot({
        company_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      }),
      snapshot({
        requested_job: {
          kind: "opportunity",
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        },
      }),
      snapshot({
        recent_turns: [turn(TURN_ONE, 1), turn(TURN_THREE, 3)],
      }),
      snapshot({
        invalidated_evidence_ids: [`job_conversation_turn:${TURN_ONE}`],
        invalidated_evidence_total: 0,
      }),
      snapshot({
        cross_job_seed: {
          ...snapshot().cross_job_seed,
          customer_has_prior_ops_jobs: false,
        },
      }),
      snapshot({
        active_evidence: [
          {
            ...snapshot().active_evidence[0],
            excerpt: "A different projection for the same source turn",
          },
        ],
      }),
      snapshot({
        participants: [
          {
            ...snapshot().participants[0],
            primary_evidence: {
              ...snapshot().participants[0].primary_evidence,
              source_id: TURN_TWO,
            },
          },
        ],
      }),
      snapshot({
        cross_job_seed: {
          ...snapshot().cross_job_seed,
          evidence: {
            ...snapshot().cross_job_seed.evidence,
            source_content_hash: CONTENT_HASH,
          },
        },
      }),
    ]) {
      const client = new StubContextRpcClient(malformed);
      await expect(
        getJobConversationContext({
          authorization,
          repository: createSupabaseJobConversationContextRepository(client),
        })
      ).rejects.toMatchObject({ code: "INTERNAL" });
    }
  });

  it("maps the RPC's privacy-safe not-found signal without exposing entity details", async () => {
    const authorization = await authorizedRead();
    const repository = createSupabaseJobConversationContextRepository({
      async rpc() {
        return {
          data: null,
          error: {
            code: "P0002",
            message: "agent_job_conversation_context_not_found",
          },
        };
      },
    });

    try {
      await getJobConversationContext({ authorization, repository });
      throw new Error("Expected a privacy-safe not-found error");
    } catch (error) {
      expect(error).toBeInstanceOf(JobConversationContextReadError);
      const typed = error as JobConversationContextReadError;
      expect(typed.code).toBe("NOT_FOUND");
      expect(typed.toAgentError()).toEqual({
        contract_version: "2026-08-07.v1",
        request_id: "request-context-1",
        message: "Conversation context is not available.",
        retryable: false,
        code: "NOT_FOUND",
      });
      expect(JSON.stringify(typed.toAgentError())).not.toContain(
        OPPORTUNITY_ID
      );
    }
  });
});
