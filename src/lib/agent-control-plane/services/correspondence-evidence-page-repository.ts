import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  PostgresUuidSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import { CorrespondenceEvidenceItemSchema } from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  isAuthorizedCorrespondenceEvidencePageRead,
  type AuthorizedCorrespondenceEvidencePageRead,
} from "./correspondence-evidence-page-authorization";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
  type CanonicalProjection,
} from "./operational-read-projection";

const RPC_NAME = "read_agent_correspondence_evidence_page_as_system" as const;
const UUID_SCHEMA = PostgresUuidSchema;
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const UTC_SCHEMA = z.string().datetime({ offset: false });
const JOB_REF_SCHEMA = z
  .object({ kind: z.enum(["opportunity", "project"]), id: UUID_SCHEMA })
  .strict();
const HISTORY_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "job_history_read_revision" &&
    source.source_id === "private.agent_job_history_revisions" &&
    /^revision:\d+$/.test(source.version),
  "Correspondence-evidence history fence is invalid"
);
const GapCodesSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(20)
  .refine((values) => new Set(values).size === values.length);
const CollectionRawSchema = z
  .object({
    requested_job: JOB_REF_SCHEMA,
    requested_evidence_count: z.number().int().min(1).max(20),
    returned_evidence_count: z.number().int().min(1).max(20),
    gaps: GapCodesSchema,
  })
  .strict();
const PromptReductionSchema = z
  .object({
    max_output_characters: z.literal(60_000),
    atomic_claim_kind: z.literal("correspondence_evidence"),
    retention: z.literal("all_or_error"),
    claim_path: z.literal("evidence_claims"),
    envelope_claim_path: z.literal("collection_claim"),
  })
  .strict();
const ProjectionProofSchema = z
  .object({
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: z.string().min(1).max(512),
    projection: z.record(z.string(), z.unknown()),
  })
  .strict();
const EvidenceClaimSchema = z
  .object({
    raw: CorrespondenceEvidenceItemSchema,
    proof: ProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).length(1),
  })
  .strict();
const CollectionClaimSchema = z
  .object({
    raw: CollectionRawSchema,
    proof: ProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).length(1),
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    company_id: UUID_SCHEMA,
    permission_snapshot_revision: SHA256_SCHEMA,
    read_at: UTC_SCHEMA,
    history_fence: HISTORY_FENCE_SCHEMA,
    requested_job: JOB_REF_SCHEMA,
    evidence_claims: z.array(EvidenceClaimSchema).min(1).max(20),
    requested_evidence_count: z.number().int().min(1).max(20),
    returned_evidence_count: z.number().int().min(1).max(20),
    gaps: GapCodesSchema,
    collection_claim: CollectionClaimSchema,
    prompt_reduction: PromptReductionSchema,
  })
  .strict();

export type CorrespondenceEvidenceSnapshot = Readonly<
  z.infer<typeof RawSnapshotSchema>
>;
type RawCorrespondenceEvidenceSnapshot = z.infer<typeof RawSnapshotSchema>;
type SourceVersion = z.infer<typeof SourceVersionSchema>;
type AtomicClaim =
  | z.infer<typeof EvidenceClaimSchema>
  | z.infer<typeof CollectionClaimSchema>;

export class CorrespondenceEvidencePageRepositoryError extends Error {
  readonly code:
    | "CORRESPONDENCE_EVIDENCE_READ_FAILED"
    | "CORRESPONDENCE_EVIDENCE_NOT_FOUND"
    | "CORRESPONDENCE_EVIDENCE_TOO_LARGE"
    | "CORRESPONDENCE_EVIDENCE_INVALID";

  constructor(
    code: CorrespondenceEvidencePageRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "CorrespondenceEvidencePageRepositoryError";
    this.code = code;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface CorrespondenceEvidencePageRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface CorrespondenceEvidencePageRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): CorrespondenceEvidencePageRpcRequest;
}

