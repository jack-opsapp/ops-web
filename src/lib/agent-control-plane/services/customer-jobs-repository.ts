import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  PostgresUuidSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CustomerJobSchema,
  TASK_13_CAPABILITY_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  isAuthorizedCustomerJobsRead,
  type AuthorizedCustomerJobsRead,
} from "./customer-jobs-authorization";
import {
  FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
  hashOperationalReadQuery,
  isTrustedOperationalReadCursorCodec,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
  type CustomerJobsCursorClaims,
  type OperationalReadCursorCodec,
} from "./operational-read-cursor";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
  type CanonicalProjection,
} from "./operational-read-projection";

const RPC_NAME = "read_agent_customer_jobs_as_system" as const;
const UUID_SCHEMA = PostgresUuidSchema;
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const UTC_SCHEMA = z.string().datetime({ offset: false });
const SOURCE_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "operational_read_revision" &&
    source.source_id === "private.agent_operational_read_revisions" &&
    /^revision:\d+$/.test(source.version),
  "Customer-job source fence is invalid"
);
const GapCodesSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(20)
  .refine((values) => new Set(values).size === values.length);
const NextCursorClaimsSchema = z
  .object({
    source_revision: z.number().int().safe().nonnegative(),
    read_as_of: UTC_SCHEMA,
    sort_at: UTC_SCHEMA,
    job_kind: z.enum(["opportunity", "project"]),
    job_id: UUID_SCHEMA,
  })
  .strict();
const CollectionRawSchema = z
  .object({
    returned_job_count: z.number().int().min(0).max(50),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    gaps: GapCodesSchema,
  })
  .strict();
