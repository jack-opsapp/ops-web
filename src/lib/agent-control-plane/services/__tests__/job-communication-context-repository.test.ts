import { describe, expect, it } from "vitest";

import {
  REGISTERED_ACTOR_PERMISSION_KEYS,
  type ActorAuthoritySnapshot,
} from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type { ParsedJobCommunicationContextInput } from "@/lib/agent-control-plane/contracts";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { authorizeJobCommunicationRead } from "../job-communication-authorization";
import type {
  JobCommunicationContextSnapshot,
  RawJobParticipant,
} from "../communication-participant-snapshot";
import {
  createSupabaseJobCommunicationContextRepository,
  isTrustedJobCommunicationContextRepository,
  JobCommunicationContextRepositoryError,
} from "../job-communication-context-repository";
import { hashOperationalProjection } from "../operational-read-projection";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const CONTACTABILITY_DIGEST = `sha256:${"b".repeat(64)}`;
const READ_AT = "2026-08-13T18:00:00.000Z";
const SOURCE_REVISION = 73;
const CONTACTABILITY_REVISION = 19;
const CAPABILITY_ID = "get_job_communication_context" as const;
const CAPABILITY_REVISION = `${CAPABILITY_ID}:2026-08-13.v1` as const;
const INPUT: ParsedJobCommunicationContextInput = {
  job_ref: { kind: "project" as const, id: PROJECT_ID },
  purpose: "general" as const,
};

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

class StubRpcClient {
  readonly calls: Array<{
    readonly functionName: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(private readonly result: RpcResult) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const request = Promise.resolve(this.result);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
  }
}

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
      "inbox.view",
      "projects.view",
      "tasks.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "own" },
      { permission: "clients.view", scope: "assigned" },
      { permission: "inbox.view", scope: "own" },
      { permission: "projects.view", scope: "assigned" },
      { permission: "tasks.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function authorizedRead(rawInput = INPUT) {
  const actor = await resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-task12-communication",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-task12-communication",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
  const resolved = resolveCapabilityAuthorization(CAPABILITY_ID, rawInput);
  return authorizeJobCommunicationRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext: actor, policy: variant.policy })
    ),
    rawInput,
  });
}

function sourceVersion(sourceType: string, sourceId: string, version: string) {
  return {
    source_domain: "operations",
    source_type: sourceType,
    source_id: sourceId,
    version,
  };
}

function participantRow(): RawJobParticipant {
  return {
    source_kind: "primary_client",
    participant_ref: { kind: "client", id: CLIENT_ID },
    display_name: "Morgan Client",
    role_label: null,
    conversation_side: "user",
    resolution_status: "confirmed",
    resolution_basis: "job_client",
    resolution_revision: "job-participant-resolution:v1",
    candidate_count: null,
    email_source: {
      state: "available",
      normalized_address: "morgan@example.com",
    },
    evidence_ids: ["delivered_email:message-1"],
    evidence_id_total: 1,
  };
}

