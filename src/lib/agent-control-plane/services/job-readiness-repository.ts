import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import { PostgresUuidSchema } from "@/lib/agent-control-plane/contracts/postgres-uuid";
import { ReadinessRuleCodeSchema } from "@/lib/agent-control-plane/contracts/schedule";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import {
  isAuthorizedJobReadinessRead,
  type AuthorizedJobReadinessRead,
} from "./job-readiness-authorization";
import {
  FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
  hashOperationalReadQuery,
  isTrustedOperationalReadCursorCodec,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
  type OperationalReadCursorCodec,
} from "./operational-read-cursor";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
} from "./operational-read-projection";
import {
  READINESS_RULES,
  ReadinessRuleRawSourcesSchema,
} from "./readiness-rules";

const RPC_NAME = "read_agent_job_readiness_issues_as_system" as const;
const UUID_SCHEMA = PostgresUuidSchema;
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const SOURCE_FENCE_ID = "private.agent_operational_read_revisions";
const SOURCE_FENCE_SCHEMA = SourceVersionSchema.refine(
  (value) =>
    value.source_type === "operational_read_revision" &&
    value.source_id === SOURCE_FENCE_ID &&
    /^revision:\d+$/.test(value.version),
  "Operational source fence is invalid"
);
const PROJECTION_VERSION_SCHEMA = z
  .string()
  .regex(/^job-readiness-projection:v1:sha256:[0-9a-f]{64}$/);
const OccurrenceRefSchema = z
  .object({ kind: z.literal("project_task"), id: UUID_SCHEMA })
  .strict();
const OccurrenceRefsSchema = z
  .array(OccurrenceRefSchema)
  .min(1)
  .max(50)
  .refine(
    (refs) => new Set(refs.map((ref) => ref.id)).size === refs.length,
    "Evaluated occurrence references must be unique"
  );
const JobRefSchema = z
  .object({ kind: z.literal("project"), id: UUID_SCHEMA })
  .strict();
const RuleSourceSchema = z
  .object({
    rule_code: ReadinessRuleCodeSchema,
    source_versions: z.array(SourceVersionSchema).length(1),
    evidence_ids: z.array(z.string().min(1).max(512)).length(1),
  })
  .strict();
const ProjectionJobSchema = z
  .object({
    job_ref: JobRefSchema,
    title: z.string().trim().min(1).max(1_000),
    first_scheduled_start_utc: z.string().datetime({ offset: false }),
    evaluated_occurrence_refs: OccurrenceRefsSchema,
    raw_sources: ReadinessRuleRawSourcesSchema,
    requested_rule_codes: z.array(ReadinessRuleCodeSchema).min(1).max(5),
  })
  .strict();
const ProjectionSchema = z
  .object({
    actor_user_id: UUID_SCHEMA,
    capability_id: z.literal("list_job_readiness_issues"),
    capability_manifest_revision: z.string().min(1).max(128),
    capability_revision: z.string().min(1).max(128),
    company_id: UUID_SCHEMA,
    job: ProjectionJobSchema,
    permission_snapshot_revision: z.string().min(1).max(512),
    read_at: z.string().datetime({ offset: false }),
    rule_revisions: z.array(z.string().min(1).max(128)).min(1).max(5),
    source_revision: z.number().int().nonnegative(),
  })
  .strict();
const ProjectionProofSchema = z
  .object({
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: z.string().min(1).max(512),
    projection: ProjectionSchema,
  })
  .strict();
const CandidateSchema = z
  .object({
    job_ref: JobRefSchema,
    title: z.string().trim().min(1).max(1_000),
    first_scheduled_start_utc: z.string().datetime({ offset: false }),
    evaluated_occurrence_refs: OccurrenceRefsSchema,
    raw_sources: ReadinessRuleRawSourcesSchema,
    rule_sources: z.array(RuleSourceSchema).min(1).max(5),
    projection_proof: ProjectionProofSchema,
  })
  .strict();
