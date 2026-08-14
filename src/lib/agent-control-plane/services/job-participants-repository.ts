import "server-only";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import type { SourceVersion } from "@/lib/agent-control-plane/contracts";
import {
  JobParticipantsSnapshotSchema,
  type JobParticipantsSnapshot,
  type JobParticipantsSnapshotReader,
} from "./communication-participant-snapshot";
import {
  isAuthorizedJobParticipantsRead,
  type AuthorizedJobParticipantsRead,
} from "./job-participants-authorization";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
} from "./operational-read-projection";

const RPC_NAME = "read_agent_job_participants_as_system" as const;
const PARTICIPANT_VERSION_PREFIX = "job-participant-projection:v1:";
const COLLECTION_VERSION_PREFIX = "job-participants-collection-projection:v1:";

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface JobParticipantsRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}

export interface JobParticipantsRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): JobParticipantsRpcRequest;
}

declare const TRUSTED_JOB_PARTICIPANTS_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

export interface JobParticipantsRepository
  extends JobParticipantsSnapshotReader {
  readonly [TRUSTED_JOB_PARTICIPANTS_REPOSITORY]: true;
}

export class JobParticipantsRepositoryError extends Error {
  readonly code:
    | "JOB_PARTICIPANTS_READ_FAILED"
    | "JOB_PARTICIPANTS_NOT_FOUND"
    | "JOB_PARTICIPANTS_INVALID";

  constructor(
    code: JobParticipantsRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "JobParticipantsRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new JobParticipantsRepositoryError("JOB_PARTICIPANTS_INVALID", {
    cause,
  });
}

function sameSource(left: SourceVersion, right: SourceVersion): boolean {
  return (
    left.source_domain === right.source_domain &&
    left.source_type === right.source_type &&
    left.source_id === right.source_id &&
    left.version === right.version
  );
}