const PromptReductionSchema = z
  .object({
    max_output_characters: z.literal(60_000),
    atomic_claim_kind: z.literal("customer_job"),
    retention: z.literal("maximal_ordered_prefix"),
    claim_path: z.literal("job_claims"),
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
const CustomerJobClaimSchema = z
  .object({
    raw: CustomerJobSchema,
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
    source_fence: SOURCE_FENCE_SCHEMA,
    job_claims: z.array(CustomerJobClaimSchema).max(50),
    returned_job_count: z.number().int().min(0).max(50),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    gaps: GapCodesSchema,
    collection_claim: CollectionClaimSchema,
    prompt_reduction: PromptReductionSchema,
  })
  .strict();

type RawCustomerJobsSnapshot = z.infer<typeof RawSnapshotSchema>;
type SourceVersion = z.infer<typeof SourceVersionSchema>;
type CustomerJobClaim = z.infer<typeof CustomerJobClaimSchema>;

export interface CustomerJobsSnapshot extends Omit<
  RawCustomerJobsSnapshot,
  "has_more" | "next_cursor_claims"
> {
  readonly page: Readonly<{
    readonly next_cursor: string | null;
    readonly has_more: boolean;
  }>;
  readonly boundary_cursors: readonly string[];
}

export class CustomerJobsRepositoryError extends Error {
  readonly code:
    | "CUSTOMER_JOBS_READ_FAILED"
    | "CUSTOMER_JOBS_NOT_FOUND"
    | "CUSTOMER_JOBS_INVALID"
    | "CUSTOMER_JOBS_STALE";
  readonly currentSourceVersion: SourceVersion | null;

  constructor(
    code: CustomerJobsRepositoryError["code"],
    options?: ErrorOptions & { readonly currentSourceVersion?: SourceVersion }
  ) {
    super(code, options);
    this.name = "CustomerJobsRepositoryError";
    this.code = code;
    this.currentSourceVersion = options?.currentSourceVersion ?? null;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface CustomerJobsRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface CustomerJobsRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): CustomerJobsRpcRequest;
}

declare const TRUSTED_CUSTOMER_JOBS_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface CustomerJobsRepository {
  readonly [TRUSTED_CUSTOMER_JOBS_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedCustomerJobsRead;
    readonly signal?: AbortSignal;
  }): Promise<CustomerJobsSnapshot>;
}

function invalid(cause?: unknown): never {
  throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_INVALID", { cause });
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

function canonicalInput(proof: AuthorizedCustomerJobsRead) {
  const { cursor: _cursor, ...query } = proof.query;
  return query;
}

function queryHash(
  proof: AuthorizedCustomerJobsRead,
  capabilityManifestRevision = proof.capabilityManifestRevision
): string {
  return hashOperationalReadQuery({
    capability_id: proof.capabilityId,
    schema_revision: TASK_13_CAPABILITY_SCHEMA_REVISION,
    capability_manifest_revision: capabilityManifestRevision,
    query: canonicalInput(proof),
  });
}

function sourceRevision(snapshot: RawCustomerJobsSnapshot): number {
  const revision = Number(snapshot.source_fence.version.slice(9));
  if (!Number.isSafeInteger(revision) || revision < 0) invalid();
  return revision;
}

function assertEvidence(input: {
  readonly evidence: z.infer<typeof EvidenceRefSchema>;
  readonly source: SourceVersion;
  readonly evidenceId: string;
  readonly readAt: string;
  readonly trust: "authoritative_ops";
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
  readonly claim: CustomerJobClaim | z.infer<typeof CollectionClaimSchema>;
  readonly proof: AuthorizedCustomerJobsRead;
  readonly snapshot: RawCustomerJobsSnapshot;
  readonly sourceType:
    | "customer_job_projection"
    | "customer_jobs_collection_projection";
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly versionPrefix:
    | "customer-job-projection:v1"
    | "customer-jobs-collection-projection:v1";
  readonly payloadKey: "job" | "collection";
  readonly expectedRaw: CanonicalProjection;
  readonly retainedProofSources: readonly SourceVersion[];
}): void {
  const revision = sourceRevision(input.snapshot);
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
    source_revision: revision,
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
    if (error instanceof CustomerJobsRepositoryError) throw error;
    invalid(error);
  }
  assertEvidence({
    evidence: claim.evidence[0]!,
    source: claim.source_version,
    evidenceId: claim.proof.evidence_id,
    readAt: input.snapshot.read_at,
    trust: "authoritative_ops",
  });
}

function sortAt(
  claim: CustomerJobClaim,
  proof: AuthorizedCustomerJobsRead
): string {
  return proof.query.date_window?.field === "created_at"
    ? claim.raw.dates.created_at
    : claim.raw.dates.updated_at;
}

function jobMatchesQuery(
  claim: CustomerJobClaim,
  proof: AuthorizedCustomerJobsRead,
  readAt: string
): boolean {
  const query = proof.query;
  const raw = claim.raw;
  const expectedRelationshipBasis =
    query.customer_ref.kind === "client"
      ? "primary_client"
      : "sub_client_parent";
  const readAtMillis = Date.parse(readAt);
  const createdAtMillis = Date.parse(raw.dates.created_at);
  const updatedAtMillis = Date.parse(raw.dates.updated_at);
  if (
    !query.job_kinds.includes(raw.job_ref.kind) ||
    raw.relationship_basis !== expectedRelationshipBasis ||
    createdAtMillis > updatedAtMillis ||
    createdAtMillis > readAtMillis ||
    updatedAtMillis > readAtMillis ||
    (query.lifecycle_states !== undefined &&
      !query.lifecycle_states.includes(raw.lifecycle_state)) ||
    (raw.status.kind === "opportunity" &&
      query.opportunity_stages !== undefined &&
      !query.opportunity_stages.includes(raw.status.value)) ||
    (raw.status.kind === "project" &&
      query.project_statuses !== undefined &&
      !query.project_statuses.includes(raw.status.value)) ||
    (raw.conversion.state === "converted" &&
      (!query.job_kinds.includes("opportunity") ||
        !query.job_kinds.includes("project")))
  ) {
    return false;
  }
  const selectedAt = sortAt(claim, proof);
  if (Date.parse(selectedAt) > Date.parse(readAt)) return false;
  const window = query.date_window;
  return (
    window === undefined ||
    (Date.parse(selectedAt) >= Date.parse(window.from) &&
      Date.parse(selectedAt) < Date.parse(window.to_exclusive))
  );
}

function assertSnapshot(
  snapshot: RawCustomerJobsSnapshot,
  proof: AuthorizedCustomerJobsRead,
  decoded: CustomerJobsCursorClaims | null
): void {
  const revision = sourceRevision(snapshot);
  const expectedCollectionRaw = {
    returned_job_count: snapshot.returned_job_count,
    has_more: snapshot.has_more,
    next_cursor_claims: snapshot.next_cursor_claims,
    gaps: snapshot.gaps,
  } as const;
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    snapshot.returned_job_count !== snapshot.job_claims.length ||
    snapshot.job_claims.length > proof.query.limit ||
    snapshot.has_more !== (snapshot.next_cursor_claims !== null) ||
    (snapshot.next_cursor_claims !== null &&
      (snapshot.next_cursor_claims.source_revision !== revision ||
        snapshot.next_cursor_claims.read_as_of !== snapshot.read_at)) ||
    (decoded !== null &&
      (decoded.source_revision !== revision ||
        decoded.read_as_of !== snapshot.read_at))
  ) {
    invalid();
  }

  const sources = new Set<string>();
  const evidenceIds = new Set<string>();
  const retainedSources: SourceVersion[] = [];
  for (const [index, claim] of snapshot.job_claims.entries()) {
    if (
      !jobMatchesQuery(claim, proof, snapshot.read_at) ||
      claim.raw.evidence_ids.length !== 1 ||
      claim.raw.evidence_ids[0] !== claim.proof.evidence_id ||
      sources.has(sourceIdentity(claim.source_version)) ||
      evidenceIds.has(claim.proof.evidence_id)
    ) {
      invalid();
    }
    assertAtomicClaim({
      claim,
      proof,
      snapshot,
      sourceType: "customer_job_projection",
      sourceId: `${claim.raw.job_ref.kind}:${claim.raw.job_ref.id}`,
      evidenceId: `evidence:customer_job_projection:${claim.raw.job_ref.kind}:${claim.raw.job_ref.id}`,
      versionPrefix: "customer-job-projection:v1",
      payloadKey: "job",
      expectedRaw: claim.raw as CanonicalProjection,
      retainedProofSources: [],
    });
    sources.add(sourceIdentity(claim.source_version));
    evidenceIds.add(claim.proof.evidence_id);
    retainedSources.push(claim.source_version);

    const previous = snapshot.job_claims[index - 1];
    if (previous) {
      const previousSortAt = sortAt(previous, proof);
      const currentSortAt = sortAt(claim, proof);
      if (
        previousSortAt < currentSortAt ||
        (previousSortAt === currentSortAt &&
          (previous.raw.job_ref.kind > claim.raw.job_ref.kind ||
            (previous.raw.job_ref.kind === claim.raw.job_ref.kind &&
              previous.raw.job_ref.id <= claim.raw.job_ref.id)))
      ) {
        invalid();
      }
    }
  }

  const first = snapshot.job_claims[0];
  if (decoded && first) {
    const firstSortAt = sortAt(first, proof);
    if (
      firstSortAt > decoded.sort_at ||
      (firstSortAt === decoded.sort_at &&
        (first.raw.job_ref.kind < decoded.job_kind ||
          (first.raw.job_ref.kind === decoded.job_kind &&
            first.raw.job_ref.id >= decoded.job_id)))
    ) {
      invalid();
    }
  }
  const last = snapshot.job_claims.at(-1);
  if (
    snapshot.next_cursor_claims !== null &&
    (!last ||
      snapshot.next_cursor_claims.sort_at !== sortAt(last, proof) ||
      snapshot.next_cursor_claims.job_kind !== last.raw.job_ref.kind ||
      snapshot.next_cursor_claims.job_id !== last.raw.job_ref.id)
  ) {
    invalid();
  }

  assertAtomicClaim({
    claim: snapshot.collection_claim,
    proof,
    snapshot,
    sourceType: "customer_jobs_collection_projection",
    sourceId: `${proof.query.customer_ref.kind}:${proof.query.customer_ref.id}`,
    evidenceId: `evidence:customer_jobs_collection_projection:${proof.query.customer_ref.kind}:${proof.query.customer_ref.id}`,
    versionPrefix: "customer-jobs-collection-projection:v1",
    payloadKey: "collection",
    expectedRaw: expectedCollectionRaw,
    retainedProofSources: retainedSources,
  });
  if (
    sources.has(sourceIdentity(snapshot.collection_claim.source_version)) ||
    evidenceIds.has(snapshot.collection_claim.proof.evidence_id)
  ) {
    invalid();
  }
}

