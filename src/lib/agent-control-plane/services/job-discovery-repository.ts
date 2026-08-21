import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  CurrentJobRefSchema,
  EvidenceRefSchema,
  NormalizedJobLifecycleStateSchema,
  OpportunityStageSchema,
  ProjectStatusSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  DiscoveryMillisecondUtcTimestampSchema,
  JOB_DISCOVERY_RANKING_REVISION,
  JobDiscoveryMatchSchema,
} from "@/lib/agent-control-plane/contracts/discovery";
import {
  isAuthorizedJobDiscoveryRead,
  type AuthorizedJobDiscoveryRead,
} from "./job-discovery-authorization";
import {
  hashOperationalReadQuery,
  isTrustedOperationalReadCursorCodec,
  type JobDiscoveryCursorClaims,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
  type OperationalReadCursorCodec,
} from "./operational-read-cursor";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
  type CanonicalProjection,
} from "./operational-read-projection";
import {
  compareJobDiscoveryOrder,
  expectedJobTextMatchBasis,
  returnedBusinessStringIsSafe,
} from "./discovery-match-rules";

const RPC_NAME = "read_agent_job_discovery_as_system" as const;
const UUID_SCHEMA = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const UTC_SCHEMA = DiscoveryMillisecondUtcTimestampSchema;
const SOURCE_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "operational_read_revision" &&
    source.source_id === "private.agent_operational_read_revisions" &&
    /^revision:(?:0|[1-9][0-9]*)$/.test(source.version),
  "Job-discovery source fence is invalid"
);
const DiscoveryGapsSchema = z
  .array(z.enum(["SOURCE_QUERY_BOUND", "SOURCE_DATA_INVALID"]))
  .max(1)
  .refine((values) => new Set(values).size === values.length);
const PageRowSchema = z
  .object({
    rank_ordinal: z.number().int().safe().min(1).max(500),
    source_kind: z.enum(["opportunity", "project"]),
    source_id: UUID_SCHEMA,
  })
  .strict();
const NextCursorClaimsSchema = z
  .object({
    source_revision: z.number().int().safe().nonnegative(),
    read_as_of: UTC_SCHEMA,
    rank_ordinal: z.number().int().safe().min(1).max(500),
    source_kind: z.enum(["opportunity", "project"]),
    source_id: UUID_SCHEMA,
  })
  .strict();
const CursorAnchorOrderWitnessSchema = z
  .object({
    rank_ordinal: z.number().int().safe().min(1).max(500),
    raw: JobDiscoveryMatchSchema,
  })
  .strict();
const CollectionRawSchema = z
  .object({
    authorized_candidate_count: z.number().int().safe().min(0).max(501),
    raw_page_count: z.number().int().safe().min(0).max(26),
    page_rows: z.array(PageRowSchema).max(26),
    returned_match_count: z.number().int().safe().min(0).max(25),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    cursor_anchor_order_witness: CursorAnchorOrderWitnessSchema.nullable(),
    gaps: DiscoveryGapsSchema,
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
const CivilDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SelectionMatchBasisSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
      kind: z.literal("filter_only"),
      field: z.literal("none"),
    })
    .strict(),
  z
    .object({
      ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
      kind: z.enum(["exact_title", "prefix_title", "all_tokens_title"]),
      field: z.literal("title"),
    })
    .strict(),
  z
    .object({
      ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
      kind: z.enum(["exact_address", "prefix_address", "all_tokens_address"]),
      field: z.literal("address"),
    })
    .strict(),
]);
const SelectionAnchorSharedShape = {
  display_title: z.string().trim().min(1).max(1_000),
  address: z.string().trim().min(1).max(2_000).nullable(),
  lifecycle_state: NormalizedJobLifecycleStateSchema,
  match_basis: SelectionMatchBasisSchema,
};
const OpportunitySelectionAnchorSchema = z
  .object({
    job_ref: CurrentJobRefSchema.options[0],
    ...SelectionAnchorSharedShape,
    status: z
      .object({
        kind: z.literal("opportunity"),
        value: OpportunityStageSchema,
      })
      .strict(),
    dates: z
      .object({
        kind: z.literal("opportunity"),
        created_at: DiscoveryMillisecondUtcTimestampSchema,
        updated_at: DiscoveryMillisecondUtcTimestampSchema,
      })
      .strict(),
    archived: z.boolean(),
  })
  .strict();
