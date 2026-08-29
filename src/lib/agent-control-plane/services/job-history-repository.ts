import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  JobHistoryMatchSchema,
  TASK_13_CAPABILITY_SCHEMA_REVISION,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  isAuthorizedJobHistoryRead,
  type AuthorizedJobHistoryRead,
} from "./job-history-authorization";
import {
  FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
  hashOperationalReadQuery,
  isTrustedOperationalReadCursorCodec,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
  type JobHistoryCursorClaims,
  type OperationalReadCursorCodec,
} from "./operational-read-cursor";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
  type CanonicalProjection,
} from "./operational-read-projection";

const RPC_NAME = "read_agent_job_history_as_system" as const;
const HISTORY_DEFAULT_WINDOW_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;
const UUID_SCHEMA = z.string().uuid();
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const UTC_SCHEMA = z.string().datetime({ offset: false });
const JOB_KIND_SCHEMA = z.enum(["opportunity", "project"]);
const SOURCE_TYPE_SCHEMA = z.enum([
  "delivered_correspondence",
  "current_memory_summary",
  "job_status_event",
  "task_event",
  "estimate_document",
]);
const JOB_REF_SCHEMA = z
  .object({ kind: JOB_KIND_SCHEMA, id: UUID_SCHEMA })
  .strict();
const SCOPE_SCHEMA = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("customer"),
      customer_ref: z
        .object({ kind: z.enum(["client", "sub_client"]), id: UUID_SCHEMA })
        .strict(),
      job_kinds: z.array(JOB_KIND_SCHEMA).min(1).max(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal("jobs"),
      job_refs: z.array(JOB_REF_SCHEMA).min(1).max(50),
    })
    .strict(),
]);
const WINDOW_SCHEMA = z
  .object({ from: UTC_SCHEMA, to_exclusive: UTC_SCHEMA })
  .strict()
  .refine((window) => window.from < window.to_exclusive);
const SOURCE_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "operational_read_revision" &&
    source.source_id === "private.agent_operational_read_revisions" &&
    /^revision:\d+$/.test(source.version),
  "Job-history source fence is invalid"
);
const HISTORY_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "job_history_read_revision" &&
    source.source_id === "private.agent_job_history_revisions" &&
    /^revision:\d+$/.test(source.version),
  "Job-history history fence is invalid"
);
const GapCodesSchema = z
  .array(z.enum(["SOURCE_QUERY_BOUND", "SOURCE_DATA_INVALID"]))
  .max(2)
  .refine((values) => new Set(values).size === values.length);
const NextCursorClaimsSchema = z
  .object({
    source_revision: z.number().int().safe().nonnegative(),
    history_revision: z.number().int().safe().nonnegative(),
    read_as_of: UTC_SCHEMA,
    rank_micros: z.number().int().safe().min(0).max(1_000_000),
    occurred_at: UTC_SCHEMA,
    source_type: SOURCE_TYPE_SCHEMA,
    source_id: z.string().min(1).max(512),
  })
  .strict();
const CollectionRawSchema = z
  .object({
    scope: SCOPE_SCHEMA,
    effective_window: WINDOW_SCHEMA,
    returned_event_count: z.number().int().min(0).max(20),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    gaps: GapCodesSchema,
  })
  .strict();