const NextCursorClaimsSchema = z
  .object({
    source_revision: z.number().int().nonnegative(),
    first_scheduled_start_utc: z.string().datetime({ offset: false }),
    project_id: UUID_SCHEMA,
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    company_id: UUID_SCHEMA,
    permission_snapshot_revision: z.string().min(1).max(512),
    read_at: z.string().datetime({ offset: false }),
    source_fence: SOURCE_FENCE_SCHEMA,
    candidates: z.array(CandidateSchema).max(50),
    scanned_candidate_count: z.number().int().min(0).max(50),
    next_scan_cursor_claims: NextCursorClaimsSchema.nullable(),
    scan_has_more: z.boolean(),
    source_versions: z.array(SourceVersionSchema).max(100),
    evidence: z.array(EvidenceRefSchema).max(100),
  })
  .strict();

export type JobReadinessSnapshot = z.infer<typeof RawSnapshotSchema>;
export type JobReadinessRepositoryCandidate = z.infer<typeof CandidateSchema> &
  Readonly<{ boundary_cursor: string }>;
export interface JobReadinessRepositorySnapshot extends Omit<
  JobReadinessSnapshot,
  "candidates" | "next_scan_cursor_claims" | "scan_has_more"
> {
  readonly candidates: readonly JobReadinessRepositoryCandidate[];
  readonly page: Readonly<{
    next_cursor: string | null;
    has_more: boolean;
  }>;
}

export class JobReadinessRepositoryError extends Error {
  readonly code:
    | "JOB_READINESS_READ_FAILED"
    | "JOB_READINESS_STALE"
    | "JOB_READINESS_INVALID";
  readonly currentSourceVersion: z.infer<typeof SourceVersionSchema> | null;
  constructor(
    code: JobReadinessRepositoryError["code"],
    options?: ErrorOptions & {
      readonly currentSourceVersion?: z.infer<typeof SourceVersionSchema>;
    }
  ) {
    super(code, options);
    this.name = "JobReadinessRepositoryError";
    this.code = code;
    this.currentSourceVersion = options?.currentSourceVersion ?? null;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface JobReadinessRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface JobReadinessRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): JobReadinessRpcRequest;
}

declare const TRUSTED_JOB_READINESS_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface JobReadinessRepository {
  readonly [TRUSTED_JOB_READINESS_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedJobReadinessRead;
    readonly signal?: AbortSignal;
    readonly cursor?: string | null;
    readonly scanLimit?: number;
  }): Promise<JobReadinessRepositorySnapshot>;
}

function ruleRevisions(proof: AuthorizedJobReadinessRead): readonly string[] {
  const revisionByCode = new Map(
    READINESS_RULES.map((rule) => [rule.code, rule.revision])
  );
  return proof.query.rule_codes.map((code) => revisionByCode.get(code)!);
}

function queryHash(
  proof: AuthorizedJobReadinessRead,
  capabilityManifestRevision = proof.capabilityManifestRevision
): string {
  const { cursor: _cursor, ...query } = proof.query;
  return hashOperationalReadQuery({
    capability_id: proof.capabilityId,
    schema_revision: CONTRACT_VERSION,
    capability_manifest_revision: capabilityManifestRevision,
    rule_revisions: ruleRevisions(proof),
    query,
  });
}

function sameSource(
  left: z.infer<typeof SourceVersionSchema>,
  right: z.infer<typeof SourceVersionSchema>
): boolean {
  return (
    left.source_domain === right.source_domain &&
    left.source_type === right.source_type &&
    left.source_id === right.source_id &&
    left.version === right.version
  );
}

function invalid(): never {
  throw new JobReadinessRepositoryError("JOB_READINESS_INVALID");
}

