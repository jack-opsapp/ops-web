import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  CUSTOMER_DISCOVERY_RANKING_REVISION,
  CustomerDiscoveryMatchSchema,
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  DiscoveryMillisecondUtcTimestampSchema,
} from "@/lib/agent-control-plane/contracts/discovery";
import {
  isAuthorizedCustomerDiscoveryRead,
  type AuthorizedCustomerDiscoveryRead,
} from "./customer-discovery-authorization";
import {
  FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION,
  hashOperationalReadQuery,
  isTrustedOperationalReadCursorCodec,
  OperationalReadCursorError,
  OperationalReadCursorPermissionStaleError,
  type CustomerDiscoveryCursorClaims,
  type OperationalReadCursorCodec,
} from "./operational-read-cursor";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
  type CanonicalProjection,
} from "./operational-read-projection";
import {
  compareCustomerDiscoveryOrder,
  customerNameMatchBasisFits,
} from "./discovery-match-rules";

const RPC_NAME = "read_agent_customer_discovery_as_system" as const;
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
  "Customer-discovery source fence is invalid"
);
const DiscoveryGapsSchema = z
  .array(z.enum(["SOURCE_QUERY_BOUND", "SOURCE_DATA_INVALID"]))
  .max(1)
  .refine((values) => new Set(values).size === values.length);
const PageRowSchema = z
  .object({
    rank_ordinal: z.number().int().safe().min(1).max(500),
    source_kind: z.enum(["client", "sub_client"]),
    source_id: UUID_SCHEMA,
  })
  .strict();
const NextCursorClaimsSchema = z
  .object({
    source_revision: z.number().int().safe().nonnegative(),
    read_as_of: UTC_SCHEMA,
    rank_ordinal: z.number().int().safe().min(1).max(500),
    source_kind: z.enum(["client", "sub_client"]),
    source_id: UUID_SCHEMA,
  })
  .strict();