const PromptReductionSchema = z
  .object({
    max_output_characters: z.literal(60_000),
    atomic_claim_kind: z.literal("job_history_event"),
    retention: z.literal("maximal_ordered_prefix"),
    claim_path: z.literal("event_claims"),
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
const EventClaimSchema = z
  .object({
    raw: JobHistoryMatchSchema,
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
    history_fence: HISTORY_FENCE_SCHEMA,
    event_claims: z.array(EventClaimSchema).max(20),
    returned_event_count: z.number().int().min(0).max(20),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    gaps: GapCodesSchema,
    collection_claim: CollectionClaimSchema,
    prompt_reduction: PromptReductionSchema,
  })
  .strict();

type RawJobHistorySnapshot = z.infer<typeof RawSnapshotSchema>;
type SourceVersion = z.infer<typeof SourceVersionSchema>;
type EventClaim = z.infer<typeof EventClaimSchema>;

export interface JobHistorySnapshot extends Omit<
  RawJobHistorySnapshot,
  "has_more" | "next_cursor_claims"
> {
  readonly page: Readonly<{
    readonly next_cursor: string | null;
    readonly has_more: boolean;
  }>;
  readonly boundary_cursors: readonly string[];
}

export class JobHistoryRepositoryError extends Error {
  readonly code:
    | "JOB_HISTORY_READ_FAILED"
    | "JOB_HISTORY_NOT_FOUND"
    | "JOB_HISTORY_INVALID"
    | "JOB_HISTORY_STALE";
  readonly currentSourceVersion: SourceVersion | null;

  constructor(
    code: JobHistoryRepositoryError["code"],
    options?: ErrorOptions & { readonly currentSourceVersion?: SourceVersion }
  ) {
    super(code, options);
    this.name = "JobHistoryRepositoryError";
    this.code = code;
    this.currentSourceVersion = options?.currentSourceVersion ?? null;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface JobHistoryRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface JobHistoryRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): JobHistoryRpcRequest;
}

declare const TRUSTED_JOB_HISTORY_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface JobHistoryRepository {
  readonly [TRUSTED_JOB_HISTORY_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedJobHistoryRead;
    readonly signal?: AbortSignal;
  }): Promise<JobHistorySnapshot>;
}

function invalid(cause?: unknown): never {
  throw new JobHistoryRepositoryError("JOB_HISTORY_INVALID", { cause });
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

function revision(source: SourceVersion): number {
  const value = Number(source.version.slice(9));
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function canonicalInput(proof: AuthorizedJobHistoryRead) {
  const { cursor: _cursor, ...query } = proof.query;
  return query;
}

function queryHash(
  proof: AuthorizedJobHistoryRead,
  capabilityManifestRevision = proof.capabilityManifestRevision
): string {
  return hashOperationalReadQuery({
    capability_id: proof.capabilityId,
    schema_revision: TASK_13_CAPABILITY_SCHEMA_REVISION,
    capability_manifest_revision: capabilityManifestRevision,
    query: canonicalInput(proof),
  });
}

function expectedTrust(
  sourceType: z.infer<typeof SOURCE_TYPE_SCHEMA>
): "authoritative_ops" | "delivered_correspondence" | "model_transcribed" {
  if (sourceType === "delivered_correspondence") {
    return "delivered_correspondence";
  }
  if (sourceType === "current_memory_summary") return "model_transcribed";
  return "authoritative_ops";
}

function assertEvidence(input: {
  readonly evidence: z.infer<typeof EvidenceRefSchema>;
  readonly source: SourceVersion;
  readonly evidenceId: string;
  readonly readAt: string;
  readonly trust:
    | "authoritative_ops"
    | "delivered_correspondence"
    | "model_transcribed";
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
  readonly claim: EventClaim | z.infer<typeof CollectionClaimSchema>;
  readonly proof: AuthorizedJobHistoryRead;
  readonly snapshot: RawJobHistorySnapshot;
  readonly sourceType:
    | "job_history_event_projection"
    | "job_history_collection_projection";
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly versionPrefix:
    | "job-history-event-projection:v1"
    | "job-history-collection-projection:v1";
  readonly payloadKey: "event" | "collection";
  readonly expectedRaw: CanonicalProjection;
  readonly retainedProofSources: readonly SourceVersion[];
  readonly trust:
    | "authoritative_ops"
    | "delivered_correspondence"
    | "model_transcribed";
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
    source_revision: revision(input.snapshot.source_fence),
    history_revision: revision(input.snapshot.history_fence),
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
    if (error instanceof JobHistoryRepositoryError) throw error;
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

function compareEvents(previous: EventClaim, current: EventClaim): boolean {
  if (
    previous.raw.relevance.score_millionths !==
    current.raw.relevance.score_millionths
  ) {
    return (
      previous.raw.relevance.score_millionths >
      current.raw.relevance.score_millionths
    );
  }
  if (previous.raw.occurred_at !== current.raw.occurred_at) {
    return previous.raw.occurred_at > current.raw.occurred_at;
  }
  if (previous.raw.source_type !== current.raw.source_type) {
    return previous.raw.source_type < current.raw.source_type;
  }
  return previous.raw.match_ref > current.raw.match_ref;
}

function assertAfterCursor(
  first: EventClaim,
  cursor: JobHistoryCursorClaims
): void {
  const raw = first.raw;
  if (
    raw.relevance.score_millionths > cursor.rank_micros ||
    (raw.relevance.score_millionths === cursor.rank_micros &&
      (raw.occurred_at > cursor.occurred_at ||
        (raw.occurred_at === cursor.occurred_at &&
          (raw.source_type < cursor.source_type ||
            (raw.source_type === cursor.source_type &&
              raw.match_ref >= cursor.source_id)))))
  ) {
    invalid();
  }
}

function expectedEffectiveWindow(
  snapshot: RawJobHistorySnapshot,
  proof: AuthorizedJobHistoryRead
) {
  if (proof.query.window !== undefined) return proof.query.window;
  return {
    from: new Date(
      Date.parse(snapshot.read_at) - HISTORY_DEFAULT_WINDOW_MILLISECONDS
    ).toISOString(),
    to_exclusive: snapshot.read_at,
  } as const;
}

function eventMatchesQuery(input: {
  readonly claim: EventClaim;
  readonly proof: AuthorizedJobHistoryRead;
  readonly snapshot: RawJobHistorySnapshot;
}): boolean {
  const raw = input.claim.raw;
  const query = input.proof.query;
  const window = input.snapshot.collection_claim.raw.effective_window;
  const occurredAt = Date.parse(raw.occurred_at);
  const hasPrimaryRelevanceReason = raw.relevance.reason_codes.some((reason) =>
    ["QUERY_TOKEN_MATCH", "QUERY_PHRASE_MATCH", "JOB_IDENTITY_MATCH"].includes(
      reason
    )
  );
  if (
    !query.source_types.includes(raw.source_type) ||
    !hasPrimaryRelevanceReason ||
    occurredAt < Date.parse(window.from) ||
    occurredAt >= Date.parse(window.to_exclusive) ||
    occurredAt > Date.parse(input.snapshot.read_at)
  ) {
    return false;
  }
  if (query.scope.kind === "customer") {
    return query.scope.job_kinds.includes(raw.job_ref.kind);
  }
  return query.scope.job_refs.some(
    (reference) =>
      reference.kind === raw.job_ref.kind && reference.id === raw.job_ref.id
  );
}

function assertSnapshot(
  snapshot: RawJobHistorySnapshot,
  proof: AuthorizedJobHistoryRead,
  decoded: JobHistoryCursorClaims | null
): void {
  const sourceRevision = revision(snapshot.source_fence);
  const historyRevision = revision(snapshot.history_fence);
  const expectedCollectionRaw = {
    scope: snapshot.collection_claim.raw.scope,
    effective_window: snapshot.collection_claim.raw.effective_window,
    returned_event_count: snapshot.returned_event_count,
    has_more: snapshot.has_more,
    next_cursor_claims: snapshot.next_cursor_claims,
    gaps: snapshot.gaps,
  } as const;
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    canonicalOperationalProjection(snapshot.collection_claim.raw.scope) !==
      canonicalOperationalProjection(proof.query.scope) ||
    canonicalOperationalProjection(
      snapshot.collection_claim.raw.effective_window
    ) !==
      canonicalOperationalProjection(
        expectedEffectiveWindow(snapshot, proof)
      ) ||
    snapshot.returned_event_count !== snapshot.event_claims.length ||
    snapshot.event_claims.length > proof.query.limit ||
    snapshot.has_more !== (snapshot.next_cursor_claims !== null) ||
    (snapshot.next_cursor_claims !== null &&
      (snapshot.next_cursor_claims.source_revision !== sourceRevision ||
        snapshot.next_cursor_claims.history_revision !== historyRevision ||
        snapshot.next_cursor_claims.read_as_of !== snapshot.read_at)) ||
    (decoded !== null &&
      (decoded.source_revision !== sourceRevision ||
        decoded.history_revision !== historyRevision ||
        decoded.read_as_of !== snapshot.read_at))
  ) {
    invalid();
  }

  const sources = new Set<string>();
  const evidenceIds = new Set<string>();
  const matchRefs = new Set<string>();
  const retainedSources: SourceVersion[] = [];
  for (const [index, claim] of snapshot.event_claims.entries()) {
    const selectors = claim.raw.correspondence_evidence_ids;
    const selectorCountIsInvalid =
      claim.raw.source_type === "delivered_correspondence"
        ? selectors.length !== 1
        : claim.raw.source_type === "current_memory_summary"
          ? selectors.length > 8
          : selectors.length !== 0;
    if (
      !eventMatchesQuery({ claim, proof, snapshot }) ||
      claim.raw.evidence_ids.length !== 1 ||
      claim.raw.evidence_ids[0] !== claim.proof.evidence_id ||
      selectors.includes(claim.proof.evidence_id) ||
      selectorCountIsInvalid ||
      selectors.some(
        (selector, selectorIndex) =>
          selectorIndex > 0 && selectors[selectorIndex - 1]! >= selector
      ) ||
      matchRefs.has(claim.raw.match_ref) ||
      sources.has(sourceIdentity(claim.source_version)) ||
      evidenceIds.has(claim.proof.evidence_id)
    ) {
      invalid();
    }
    assertAtomicClaim({
      claim,
      proof,
      snapshot,
      sourceType: "job_history_event_projection",
      sourceId: claim.raw.match_ref,
      evidenceId: `evidence:job_history_event_projection:${claim.raw.match_ref}`,
      versionPrefix: "job-history-event-projection:v1",
      payloadKey: "event",
      expectedRaw: claim.raw as CanonicalProjection,
      retainedProofSources: [],
      trust: expectedTrust(claim.raw.source_type),
    });
    const previous = snapshot.event_claims[index - 1];
    if (previous && !compareEvents(previous, claim)) invalid();
    matchRefs.add(claim.raw.match_ref);
    sources.add(sourceIdentity(claim.source_version));
    evidenceIds.add(claim.proof.evidence_id);
    retainedSources.push(claim.source_version);
  }

  const first = snapshot.event_claims[0];
  if (decoded && first) assertAfterCursor(first, decoded);
  const last = snapshot.event_claims.at(-1);
  if (
    snapshot.next_cursor_claims !== null &&
    (!last ||
      snapshot.next_cursor_claims.rank_micros !==
        last.raw.relevance.score_millionths ||
      snapshot.next_cursor_claims.occurred_at !== last.raw.occurred_at ||
      snapshot.next_cursor_claims.source_type !== last.raw.source_type ||
      snapshot.next_cursor_claims.source_id !== last.raw.match_ref)
  ) {
    invalid();
  }

  assertAtomicClaim({
    claim: snapshot.collection_claim,
    proof,
    snapshot,
    sourceType: "job_history_collection_projection",
    sourceId: `${proof.query.scope.kind}:${proof.actorContext.companyId}`,
    evidenceId: `evidence:job_history_collection_projection:${proof.query.scope.kind}:${proof.actorContext.companyId}`,
    versionPrefix: "job-history-collection-projection:v1",
    payloadKey: "collection",
    expectedRaw: expectedCollectionRaw,
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

function permissionSource(proof: AuthorizedJobHistoryRead): SourceVersion {
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
      value.message !== "agent_job_history_cursor_stale"
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
      // The shipped RPC (ledger 20260814120000) raises the scope-prefixed
      // form; this mapper was written against the unprefixed name and so
      // downgraded every privacy-safe not-found to TEMPORARILY_UNAVAILABLE.
      value.message === "agent_job_history_scope_not_found_or_not_visible"
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

export function createSupabaseJobHistoryRepository(
  client: JobHistoryRpcClient,
  cursorCodec: OperationalReadCursorCodec
): JobHistoryRepository {
  let suppliedRpc: JobHistoryRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as JobHistoryRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A job-history RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A job-history RPC client is required");
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
      readonly authorization: AuthorizedJobHistoryRead;
      readonly signal?: AbortSignal;
    }): Promise<JobHistorySnapshot> {
      let proof: AuthorizedJobHistoryRead;
      let signal: AbortSignal | undefined;
      try {
        proof = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedJobHistoryRead(proof)) invalid();
      if (signal?.aborted) {
        throw new JobHistoryRepositoryError("JOB_HISTORY_READ_FAILED");
      }

      const hash = queryHash(proof);
      const frozenV7QueryHash = queryHash(
        proof,
        FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION
      );
      let decoded: JobHistoryCursorClaims | null = null;
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
          if (claims.capability_id !== "search_job_history") invalid();
          decoded = claims;
        } catch (error) {
          if (error instanceof OperationalReadCursorPermissionStaleError) {
            throw new JobHistoryRepositoryError("JOB_HISTORY_STALE", {
              cause: error,
              currentSourceVersion: permissionSource(proof),
            });
          }
          if (
            error instanceof OperationalReadCursorError ||
            error instanceof JobHistoryRepositoryError
          ) {
            throw new JobHistoryRepositoryError("JOB_HISTORY_INVALID", {
              cause: error,
            });
          }
          throw error;
        }
      }

      const query = proof.query;
      const selectedTaskEvents = query.source_types.includes("task_event");
      const selectedEstimateDocuments =
        query.source_types.includes("estimate_document");
      const scope = query.scope;
      const customerScope = scope.kind === "customer" ? scope : null;
      const includesProject =
        scope.kind === "customer"
          ? scope.job_kinds.includes("project")
          : scope.job_refs.some(({ kind }) => kind === "project");
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
          p_pipeline_scope: proof.pipelineScope,
          p_projects_scope: proof.projectsScope,
          p_calendar_scope: selectedTaskEvents ? proof.calendarScope : null,
          p_tasks_scope: selectedTaskEvents ? proof.tasksScope : null,
          p_estimates_scope: selectedEstimateDocuments
            ? proof.estimatesScope
            : null,
          p_projects_financials_scope:
            selectedEstimateDocuments &&
            includesProject &&
            proof.projectsFinancialsScope
              ? proof.projectsFinancialsScope
              : null,
          p_query: query.query,
          p_scope_kind: scope.kind,
          p_customer_kind: customerScope?.customer_ref.kind ?? null,
          p_customer_id: customerScope?.customer_ref.id ?? null,
          p_scope_job_kinds: customerScope
            ? [...customerScope.job_kinds]
            : null,
          p_job_refs:
            scope.kind === "jobs"
              ? scope.job_refs.map(({ kind, id }) => ({ kind, id }))
              : null,
          p_from: query.window?.from ?? null,
          p_to_exclusive: query.window?.to_exclusive ?? null,
          p_source_types: [...query.source_types],
          p_read_as_of: decoded?.read_as_of ?? null,
          p_cursor_source_revision: decoded?.source_revision ?? null,
          p_cursor_history_revision: decoded?.history_revision ?? null,
          p_cursor_rank_micros: decoded?.rank_micros ?? null,
          p_cursor_occurred_at: decoded?.occurred_at ?? null,
          p_cursor_source_type: decoded?.source_type ?? null,
          p_cursor_source_id: decoded?.source_id ?? null,
          p_limit: query.limit,
        });
        const abortSignal = request?.abortSignal;
        response =
          signal && typeof abortSignal === "function"
            ? await Reflect.apply(abortSignal, request, [signal])
            : await request;
      } catch (error) {
        if (error instanceof JobHistoryRepositoryError) throw error;
        throw new JobHistoryRepositoryError("JOB_HISTORY_READ_FAILED", {
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new JobHistoryRepositoryError("JOB_HISTORY_READ_FAILED");
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new JobHistoryRepositoryError("JOB_HISTORY_READ_FAILED", {
          cause: error,
        });
      }
      if (responseError) {
        const currentSourceVersion = staleSource(responseError);
        if (currentSourceVersion) {
          throw new JobHistoryRepositoryError("JOB_HISTORY_STALE", {
            cause: responseError,
            currentSourceVersion,
          });
        }
        throw new JobHistoryRepositoryError(
          isNotFound(responseError)
            ? "JOB_HISTORY_NOT_FOUND"
            : "JOB_HISTORY_READ_FAILED",
          { cause: responseError }
        );
      }

      let parsedData: RawJobHistorySnapshot;
      try {
        const parsed = RawSnapshotSchema.safeParse(responseData);
        if (!parsed.success) invalid(parsed.error);
        parsedData = parsed.data;
      } catch (error) {
        if (error instanceof JobHistoryRepositoryError) throw error;
        invalid(error);
      }
      assertSnapshot(parsedData, proof, decoded);
      const sourceRevision = revision(parsedData.source_fence);
      const historyRevision = revision(parsedData.history_fence);
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
        source_revision: sourceRevision,
        history_revision: historyRevision,
        read_as_of: parsedData.read_at,
      } as const;
      const boundaryCursors = parsedData.event_claims.map((claim) =>
        cursorCodec.encode({
          ...commonClaims,
          rank_micros: claim.raw.relevance.score_millionths,
          occurred_at: claim.raw.occurred_at,
          source_type: claim.raw.source_type,
          source_id: claim.raw.match_ref,
        })
      );
      const nextClaims = parsedData.next_cursor_claims;
      const nextCursor = nextClaims
        ? cursorCodec.encode({
            ...commonClaims,
            source_revision: nextClaims.source_revision,
            history_revision: nextClaims.history_revision,
            read_as_of: nextClaims.read_as_of,
            rank_micros: nextClaims.rank_micros,
            occurred_at: nextClaims.occurred_at,
            source_type: nextClaims.source_type,
            source_id: nextClaims.source_id,
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
  return Object.freeze(repository) as JobHistoryRepository;
}

export function isTrustedJobHistoryRepository(
  value: unknown
): value is JobHistoryRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