function assertSnapshot(
  snapshot: JobReadinessSnapshot,
  proof: AuthorizedJobReadinessRead,
  scanLimit: number,
  decoded: ReturnType<OperationalReadCursorCodec["decode"]> | null
): void {
  const expectedRules = proof.query.rule_codes;
  const expectedRevisions = ruleRevisions(proof);
  const sourceRevision = Number(snapshot.source_fence.version.slice(9));
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    snapshot.candidates.length > scanLimit ||
    (snapshot.scan_has_more && snapshot.candidates.length !== scanLimit) ||
    snapshot.scanned_candidate_count !== snapshot.candidates.length ||
    snapshot.source_versions.length !== snapshot.candidates.length + 1 ||
    snapshot.evidence.length !== snapshot.candidates.length ||
    snapshot.scan_has_more !== (snapshot.next_scan_cursor_claims !== null) ||
    (snapshot.next_scan_cursor_claims !== null &&
      snapshot.next_scan_cursor_claims.source_revision !== sourceRevision) ||
    (decoded !== null &&
      (snapshot.read_at !== decoded.read_as_of ||
        sourceRevision !== decoded.source_revision)) ||
    !snapshot.source_versions.some((source) =>
      sameSource(source, snapshot.source_fence)
    )
  ) {
    invalid();
  }

  const jobIds = new Set<string>();
  const proofSourceIds = new Set<string>();
  const proofEvidenceIds = new Set<string>();
  for (const candidate of snapshot.candidates) {
    const projectionSource = candidate.projection_proof.source_version;
    const projectionEvidence = snapshot.evidence.find(
      (item) => item.evidence_id === candidate.projection_proof.evidence_id
    );
    const expectedEvidenceId = `evidence:job_readiness_projection:${candidate.job_ref.id}`;
    const evaluatedOccurrenceIds = new Set(
      candidate.evaluated_occurrence_refs.map(
        (occurrence) => `project_task:${occurrence.id}`
      )
    );
    const issueRefsBelongToCandidate =
      (!("unconfirmed_occurrence_refs" in candidate.raw_sources.schedule) ||
        candidate.raw_sources.schedule.unconfirmed_occurrence_refs.every(
          (ref) => evaluatedOccurrenceIds.has(ref)
        )) &&
      (!("unassigned_occurrence_refs" in candidate.raw_sources.crew) ||
        candidate.raw_sources.crew.unassigned_occurrence_refs.every((ref) =>
          evaluatedOccurrenceIds.has(ref)
        ));
    const expectedProjection = {
      actor_user_id: proof.actorContext.actorUserId,
      capability_id: proof.capabilityId,
      capability_manifest_revision: proof.capabilityManifestRevision,
      capability_revision: proof.capabilityRevision,
      company_id: proof.actorContext.companyId,
      job: {
        job_ref: candidate.job_ref,
        title: candidate.title,
        first_scheduled_start_utc: candidate.first_scheduled_start_utc,
        evaluated_occurrence_refs: candidate.evaluated_occurrence_refs,
        raw_sources: candidate.raw_sources,
        requested_rule_codes: expectedRules,
      },
      permission_snapshot_revision:
        proof.actorContext.permissionSnapshotRevision,
      read_at: snapshot.read_at,
      rule_revisions: expectedRevisions,
      source_revision: sourceRevision,
    } as const;
    const exactProjection =
      projectionSource.source_domain === "operations" &&
      projectionSource.source_type === "job_readiness_projection" &&
      projectionSource.source_id === candidate.job_ref.id &&
      PROJECTION_VERSION_SCHEMA.safeParse(projectionSource.version).success &&
      projectionSource.version ===
        `job-readiness-projection:v1:${candidate.projection_proof.source_content_hash}` &&
      candidate.projection_proof.evidence_id === expectedEvidenceId &&
      snapshot.source_versions.some((source) =>
        sameSource(source, projectionSource)
      ) &&
      projectionEvidence !== undefined &&
      sameSource(projectionEvidence, projectionSource) &&
      projectionEvidence.locator ===
        `ops://projects/${candidate.job_ref.id}/readiness` &&
      projectionEvidence.occurred_at === snapshot.read_at &&
      projectionEvidence.relationship === "supports" &&
      projectionEvidence.trust === "authoritative_ops" &&
      projectionEvidence.excerpt === undefined &&
      canonicalOperationalProjection(candidate.projection_proof.projection) ===
        canonicalOperationalProjection(expectedProjection) &&
      hashOperationalProjection(candidate.projection_proof.projection) ===
        candidate.projection_proof.source_content_hash;
    const exactRuleSources =
      candidate.rule_sources.length === expectedRules.length &&
      candidate.rule_sources.every((ruleSource, index) => {
        const source = ruleSource.source_versions[0];
        return (
          ruleSource.rule_code === expectedRules[index] &&
          source !== undefined &&
          sameSource(source, projectionSource) &&
          ruleSource.evidence_ids[0] === expectedEvidenceId
        );
      });
    if (
      Date.parse(candidate.first_scheduled_start_utc) >=
        Date.parse(proof.query.to) ||
      jobIds.has(candidate.job_ref.id) ||
      proofSourceIds.has(projectionSource.source_id) ||
      proofEvidenceIds.has(candidate.projection_proof.evidence_id) ||
      !issueRefsBelongToCandidate ||
      !exactProjection ||
      !exactRuleSources
    ) {
      invalid();
    }
    jobIds.add(candidate.job_ref.id);
    proofSourceIds.add(projectionSource.source_id);
    proofEvidenceIds.add(candidate.projection_proof.evidence_id);
  }

  for (let index = 1; index < snapshot.candidates.length; index += 1) {
    const previous = snapshot.candidates[index - 1]!;
    const current = snapshot.candidates[index]!;
    if (
      previous.first_scheduled_start_utc > current.first_scheduled_start_utc ||
      (previous.first_scheduled_start_utc ===
        current.first_scheduled_start_utc &&
        previous.job_ref.id >= current.job_ref.id)
    ) {
      invalid();
    }
  }
  const last = snapshot.candidates.at(-1);
  const first = snapshot.candidates[0];
  if (
    decoded?.capability_id === "list_job_readiness_issues" &&
    first &&
    (first.first_scheduled_start_utc < decoded.first_scheduled_start_utc ||
      (first.first_scheduled_start_utc === decoded.first_scheduled_start_utc &&
        first.job_ref.id <= decoded.project_id))
  ) {
    invalid();
  }
  if (
    snapshot.next_scan_cursor_claims &&
    (!last ||
      snapshot.next_scan_cursor_claims.first_scheduled_start_utc !==
        last.first_scheduled_start_utc ||
      snapshot.next_scan_cursor_claims.project_id !== last.job_ref.id)
  ) {
    invalid();
  }
}