const CursorAnchorOrderWitnessSchema = z
  .object({
    rank_ordinal: z.number().int().safe().min(1).max(500),
    raw: CustomerDiscoveryMatchSchema,
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
const ContactSelectionWitnessSchema = z
  .object({
    customer_ref: z.union([
      z.object({ kind: z.literal("client"), id: UUID_SCHEMA }).strict(),
      z.object({ kind: z.literal("sub_client"), id: UUID_SCHEMA }).strict(),
    ]),
    lookup: z.enum(["exact_email", "exact_phone"]),
    query_binding_hash: SHA256_SCHEMA,
  })
  .strict();
const CustomerDiscoveryClaimSchema = z
  .object({
    rank_ordinal: z.number().int().safe().min(1).max(500),
    raw: CustomerDiscoveryMatchSchema,
    selection_witness: ContactSelectionWitnessSchema.optional(),
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
    ranking_revision: z.literal(CUSTOMER_DISCOVERY_RANKING_REVISION),
    authorized_candidate_count: z.number().int().safe().min(0).max(501),
    raw_page_count: z.number().int().safe().min(0).max(26),
    page_rows: z.array(PageRowSchema).max(26),
    match_claims: z.array(CustomerDiscoveryClaimSchema).max(25),
    returned_match_count: z.number().int().safe().min(0).max(25),
    has_more: z.boolean(),
    next_cursor_claims: NextCursorClaimsSchema.nullable(),
    gaps: DiscoveryGapsSchema,
    collection_claim: CollectionClaimSchema,
  })
  .strict();

type RawCustomerDiscoverySnapshot = z.infer<typeof RawSnapshotSchema>;
type CustomerDiscoveryClaim = z.infer<typeof CustomerDiscoveryClaimSchema>;
type SourceVersion = z.infer<typeof SourceVersionSchema>;

export interface CustomerDiscoverySnapshot extends Omit<
  RawCustomerDiscoverySnapshot,
  "has_more" | "next_cursor_claims"
> {
  readonly page: Readonly<{
    readonly next_cursor: string | null;
    readonly has_more: boolean;
  }>;
  readonly boundary_cursors: readonly string[];
}

export class CustomerDiscoveryRepositoryError extends Error {
  readonly code:
    | "CUSTOMER_DISCOVERY_READ_FAILED"
    | "CUSTOMER_DISCOVERY_NOT_FOUND"
    | "CUSTOMER_DISCOVERY_INVALID"
    | "CUSTOMER_DISCOVERY_STALE";
  readonly currentSourceVersion: SourceVersion | null;

  constructor(
    code: CustomerDiscoveryRepositoryError["code"],
    options?: ErrorOptions & { readonly currentSourceVersion?: SourceVersion }
  ) {
    super(code, options);
    this.name = "CustomerDiscoveryRepositoryError";
    this.code = code;
    this.currentSourceVersion = options?.currentSourceVersion ?? null;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface CustomerDiscoveryRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface CustomerDiscoveryRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): CustomerDiscoveryRpcRequest;
}

declare const TRUSTED_CUSTOMER_DISCOVERY_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface CustomerDiscoveryRepository {
  readonly [TRUSTED_CUSTOMER_DISCOVERY_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedCustomerDiscoveryRead;
    readonly signal?: AbortSignal;
  }): Promise<CustomerDiscoverySnapshot>;
}

function invalid(cause?: unknown): never {
  throw new CustomerDiscoveryRepositoryError("CUSTOMER_DISCOVERY_INVALID", {
    cause,
  });
}

function canonicalInput(proof: AuthorizedCustomerDiscoveryRead) {
  const { cursor: _cursor, ...query } = proof.query;
  return query;
}

function queryHash(
  proof: AuthorizedCustomerDiscoveryRead,
  capabilityManifestRevision = proof.capabilityManifestRevision
): string {
  return hashOperationalReadQuery({
    capability_id: proof.capabilityId,
    schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    capability_manifest_revision: capabilityManifestRevision,
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

function sourceRevision(snapshot: RawCustomerDiscoverySnapshot): number {
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
  readonly claim:
    | CustomerDiscoveryClaim
    | z.infer<typeof CollectionClaimSchema>;
  readonly proof: AuthorizedCustomerDiscoveryRead;
  readonly snapshot: RawCustomerDiscoverySnapshot;
  readonly sourceType:
    | "customer_discovery_projection"
    | "customer_discovery_collection_projection";
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
    ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
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
    if (error instanceof CustomerDiscoveryRepositoryError) throw error;
    invalid(error);
  }
  assertEvidence({
    evidence: claim.evidence[0]!,
    source: claim.source_version,
    evidenceId: claim.proof.evidence_id,
    readAt: input.snapshot.read_at,
  });
}

function rowForClaim(claim: CustomerDiscoveryClaim) {
  return {
    rank_ordinal: claim.rank_ordinal,
    source_kind: claim.raw.customer_ref.kind,
    source_id: claim.raw.customer_ref.id,
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

function matchFitsQuery(
  raw: CustomerDiscoveryClaim["raw"],
  proof: AuthorizedCustomerDiscoveryRead
): boolean {
  const reference = raw.customer_ref;
  const basis = raw.match_basis.kind;
  if (!proof.query.customer_kinds.includes(reference.kind)) return false;
  if (
    (proof.query.lookup === "name" &&
      !["exact_name", "prefix_name", "all_tokens_name"].includes(basis)) ||
    (proof.query.lookup === "exact_email" && basis !== "exact_email") ||
    (proof.query.lookup === "exact_phone" && basis !== "exact_phone")
  ) {
    return false;
  }
  if (
    proof.query.lookup === "name" &&
    !customerNameMatchBasisFits({
      displayName: raw.display_name,
      canonicalQuery: proof.query.query,
      claimedBasis: basis as "exact_name" | "prefix_name" | "all_tokens_name",
    })
  ) {
    return false;
  }
  return (
    reference.kind !== "sub_client" ||
    (raw.relationship.kind === "sub_client" &&
      raw.relationship.parent_client_ref.id !== reference.id)
  );
}

function assertCursorAnchorOrderWitness(
  snapshot: RawCustomerDiscoverySnapshot,
  proof: AuthorizedCustomerDiscoveryRead,
  decoded: CustomerDiscoveryCursorClaims | null
): void {
  const witness = snapshot.collection_claim.raw.cursor_anchor_order_witness;
  if ((decoded === null) !== (witness === null)) invalid();
  if (decoded === null || witness === null) return;

  const reference = witness.raw.customer_ref;
  const sourceId = `${reference.kind}:${reference.id}:ordinal:${witness.rank_ordinal}`;
  const evidenceId = `evidence:customer_discovery_projection:${sourceId}`;
  if (
    witness.rank_ordinal !== decoded.rank_ordinal ||
    reference.kind !== decoded.customer_kind ||
    reference.id !== decoded.customer_id ||
    witness.raw.evidence_ids.length !== 1 ||
    witness.raw.evidence_ids[0] !== evidenceId ||
    !matchFitsQuery(witness.raw, proof)
  ) {
    invalid();
  }

  const first = snapshot.match_claims[0]?.raw;
  if (first !== undefined) {
    const order = compareCustomerDiscoveryOrder(witness.raw, first);
    if (order === null || order >= 0) invalid();
  }
}

function contactSelectionBindingHash(
  claim: CustomerDiscoveryClaim,
  proof: AuthorizedCustomerDiscoveryRead
): string {
  return hashOperationalProjection({
    schema_revision: "customer-discovery-contact-selection:v1",
    customer_ref: claim.raw.customer_ref,
    lookup: proof.query.lookup,
    normalized_query: proof.query.query,
  });
}

function assertSelectionWitness(
  claim: CustomerDiscoveryClaim,
  proof: AuthorizedCustomerDiscoveryRead
): void {
  const witness = claim.selection_witness;
  if (proof.query.lookup === "name") {
    if (witness !== undefined) invalid();
    return;
  }
  if (
    witness === undefined ||
    witness.lookup !== proof.query.lookup ||
    witness.customer_ref.kind !== claim.raw.customer_ref.kind ||
    witness.customer_ref.id !== claim.raw.customer_ref.id ||
    witness.query_binding_hash !== contactSelectionBindingHash(claim, proof)
  ) {
    invalid();
  }
}

function assertPageAndCandidateState(
  snapshot: RawCustomerDiscoverySnapshot,
  proof: AuthorizedCustomerDiscoveryRead,
  decoded: CustomerDiscoveryCursorClaims | null
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
  snapshot: RawCustomerDiscoverySnapshot,
  proof: AuthorizedCustomerDiscoveryRead,
  decoded: CustomerDiscoveryCursorClaims | null
): void {
  const revision = sourceRevision(snapshot);
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    snapshot.ranking_revision !== CUSTOMER_DISCOVERY_RANKING_REVISION ||
    (decoded !== null &&
      (decoded.source_revision !== revision ||
        decoded.read_as_of !== snapshot.read_at))
  ) {
    invalid();
  }
  assertPageAndCandidateState(snapshot, proof, decoded);
  assertCursorAnchorOrderWitness(snapshot, proof, decoded);

  for (let index = 1; index < snapshot.match_claims.length; index += 1) {
    const order = compareCustomerDiscoveryOrder(
      snapshot.match_claims[index - 1]!.raw,
      snapshot.match_claims[index]!.raw
    );
    if (order === null || order >= 0) invalid();
  }

  const sources = new Set<string>();
  const evidenceIds = new Set<string>();
  const canonicalRefs = new Set<string>();
  const retainedSources: SourceVersion[] = [];
  for (const claim of snapshot.match_claims) {
    const reference = claim.raw.customer_ref;
    const referenceIdentity = `${reference.kind}:${reference.id}`;
    const sourceId = `${referenceIdentity}:ordinal:${claim.rank_ordinal}`;
    const evidenceId = `evidence:customer_discovery_projection:${sourceId}`;
    if (
      !matchFitsQuery(claim.raw, proof) ||
      claim.raw.evidence_ids.length !== 1 ||
      claim.raw.evidence_ids[0] !== evidenceId ||
      canonicalRefs.has(referenceIdentity) ||
      sources.has(sourceIdentity(claim.source_version)) ||
      evidenceIds.has(claim.proof.evidence_id)
    ) {
      invalid();
    }
    assertSelectionWitness(claim, proof);
    assertAtomicClaim({
      claim,
      proof,
      snapshot,
      sourceType: "customer_discovery_projection",
      sourceId,
      evidenceId,
      payloadKey: "match",
      expectedRaw: claim.raw as CanonicalProjection,
      retainedProofSources: [],
      rankOrdinal: claim.rank_ordinal,
      selectionWitness: claim.selection_witness as unknown as
        | CanonicalProjection
        | undefined,
    });
    canonicalRefs.add(referenceIdentity);
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
        next.source_kind !== last.raw.customer_ref.kind ||
        next.source_id !== last.raw.customer_ref.id)) ||
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
    sourceType: "customer_discovery_collection_projection",
    sourceId: `company:${proof.actorContext.companyId}`,
    evidenceId: `evidence:customer_discovery_collection_projection:company:${proof.actorContext.companyId}`,
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

function permissionSource(
  proof: AuthorizedCustomerDiscoveryRead
): SourceVersion {
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
      value.message !== "agent_customer_discovery_cursor_stale"
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
        value.message ===
          "agent_customer_discovery_not_found_or_not_visible") ||
      (value.code === "42501" &&
        value.message === "agent_customer_discovery_forbidden")
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

export function createSupabaseCustomerDiscoveryRepository(
  client: CustomerDiscoveryRpcClient,
  cursorCodec: OperationalReadCursorCodec
): CustomerDiscoveryRepository {
  let suppliedRpc: CustomerDiscoveryRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as CustomerDiscoveryRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A customer-discovery RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A customer-discovery RPC client is required");
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
      readonly authorization: AuthorizedCustomerDiscoveryRead;
      readonly signal?: AbortSignal;
    }): Promise<CustomerDiscoverySnapshot> {
      let proof: AuthorizedCustomerDiscoveryRead;
      let signal: AbortSignal | undefined;
      try {
        proof = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedCustomerDiscoveryRead(proof)) invalid();
      if (signal?.aborted) {
        throw new CustomerDiscoveryRepositoryError(
          "CUSTOMER_DISCOVERY_READ_FAILED"
        );
      }

      const hash = queryHash(proof);
      const frozenV7QueryHash = queryHash(
        proof,
        FROZEN_V7_OPERATIONAL_CURSOR_MANIFEST_REVISION
      );
      let decoded: CustomerDiscoveryCursorClaims | null = null;
      if (proof.query.cursor) {
        try {
          const claims = cursorCodec.decode({
            cursor: proof.query.cursor,
            expected: {
              capabilityId: proof.capabilityId,
              schemaRevision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
              capabilityManifestRevision: proof.capabilityManifestRevision,
              rankingRevision: CUSTOMER_DISCOVERY_RANKING_REVISION,
              ruleRevisions: [],
              actorUserId: proof.actorContext.actorUserId,
              companyId: proof.actorContext.companyId,
              permissionSnapshotRevision:
                proof.actorContext.permissionSnapshotRevision,
              queryHash: hash,
              frozenV7QueryHash,
            },
          });
          if (claims.capability_id !== "search_customers") invalid();
          decoded = claims;
        } catch (error) {
          if (error instanceof OperationalReadCursorPermissionStaleError) {
            throw new CustomerDiscoveryRepositoryError(
              "CUSTOMER_DISCOVERY_STALE",
              { cause: error, currentSourceVersion: permissionSource(proof) }
            );
          }
          if (
            error instanceof OperationalReadCursorError ||
            error instanceof CustomerDiscoveryRepositoryError
          ) {
            throw new CustomerDiscoveryRepositoryError(
              "CUSTOMER_DISCOVERY_INVALID",
              { cause: error }
            );
          }
          throw error;
        }
      }

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
          p_ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
          p_required_oauth_scopes: [...proof.requiredOAuthScopes],
          p_clients_scope: proof.clientsScope,
          p_lookup: proof.query.lookup,
          p_query: proof.query.query,
          p_customer_kinds: [...proof.query.customer_kinds],
          p_read_as_of: decoded?.read_as_of ?? null,
          p_cursor_source_revision: decoded?.source_revision ?? null,
          p_cursor_rank_ordinal: decoded?.rank_ordinal ?? null,
          p_cursor_customer_kind: decoded?.customer_kind ?? null,
          p_cursor_customer_id: decoded?.customer_id ?? null,
          p_limit: proof.query.limit,
        });
        const abortSignal = request?.abortSignal;
        response =
          signal && typeof abortSignal === "function"
            ? await Reflect.apply(abortSignal, request, [signal])
            : await request;
      } catch (error) {
        if (error instanceof CustomerDiscoveryRepositoryError) throw error;
        throw new CustomerDiscoveryRepositoryError(
          "CUSTOMER_DISCOVERY_READ_FAILED",
          { cause: error }
        );
      }
      if (signal?.aborted) {
        throw new CustomerDiscoveryRepositoryError(
          "CUSTOMER_DISCOVERY_READ_FAILED"
        );
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new CustomerDiscoveryRepositoryError(
          "CUSTOMER_DISCOVERY_READ_FAILED",
          { cause: error }
        );
      }
      if (responseError) {
        const currentSourceVersion = staleSource(responseError);
        if (currentSourceVersion) {
          throw new CustomerDiscoveryRepositoryError(
            "CUSTOMER_DISCOVERY_STALE",
            { currentSourceVersion }
          );
        }
        throw new CustomerDiscoveryRepositoryError(
          isNotFoundOrForbidden(responseError)
            ? "CUSTOMER_DISCOVERY_NOT_FOUND"
            : "CUSTOMER_DISCOVERY_READ_FAILED"
        );
      }

      let parsedData: RawCustomerDiscoverySnapshot;
      try {
        const parsed = RawSnapshotSchema.safeParse(responseData);
        if (!parsed.success) invalid(parsed.error);
        parsedData = parsed.data;
      } catch (error) {
        if (error instanceof CustomerDiscoveryRepositoryError) throw error;
        invalid(error);
      }
      assertSnapshot(parsedData, proof, decoded);
      const commonClaims = {
        capability_id: proof.capabilityId,
        schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
        capability_manifest_revision: proof.capabilityManifestRevision,
        ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
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
          customer_kind: claim.raw.customer_ref.kind,
          customer_id: claim.raw.customer_ref.id,
        })
      );
      const nextClaims = parsedData.next_cursor_claims;
      const nextCursor = nextClaims
        ? cursorCodec.encode({
            ...commonClaims,
            source_revision: nextClaims.source_revision,
            read_as_of: nextClaims.read_as_of,
            rank_ordinal: nextClaims.rank_ordinal,
            customer_kind: nextClaims.source_kind,
            customer_id: nextClaims.source_id,
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
  return Object.freeze(repository) as CustomerDiscoveryRepository;
}

export function isTrustedCustomerDiscoveryRepository(
  value: unknown
): value is CustomerDiscoveryRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