function permissionSource(proof: AuthorizedCustomerJobsRead): SourceVersion {
  return {
    source_domain: "authorization",
    source_type: "actor_permission_snapshot",
    source_id: proof.actorContext.actorUserId,
    version: proof.actorContext.permissionSnapshotRevision,
  };
}

function staleSource(error: unknown): SourceVersion | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const value = error as Readonly<Record<string, unknown>>;
    if (
      value.code !== "40001" ||
      value.message !== "agent_customer_jobs_cursor_stale"
    ) {
      return null;
    }
    let details = value.details;
    if (typeof details === "string") {
      if (details.length > 4_096) return null;
      details = JSON.parse(details);
    }
    const parsed = SourceVersionSchema.safeParse(details);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isNotFound(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const value = error as Readonly<Record<string, unknown>>;
    return (
      value.code === "P0002" &&
      value.message === "agent_customer_jobs_not_found_or_not_visible"
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

export function createSupabaseCustomerJobsRepository(
  client: CustomerJobsRpcClient,
  cursorCodec: OperationalReadCursorCodec
): CustomerJobsRepository {
  let suppliedRpc: CustomerJobsRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as CustomerJobsRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A customer-jobs RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A customer-jobs RPC client is required");
  }
  if (!isTrustedOperationalReadCursorCodec(cursorCodec)) {
    throw new TypeError("A trusted operational-read cursor codec is required");
  }
  const rpc = (
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc, client, [functionName, args]);

  const repository = {
    async read(input: {
      readonly authorization: AuthorizedCustomerJobsRead;
      readonly signal?: AbortSignal;
    }): Promise<CustomerJobsSnapshot> {
      let proof: AuthorizedCustomerJobsRead;
      let signal: AbortSignal | undefined;
      try {
        proof = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedCustomerJobsRead(proof)) invalid();
      if (signal?.aborted) {
        throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_READ_FAILED");
      }

      const hash = queryHash(proof);
      const frozenV7QueryHash = queryHash(
        proof,
        FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION
      );
      let decoded: CustomerJobsCursorClaims | null = null;
      if (proof.query.cursor) {
        try {
          const claims = cursorCodec.decode({
            cursor: proof.query.cursor,
            expected: {
              capabilityId: proof.capabilityId,
              schemaRevision: TASK_13_CAPABILITY_SCHEMA_REVISION,
              capabilityManifestRevision: proof.capabilityManifestRevision,
              ruleRevisions: [],
              actorUserId: proof.actorContext.actorUserId,
              companyId: proof.actorContext.companyId,
              permissionSnapshotRevision:
                proof.actorContext.permissionSnapshotRevision,
              queryHash: hash,
              frozenV7QueryHash,
            },
          });
          if (claims.capability_id !== "list_customer_jobs") invalid();
          decoded = claims;
        } catch (error) {
          if (error instanceof OperationalReadCursorPermissionStaleError) {
            throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_STALE", {
              cause: error,
              currentSourceVersion: permissionSource(proof),
            });
          }
          if (
            error instanceof OperationalReadCursorError ||
            error instanceof CustomerJobsRepositoryError
          ) {
            throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_INVALID", {
              cause: error,
            });
          }
          throw error;
        }
      }

      const dateWindow = proof.query.date_window;
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
          p_clients_scope: proof.clientsScope,
          p_pipeline_scope: proof.pipelineScope,
          p_projects_scope: proof.projectsScope,
          p_customer_kind: proof.query.customer_ref.kind,
          p_customer_id: proof.query.customer_ref.id,
          p_job_kinds: [...proof.query.job_kinds],
          p_lifecycle_states: proof.query.lifecycle_states
            ? [...proof.query.lifecycle_states]
            : null,
          p_opportunity_stages: proof.query.opportunity_stages
            ? [...proof.query.opportunity_stages]
            : null,
          p_project_statuses: proof.query.project_statuses
            ? [...proof.query.project_statuses]
            : null,
          p_date_field: dateWindow?.field ?? null,
          p_date_from: dateWindow?.from ?? null,
          p_date_to_exclusive: dateWindow?.to_exclusive ?? null,
          p_read_as_of: decoded?.read_as_of ?? null,
          p_cursor_source_revision: decoded?.source_revision ?? null,
          p_cursor_sort_at: decoded?.sort_at ?? null,
          p_cursor_job_kind: decoded?.job_kind ?? null,
          p_cursor_job_id: decoded?.job_id ?? null,
          p_limit: proof.query.limit,
        });
        const abortSignal = request?.abortSignal;
        response =
          signal && typeof abortSignal === "function"
            ? await Reflect.apply(abortSignal, request, [signal])
            : await request;
      } catch (error) {
        if (error instanceof CustomerJobsRepositoryError) throw error;
        throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_READ_FAILED", {
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_READ_FAILED");
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_READ_FAILED", {
          cause: error,
        });
      }
      if (responseError) {
        const currentSourceVersion = staleSource(responseError);
        if (currentSourceVersion) {
          throw new CustomerJobsRepositoryError("CUSTOMER_JOBS_STALE", {
            cause: responseError,
            currentSourceVersion,
          });
        }
        throw new CustomerJobsRepositoryError(
          isNotFound(responseError)
            ? "CUSTOMER_JOBS_NOT_FOUND"
            : "CUSTOMER_JOBS_READ_FAILED",
          { cause: responseError }
        );
      }

      let parsedData: RawCustomerJobsSnapshot;
      try {
        const parsed = RawSnapshotSchema.safeParse(responseData);
        if (!parsed.success) invalid(parsed.error);
        parsedData = parsed.data;
      } catch (error) {
        if (error instanceof CustomerJobsRepositoryError) throw error;
        invalid(error);
      }
      assertSnapshot(parsedData, proof, decoded);
      const commonClaims = {
        capability_id: proof.capabilityId,
        schema_revision: TASK_13_CAPABILITY_SCHEMA_REVISION,
        capability_manifest_revision: proof.capabilityManifestRevision,
        rule_revisions: [],
        actor_user_id: proof.actorContext.actorUserId,
        company_id: proof.actorContext.companyId,
        permission_snapshot_revision:
          proof.actorContext.permissionSnapshotRevision,
        query_hash: hash,
        source_revision: sourceRevision(parsedData),
        read_as_of: parsedData.read_at,
      } as const;
      const boundaryCursors = parsedData.job_claims.map((claim) =>
        cursorCodec.encode({
          ...commonClaims,
          sort_at: sortAt(claim, proof),
          job_kind: claim.raw.job_ref.kind,
          job_id: claim.raw.job_ref.id,
        })
      );
      const nextClaims = parsedData.next_cursor_claims;
      const nextCursor = nextClaims
        ? cursorCodec.encode({
            ...commonClaims,
            source_revision: nextClaims.source_revision,
            read_as_of: nextClaims.read_as_of,
            sort_at: nextClaims.sort_at,
            job_kind: nextClaims.job_kind,
            job_id: nextClaims.job_id,
          })
        : null;
      const {
        has_more: hasMore,
        next_cursor_claims: _nextCursorClaims,
        ...snapshot
      } = parsedData;
      return deepFreeze({
        ...snapshot,
        page: { next_cursor: nextCursor, has_more: hasMore },
        boundary_cursors: boundaryCursors,
      });
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as CustomerJobsRepository;
}

export function isTrustedCustomerJobsRepository(
  value: unknown
): value is CustomerJobsRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
