import "server-only";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import type {
  EvidenceRef,
  SourceVersion,
} from "@/lib/agent-control-plane/contracts";
import {
  JobCommunicationContextSnapshotSchema,
  type JobCommunicationContextSnapshot,
  type JobCommunicationContextSnapshotReader,
} from "./communication-participant-snapshot";
import {
  isAuthorizedJobCommunicationRead,
  type AuthorizedJobCommunicationRead,
} from "./job-communication-authorization";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
} from "./operational-read-projection";

const RPC_NAME = "read_agent_job_communication_context_as_system" as const;
const PARTICIPANT_VERSION_PREFIX = "job-participant-projection:v1:";
const CONTEXT_VERSION_PREFIX = "job-communication-context-projection:v1:";

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface JobCommunicationContextRpcRequest
  extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}

export interface JobCommunicationContextRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): JobCommunicationContextRpcRequest;
}

declare const TRUSTED_JOB_COMMUNICATION_CONTEXT_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

export interface JobCommunicationContextRepository
  extends JobCommunicationContextSnapshotReader {
  readonly [TRUSTED_JOB_COMMUNICATION_CONTEXT_REPOSITORY]: true;
}

export class JobCommunicationContextRepositoryError extends Error {
  readonly code:
    | "JOB_COMMUNICATION_CONTEXT_READ_FAILED"
    | "JOB_COMMUNICATION_CONTEXT_NOT_FOUND"
    | "JOB_COMMUNICATION_CONTEXT_INVALID";

  constructor(
    code: JobCommunicationContextRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "JobCommunicationContextRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new JobCommunicationContextRepositoryError(
    "JOB_COMMUNICATION_CONTEXT_INVALID",
    { cause }
  );
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
  readonly evidence: EvidenceRef;
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
    if (error instanceof JobCommunicationContextRepositoryError) throw error;
    invalid(error);
  }
}

function assertSnapshot(
  snapshot: JobCommunicationContextSnapshot,
  authorization: AuthorizedJobCommunicationRead
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
    if (claim.raw.source_kind === "task_assignment_user") {
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

  const context = snapshot.context_claim;
  const expectedContextEvidenceId =
    `evidence:job_communication_context_projection:` +
    `${authorization.query.job_ref.kind}:` +
    `${authorization.query.job_ref.id}:${authorization.query.purpose}`;
  const expectedContextProjection = {
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
    context: context.raw,
    participant_proof_sources: participantSources,
  } as const;
  if (
    context.raw.purpose !== authorization.query.purpose ||
    context.raw.participant_total !== snapshot.participant_total ||
    context.raw.participants_omitted_count !==
      snapshot.participants_omitted_count ||
    context.raw.participant_count_completeness !==
      snapshot.participant_count_completeness ||
    canonicalOperationalProjection(context.raw.gaps) !==
      canonicalOperationalProjection(snapshot.gaps) ||
    context.proof.source_version.source_domain !== "operations" ||
    context.proof.source_version.source_type !==
      "job_communication_context_projection" ||
    context.proof.source_version.source_id !==
      `${authorization.query.job_ref.kind}:${authorization.query.job_ref.id}` ||
    context.proof.source_version.version !==
      `${CONTEXT_VERSION_PREFIX}${context.proof.source_content_hash}` ||
    !sameSource(context.source_version, context.proof.source_version) ||
    context.proof.evidence_id !== expectedContextEvidenceId ||
    context.evidence.length !== 1 ||
    evidenceIds.has(expectedContextEvidenceId)
  ) {
    invalid();
  }
  assertExactProjection(
    context.proof.projection,
    expectedContextProjection,
    context.proof.source_content_hash
  );
  assertEvidence({
    evidence: context.evidence[0]!,
    source: context.source_version,
    evidenceId: expectedContextEvidenceId,
    readAt: snapshot.read_at,
    locator,
  });
  addSource(context.source_version);
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  try {
    const value = error as Readonly<Record<string, unknown>>;
    return (
      value.code === "P0002" &&
      value.message === "agent_job_communication_context_not_found"
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

export function createSupabaseJobCommunicationContextRepository(
  client: JobCommunicationContextRpcClient
): JobCommunicationContextRepository {
  let suppliedRpc: JobCommunicationContextRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as JobCommunicationContextRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A job communication context RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A job communication context RPC client is required");
  }
  const rpc = (
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc, client, [functionName, args]);

  const repository = {
    async read(input: {
      readonly authorization: AuthorizedJobCommunicationRead;
      readonly signal?: AbortSignal;
    }): Promise<JobCommunicationContextSnapshot> {
      const authorization = input.authorization;
      const signal = input.signal;
      if (!isAuthorizedJobCommunicationRead(authorization)) invalid();
      if (signal?.aborted) {
        throw new JobCommunicationContextRepositoryError(
          "JOB_COMMUNICATION_CONTEXT_READ_FAILED"
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
          p_calendar_scope: proof.calendarScope,
          p_tasks_scope: proof.tasksScope,
          p_photos_scope: proof.photosScope,
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
        throw new JobCommunicationContextRepositoryError(
          "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new JobCommunicationContextRepositoryError(
          "JOB_COMMUNICATION_CONTEXT_READ_FAILED"
        );
      }
      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new JobCommunicationContextRepositoryError(
          "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        throw new JobCommunicationContextRepositoryError(
          isNotFound(responseError)
            ? "JOB_COMMUNICATION_CONTEXT_NOT_FOUND"
            : "JOB_COMMUNICATION_CONTEXT_READ_FAILED",
          { cause: responseError }
        );
      }
      const parsed =
        JobCommunicationContextSnapshotSchema.safeParse(responseData);
      if (!parsed.success) invalid(parsed.error);
      assertSnapshot(parsed.data, proof);
      return deepFreeze(parsed.data);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(
    repository
  ) as unknown as JobCommunicationContextRepository;
}

export function isTrustedJobCommunicationContextRepository(
  value: unknown
): value is JobCommunicationContextRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