function validSnapshot(): JobCommunicationContextSnapshot {
  const row = participantRow();
  const raw = {
    purpose: "general" as const,
    job_address: "1432 Marine Drive, North Vancouver, BC",
    safe_job_description: "Replace fascia and inspect the roof edge.",
    participant_total: 1,
    participants_omitted_count: 0,
    participant_count_completeness: "exact" as const,
    gaps: [],
  };
  const sourceFence = sourceVersion(
    "operational_read_revision",
    "private.agent_operational_read_revisions",
    `revision:${SOURCE_REVISION}`
  );
  const contactabilitySource = sourceVersion(
    "contactability_revision",
    CONTACTABILITY_DIGEST,
    `revision:${CONTACTABILITY_REVISION}`
  );
  const participantProjection = {
    actor_user_id: ACTOR_ID,
    capability_id: CAPABILITY_ID,
    capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
    capability_revision: CAPABILITY_REVISION,
    company_id: COMPANY_ID,
    contactability_digest: CONTACTABILITY_DIGEST,
    contactability_revision: CONTACTABILITY_REVISION,
    job_ref: INPUT.job_ref,
    permission_snapshot_revision: PERMISSION_REVISION,
    purpose: INPUT.purpose,
    participant: row,
    read_at: READ_AT,
    source_revision: SOURCE_REVISION,
  };
  const participantHash = hashOperationalProjection(participantProjection);
  const participantSource = sourceVersion(
    "job_participant_projection",
    CLIENT_ID,
    `job-participant-projection:v1:${participantHash}`
  );
  const participantEvidenceId = `evidence:job_participant_projection:project:${PROJECT_ID}:${CLIENT_ID}`;
  const contextProjection = {
    actor_user_id: ACTOR_ID,
    capability_id: CAPABILITY_ID,
    capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
    capability_revision: CAPABILITY_REVISION,
    company_id: COMPANY_ID,
    contactability_digest: CONTACTABILITY_DIGEST,
    contactability_revision: CONTACTABILITY_REVISION,
    job_ref: INPUT.job_ref,
    permission_snapshot_revision: PERMISSION_REVISION,
    purpose: INPUT.purpose,
    context: raw,
    participant_proof_sources: [participantSource],
    read_at: READ_AT,
    source_revision: SOURCE_REVISION,
  };
  const contextHash = hashOperationalProjection(contextProjection);
  const contextSource = sourceVersion(
    "job_communication_context_projection",
    `project:${PROJECT_ID}`,
    `job-communication-context-projection:v1:${contextHash}`
  );
  const contextEvidenceId = `evidence:job_communication_context_projection:project:${PROJECT_ID}:general`;
  return {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_fence: sourceFence,
    contactability_fence: contactabilitySource,
    requested_job: INPUT.job_ref,
    participant_claims: [
      {
        raw: row,
        proof: {
          source_version: participantSource,
          source_content_hash: participantHash,
          evidence_id: participantEvidenceId,
          projection: participantProjection,
        },
        source_version: participantSource,
        evidence: [
          {
            evidence_id: participantEvidenceId,
            ...participantSource,
            occurred_at: READ_AT,
            relationship: "supports",
            trust: "authoritative_ops",
            locator: `ops://jobs/project/${PROJECT_ID}`,
          },
        ],
      },
    ],
    participant_total: 1,
    participants_omitted_count: 0,
    participant_count_completeness: "exact" as const,
    gaps: [],
    purpose: INPUT.purpose,
    context_claim: {
      raw,
      proof: {
        source_version: contextSource,
        source_content_hash: contextHash,
        evidence_id: contextEvidenceId,
        projection: contextProjection,
      },
      source_version: contextSource,
      evidence: [
        {
          evidence_id: contextEvidenceId,
          ...contextSource,
          occurred_at: READ_AT,
          relationship: "supports",
          trust: "authoritative_ops",
          locator: `ops://jobs/project/${PROJECT_ID}`,
        },
      ],
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function recoupleParticipantAndContext(
  snapshot: ReturnType<typeof validSnapshot>
) {
  const claim = snapshot.participant_claims[0]!;
  claim.proof.projection.participant = claim.raw as never;
  const participantHash = hashOperationalProjection(
    claim.proof.projection as never
  );
  const participantVersion = `job-participant-projection:v1:${participantHash}`;
  claim.proof.source_content_hash = participantHash;
  claim.proof.source_version.version = participantVersion;
  claim.source_version.version = participantVersion;
  claim.evidence[0]!.version = participantVersion;
  snapshot.context_claim.proof.projection.participant_proof_sources = [
    claim.source_version,
  ];
  const contextHash = hashOperationalProjection(
    snapshot.context_claim.proof.projection as never
  );
  const contextVersion = `job-communication-context-projection:v1:${contextHash}`;
  snapshot.context_claim.proof.source_content_hash = contextHash;
  snapshot.context_claim.proof.source_version.version = contextVersion;
  snapshot.context_claim.source_version.version = contextVersion;
  snapshot.context_claim.evidence[0]!.version = contextVersion;
}

function scheduleNoticeSnapshot() {
  const snapshot = clone(validSnapshot());
  const raw = {
    purpose: "schedule_notice" as const,
    job_address: snapshot.context_claim.raw.job_address,
    safe_job_description: snapshot.context_claim.raw.safe_job_description,
    participant_total: snapshot.participant_total,
    participants_omitted_count: snapshot.participants_omitted_count,
    participant_count_completeness: snapshot.participant_count_completeness,
    gaps: ["SCHEDULE_SOURCE_UNAVAILABLE" as const],
    schedule: {
      status: "not_evaluated" as const,
      gap_code: "SOURCE_QUERY_BOUND" as const,
      source_kind: "task_schedule" as const,
    },
  };
  snapshot.purpose = "schedule_notice" as never;
  snapshot.gaps = [...raw.gaps];
  snapshot.context_claim.raw = raw as never;
  snapshot.context_claim.proof.projection.context = raw as never;
  snapshot.context_claim.proof.projection.purpose = "schedule_notice";
  snapshot.participant_claims[0]!.proof.projection.purpose = "schedule_notice";
  snapshot.context_claim.proof.evidence_id = `evidence:job_communication_context_projection:project:${PROJECT_ID}:schedule_notice`;
  snapshot.context_claim.evidence[0]!.evidence_id =
    snapshot.context_claim.proof.evidence_id;
  recoupleParticipantAndContext(snapshot);
  return snapshot;
}

describe("job communication context repository", () => {
  it("calls the exact current-only RPC with the authorized nullable scope union", async () => {
    const authorization = await authorizedRead();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobCommunicationContextRepository(client);

    const result = await repository.read({ authorization });

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_job_communication_context_as_system",
        args: {
          p_request_id: "request-task12-communication",
          p_actor_user_id: ACTOR_ID,
          p_company_id: COMPANY_ID,
          p_permission_snapshot_revision: PERMISSION_REVISION,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: CAPABILITY_ID,
          p_capability_revision: CAPABILITY_REVISION,
          p_capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
          p_required_oauth_scopes: [
            "ops.correspondence.read",
            "ops.customer_contacts.read",
            "ops.customers.read",
            "ops.jobs.read",
          ],
          p_inbox_scope: "own",
          p_clients_scope: "assigned",
          p_job_permission: "projects.view",
          p_job_scope: "assigned",
          p_projects_scope: "assigned",
          p_calendar_scope: null,
          p_tasks_scope: null,
          p_photos_scope: null,
          p_job_kind: "project",
          p_job_id: PROJECT_ID,
          p_purpose: "general",
        },
      },
    ]);
    expect(client.calls[0]!.args).not.toHaveProperty("p_as_of");
    expect(client.calls[0]!.args).not.toHaveProperty("p_cursor");
    expect(client.calls[0]!.args).not.toHaveProperty("p_limit");
    expect(result).toMatchObject({
      company_id: COMPANY_ID,
      purpose: INPUT.purpose,
      context_claim: { raw: validSnapshot().context_claim.raw },
    });
    expect(isTrustedJobCommunicationContextRepository(repository)).toBe(true);
    expect(isTrustedJobCommunicationContextRepository({ ...repository })).toBe(
      false
    );
    expect(Object.isFrozen(repository)).toBe(true);
  });

  it("captures the RPC getter exactly once and never executes a swapped dependency", async () => {
    const authorization = await authorizedRead();
    const trustedClient = new StubRpcClient({
      data: validSnapshot(),
      error: null,
    });
    let getterCalls = 0;
    let attackerCalls = 0;
    const dependency = {
      get rpc() {
        getterCalls += 1;
        if (getterCalls === 1) return trustedClient.rpc.bind(trustedClient);
        return () => {
          attackerCalls += 1;
          return Promise.resolve({ data: null, error: null });
        };
      },
    };

    const repository =
      createSupabaseJobCommunicationContextRepository(dependency);
    await repository.read({ authorization });

    expect(getterCalls).toBe(1);
    expect(attackerCalls).toBe(0);
    expect(trustedClient.calls).toHaveLength(1);
  });

  it("normalizes hostile dependency and response getters without exposing raw errors", async () => {
    expect(() =>
      createSupabaseJobCommunicationContextRepository({
        get rpc(): never {
          throw new Error(`attacker factory ${PROJECT_ID}`);
        },
      } as never)
    ).toThrowError(
      new TypeError("A job communication context RPC client is required")
    );

    const authorization = await authorizedRead();
    const repository = createSupabaseJobCommunicationContextRepository({
      rpc() {
        return Promise.resolve({
          get error(): never {
            throw new Error(`attacker response ${PROJECT_ID}`);
          },
          data: validSnapshot(),
        });
      },
    });
    await expect(repository.read({ authorization })).rejects.toMatchObject({
      code: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
      message: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
    });
  });

  it("captures nominal authorization and AbortSignal once before validation", async () => {
    const authorization = await authorizedRead();
    const controller = new AbortController();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobCommunicationContextRepository(client);
    let authorizationReads = 0;
    let signalReads = 0;

    await repository.read({
      get authorization() {
        authorizationReads += 1;
        return authorizationReads === 1 ? authorization : { ...authorization };
      },
      get signal() {
        signalReads += 1;
        return signalReads === 1 ? controller.signal : AbortSignal.abort();
      },
    });

    expect(authorizationReads).toBe(1);
    expect(signalReads).toBe(1);
    expect(client.calls).toHaveLength(1);
    expect(client.abortSignals).toEqual([controller.signal]);
  });

  it("rejects forged proof and pre-aborted calls without reading", async () => {
    const authorization = await authorizedRead();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobCommunicationContextRepository(client);
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.read({ authorization: { ...authorization } as never })
    ).rejects.toMatchObject({ code: "JOB_COMMUNICATION_CONTEXT_INVALID" });
    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({
      code: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
    });
    expect(client.calls).toHaveLength(0);
  });

  it("passes an in-flight AbortSignal to the request", async () => {
    const authorization = await authorizedRead();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobCommunicationContextRepository(client);
    const controller = new AbortController();

    await repository.read({ authorization, signal: controller.signal });

    expect(client.abortSignals).toEqual([controller.signal]);
  });

  it("fails closed when cancellation wins an in-flight RPC without transport abort support", async () => {
    const authorization = await authorizedRead();
    const controller = new AbortController();
    let rpcCalls = 0;
    const repository = createSupabaseJobCommunicationContextRepository({
      rpc() {
        rpcCalls += 1;
        return Promise.resolve({ data: validSnapshot(), error: null }).then(
          (response) => {
            controller.abort();
            return response;
          }
        );
      },
    });

    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({
      code: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
    });
    expect(rpcCalls).toBe(1);
  });

  it("maps only the exact not-found condition without leaking raw provider detail", async () => {
    const authorization = await authorizedRead();
    const notFound = createSupabaseJobCommunicationContextRepository(
      new StubRpcClient({
        data: null,
        error: {
          code: "P0002",
          message: "agent_job_communication_context_not_found",
          details: `secret:${PROJECT_ID}`,
        },
      })
    );
    const failed = createSupabaseJobCommunicationContextRepository(
      new StubRpcClient({
        data: null,
        error: { code: "XX000", message: `database leaked ${PROJECT_ID}` },
      })
    );
    const hostile = createSupabaseJobCommunicationContextRepository(
      new StubRpcClient({
        data: null,
        error: Object.defineProperty({}, "code", {
          get() {
            throw new Error(`provider getter leaked ${PROJECT_ID}`);
          },
        }),
      })
    );

    await expect(notFound.read({ authorization })).rejects.toMatchObject({
      code: "JOB_COMMUNICATION_CONTEXT_NOT_FOUND",
      message: "JOB_COMMUNICATION_CONTEXT_NOT_FOUND",
    });
    await expect(failed.read({ authorization })).rejects.toMatchObject({
      code: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
      message: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
    });
    await expect(hostile.read({ authorization })).rejects.toMatchObject({
      code: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
      message: "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
    });
  });

  it("rejects a context proof that does not bind exact raw facts or ordered participant sources", async () => {
    const authorization = await authorizedRead();
    const mutations = [
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.raw.job_address = "A different source address";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.projection.context.safe_job_description =
          "A different description";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.projection.participant_proof_sources = [];
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.source_content_hash = `sha256:${"f".repeat(64)}`;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.source_version.source_id = `project:ffffffff-ffff-4fff-8fff-ffffffffffff`;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.evidence[0]!.evidence_id = "evidence:unrelated";
      },
    ];

    for (const mutate of mutations) {
      const snapshot = clone(validSnapshot());
      mutate(snapshot);
      await expect(
        createSupabaseJobCommunicationContextRepository(
          new StubRpcClient({ data: snapshot, error: null })
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_COMMUNICATION_CONTEXT_INVALID" });
    }
  });

  it("rejects actor, capability, manifest, permission, job, purpose, and freshness mutations", async () => {
    const authorization = await authorizedRead();
    const mutations = [
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.projection.actor_user_id =
          "ffffffff-ffff-4fff-8fff-ffffffffffff";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.projection.capability_revision =
          "wrong-revision" as never;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.projection.capability_manifest_revision =
          "wrong-manifest" as never;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.permission_snapshot_revision = `sha256:${"f".repeat(64)}`;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.context_claim.proof.projection.job_ref.id =
          "ffffffff-ffff-4fff-8fff-ffffffffffff";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.purpose = "photo_request" as never;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.read_at = "2026-08-13T18:00:01.000Z";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.source_fence.version = "revision:72";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.contactability_fence.version = "revision:20";
      },
    ];

    for (const mutate of mutations) {
      const snapshot = clone(validSnapshot());
      mutate(snapshot);
      await expect(
        createSupabaseJobCommunicationContextRepository(
          new StubRpcClient({ data: snapshot, error: null })
        ).read({ authorization })
      ).rejects.toBeInstanceOf(JobCommunicationContextRepositoryError);
    }
  });

  it("rejects extra raw fields and duplicate envelope identities", async () => {
    const authorization = await authorizedRead();
    const extraField = clone(validSnapshot());
    Object.assign(extraField.context_claim.raw, {
      hidden_email_body: "do not expose",
    });
    const duplicateSource = clone(validSnapshot());
    duplicateSource.participant_claims.push(
      duplicateSource.participant_claims[0]!
    );
    for (const snapshot of [extraField, duplicateSource]) {
      await expect(
        createSupabaseJobCommunicationContextRepository(
          new StubRpcClient({ data: snapshot, error: null })
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_COMMUNICATION_CONTEXT_INVALID" });
    }
  });

  it("rejects a fully proof-coupled assignment participant from general communication", async () => {
    const authorization = await authorizedRead();
    const snapshot = clone(validSnapshot());
    snapshot.participant_claims[0]!.raw = {
      source_kind: "task_assignment_user",
      participant_ref: { kind: "ops_user", id: CLIENT_ID },
      display_name: "Assigned Crew",
      role_label: null,
      conversation_side: "assistant",
      resolution_status: "confirmed",
      resolution_basis: "task_assignment",
      resolution_revision: "job-participant-resolution:v1",
      candidate_count: null,
      evidence_ids: ["task_assignment:task-1"],
      evidence_id_total: 1,
    } as never;
    recoupleParticipantAndContext(snapshot);

    await expect(
      createSupabaseJobCommunicationContextRepository(
        new StubRpcClient({ data: snapshot, error: null })
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_COMMUNICATION_CONTEXT_INVALID" });
  });

  it("rejects a fully proof-coupled assignment participant from schedule communication", async () => {
    const rawInput = {
      job_ref: INPUT.job_ref,
      purpose: "schedule_notice" as const,
    };
    const authorization = await authorizedRead(rawInput);
    const snapshot = scheduleNoticeSnapshot();
    snapshot.participant_claims[0]!.raw = {
      source_kind: "task_assignment_user",
      participant_ref: { kind: "ops_user", id: CLIENT_ID },
      display_name: "Assigned Crew",
      role_label: null,
      conversation_side: "assistant",
      resolution_status: "confirmed",
      resolution_basis: "task_assignment",
      resolution_revision: "job-participant-resolution:v1",
      candidate_count: null,
      evidence_ids: ["task_assignment:task-1"],
      evidence_id_total: 1,
    } as never;
    recoupleParticipantAndContext(snapshot);

    await expect(
      createSupabaseJobCommunicationContextRepository(
        new StubRpcClient({ data: snapshot, error: null })
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_COMMUNICATION_CONTEXT_INVALID" });
  });
});
