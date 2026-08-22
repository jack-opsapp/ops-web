import { describe, expect, it } from "vitest";

import type { ActorAuthoritySnapshot } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { trustedAuthorityRepositoryForSnapshot } from "@/lib/agent-control-plane/actor/__tests__/fixtures/trusted-repository-fixtures";
import { verifiedInternalPrincipalFixture } from "@/lib/agent-control-plane/actor/__tests__/fixtures/verified-principal-fixtures";
import { resolveActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { AuthorizedJobCommunicationRead } from "../job-communication-authorization";
import { authorizeJobCommunicationRead } from "../job-communication-authorization";
import {
  createSupabaseJobCommunicationContextRepository,
  JobCommunicationContextRepositoryError,
} from "../job-communication-context-repository";
import type { AuthorizedJobParticipantsRead } from "../job-participants-authorization";
import { authorizeJobParticipantsRead } from "../job-participants-authorization";
import {
  createSupabaseJobParticipantsRepository,
  JobParticipantsRepositoryError,
} from "../job-participants-repository";
import { hashOperationalProjection } from "../operational-read-projection";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PERMISSION_REVISION = `sha256:${"a".repeat(64)}`;
const CONTACTABILITY_DIGEST = `sha256:${"b".repeat(64)}`;
const READ_AT = "2026-08-14T18:00:00.000Z";
const SOURCE_REVISION = 74;
const CONTACTABILITY_REVISION = 20;
const TASK_13_MANIFEST_REVISION = "2026-08-20.capability-manifest.v7" as const;
const TASK_12_MANIFEST_REVISION = "2026-08-13.capability-manifest.v5" as const;
const JOB_REF = { kind: "project" as const, id: PROJECT_ID };
const PARTICIPANTS_INPUT = { job_ref: JOB_REF, purpose: "general" as const };
const COMMUNICATION_INPUT = {
  job_ref: JOB_REF,
  purpose: "general" as const,
};

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
      "photos.view",
      "projects.view",
      "tasks.view",
    ],
    effectivePermissions: [
      { permission: "calendar.view", scope: "own" },
      { permission: "clients.view", scope: "assigned" },
      { permission: "inbox.view", scope: "own" },
      { permission: "photos.view", scope: "assigned" },
      { permission: "projects.view", scope: "assigned" },
      { permission: "tasks.view", scope: "assigned" },
    ],
    permissionSnapshotRevision: PERMISSION_REVISION,
  };
}

async function actorContext(requestId: string) {
  return resolveActorContext({
    principal: verifiedInternalPrincipalFixture({
      channel: "internal",
      firebaseSubject: `firebase-${requestId}`,
      applicationId: "phase-c",
      protocolEra: "internal-v1",
    }),
    authorityRepository: trustedAuthorityRepositoryForSnapshot(authority()),
    requestId,
    policyRevision: "actor-policy:v1",
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
  });
}

async function participantsAuthorization(): Promise<AuthorizedJobParticipantsRead> {
  const actor = await actorContext("request-task13-participants-v6");
  const resolved = resolveCapabilityAuthorization(
    "resolve_job_participants",
    PARTICIPANTS_INPUT
  );
  return authorizeJobParticipantsRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext: actor, policy: variant.policy })
    ),
    rawInput: PARTICIPANTS_INPUT,
  });
}

async function communicationAuthorization(): Promise<AuthorizedJobCommunicationRead> {
  const actor = await actorContext("request-task13-communication-v6");
  const resolved = resolveCapabilityAuthorization(
    "get_job_communication_context",
    COMMUNICATION_INPUT
  );
  return authorizeJobCommunicationRead({
    authorizations: resolved.variants.map((variant) =>
      authorizeCapability({ actorContext: actor, policy: variant.policy })
    ),
    rawInput: COMMUNICATION_INPUT,
  });
}

function sourceVersion(sourceType: string, sourceId: string, version: string) {
  return {
    source_domain: "operations" as const,
    source_type: sourceType,
    source_id: sourceId,
    version,
  };
}

function envelopeEvidence(input: {
  evidenceId: string;
  source: ReturnType<typeof sourceVersion>;
}) {
  return {
    evidence_id: input.evidenceId,
    ...input.source,
    occurred_at: READ_AT,
    relationship: "supports" as const,
    trust: "authoritative_ops" as const,
    locator: `ops://jobs/project/${PROJECT_ID}`,
  };
}

function commonSnapshotFields() {
  return {
    company_id: COMPANY_ID,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_fence: sourceVersion(
      "operational_read_revision",
      "private.agent_operational_read_revisions",
      `revision:${SOURCE_REVISION}`
    ),
    contactability_fence: sourceVersion(
      "contactability_revision",
      CONTACTABILITY_DIGEST,
      `revision:${CONTACTABILITY_REVISION}`
    ),
    requested_job: JOB_REF,
    participant_claims: [],
    participant_total: 0,
    participants_omitted_count: 0,
    participant_count_completeness: "exact" as const,
    gaps: [],
    purpose: "general" as const,
  };
}