function sameJob(
  left: Readonly<{ kind: string; id: string }>,
  right: Readonly<{ kind: string; id: string }>
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sourceIdentity(source: SourceVersion): string {
  return [
    source.source_domain,
    source.source_type,
    source.source_id,
    source.version,
  ].join("\u0000");
}

function assertEvidence(input: {
  readonly evidence: JobParticipantsSnapshot["participant_claims"][number]["evidence"][number];
  readonly source: SourceVersion;
  readonly evidenceId: string;
  readonly readAt: string;
  readonly locator: string;
}): void {
  if (
    input.evidence.evidence_id !== input.evidenceId ||
    !sameSource(input.evidence, input.source) ||
    input.evidence.occurred_at !== input.readAt ||
    input.evidence.relationship !== "supports" ||
    input.evidence.trust !== "authoritative_ops" ||
    input.evidence.locator !== input.locator ||
    input.evidence.excerpt !== undefined
  ) {
    invalid();
  }
}

function assertExactProjection(
  actual: Parameters<typeof canonicalOperationalProjection>[0],
  expected: Parameters<typeof canonicalOperationalProjection>[0],
  sourceContentHash: string
): void {
  try {
    if (
      canonicalOperationalProjection(actual) !==
        canonicalOperationalProjection(expected) ||
      hashOperationalProjection(actual) !== sourceContentHash
    ) {
      invalid();
    }
  } catch (error) {
    if (error instanceof JobParticipantsRepositoryError) throw error;
    invalid(error);
  }
}

function assertSnapshot(
  snapshot: JobParticipantsSnapshot,
  authorization: AuthorizedJobParticipantsRead
): void {
  const sourceRevision = Number(snapshot.source_fence.version.slice(9));
  const contactabilityRevision = Number(
    snapshot.contactability_fence.version.slice(9)
  );
  const locator =
    `ops://jobs/${authorization.query.job_ref.kind}/` +
    authorization.query.job_ref.id;
  if (
    snapshot.company_id !== authorization.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      authorization.actorContext.permissionSnapshotRevision ||
    !sameJob(snapshot.requested_job, authorization.query.job_ref) ||
    snapshot.purpose !== authorization.query.purpose ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 0 ||
    !Number.isSafeInteger(contactabilityRevision) ||
    contactabilityRevision < 0 ||
    snapshot.participant_total !==
      snapshot.participant_claims.length +
        snapshot.participants_omitted_count ||
    (snapshot.participant_count_completeness === "lower_bound") !==
      snapshot.gaps.includes("PARTICIPANT_QUERY_BOUND")
  ) {
    invalid();
  }

  const sourceIdentities = new Set<string>();
  const evidenceIds = new Set<string>();
  const participantSources: SourceVersion[] = [];
  const addSource = (source: SourceVersion) => {
    const identity = sourceIdentity(source);
    if (sourceIdentities.has(identity)) invalid();
    sourceIdentities.add(identity);
  };
  addSource(snapshot.source_fence);
  addSource(snapshot.contactability_fence);

  for (const claim of snapshot.participant_claims) {
    const participantId = claim.raw.participant_ref.id;
    if (
      claim.raw.source_kind === "task_assignment_user" &&
      authorization.query.purpose !== "schedule" &&
      authorization.query.purpose !== "assignment"
    ) {
      invalid();
    }
    const expectedEvidenceId =
      `evidence:job_participant_projection:` +
      `${authorization.query.job_ref.kind}:` +
      `${authorization.query.job_ref.id}:${participantId}`;
    const expectedProjection = {
      actor_user_id: authorization.actorContext.actorUserId,
      capability_id: authorization.capabilityId,
      capability_manifest_revision: authorization.capabilityManifestRevision,
      capability_revision: authorization.capabilityRevision,
      company_id: authorization.actorContext.companyId,
      contactability_digest: snapshot.contactability_fence.source_id,
      contactability_revision: contactabilityRevision,
      job_ref: authorization.query.job_ref,
      permission_snapshot_revision:
        authorization.actorContext.permissionSnapshotRevision,
      read_at: snapshot.read_at,
      source_revision: sourceRevision,
      purpose: authorization.query.purpose,
      participant: claim.raw,
    } as const;
    if (
      claim.proof.source_version.source_domain !== "operations" ||
      claim.proof.source_version.source_type !== "job_participant_projection" ||
      claim.proof.source_version.source_id !== participantId ||
      claim.proof.source_version.version !==
        `${PARTICIPANT_VERSION_PREFIX}${claim.proof.source_content_hash}` ||
      !sameSource(claim.source_version, claim.proof.source_version) ||
      claim.proof.evidence_id !== expectedEvidenceId ||
      claim.evidence.length !== 1 ||
      evidenceIds.has(expectedEvidenceId)
    ) {
      invalid();
    }
    assertExactProjection(
      claim.proof.projection,
      expectedProjection,
      claim.proof.source_content_hash
    );
    assertEvidence({
      evidence: claim.evidence[0]!,
      source: claim.source_version,
      evidenceId: expectedEvidenceId,
      readAt: snapshot.read_at,
      locator,
    });
    addSource(claim.source_version);
    evidenceIds.add(expectedEvidenceId);
    participantSources.push(claim.source_version);
  }

  const collection = snapshot.collection_claim;
  const expectedCollectionEvidenceId =
    `evidence:job_participants_collection_projection:` +
    `${authorization.query.job_ref.kind}:` +
    `${authorization.query.job_ref.id}:${authorization.query.purpose}`;
  const expectedCollectionRaw = {
    participant_total: snapshot.participant_total,
    participants_omitted_count: snapshot.participants_omitted_count,
    participant_count_completeness: snapshot.participant_count_completeness,
    gaps: snapshot.gaps,
  } as const;
  const expectedCollectionProjection = {
    actor_user_id: authorization.actorContext.actorUserId,
    capability_id: authorization.capabilityId,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    capability_revision: authorization.capabilityRevision,
    company_id: authorization.actorContext.companyId,
    contactability_digest: snapshot.contactability_fence.source_id,
    contactability_revision: contactabilityRevision,
    job_ref: authorization.query.job_ref,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    read_at: snapshot.read_at,
    source_revision: sourceRevision,
    purpose: authorization.query.purpose,
    collection: expectedCollectionRaw,
    participant_proof_sources: participantSources,
  } as const;
  if (
    canonicalOperationalProjection(collection.raw) !==
      canonicalOperationalProjection(expectedCollectionRaw) ||
    collection.proof.source_version.source_domain !== "operations" ||
    collection.proof.source_version.source_type !==
      "job_participants_collection_projection" ||
    collection.proof.source_version.source_id !==
      `${authorization.query.job_ref.kind}:${authorization.query.job_ref.id}` ||
    collection.proof.source_version.version !==
      `${COLLECTION_VERSION_PREFIX}${collection.proof.source_content_hash}` ||
    !sameSource(collection.source_version, collection.proof.source_version) ||
    collection.proof.evidence_id !== expectedCollectionEvidenceId ||
    collection.evidence.length !== 1 ||
    evidenceIds.has(expectedCollectionEvidenceId)
  ) {
    invalid();
  }
  assertExactProjection(
    collection.proof.projection,
    expectedCollectionProjection,
    collection.proof.source_content_hash
  );
  assertEvidence({
    evidence: collection.evidence[0]!,
    source: collection.source_version,
    evidenceId: expectedCollectionEvidenceId,
    readAt: snapshot.read_at,
    locator,
  });
  addSource(collection.source_version);
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  try {
    const value = error as Readonly<Record<string, unknown>>;
    return (
      value.code === "P0002" &&
      value.message === "agent_job_participants_not_found"
    );
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function createSupabaseJobParticipantsRepository(
  client: JobParticipantsRpcClient
): JobParticipantsRepository {
  let suppliedRpc: JobParticipantsRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as JobParticipantsRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A job-participants RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A job-participants RPC client is required");
  }
  const rpc = (
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc, client, [functionName, args]);

  const repository = {
    async read(input: {
      readonly authorization: AuthorizedJobParticipantsRead;
      readonly signal?: AbortSignal;
    }): Promise<JobParticipantsSnapshot> {
      const authorization = input.authorization;
      const signal = input.signal;
      if (!isAuthorizedJobParticipantsRead(authorization)) invalid();
      if (signal?.aborted) {
        throw new JobParticipantsRepositoryError(
          "JOB_PARTICIPANTS_READ_FAILED"
        );
      }
      const proof = authorization;
      const jobPermission =
        proof.query.job_ref.kind === "opportunity"
          ? "pipeline.view"
          : "projects.view";
      const jobScope =
        proof.query.job_ref.kind === "opportunity"
          ? proof.pipelineScope
          : proof.projectsScope;
      let response: RpcResult;
      try {
        const request = rpc(RPC_NAME, {
          p_request_id: proof.actorContext.requestId,
          p_actor_user_id: proof.actorContext.actorUserId,
          p_company_id: proof.actorContext.companyId,
          p_permission_snapshot_revision:
            proof.actorContext.permissionSnapshotRevision,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: proof.capabilityId,
          p_capability_revision: proof.capabilityRevision,
          p_capability_manifest_revision: proof.capabilityManifestRevision,
          p_required_oauth_scopes: [...proof.requiredOAuthScopes],
          p_inbox_scope: proof.inboxScope,
          p_clients_scope: proof.clientsScope,
          p_job_permission: jobPermission,
          p_job_scope: jobScope,
          p_projects_scope: proof.projectsScope,
          p_tasks_scope: proof.tasksScope,
          p_job_kind: proof.query.job_ref.kind,
          p_job_id: proof.query.job_ref.id,
          p_purpose: proof.query.purpose,
        });
        const abortSignal = request?.abortSignal;
        response =
          signal && typeof abortSignal === "function"
            ? await Reflect.apply(abortSignal, request, [signal])
            : await request;
      } catch (error) {
        throw new JobParticipantsRepositoryError(
          "JOB_PARTICIPANTS_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new JobParticipantsRepositoryError(
          "JOB_PARTICIPANTS_READ_FAILED"
        );
      }
      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new JobParticipantsRepositoryError(
          "JOB_PARTICIPANTS_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        throw new JobParticipantsRepositoryError(
          isNotFound(responseError)
            ? "JOB_PARTICIPANTS_NOT_FOUND"
            : "JOB_PARTICIPANTS_READ_FAILED",
          { cause: responseError }
        );
      }
      const parsed = JobParticipantsSnapshotSchema.safeParse(responseData);
      if (!parsed.success) invalid(parsed.error);
      assertSnapshot(parsed.data, proof);
      return deepFreeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as unknown as JobParticipantsRepository;
}

export function isTrustedJobParticipantsRepository(
  value: unknown
): value is JobParticipantsRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