declare const TRUSTED_CORRESPONDENCE_EVIDENCE_PAGE_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface CorrespondenceEvidencePageRepository {
  readonly [TRUSTED_CORRESPONDENCE_EVIDENCE_PAGE_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedCorrespondenceEvidencePageRead;
    readonly signal?: AbortSignal;
  }): Promise<CorrespondenceEvidenceSnapshot>;
}

function invalid(cause?: unknown): never {
  throw new CorrespondenceEvidencePageRepositoryError(
    "CORRESPONDENCE_EVIDENCE_INVALID",
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

function sourceIdentity(source: SourceVersion): string {
  return [
    source.source_domain,
    source.source_type,
    source.source_id,
    source.version,
  ].join("\u0000");
}

function historyRevision(snapshot: RawCorrespondenceEvidenceSnapshot): number {
  const value = Number(snapshot.history_fence.version.slice(9));
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function canonicalInput(proof: AuthorizedCorrespondenceEvidencePageRead) {
  return proof.query;
}

function assertEvidence(input: {
  readonly evidence: z.infer<typeof EvidenceRefSchema>;
  readonly source: SourceVersion;
  readonly evidenceId: string;
  readonly readAt: string;
  readonly trust: "authoritative_ops" | "delivered_correspondence";
}): void {
  if (
    input.evidence.evidence_id !== input.evidenceId ||
    input.evidence.locator !==
      `ops://evidence/${encodeURIComponent(input.evidenceId)}` ||
    !sameSource(input.evidence, input.source) ||
    input.evidence.occurred_at !== input.readAt ||
    input.evidence.relationship !== "supports" ||
    input.evidence.trust !== input.trust ||
    input.evidence.excerpt !== undefined
  ) {
    invalid();
  }
}

function assertAtomicClaim(input: {
  readonly claim: AtomicClaim;
  readonly proof: AuthorizedCorrespondenceEvidencePageRead;
  readonly snapshot: RawCorrespondenceEvidenceSnapshot;
  readonly sourceType:
    | "correspondence_evidence_projection"
    | "correspondence_evidence_collection_projection";
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly versionPrefix:
    | "correspondence-evidence-projection:v1"
    | "correspondence-evidence-collection-projection:v1";
  readonly payloadKey: "correspondence_evidence" | "collection";
  readonly expectedRaw: CanonicalProjection;
  readonly retainedProofSources: readonly SourceVersion[];
  readonly trust: "authoritative_ops" | "delivered_correspondence";
}): void {
  const expectedProjection = {
    actor_user_id: input.proof.actorContext.actorUserId,
    company_id: input.proof.actorContext.companyId,
    capability_id: input.proof.capabilityId,
    capability_revision: input.proof.capabilityRevision,
    capability_manifest_revision: input.proof.capabilityManifestRevision,
    permission_snapshot_revision:
      input.proof.actorContext.permissionSnapshotRevision,
    canonical_input: canonicalInput(input.proof),
    read_at: input.snapshot.read_at,
    history_revision: historyRevision(input.snapshot),
    retained_proof_sources: input.retainedProofSources,
    [input.payloadKey]: input.expectedRaw,
  } as const;
  const claim = input.claim;
  try {
    if (
      canonicalOperationalProjection(claim.raw as CanonicalProjection) !==
        canonicalOperationalProjection(input.expectedRaw) ||
      canonicalOperationalProjection(
        claim.proof.projection as CanonicalProjection
      ) !== canonicalOperationalProjection(expectedProjection) ||
      hashOperationalProjection(
        claim.proof.projection as CanonicalProjection
      ) !== claim.proof.source_content_hash ||
      claim.proof.source_version.source_domain !== "operations" ||
      claim.proof.source_version.source_type !== input.sourceType ||
      claim.proof.source_version.source_id !== input.sourceId ||
      claim.proof.evidence_id !== input.evidenceId ||
      claim.proof.source_version.version !==
        `${input.versionPrefix}:${claim.proof.source_content_hash}` ||
      !sameSource(claim.source_version, claim.proof.source_version) ||
      claim.evidence.length !== 1
    ) {
      invalid();
    }
  } catch (error) {
    if (error instanceof CorrespondenceEvidencePageRepositoryError) {
      throw error;
    }
    invalid(error);
  }
  assertEvidence({
    evidence: claim.evidence[0]!,
    source: claim.source_version,
    evidenceId: claim.proof.evidence_id,
    readAt: input.snapshot.read_at,
    trust: input.trust,
  });
}

function sameJob(
  left: { readonly kind: string; readonly id: string },
  right: { readonly kind: string; readonly id: string }
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function assertSnapshot(
  snapshot: RawCorrespondenceEvidenceSnapshot,
  proof: AuthorizedCorrespondenceEvidencePageRead
): void {
  const expectedIds = proof.query.evidence_ids;
  const returnedIds = snapshot.evidence_claims.map(
    ({ raw }) => raw.evidence_id
  );
  const collectionRaw = {
    requested_job: snapshot.requested_job,
    requested_evidence_count: snapshot.requested_evidence_count,
    returned_evidence_count: snapshot.returned_evidence_count,
    gaps: snapshot.gaps,
  } as const;
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    !sameJob(snapshot.requested_job, proof.query.job_ref) ||
    snapshot.requested_evidence_count !== expectedIds.length ||
    snapshot.returned_evidence_count !== expectedIds.length ||
    snapshot.evidence_claims.length !== expectedIds.length ||
    returnedIds.some((id, index) => id !== expectedIds[index]) ||
    canonicalOperationalProjection(snapshot.collection_claim.raw) !==
      canonicalOperationalProjection(collectionRaw) ||
    snapshot.evidence_claims.reduce(
      (total, claim) => total + claim.raw.attachments.length,
      0
    ) > 20
  ) {
    invalid();
  }

  const sources = new Set<string>();
  const evidenceIds = new Set<string>();
  const retainedSources: SourceVersion[] = [];
  for (const claim of snapshot.evidence_claims) {
    if (
      !sameJob(claim.raw.job_ref, snapshot.requested_job) ||
      Date.parse(claim.raw.delivered_at) > Date.parse(snapshot.read_at) ||
      (claim.raw.content.state === "available" &&
        claim.raw.content.mode !== proof.query.mode) ||
      claim.raw.evidence_ids.length !== 1 ||
      claim.raw.evidence_ids[0] !== claim.proof.evidence_id ||
      claim.proof.evidence_id !== claim.raw.evidence_id ||
      sources.has(sourceIdentity(claim.source_version)) ||
      evidenceIds.has(claim.proof.evidence_id)
    ) {
      invalid();
    }
    assertAtomicClaim({
      claim,
      proof,
      snapshot,
      sourceType: "correspondence_evidence_projection",
      sourceId: claim.raw.evidence_id,
      evidenceId: claim.raw.evidence_id,
      versionPrefix: "correspondence-evidence-projection:v1",
      payloadKey: "correspondence_evidence",
      expectedRaw: claim.raw as CanonicalProjection,
      retainedProofSources: [],
      trust: "delivered_correspondence",
    });
    sources.add(sourceIdentity(claim.source_version));
    evidenceIds.add(claim.proof.evidence_id);
    retainedSources.push(claim.source_version);
  }

  assertAtomicClaim({
    claim: snapshot.collection_claim,
    proof,
    snapshot,
    sourceType: "correspondence_evidence_collection_projection",
    sourceId: `${snapshot.requested_job.kind}:${snapshot.requested_job.id}`,
    evidenceId: `evidence:correspondence_evidence_collection_projection:${snapshot.requested_job.kind}:${snapshot.requested_job.id}`,
    versionPrefix: "correspondence-evidence-collection-projection:v1",
    payloadKey: "collection",
    expectedRaw: collectionRaw,
    retainedProofSources: retainedSources,
    trust: "authoritative_ops",
  });
  if (
    sources.has(sourceIdentity(snapshot.collection_claim.source_version)) ||
    evidenceIds.has(snapshot.collection_claim.proof.evidence_id)
  ) {
    invalid();
  }
}

function isNotFound(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const value = error as Readonly<Record<string, unknown>>;
    return (
      value.code === "P0002" &&
      value.message === "agent_correspondence_evidence_not_found_or_not_visible"
    );
  } catch {
    return false;
  }
}

function isTooLarge(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const value = error as Readonly<Record<string, unknown>>;
    return (
      value.code === "54000" &&
      value.message === "agent_correspondence_evidence_full_text_too_large"
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

export function createSupabaseCorrespondenceEvidencePageRepository(
  client: CorrespondenceEvidencePageRpcClient
): CorrespondenceEvidencePageRepository {
  let suppliedRpc: CorrespondenceEvidencePageRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as CorrespondenceEvidencePageRpcClient | null)?.rpc;
  } catch {
    throw new TypeError(
      "A correspondence-evidence-page RPC client is required"
    );
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError(
      "A correspondence-evidence-page RPC client is required"
    );
  }
  const rpc = (
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc, client, [functionName, args]);

  const repository = {
    async read(input: {
      readonly authorization: AuthorizedCorrespondenceEvidencePageRead;
      readonly signal?: AbortSignal;
    }): Promise<CorrespondenceEvidenceSnapshot> {
      let proof: AuthorizedCorrespondenceEvidencePageRead;
      let signal: AbortSignal | undefined;
      try {
        proof = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedCorrespondenceEvidencePageRead(proof)) invalid();
      if (signal?.aborted) {
        throw new CorrespondenceEvidencePageRepositoryError(
          "CORRESPONDENCE_EVIDENCE_READ_FAILED"
        );
      }

      let response: RpcResult;
      try {
        const query = proof.query;
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
          p_pipeline_scope: proof.pipelineScope,
          p_projects_scope: proof.projectsScope,
          p_job_kind: query.job_ref.kind,
          p_job_id: query.job_ref.id,
          p_evidence_ids: [...query.evidence_ids],
          p_mode: query.mode,
        });
        const abortSignal = request?.abortSignal;
        response =
          signal && typeof abortSignal === "function"
            ? await Reflect.apply(abortSignal, request, [signal])
            : await request;
      } catch (error) {
        if (error instanceof CorrespondenceEvidencePageRepositoryError) {
          throw error;
        }
        throw new CorrespondenceEvidencePageRepositoryError(
          "CORRESPONDENCE_EVIDENCE_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new CorrespondenceEvidencePageRepositoryError(
          "CORRESPONDENCE_EVIDENCE_READ_FAILED"
        );
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new CorrespondenceEvidencePageRepositoryError(
          "CORRESPONDENCE_EVIDENCE_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        throw new CorrespondenceEvidencePageRepositoryError(
          isNotFound(responseError)
            ? "CORRESPONDENCE_EVIDENCE_NOT_FOUND"
            : isTooLarge(responseError)
              ? "CORRESPONDENCE_EVIDENCE_TOO_LARGE"
              : "CORRESPONDENCE_EVIDENCE_READ_FAILED",
          { cause: responseError }
        );
      }
      let parsedData: RawCorrespondenceEvidenceSnapshot;
      try {
        const parsed = RawSnapshotSchema.safeParse(responseData);
        if (!parsed.success) invalid(parsed.error);
        parsedData = parsed.data;
      } catch (error) {
        if (error instanceof CorrespondenceEvidencePageRepositoryError) {
          throw error;
        }
        invalid(error);
      }
      assertSnapshot(parsedData, proof);
      return deepFreeze(parsedData);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as CorrespondenceEvidencePageRepository;
}

export function isTrustedCorrespondenceEvidencePageRepository(
  value: unknown
): value is CorrespondenceEvidencePageRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