function participantsSnapshot(
  authorization: AuthorizedJobParticipantsRead,
  manifestRevision: string
) {
  const raw = {
    participant_total: 0,
    participants_omitted_count: 0,
    participant_count_completeness: "exact" as const,
    gaps: [],
  };
  const projection = {
    actor_user_id: ACTOR_ID,
    capability_id: authorization.capabilityId,
    capability_manifest_revision: manifestRevision,
    capability_revision: authorization.capabilityRevision,
    company_id: COMPANY_ID,
    contactability_digest: CONTACTABILITY_DIGEST,
    contactability_revision: CONTACTABILITY_REVISION,
    job_ref: JOB_REF,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_revision: SOURCE_REVISION,
    purpose: "general" as const,
    collection: raw,
    participant_proof_sources: [],
  };
  const hash = hashOperationalProjection(projection);
  const source = sourceVersion(
    "job_participants_collection_projection",
    `project:${PROJECT_ID}`,
    `job-participants-collection-projection:v1:${hash}`
  );
  const evidenceId =
    `evidence:job_participants_collection_projection:` +
    `project:${PROJECT_ID}:general`;
  return {
    ...commonSnapshotFields(),
    collection_claim: {
      raw,
      proof: {
        source_version: source,
        source_content_hash: hash,
        evidence_id: evidenceId,
        projection,
      },
      source_version: source,
      evidence: [envelopeEvidence({ evidenceId, source })],
    },
  };
}

function communicationSnapshot(
  authorization: AuthorizedJobCommunicationRead,
  manifestRevision: string
) {
  const raw = {
    purpose: "general" as const,
    job_address: null,
    safe_job_description: null,
    participant_total: 0,
    participants_omitted_count: 0,
    participant_count_completeness: "exact" as const,
    gaps: [],
  };
  const projection = {
    actor_user_id: ACTOR_ID,
    capability_id: authorization.capabilityId,
    capability_manifest_revision: manifestRevision,
    capability_revision: authorization.capabilityRevision,
    company_id: COMPANY_ID,
    contactability_digest: CONTACTABILITY_DIGEST,
    contactability_revision: CONTACTABILITY_REVISION,
    job_ref: JOB_REF,
    permission_snapshot_revision: PERMISSION_REVISION,
    read_at: READ_AT,
    source_revision: SOURCE_REVISION,
    purpose: "general" as const,
    context: raw,
    participant_proof_sources: [],
  };
  const hash = hashOperationalProjection(projection);
  const source = sourceVersion(
    "job_communication_context_projection",
    `project:${PROJECT_ID}`,
    `job-communication-context-projection:v1:${hash}`
  );
  const evidenceId =
    `evidence:job_communication_context_projection:` +
    `project:${PROJECT_ID}:general`;
  return {
    ...commonSnapshotFields(),
    context_claim: {
      raw,
      proof: {
        source_version: source,
        source_content_hash: hash,
        evidence_id: evidenceId,
        projection,
      },
      source_version: source,
      evidence: [envelopeEvidence({ evidenceId, source })],
    },
  };
}

function clientFor(data: unknown) {
  return {
    rpc() {
      return Promise.resolve({ data, error: null });
    },
  };
}

describe("Task 12 repository compatibility under manifest v7", () => {
  it("requires the process-wide capability manifest to be v7", () => {
    expect(CAPABILITY_MANIFEST_REVISION).toBe(TASK_13_MANIFEST_REVISION);
  });

  it("accepts communication and participant wrappers rebound consistently to v7", async () => {
    const participants = await participantsAuthorization();
    const communication = await communicationAuthorization();
    const participantsRepository = createSupabaseJobParticipantsRepository(
      clientFor(participantsSnapshot(participants, TASK_13_MANIFEST_REVISION))
    );
    const communicationRepository =
      createSupabaseJobCommunicationContextRepository(
        clientFor(
          communicationSnapshot(communication, TASK_13_MANIFEST_REVISION)
        )
      );

    await expect(
      participantsRepository.read({ authorization: participants })
    ).resolves.toMatchObject({
      participant_total: 0,
      collection_claim: {
        proof: {
          projection: {
            capability_manifest_revision: TASK_13_MANIFEST_REVISION,
          },
        },
      },
    });
    await expect(
      communicationRepository.read({ authorization: communication })
    ).resolves.toMatchObject({
      participant_total: 0,
      context_claim: {
        proof: {
          projection: {
            capability_manifest_revision: TASK_13_MANIFEST_REVISION,
          },
        },
      },
    });
  });

  it("rejects fully recoupled v5 projections presented with v7 authorizations", async () => {
    const participants = await participantsAuthorization();
    const communication = await communicationAuthorization();
    const participantsRepository = createSupabaseJobParticipantsRepository(
      clientFor(participantsSnapshot(participants, TASK_12_MANIFEST_REVISION))
    );
    const communicationRepository =
      createSupabaseJobCommunicationContextRepository(
        clientFor(
          communicationSnapshot(communication, TASK_12_MANIFEST_REVISION)
        )
      );

    await expect(
      participantsRepository.read({ authorization: participants })
    ).rejects.toEqual(
      expect.objectContaining<Partial<JobParticipantsRepositoryError>>({
        code: "JOB_PARTICIPANTS_INVALID",
      })
    );
    await expect(
      communicationRepository.read({ authorization: communication })
    ).rejects.toEqual(
      expect.objectContaining<Partial<JobCommunicationContextRepositoryError>>({
        code: "JOB_COMMUNICATION_CONTEXT_INVALID",
      })
    );
  });
});
