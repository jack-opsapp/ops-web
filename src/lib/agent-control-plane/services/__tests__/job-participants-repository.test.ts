import { describe, expect, it } from "vitest";

import {
  REGISTERED_ACTOR_PERMISSION_KEYS,
  type ActorAuthoritySnapshot,
} from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { authorizeJobParticipantsRead } from "../job-participants-authorization";
import {
  createSupabaseJobParticipantsRepository,
  isTrustedJobParticipantsRepository,
  JobParticipantsRepositoryError,
} from "../job-participants-repository";
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
const CAPABILITY_ID = "resolve_job_participants" as const;
const CAPABILITY_REVISION = `${CAPABILITY_ID}:2026-08-13.v1`;
const INPUT = {
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
    configuredPermissions: ["clients.view", "inbox.view", "projects.view"],
    effectivePermissions: [
      { permission: "clients.view", scope: "assigned" },
      { permission: "inbox.view", scope: "own" },
      { permission: "projects.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function authorizedRead() {
  const actor = await resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: "firebase-task12-participants",
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId: "request-task12-participants",
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
  const resolved = resolveCapabilityAuthorization(CAPABILITY_ID, INPUT);
  return authorizeJobParticipantsRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext: actor, policy: variant.policy })
    ),
    rawInput: INPUT,
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