const ProjectSelectionAnchorSchema = z
  .object({
    job_ref: CurrentJobRefSchema.options[1],
    ...SelectionAnchorSharedShape,
    status: z
      .object({ kind: z.literal("project"), value: ProjectStatusSchema })
      .strict(),
    dates: z
      .object({
        kind: z.literal("project"),
        created_at: DiscoveryMillisecondUtcTimestampSchema,
        updated_at: DiscoveryMillisecondUtcTimestampSchema,
        start_date: CivilDateSchema.nullable(),
        end_date: CivilDateSchema.nullable(),
      })
      .strict(),
  })
  .strict();
const SelectionAnchorSchema = z.union([
  OpportunitySelectionAnchorSchema,
  ProjectSelectionAnchorSchema,
]);
const SelectionWitnessSchema = z
  .object({ anchors: z.array(SelectionAnchorSchema).min(1).max(2) })
  .strict();
const JobDiscoveryClaimSchema = z
  .object({
    rank_ordinal: z.number().int().safe().min(1).max(500),
    raw: JobDiscoveryMatchSchema,
    selection_witness: SelectionWitnessSchema,
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
    ranking_revision: z.literal(JOB_DISCOVERY_RANKING_REVISION),
    authorized_candidate_count: z.number().int().safe().min(0).max(501),
    raw_page_count: z.number().int().safe().min(0).max(26),
    page_rows: z.array(PageRowSchema).max(26),
    match_claims: z.array(JobDiscoveryClaimSchema).max(25),
    returned_match_count: z.number().int().safe().min(0).max(25),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    gaps: DiscoveryGapsSchema,
    collection_claim: CollectionClaimSchema,
  })
  .strict();

type RawJobDiscoverySnapshot = z.infer<typeof RawSnapshotSchema>;
type JobDiscoveryClaim = z.infer<typeof JobDiscoveryClaimSchema>;
type SelectionAnchor = z.infer<typeof SelectionAnchorSchema>;
type SourceVersion = z.infer<typeof SourceVersionSchema>;

export interface JobDiscoverySnapshot extends Omit<
  RawJobDiscoverySnapshot,
  "has_more" | "next_cursor_claims"
> {
  readonly page: Readonly<{
    readonly next_cursor: string | null;
    readonly has_more: boolean;
  }>;
  readonly boundary_cursors: readonly string[];
}

export class JobDiscoveryRepositoryError extends Error {
  readonly code:
    | "JOB_DISCOVERY_READ_FAILED"
    | "JOB_DISCOVERY_NOT_FOUND"
    | "JOB_DISCOVERY_INVALID"
    | "JOB_DISCOVERY_STALE";
  readonly currentSourceVersion: SourceVersion | null;

  constructor(
    code: JobDiscoveryRepositoryError["code"],
    options?: ErrorOptions & { readonly currentSourceVersion?: SourceVersion }
  ) {
    super(code, options);
    this.name = "JobDiscoveryRepositoryError";
    this.code = code;
    this.currentSourceVersion = options?.currentSourceVersion ?? null;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface JobDiscoveryRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface JobDiscoveryRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): JobDiscoveryRpcRequest;
}

declare const TRUSTED_JOB_DISCOVERY_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface JobDiscoveryRepository {
  readonly [TRUSTED_JOB_DISCOVERY_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedJobDiscoveryRead;
    readonly signal?: AbortSignal;
  }): Promise<JobDiscoverySnapshot>;
}

function invalid(cause?: unknown): never {
  throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_INVALID", { cause });
}

function canonicalInput(proof: AuthorizedJobDiscoveryRead) {
  const { cursor: _cursor, ...query } = proof.query;
  return query;
}