function staleSource(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const value = error as Record<string, unknown>;
  if (
    value.code !== "40001" ||
    value.message !== "agent_operational_read_cursor_stale"
  ) {
    return null;
  }
  let details = value.details;
  if (typeof details === "string") {
    if (details.length > 4_096) return null;
    try {
      details = JSON.parse(details);
    } catch {
      return null;
    }
  }
  const parsed = SourceVersionSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

function permissionSource(proof: AuthorizedJobReadinessRead) {
  return {
    source_domain: "authorization",
    source_type: "actor_permission_snapshot",
    source_id: proof.actorContext.actorUserId,
    version: proof.actorContext.permissionSnapshotRevision,
  } as const;
}

export function createSupabaseJobReadinessRepository(
  client: JobReadinessRpcClient,
  cursorCodec: OperationalReadCursorCodec
): JobReadinessRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("A job-readiness RPC client is required");
  }
  if (!isTrustedOperationalReadCursorCodec(cursorCodec)) {
    throw new TypeError("A trusted operational-read cursor codec is required");
  }
  const repository = {
    async read(input: {
      readonly authorization: AuthorizedJobReadinessRead;
      readonly signal?: AbortSignal;
      readonly cursor?: string | null;
      readonly scanLimit?: number;
    }): Promise<JobReadinessRepositorySnapshot> {
      if (!isAuthorizedJobReadinessRead(input.authorization)) invalid();
      if (input.signal?.aborted) {
        throw new JobReadinessRepositoryError("JOB_READINESS_READ_FAILED");
      }
      const proof = input.authorization;
      const scanLimit = input.scanLimit ?? 50;
      if (!Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 50) {
        invalid();
      }
      const revisions = ruleRevisions(proof);
      const hash = queryHash(proof);
      const frozenV7QueryHash = queryHash(
        proof,
        FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION
      );
      const cursor =
        input.cursor === undefined ? proof.query.cursor : input.cursor;
      let decoded: ReturnType<OperationalReadCursorCodec["decode"]> | null =
        null;
      if (cursor) {
        try {
          decoded = cursorCodec.decode({
            cursor,
            expected: {
              capabilityId: proof.capabilityId,
              schemaRevision: CONTRACT_VERSION,
              capabilityManifestRevision: proof.capabilityManifestRevision,
              ruleRevisions: revisions,
              actorUserId: proof.actorContext.actorUserId,
              companyId: proof.actorContext.companyId,
              permissionSnapshotRevision:
                proof.actorContext.permissionSnapshotRevision,
              queryHash: hash,
              frozenV7QueryHash,
            },
          });
        } catch (error) {
          if (error instanceof OperationalReadCursorPermissionStaleError) {
            throw new JobReadinessRepositoryError("JOB_READINESS_STALE", {
              cause: error,
              currentSourceVersion: permissionSource(proof),
            });
          }
          if (error instanceof OperationalReadCursorError) {
            throw new JobReadinessRepositoryError("JOB_READINESS_INVALID", {
              cause: error,
            });
          }
          throw error;
        }
      }
      const request = client.rpc(RPC_NAME, {
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
        p_calendar_scope: proof.calendarScope,
        p_clients_scope: proof.clientsScope,
        p_photos_scope: proof.photosScope,
        p_projects_scope: proof.projectsScope,
        p_tasks_scope: proof.tasksScope,
        p_from: proof.query.from,
        p_to: proof.query.to,
        p_rule_codes: [...proof.query.rule_codes],
        p_read_as_of: decoded?.read_as_of ?? null,
        p_cursor_source_revision: decoded?.source_revision ?? null,
        p_cursor_first_scheduled_start_utc:
          decoded?.capability_id === "list_job_readiness_issues"
            ? decoded.first_scheduled_start_utc
            : null,
        p_cursor_project_id:
          decoded?.capability_id === "list_job_readiness_issues"
            ? decoded.project_id
            : null,
        p_scan_limit: scanLimit,
      });
      const response =
        input.signal && request.abortSignal
          ? await request.abortSignal(input.signal)
          : await request;
      if (response.error) {
        const currentSourceVersion = staleSource(response.error);
        if (currentSourceVersion) {
          throw new JobReadinessRepositoryError("JOB_READINESS_STALE", {
            cause: response.error,
            currentSourceVersion,
          });
        }
        throw new JobReadinessRepositoryError("JOB_READINESS_READ_FAILED", {
          cause: response.error,
        });
      }
      const parsed = RawSnapshotSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new JobReadinessRepositoryError("JOB_READINESS_INVALID", {
          cause: parsed.error,
        });
      }
      assertSnapshot(parsed.data, proof, scanLimit, decoded);
      const commonClaims = {
        capability_id: proof.capabilityId,
        schema_revision: CONTRACT_VERSION,
        capability_manifest_revision: proof.capabilityManifestRevision,
        rule_revisions: [...revisions],
        actor_user_id: proof.actorContext.actorUserId,
        company_id: proof.actorContext.companyId,
        permission_snapshot_revision:
          proof.actorContext.permissionSnapshotRevision,
        query_hash: hash,
        source_revision: Number(parsed.data.source_fence.version.slice(9)),
        read_as_of: parsed.data.read_at,
      } as const;
      const candidates = parsed.data.candidates.map((candidate) => ({
        ...candidate,
        boundary_cursor: cursorCodec.encode({
          ...commonClaims,
          first_scheduled_start_utc: candidate.first_scheduled_start_utc,
          project_id: candidate.job_ref.id,
        }),
      }));
      const nextClaims = parsed.data.next_scan_cursor_claims;
      const nextCursor = nextClaims
        ? cursorCodec.encode({
            ...commonClaims,
            source_revision: nextClaims.source_revision,
            first_scheduled_start_utc: nextClaims.first_scheduled_start_utc,
            project_id: nextClaims.project_id,
          })
        : null;
      const {
        candidates: _candidates,
        next_scan_cursor_claims: _claims,
        scan_has_more: hasMore,
        ...snapshot
      } = parsed.data;
      return Object.freeze({
        ...snapshot,
        candidates: Object.freeze(candidates),
        page: Object.freeze({ next_cursor: nextCursor, has_more: hasMore }),
      });
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as JobReadinessRepository;
}

export function isTrustedJobReadinessRepository(
  value: unknown
): value is JobReadinessRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