function participantRow() {
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

function validSnapshot() {
  const row = participantRow();
  const sourceFence = sourceVersion(
    "operational_read_revision",
    "private.agent_operational_read_revisions",
    `revision:${SOURCE_REVISION}`
  );
  const contactabilityFence = sourceVersion(
    "contactability_revision",
    CONTACTABILITY_DIGEST,
    `revision:${CONTACTABILITY_REVISION}`
  );
  const projection = {
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
  const hash = hashOperationalProjection(projection);
  const projectionSource = sourceVersion(
    "job_participant_projection",
    CLIENT_ID,
    `job-participant-projection:v1:${hash}`
  );
  const evidenceId = `evidence:job_participant_projection:project:${PROJECT_ID}:${CLIENT_ID}`;
  const collectionRaw = {
    participant_total: 1,
    participants_omitted_count: 0,
    participant_count_completeness: "exact" as const,
    gaps: [],
  };
  const collectionProjection = {
    actor_user_id: ACTOR_ID,
    capability_id: CAPABILITY_ID,
    capability_manifest_revision: CAPABILITY_MANIFEST_REVISION,
    capability_revision: CAPABILITY_REVISION,
    company_id: COMPANY_ID,
    contactability_digest: CONTACTABILITY_DIGEST,
    contactability_revision: CONTACTABILITY_REVISION,
    job_ref: INPUT.job_ref,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_revision: SOURCE_REVISION,
    purpose: INPUT.purpose,
    collection: collectionRaw,
    participant_proof_sources: [projectionSource],
  };
  const collectionHash = hashOperationalProjection(collectionProjection);
  const collectionSource = sourceVersion(
    "job_participants_collection_projection",
    `project:${PROJECT_ID}`,
    `job-participants-collection-projection:v1:${collectionHash}`
  );
  const collectionEvidenceId = `evidence:job_participants_collection_projection:project:${PROJECT_ID}:general`;
  return {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_fence: sourceFence,
    contactability_fence: contactabilityFence,
    requested_job: INPUT.job_ref,
    participant_claims: [
      {
        raw: row,
        proof: {
          source_version: projectionSource,
          source_content_hash: hash,
          evidence_id: evidenceId,
          projection,
        },
        source_version: projectionSource,
        evidence: [
          {
            evidence_id: evidenceId,
            ...projectionSource,
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
    collection_claim: {
      raw: collectionRaw,
      proof: {
        source_version: collectionSource,
        source_content_hash: collectionHash,
        evidence_id: collectionEvidenceId,
        projection: collectionProjection,
      },
      source_version: collectionSource,
      evidence: [
        {
          evidence_id: collectionEvidenceId,
          ...collectionSource,
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

function replaceSnapshotId<T>(
  value: T,
  current: string,
  replacement: string
): T {
  return JSON.parse(
    JSON.stringify(value).replaceAll(current, replacement)
  ) as T;
}

function recoupleParticipantAndCollection(
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
  snapshot.collection_claim.proof.projection.participant_proof_sources = [
    claim.source_version,
  ];
  const collectionHash = hashOperationalProjection(
    snapshot.collection_claim.proof.projection as never
  );
  const collectionVersion = `job-participants-collection-projection:v1:${collectionHash}`;
  snapshot.collection_claim.proof.source_content_hash = collectionHash;
  snapshot.collection_claim.proof.source_version.version = collectionVersion;
  snapshot.collection_claim.source_version.version = collectionVersion;
  snapshot.collection_claim.evidence[0]!.version = collectionVersion;
}

describe("job participants repository", () => {
  it("accepts a non-RFC PostgreSQL participant UUID and rejects noncanonical text", async () => {
    const postgresId = "d4000000-0000-4000-d400-000000000004";
    const authorization = await authorizedRead();
    const valid = replaceSnapshotId(validSnapshot(), CLIENT_ID, postgresId);
    recoupleParticipantAndCollection(valid);

    await expect(
      createSupabaseJobParticipantsRepository(
        new StubRpcClient({ data: valid, error: null })
      ).read({ authorization })
    ).resolves.toMatchObject({
      participant_claims: [
        { raw: { participant_ref: { kind: "client", id: postgresId } } },
      ],
    });

    for (const id of [postgresId.toUpperCase(), `${postgresId}x`]) {
      const invalid = replaceSnapshotId(validSnapshot(), CLIENT_ID, id);
      recoupleParticipantAndCollection(invalid);
      await expect(
        createSupabaseJobParticipantsRepository(
          new StubRpcClient({ data: invalid, error: null })
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
    }
  });

  it("uses the exact current-only service-role RPC and returns only a nominal repository", async () => {
    const authorization = await authorizedRead();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobParticipantsRepository(client);

    const result = await repository.read({ authorization });

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_job_participants_as_system",
        args: {
          p_request_id: "request-task12-participants",
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
          p_tasks_scope: null,
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
      requested_job: INPUT.job_ref,
      purpose: INPUT.purpose,
      participant_claims: [
        expect.objectContaining({
          raw: expect.objectContaining(participantRow()),
        }),
      ],
    });
    expect(isTrustedJobParticipantsRepository(repository)).toBe(true);
    expect(isTrustedJobParticipantsRepository({ ...repository })).toBe(false);
    expect(Object.isFrozen(repository)).toBe(true);
  });

  it("captures the RPC dependency once before validation and cannot be getter-swapped", async () => {
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

    const repository = createSupabaseJobParticipantsRepository(dependency);
    await repository.read({ authorization });

    expect(getterCalls).toBe(1);
    expect(attackerCalls).toBe(0);
    expect(trustedClient.calls).toHaveLength(1);
  });

  it("normalizes hostile dependency and response getters without leaking their errors", async () => {
    expect(() =>
      createSupabaseJobParticipantsRepository({
        get rpc(): never {
          throw new Error(`attacker factory ${CLIENT_ID}`);
        },
      } as never)
    ).toThrowError(new TypeError("A job-participants RPC client is required"));

    const authorization = await authorizedRead();
    const repository = createSupabaseJobParticipantsRepository({
      rpc() {
        return Promise.resolve({
          get data(): never {
            throw new Error(`attacker response ${CLIENT_ID}`);
          },
          error: null,
        });
      },
    });
    await expect(repository.read({ authorization })).rejects.toMatchObject({
      code: "JOB_PARTICIPANTS_READ_FAILED",
      message: "JOB_PARTICIPANTS_READ_FAILED",
    });
  });

  it("captures the nominal authorization and signal exactly once before validation", async () => {
    const authorization = await authorizedRead();
    const controller = new AbortController();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobParticipantsRepository(client);
    let authorizationReads = 0;
    let signalReads = 0;
    const input = {
      get authorization() {
        authorizationReads += 1;
        return authorizationReads === 1 ? authorization : { ...authorization };
      },
      get signal() {
        signalReads += 1;
        return signalReads === 1 ? controller.signal : AbortSignal.abort();
      },
    };

    await repository.read(input);

    expect(authorizationReads).toBe(1);
    expect(signalReads).toBe(1);
    expect(client.calls).toHaveLength(1);
    expect(client.abortSignals).toEqual([controller.signal]);
  });

  it("rejects forged authorization and an already-aborted read with zero RPC calls", async () => {
    const authorization = await authorizedRead();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobParticipantsRepository(client);
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.read({ authorization: { ...authorization } as never })
    ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
    await expect(
      repository.read({ authorization, signal: controller.signal })
    ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_READ_FAILED" });
    expect(client.calls).toHaveLength(0);
  });

  it("passes an in-flight AbortSignal to the RPC request", async () => {
    const authorization = await authorizedRead();
    const client = new StubRpcClient({ data: validSnapshot(), error: null });
    const repository = createSupabaseJobParticipantsRepository(client);
    const controller = new AbortController();

    await repository.read({ authorization, signal: controller.signal });

    expect(client.abortSignals).toEqual([controller.signal]);
  });

  it("fails closed when cancellation wins an in-flight RPC without transport abort support", async () => {
    const authorization = await authorizedRead();
    const controller = new AbortController();
    let rpcCalls = 0;
    const repository = createSupabaseJobParticipantsRepository({
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
    ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_READ_FAILED" });
    expect(rpcCalls).toBe(1);
  });

  it("maps only the exact privacy-safe not-found signal and never reflects raw errors", async () => {
    const authorization = await authorizedRead();
    const notFound = createSupabaseJobParticipantsRepository(
      new StubRpcClient({
        data: null,
        error: {
          code: "P0002",
          message: "agent_job_participants_not_found",
          details: `secret:${CLIENT_ID}`,
        },
      })
    );
    const failed = createSupabaseJobParticipantsRepository(
      new StubRpcClient({
        data: null,
        error: {
          code: "XX000",
          message: `database leaked ${CLIENT_ID}`,
        },
      })
    );
    const hostile = createSupabaseJobParticipantsRepository(
      new StubRpcClient({
        data: null,
        error: Object.defineProperty({}, "code", {
          get() {
            throw new Error(`provider getter leaked ${CLIENT_ID}`);
          },
        }),
      })
    );

    await expect(notFound.read({ authorization })).rejects.toMatchObject({
      code: "JOB_PARTICIPANTS_NOT_FOUND",
      message: "JOB_PARTICIPANTS_NOT_FOUND",
    });
    await expect(failed.read({ authorization })).rejects.toMatchObject({
      code: "JOB_PARTICIPANTS_READ_FAILED",
      message: "JOB_PARTICIPANTS_READ_FAILED",
    });
    await expect(hostile.read({ authorization })).rejects.toMatchObject({
      code: "JOB_PARTICIPANTS_READ_FAILED",
      message: "JOB_PARTICIPANTS_READ_FAILED",
    });
  });

  it("rejects tenant, permission, job, purpose, and source-fence mismatches", async () => {
    const authorization = await authorizedRead();
    const mutations = [
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.company_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.permission_snapshot_revision = `sha256:${"f".repeat(64)}`;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.requested_job.id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.purpose = "schedule" as never;
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
      const repository = createSupabaseJobParticipantsRepository(
        new StubRpcClient({ data: snapshot, error: null })
      );
      await expect(repository.read({ authorization })).rejects.toBeInstanceOf(
        JobParticipantsRepositoryError
      );
      await expect(
        createSupabaseJobParticipantsRepository(
          new StubRpcClient({ data: snapshot, error: null })
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
    }
  });

  it("rejects proof, raw claim, ordering, and exact evidence mutations", async () => {
    const authorization = await authorizedRead();
    const mutations = [
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.participant_claims[0]!.raw.display_name =
          "Mutated after proof";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.participant_claims[0]!.proof.projection.actor_user_id =
          "ffffffff-ffff-4fff-8fff-ffffffffffff";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.participant_claims[0]!.proof.source_content_hash = `sha256:${"f".repeat(64)}`;
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.participant_claims[0]!.source_version.source_id = "wrong-key";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.participant_claims[0]!.evidence[0]!.locator =
          "ops://jobs/project/wrong";
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.participant_claims.push(snapshot.participant_claims[0]!);
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.collection_claim.proof.projection.participant_proof_sources =
          [];
      },
      (snapshot: ReturnType<typeof validSnapshot>) => {
        snapshot.collection_claim.raw.participant_total = 2;
      },
    ];

    for (const mutate of mutations) {
      const snapshot = clone(validSnapshot());
      mutate(snapshot);
      await expect(
        createSupabaseJobParticipantsRepository(
          new StubRpcClient({ data: snapshot, error: null })
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
    }
  });

  it("allows an address only on available email_source and rejects suppression metadata", async () => {
    const authorization = await authorizedRead();
    const blockedWithAddress = clone(validSnapshot());
    blockedWithAddress.participant_claims[0]!.raw.email_source = {
      state: "blocked",
      code: "ADDRESS_SUPPRESSED",
      normalized_address: "suppressed@example.com",
    } as never;
    const leakedSuppressionMetadata = clone(validSnapshot());
    leakedSuppressionMetadata.participant_claims[0]!.raw.email_source = {
      state: "available",
      normalized_address: "morgan@example.com",
      global_suppression_active: false,
    } as never;

    for (const snapshot of [blockedWithAddress, leakedSuppressionMetadata]) {
      await expect(
        createSupabaseJobParticipantsRepository(
          new StubRpcClient({ data: snapshot, error: null })
        ).read({ authorization })
      ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
    }
  });

  it("rejects raw identities that bypass UUID or pseudonymous unknown IDs", async () => {
    const authorization = await authorizedRead();
    const snapshot = clone(validSnapshot());
    snapshot.participant_claims[0]!.raw = {
      ...snapshot.participant_claims[0]!.raw,
      source_kind: "conversation_unresolved",
      participant_ref: { kind: "unknown", id: "unknown:not-hashed" },
      display_name: null,
      role_label: null,
      conversation_side: null,
      resolution_status: "unresolved",
      resolution_basis: null,
      candidate_count: null,
      email_source: { state: "absent", code: "NO_ADDRESS_ON_RECORD" },
    } as never;

    await expect(
      createSupabaseJobParticipantsRepository(
        new StubRpcClient({ data: snapshot, error: null })
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
  });

  it("rejects a fully proof-coupled assignment participant outside schedule or assignment purpose", async () => {
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
    recoupleParticipantAndCollection(snapshot);

    await expect(
      createSupabaseJobParticipantsRepository(
        new StubRpcClient({ data: snapshot, error: null })
      ).read({ authorization })
    ).rejects.toMatchObject({ code: "JOB_PARTICIPANTS_INVALID" });
  });

  it("keeps an empty participant collection fully bound to the requested job", async () => {
    const authorization = await authorizedRead();
    const snapshot = clone(validSnapshot());
    snapshot.participant_claims = [];
    snapshot.participant_total = 0;
    snapshot.participant_count_completeness = "exact";
    snapshot.collection_claim.raw.participant_total = 0;
    snapshot.collection_claim.proof.projection.collection.participant_total = 0;
    snapshot.collection_claim.proof.projection.participant_proof_sources = [];
    const projection = snapshot.collection_claim.proof.projection;
    const hash = hashOperationalProjection(projection);
    snapshot.collection_claim.proof.source_content_hash = hash;
    snapshot.collection_claim.proof.source_version.version = `job-participants-collection-projection:v1:${hash}`;
    snapshot.collection_claim.source_version.version = `job-participants-collection-projection:v1:${hash}`;
    snapshot.collection_claim.evidence[0]!.version = `job-participants-collection-projection:v1:${hash}`;

    await expect(
      createSupabaseJobParticipantsRepository(
        new StubRpcClient({ data: snapshot, error: null })
      ).read({ authorization })
    ).resolves.toMatchObject({
      requested_job: INPUT.job_ref,
      participant_claims: [],
      collection_claim: {
        proof: { projection: { job_ref: INPUT.job_ref } },
      },
    });
  });
});