function queryHash(proof: AuthorizedJobDiscoveryRead): string {
  return hashOperationalReadQuery({
    capability_id: proof.capabilityId,
    schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    capability_manifest_revision: proof.capabilityManifestRevision,
    query: canonicalInput(proof),
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

function sourceIdentity(source: SourceVersion): string {
  return [
    source.source_domain,
    source.source_type,
    source.source_id,
    source.version,
  ].join("\u0000");
}

function referenceIdentity(reference: {
  readonly kind: "opportunity" | "project";
  readonly id: string;
}): string {
  return `${reference.kind}:${reference.id}`;
}

function sourceRevision(snapshot: RawJobDiscoverySnapshot): number {
  const revision = Number(snapshot.source_fence.version.slice(9));
  if (!Number.isSafeInteger(revision) || revision < 0) invalid();
  return revision;
}

function assertEvidence(input: {
  readonly evidence: z.infer<typeof EvidenceRefSchema>;
  readonly source: SourceVersion;
  readonly evidenceId: string;
  readonly readAt: string;
}): void {
  if (
    input.evidence.evidence_id !== input.evidenceId ||
    input.evidence.locator !==
      `ops://evidence/${encodeURIComponent(input.evidenceId)}` ||
    !sameSource(input.evidence, input.source) ||
    input.evidence.occurred_at !== input.readAt ||
    input.evidence.relationship !== "supports" ||
    input.evidence.trust !== "authoritative_ops" ||
    input.evidence.excerpt !== undefined
  ) {
    invalid();
  }
}

function assertAtomicClaim(input: {
  readonly claim: JobDiscoveryClaim | z.infer<typeof CollectionClaimSchema>;
  readonly proof: AuthorizedJobDiscoveryRead;
  readonly snapshot: RawJobDiscoverySnapshot;
  readonly sourceType:
    | "job_discovery_projection"
    | "job_discovery_collection_projection";
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly payloadKey: "match" | "collection";
  readonly expectedRaw: CanonicalProjection;
  readonly retainedProofSources: readonly SourceVersion[];
  readonly rankOrdinal?: number;
  readonly selectionWitness?: CanonicalProjection;
}): void {
  const expectedProjection = {
    actor_user_id: input.proof.actorContext.actorUserId,
    company_id: input.proof.actorContext.companyId,
    capability_id: input.proof.capabilityId,
    capability_revision: input.proof.capabilityRevision,
    capability_manifest_revision: input.proof.capabilityManifestRevision,
    schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    permission_snapshot_revision:
      input.proof.actorContext.permissionSnapshotRevision,
    canonical_input: canonicalInput(input.proof),
    read_at: input.snapshot.read_at,
    source_revision: sourceRevision(input.snapshot),
    ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
    retained_proof_sources: input.retainedProofSources,
    ...(input.rankOrdinal === undefined
      ? {}
      : { rank_ordinal: input.rankOrdinal }),
    ...(input.selectionWitness === undefined
      ? {}
      : { selection_witness: input.selectionWitness }),
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
        `${input.sourceType}:v1:${claim.proof.source_content_hash}` ||
      !sameSource(claim.source_version, claim.proof.source_version) ||
      claim.evidence.length !== 1
    ) {
      invalid();
    }
  } catch (error) {
    if (error instanceof JobDiscoveryRepositoryError) throw error;
    invalid(error);
  }
  assertEvidence({
    evidence: claim.evidence[0]!,
    source: claim.source_version,
    evidenceId: claim.proof.evidence_id,
    readAt: input.snapshot.read_at,
  });
}

function rowForClaim(claim: JobDiscoveryClaim) {
  return {
    rank_ordinal: claim.rank_ordinal,
    source_kind: claim.raw.job_ref.kind,
    source_id: claim.raw.job_ref.id,
  } as const;
}

function samePageRow(
  left: z.infer<typeof PageRowSchema>,
  right: z.infer<typeof PageRowSchema>
): boolean {
  return (
    left.rank_ordinal === right.rank_ordinal &&
    left.source_kind === right.source_kind &&
    left.source_id === right.source_id
  );
}

function selectedDate(
  raw: JobDiscoveryClaim["raw"],
  proof: AuthorizedJobDiscoveryRead
): string {
  return proof.query.date_window?.field === "created_at"
    ? raw.dates.created_at
    : raw.dates.updated_at;
}

function derivedLifecycle(anchor: SelectionAnchor) {
  if ("archived" in anchor) {
    if (anchor.archived || anchor.status.value === "discarded") {
      return "archived" as const;
    }
    return ["won", "lost"].includes(anchor.status.value)
      ? ("terminal" as const)
      : ("active" as const);
  }
  if (anchor.status.value === "archived") return "archived" as const;
  return ["completed", "closed"].includes(anchor.status.value)
    ? ("terminal" as const)
    : ("active" as const);
}

function selectionAnchorFitsQuery(
  anchor: SelectionAnchor,
  proof: AuthorizedJobDiscoveryRead,
  readAt: string
): boolean {
  const query = proof.query;
  const createdAt = Date.parse(anchor.dates.created_at);
  const updatedAt = Date.parse(anchor.dates.updated_at);
  const snapshotReadAt = Date.parse(readAt);
  if (
    !query.job_kinds.includes(anchor.job_ref.kind) ||
    anchor.job_ref.kind !== anchor.status.kind ||
    anchor.job_ref.kind !== anchor.dates.kind ||
    !returnedBusinessStringIsSafe(anchor.display_title, 1_000) ||
    (anchor.address !== null &&
      !returnedBusinessStringIsSafe(anchor.address, 2_000)) ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(snapshotReadAt) ||
    createdAt > updatedAt ||
    updatedAt > snapshotReadAt ||
    derivedLifecycle(anchor) !== anchor.lifecycle_state ||
    (query.lifecycle_states !== undefined &&
      !query.lifecycle_states.includes(anchor.lifecycle_state)) ||
    (anchor.status.kind === "opportunity" &&
      query.opportunity_stages !== undefined &&
      !query.opportunity_stages.includes(anchor.status.value)) ||
    (anchor.status.kind === "project" &&
      query.project_statuses !== undefined &&
      !query.project_statuses.includes(anchor.status.value))
  ) {
    return false;
  }
  const expectedMatch =
    query.query === undefined
      ? "filter_only"
      : expectedJobTextMatchBasis({
          displayTitle: anchor.display_title,
          address: anchor.address,
          canonicalQuery: query.query,
          queryFields: query.query_fields ?? ["title", "address"],
        });
  if (expectedMatch !== anchor.match_basis.kind) return false;
  const window = query.date_window;
  if (window) {
    const selected = Date.parse(anchor.dates[window.field]);
    if (
      !Number.isFinite(selected) ||
      selected < Date.parse(window.from) ||
      selected >= Date.parse(window.to_exclusive)
    ) {
      return false;
    }
  }
  return true;
}

function publicAnchorFields(value: SelectionAnchor | JobDiscoveryClaim["raw"]) {
  return {
    job_ref: value.job_ref,
    display_title: value.display_title,
    address: value.address,
    lifecycle_state: value.lifecycle_state,
    status: value.status,
    dates: value.dates,
    match_basis: value.match_basis,
  };
}

function assertSelectionWitness(
  claim: JobDiscoveryClaim,
  proof: AuthorizedJobDiscoveryRead,
  readAt: string
): void {
  const anchors = claim.selection_witness.anchors;
  if (
    anchors.some((anchor) => !selectionAnchorFitsQuery(anchor, proof, readAt))
  ) {
    invalid();
  }
  const raw = claim.raw;
  const conversion = raw.conversion;
  const converted = conversion.state === "converted";
  const expectedCanonicalAnchor = converted ? anchors[1] : anchors[0];
  if (
    expectedCanonicalAnchor === undefined ||
    (conversion.state === "converted"
      ? anchors.length !== 2 ||
        anchors[0]?.job_ref.kind !== "opportunity" ||
        anchors[0].job_ref.id !== conversion.opportunity_ref.id ||
        anchors[1]?.job_ref.kind !== "project" ||
        anchors[1].job_ref.id !== conversion.project_ref.id
      : anchors.length !== 1 ||
        referenceIdentity(anchors[0]!.job_ref) !==
          referenceIdentity(raw.job_ref))
  ) {
    invalid();
  }
  try {
    if (
      canonicalOperationalProjection(
        publicAnchorFields(expectedCanonicalAnchor) as CanonicalProjection
      ) !==
      canonicalOperationalProjection(
        publicAnchorFields(raw) as CanonicalProjection
      )
    ) {
      invalid();
    }
  } catch (error) {
    if (error instanceof JobDiscoveryRepositoryError) throw error;
    invalid(error);
  }
}

function matchFitsQuery(
  raw: JobDiscoveryClaim["raw"],
  proof: AuthorizedJobDiscoveryRead,
  readAt: string
): boolean {
  const query = proof.query;
  if (
    !query.job_kinds.includes(raw.job_ref.kind) ||
    raw.status.kind !== raw.job_ref.kind ||
    raw.dates.kind !== raw.job_ref.kind ||
    Date.parse(raw.dates.created_at) > Date.parse(raw.dates.updated_at) ||
    Date.parse(raw.dates.updated_at) > Date.parse(readAt) ||
    (query.query === undefined && raw.match_basis.kind !== "filter_only") ||
    (query.query !== undefined && raw.match_basis.kind === "filter_only") ||
    (raw.match_basis.field !== "none" &&
      !query.query_fields?.includes(raw.match_basis.field)) ||
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
  if (
    query.query !== undefined &&
    expectedJobTextMatchBasis({
      displayTitle: raw.display_title,
      address: raw.address,
      canonicalQuery: query.query,
      queryFields: query.query_fields ?? ["title", "address"],
    }) !== raw.match_basis.kind
  ) {
    return false;
  }
  const window = query.date_window;
  if (window) {
    const value = Date.parse(selectedDate(raw, proof));
    if (
      value < Date.parse(window.from) ||
      value >= Date.parse(window.to_exclusive)
    ) {
      return false;
    }
  }
  if (raw.conversion.state === "converted") {
    return (
      raw.anchor_refs.length === 2 &&
      raw.anchor_refs[0]!.kind === "opportunity" &&
      raw.anchor_refs[0]!.id === raw.conversion.opportunity_ref.id &&
      raw.anchor_refs[1]!.kind === "project" &&
      raw.anchor_refs[1]!.id === raw.conversion.project_ref.id
    );
  }
  return (
    raw.anchor_refs.length === 1 &&
    referenceIdentity(raw.anchor_refs[0]!) === referenceIdentity(raw.job_ref)
  );
}

function assertCursorAnchorOrderWitness(
  snapshot: RawJobDiscoverySnapshot,
  proof: AuthorizedJobDiscoveryRead,
  decoded: JobDiscoveryCursorClaims | null
): void {
  const witness = snapshot.collection_claim.raw.cursor_anchor_order_witness;
  if ((decoded === null) !== (witness === null)) invalid();
  if (decoded === null || witness === null) return;

  const reference = witness.raw.job_ref;
  const sourceId = `${reference.kind}:${reference.id}:ordinal:${witness.rank_ordinal}`;
  const evidenceId = `evidence:job_discovery_projection:${sourceId}`;
  if (
    witness.rank_ordinal !== decoded.rank_ordinal ||
    reference.kind !== decoded.job_kind ||
    reference.id !== decoded.job_id ||
    witness.raw.evidence_ids.length !== 1 ||
    witness.raw.evidence_ids[0] !== evidenceId ||
    !matchFitsQuery(witness.raw, proof, snapshot.read_at)
  ) {
    invalid();
  }

  const first = snapshot.match_claims[0]?.raw;
  if (first !== undefined) {
    const order = compareJobDiscoveryOrder({
      left: witness.raw,
      right: first,
      dateField: proof.query.date_window?.field ?? "updated_at",
    });
    if (order === null || order >= 0) invalid();
  }
}

function assertPageAndCandidateState(
  snapshot: RawJobDiscoverySnapshot,
  proof: AuthorizedJobDiscoveryRead,
  decoded: JobDiscoveryCursorClaims | null
): void {
  const isQueryBound = snapshot.authorized_candidate_count === 501;
  const hasQueryBoundGap = snapshot.gaps.includes("SOURCE_QUERY_BOUND");
  const hasInvalidGap = snapshot.gaps.includes("SOURCE_DATA_INVALID");
  if (
    snapshot.raw_page_count !== snapshot.page_rows.length ||
    snapshot.returned_match_count !== snapshot.match_claims.length ||
    snapshot.match_claims.length > proof.query.limit ||
    snapshot.page_rows.length > Math.min(26, proof.query.limit + 1) ||
    snapshot.has_more !== (snapshot.next_cursor_claims !== null) ||
    isQueryBound !== hasQueryBoundGap ||
    (isQueryBound &&
      (snapshot.gaps.length !== 1 ||
        snapshot.match_claims.length !== 0 ||
        snapshot.page_rows.length !== 0 ||
        snapshot.has_more)) ||
    (hasInvalidGap &&
      (snapshot.match_claims.length !== 0 ||
        snapshot.page_rows.length !== 0 ||
        snapshot.has_more)) ||
    (!isQueryBound &&
      snapshot.has_more !==
        (snapshot.page_rows.length === proof.query.limit + 1)) ||
    (!isQueryBound &&
      snapshot.page_rows.length !==
        snapshot.match_claims.length + (snapshot.has_more ? 1 : 0)) ||
    (snapshot.has_more && snapshot.match_claims.length !== proof.query.limit)
  ) {
    invalid();
  }
  if (isQueryBound || hasInvalidGap) return;

  const expectedStart = (decoded?.rank_ordinal ?? 0) + 1;
  const identities = new Set<string>();
  for (const [index, row] of snapshot.page_rows.entries()) {
    if (
      row.rank_ordinal !== expectedStart + index ||
      identities.has(`${row.source_kind}:${row.source_id}`)
    ) {
      invalid();
    }
    identities.add(`${row.source_kind}:${row.source_id}`);
    const claim = snapshot.match_claims[index];
    if (claim && !samePageRow(row, rowForClaim(claim))) invalid();
  }
  const lastRow = snapshot.page_rows.at(-1);
  if (
    snapshot.authorized_candidate_count < (lastRow?.rank_ordinal ?? 0) ||
    (snapshot.has_more &&
      snapshot.authorized_candidate_count <=
        snapshot.match_claims.at(-1)!.rank_ordinal) ||
    (!snapshot.has_more &&
      snapshot.authorized_candidate_count !==
        (lastRow?.rank_ordinal ?? decoded?.rank_ordinal ?? 0))
  ) {
    invalid();
  }
}

function assertSnapshot(
  snapshot: RawJobDiscoverySnapshot,
  proof: AuthorizedJobDiscoveryRead,
  decoded: JobDiscoveryCursorClaims | null
): void {
  const revision = sourceRevision(snapshot);
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    snapshot.ranking_revision !== JOB_DISCOVERY_RANKING_REVISION ||
    (decoded !== null &&
      (decoded.source_revision !== revision ||
        decoded.read_as_of !== snapshot.read_at))
  ) {
    invalid();
  }
  assertPageAndCandidateState(snapshot, proof, decoded);
  assertCursorAnchorOrderWitness(snapshot, proof, decoded);

  for (let index = 1; index < snapshot.match_claims.length; index += 1) {
    const order = compareJobDiscoveryOrder({
      left: snapshot.match_claims[index - 1]!.raw,
      right: snapshot.match_claims[index]!.raw,
      dateField: proof.query.date_window?.field ?? "updated_at",
    });
    if (order === null || order >= 0) invalid();
  }

  const sources = new Set<string>();
  const evidenceIds = new Set<string>();
  const canonicalRefs = new Set<string>();
  const allAnchors = new Set<string>();
  const retainedSources: SourceVersion[] = [];
  for (const claim of snapshot.match_claims) {
    const reference = claim.raw.job_ref;
    const canonicalIdentity = referenceIdentity(reference);
    const sourceId = `${canonicalIdentity}:ordinal:${claim.rank_ordinal}`;
    const evidenceId = `evidence:job_discovery_projection:${sourceId}`;
    const anchorIdentities = claim.raw.anchor_refs.map(referenceIdentity);
    if (
      !matchFitsQuery(claim.raw, proof, snapshot.read_at) ||
      claim.raw.evidence_ids.length !== 1 ||
      claim.raw.evidence_ids[0] !== evidenceId ||
      canonicalRefs.has(canonicalIdentity) ||
      anchorIdentities.some((identity) => allAnchors.has(identity)) ||
      sources.has(sourceIdentity(claim.source_version)) ||
      evidenceIds.has(claim.proof.evidence_id)
    ) {
      invalid();
    }
    assertSelectionWitness(claim, proof, snapshot.read_at);
    assertAtomicClaim({
      claim,
      proof,
      snapshot,
      sourceType: "job_discovery_projection",
      sourceId,
      evidenceId,
      payloadKey: "match",
      expectedRaw: claim.raw as CanonicalProjection,
      retainedProofSources: [],
      rankOrdinal: claim.rank_ordinal,
      selectionWitness:
        claim.selection_witness as unknown as CanonicalProjection,
    });
    canonicalRefs.add(canonicalIdentity);
    for (const anchor of anchorIdentities) allAnchors.add(anchor);
    sources.add(sourceIdentity(claim.source_version));
    evidenceIds.add(evidenceId);
    retainedSources.push(claim.source_version);
  }

  const next = snapshot.next_cursor_claims;
  const last = snapshot.match_claims.at(-1);
  if (
    (next !== null &&
      (!last ||
        next.source_revision !== revision ||
        next.read_as_of !== snapshot.read_at ||
        next.rank_ordinal !== last.rank_ordinal ||
        next.source_kind !== last.raw.job_ref.kind ||
        next.source_id !== last.raw.job_ref.id)) ||
    (next === null && snapshot.has_more)
  ) {
    invalid();
  }

  const collectionRaw = {
    authorized_candidate_count: snapshot.authorized_candidate_count,
    raw_page_count: snapshot.raw_page_count,
    page_rows: snapshot.page_rows,
    returned_match_count: snapshot.returned_match_count,
    has_more: snapshot.has_more,
    next_cursor_claims: snapshot.next_cursor_claims,
    cursor_anchor_order_witness:
      snapshot.collection_claim.raw.cursor_anchor_order_witness,
    gaps: snapshot.gaps,
  } as const;
  assertAtomicClaim({
    claim: snapshot.collection_claim,
    proof,
    snapshot,
    sourceType: "job_discovery_collection_projection",
    sourceId: `company:${proof.actorContext.companyId}`,
    evidenceId: `evidence:job_discovery_collection_projection:company:${proof.actorContext.companyId}`,
    payloadKey: "collection",
    expectedRaw: collectionRaw as CanonicalProjection,
    retainedProofSources: retainedSources,
  });
  if (
    sources.has(sourceIdentity(snapshot.collection_claim.source_version)) ||
    evidenceIds.has(snapshot.collection_claim.proof.evidence_id)
  ) {
    invalid();
  }
}

function permissionSource(proof: AuthorizedJobDiscoveryRead): SourceVersion {
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
      value.message !== "agent_job_discovery_cursor_stale"
    ) {
      return null;
    }
    let details = value.details;
    if (typeof details === "string") {
      if (details.length > 4_096) return null;
      details = JSON.parse(details);
    }
    const parsed = SOURCE_FENCE_SCHEMA.safeParse(details);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isNotFoundOrForbidden(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const value = error as Readonly<Record<string, unknown>>;
    return (
      (value.code === "P0002" &&
        value.message === "agent_job_discovery_not_found_or_not_visible") ||
      (value.code === "42501" &&
        value.message === "agent_job_discovery_forbidden")
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

export function createSupabaseJobDiscoveryRepository(
  client: JobDiscoveryRpcClient,
  cursorCodec: OperationalReadCursorCodec
): JobDiscoveryRepository {
  let suppliedRpc: JobDiscoveryRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as JobDiscoveryRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A job-discovery RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A job-discovery RPC client is required");
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
      readonly authorization: AuthorizedJobDiscoveryRead;
      readonly signal?: AbortSignal;
    }): Promise<JobDiscoverySnapshot> {
      let proof: AuthorizedJobDiscoveryRead;
      let signal: AbortSignal | undefined;
      try {
        proof = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedJobDiscoveryRead(proof)) invalid();
      if (signal?.aborted) {
        throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_READ_FAILED");
      }

      const hash = queryHash(proof);
      let decoded: JobDiscoveryCursorClaims | null = null;
      if (proof.query.cursor) {
        try {
          const claims = cursorCodec.decode({
            cursor: proof.query.cursor,
            expected: {
              capabilityId: proof.capabilityId,
              schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
              capabilityManifestRevision: proof.capabilityManifestRevision,
              rankingRevision: JOB_DISCOVERY_RANKING_REVISION,
              ruleRevisions: [],
              actorUserId: proof.actorContext.actorUserId,
              companyId: proof.actorContext.companyId,
              permissionSnapshotRevision:
                proof.actorContext.permissionSnapshotRevision,
              queryHash: hash,
            },
          });
          if (claims.capability_id !== "search_jobs") invalid();
          decoded = claims;
        } catch (error) {
          if (error instanceof OperationalReadCursorPermissionStaleError) {
            throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_STALE", {
              cause: error,
              currentSourceVersion: permissionSource(proof),
            });
          }
          if (
            error instanceof OperationalReadCursorError ||
            error instanceof JobDiscoveryRepositoryError
          ) {
            throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_INVALID", {
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
          p_capability_schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
          p_ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
          p_required_oauth_scopes: [...proof.requiredOAuthScopes],
          p_pipeline_scope: proof.pipelineScope,
          p_projects_scope: proof.projectsScope,
          p_query: proof.query.query ?? null,
          p_query_fields: proof.query.query_fields
            ? [...proof.query.query_fields]
            : null,
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
          p_cursor_rank_ordinal: decoded?.rank_ordinal ?? null,
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
        if (error instanceof JobDiscoveryRepositoryError) throw error;
        throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_READ_FAILED", {
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_READ_FAILED");
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_READ_FAILED", {
          cause: error,
        });
      }
      if (responseError) {
        const currentSourceVersion = staleSource(responseError);
        if (currentSourceVersion) {
          throw new JobDiscoveryRepositoryError("JOB_DISCOVERY_STALE", {
            currentSourceVersion,
          });
        }
        throw new JobDiscoveryRepositoryError(
          isNotFoundOrForbidden(responseError)
            ? "JOB_DISCOVERY_NOT_FOUND"
            : "JOB_DISCOVERY_READ_FAILED"
        );
      }

      let parsedData: RawJobDiscoverySnapshot;
      try {
        const parsed = RawSnapshotSchema.safeParse(responseData);
        if (!parsed.success) invalid(parsed.error);
        parsedData = parsed.data;
      } catch (error) {
        if (error instanceof JobDiscoveryRepositoryError) throw error;
        invalid(error);
      }
      assertSnapshot(parsedData, proof, decoded);
      const commonClaims = {
        capability_id: proof.capabilityId,
        schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
        capability_manifest_revision: proof.capabilityManifestRevision,
        ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
        rule_revisions: [],
        actor_user_id: proof.actorContext.actorUserId,
        company_id: proof.actorContext.companyId,
        permission_snapshot_revision:
          proof.actorContext.permissionSnapshotRevision,
        query_hash: hash,
        source_revision: sourceRevision(parsedData),
        read_as_of: parsedData.read_at,
      } as const;
      const boundaryCursors = parsedData.match_claims.map((claim) =>
        cursorCodec.encode({
          ...commonClaims,
          rank_ordinal: claim.rank_ordinal,
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
            rank_ordinal: nextClaims.rank_ordinal,
            job_kind: nextClaims.source_kind,
            job_id: nextClaims.source_id,
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
  return Object.freeze(repository) as JobDiscoveryRepository;
}

export function isTrustedJobDiscoveryRepository(
  value: unknown
): value is JobDiscoveryRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
