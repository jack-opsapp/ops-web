import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  CUSTOMER_DISCOVERY_RANKING_REVISION,
  DISCOVERY_CAPABILITY_SCHEMA_REVISION,
  JOB_DISCOVERY_RANKING_REVISION,
  SearchCustomersInputSchema,
  SearchJobsInputSchema,
  type CustomerDiscoveryMatch,
  type JobDiscoveryMatch,
} from "@/lib/agent-control-plane/contracts/discovery";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  authorizeCustomerDiscoveryRead,
  type AuthorizedCustomerDiscoveryRead,
} from "../../customer-discovery-authorization";
import {
  authorizeJobDiscoveryRead,
  type AuthorizedJobDiscoveryRead,
} from "../../job-discovery-authorization";
import {
  createOperationalReadCursorCodec,
  hashOperationalReadQuery,
} from "../../operational-read-cursor";
import {
  hashOperationalProjection,
  type CanonicalProjection,
} from "../../operational-read-projection";
import {
  TASK_13_ACTOR_ID,
  TASK_13_COMPANY_ID,
  TASK_13_PERMISSION_REVISION,
  TASK_13_READ_AT,
  TASK_13_SOURCE_REVISION,
  task13ActorContext,
} from "./task13-job-catalog-fixtures";

export const DISCOVERY_ACTOR_ID = TASK_13_ACTOR_ID;
export const DISCOVERY_COMPANY_ID = TASK_13_COMPANY_ID;
export const DISCOVERY_PERMISSION_REVISION = TASK_13_PERMISSION_REVISION;
export const DISCOVERY_READ_AT = TASK_13_READ_AT;
export const DISCOVERY_SOURCE_REVISION = TASK_13_SOURCE_REVISION;
export const DISCOVERY_GENERATED_AT = "2026-08-14T18:00:00.000Z";
export const DISCOVERY_CLIENT_ID = "a1000000-0000-4000-8000-000000000001";
export const DISCOVERY_SUB_CLIENT_ID = "a1000000-0000-4000-8000-000000000002";
export const DISCOVERY_PARENT_CLIENT_ID =
  "a1000000-0000-4000-8000-000000000003";
export const DISCOVERY_OPPORTUNITY_ID = "b1000000-0000-4000-8000-000000000001";
export const DISCOVERY_PROJECT_ID = "b1000000-0000-4000-8000-000000000002";

export const DISCOVERY_CUSTOMER_INPUT = SearchCustomersInputSchema.parse({
  lookup: "name",
  query: "Acme Construction",
  customer_kinds: ["client", "sub_client"],
  limit: 2,
});

export const DISCOVERY_JOB_INPUT = SearchJobsInputSchema.parse({
  query: "Cedar Street",
  query_fields: ["title", "address"],
  job_kinds: ["opportunity", "project"],
  lifecycle_states: ["active", "terminal"],
  opportunity_stages: ["quoting", "quoted"],
  project_statuses: ["accepted", "in_progress"],
  date_window: {
    field: "updated_at",
    from: "2026-01-01T00:00:00.000Z",
    to_exclusive: "2026-08-15T00:00:00.000Z",
  },
  limit: 2,
});

export type DiscoveryRpcResult = Readonly<{ data: unknown; error: unknown }>;

export class StubDiscoveryRpcClient {
  readonly calls: Array<{
    readonly functionName: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(
    private readonly results: Array<
      DiscoveryRpcResult | (() => PromiseLike<DiscoveryRpcResult>)
    >
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected discovery fixture repository read");
    const request =
      typeof next === "function"
        ? Promise.resolve(next())
        : Promise.resolve(next);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
  }
}

function authorizations(
  actor: ActorContext,
  capabilityId: "search_customers" | "search_jobs",
  rawInput: unknown
) {
  return resolveCapabilityAuthorization(capabilityId, rawInput).variants.map(
    ({ policy }) => authorizeCapability({ actorContext: actor, policy })
  );
}

export async function customerDiscoveryAuthorization(
  rawInput: unknown = DISCOVERY_CUSTOMER_INPUT,
  actor?: ActorContext
): Promise<AuthorizedCustomerDiscoveryRead> {
  const resolvedActor = actor ?? (await task13ActorContext());
  const [authorization] = authorizations(
    resolvedActor,
    "search_customers",
    rawInput
  );
  return authorizeCustomerDiscoveryRead({
    authorization: authorization!,
    rawInput,
  });
}

export async function jobDiscoveryAuthorization(
  rawInput: unknown = DISCOVERY_JOB_INPUT,
  actor?: ActorContext
): Promise<AuthorizedJobDiscoveryRead> {
  const resolvedActor = actor ?? (await task13ActorContext());
  return authorizeJobDiscoveryRead({
    authorizations: authorizations(resolvedActor, "search_jobs", rawInput),
    rawInput,
  });
}

export function discoveryCursorCodec(input?: {
  readonly now?: () => Date;
  readonly ttlSeconds?: number;
}) {
  return createOperationalReadCursorCodec({
    key: new Uint8Array(32).fill(37),
    keyId: "discovery-fixture",
    version: 1,
    ...(input?.now ? { now: input.now } : {}),
    ...(input?.ttlSeconds ? { ttlSeconds: input.ttlSeconds } : {}),
  });
}

export function discoverySourceVersion(
  sourceType: string,
  sourceId: string,
  version: string
) {
  return {
    source_domain: "operations" as const,
    source_type: sourceType,
    source_id: sourceId,
    version,
  };
}

export function discoverySourceFence(revision = DISCOVERY_SOURCE_REVISION) {
  return discoverySourceVersion(
    "operational_read_revision",
    "private.agent_operational_read_revisions",
    `revision:${revision}`
  );
}

type DiscoveryAuthorization =
  | AuthorizedCustomerDiscoveryRead
  | AuthorizedJobDiscoveryRead;
type DiscoverySourceVersion = ReturnType<typeof discoverySourceVersion>;

function canonicalInput(authorization: DiscoveryAuthorization) {
  const { cursor: _cursor, ...query } = authorization.query;
  return structuredClone(query);
}

export function discoveryQueryHash(
  authorization: DiscoveryAuthorization
): string {
  return hashOperationalReadQuery({
    capability_id: authorization.capabilityId,
    schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    query: canonicalInput(authorization),
  });
}

function rankingRevision(authorization: DiscoveryAuthorization) {
  return authorization.capabilityId === "search_customers"
    ? CUSTOMER_DISCOVERY_RANKING_REVISION
    : JOB_DISCOVERY_RANKING_REVISION;
}

export function discoveryEvidenceRef(input: {
  readonly evidenceId: string;
  readonly sourceVersion: DiscoverySourceVersion;
  readonly readAt?: string;
}) {
  return {
    evidence_id: input.evidenceId,
    ...input.sourceVersion,
    occurred_at: input.readAt ?? DISCOVERY_READ_AT,
    relationship: "supports" as const,
    locator: `ops://evidence/${encodeURIComponent(input.evidenceId)}`,
    trust: "authoritative_ops" as const,
  };
}

export interface AtomicDiscoveryClaim {
  rank_ordinal?: number;
  raw: Record<string, unknown>;
  selection_witness?: Record<string, unknown>;
  proof: {
    source_version: DiscoverySourceVersion;
    source_content_hash: string;
    evidence_id: string;
    projection: Record<string, unknown>;
  };
  source_version: DiscoverySourceVersion;
  evidence: Array<ReturnType<typeof discoveryEvidenceRef>>;
}

function atomicClaim(input: {
  readonly authorization: DiscoveryAuthorization;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly raw: Record<string, unknown>;
  readonly payloadKey: "match" | "collection";
  readonly retainedProofSources?: readonly DiscoverySourceVersion[];
  readonly rankOrdinal?: number;
  readonly selectionWitness?: Record<string, unknown>;
  readonly readAt?: string;
  readonly sourceRevision?: number;
}): AtomicDiscoveryClaim {
  const readAt = input.readAt ?? DISCOVERY_READ_AT;
  const sourceRevision = input.sourceRevision ?? DISCOVERY_SOURCE_REVISION;
  const projection: Record<string, unknown> = {
    actor_user_id: input.authorization.actorContext.actorUserId,
    company_id: input.authorization.actorContext.companyId,
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    capability_manifest_revision:
      input.authorization.capabilityManifestRevision,
    schema_revision: DISCOVERY_CAPABILITY_SCHEMA_REVISION,
    permission_snapshot_revision:
      input.authorization.actorContext.permissionSnapshotRevision,
    canonical_input: canonicalInput(input.authorization),
    read_at: readAt,
    source_revision: sourceRevision,
    ranking_revision: rankingRevision(input.authorization),
    retained_proof_sources: structuredClone(input.retainedProofSources ?? []),
    ...(input.rankOrdinal === undefined
      ? {}
      : { rank_ordinal: input.rankOrdinal }),
    ...(input.selectionWitness === undefined
      ? {}
      : { selection_witness: structuredClone(input.selectionWitness) }),
    [input.payloadKey]: structuredClone(input.raw),
  };
  const sourceContentHash = hashOperationalProjection(
    projection as CanonicalProjection
  );
  const sourceVersion = discoverySourceVersion(
    input.sourceType,
    input.sourceId,
    `${input.sourceType}:v1:${sourceContentHash}`
  );
  return {
    ...(input.rankOrdinal === undefined
      ? {}
      : { rank_ordinal: input.rankOrdinal }),
    raw: structuredClone(input.raw),
    ...(input.selectionWitness === undefined
      ? {}
      : { selection_witness: structuredClone(input.selectionWitness) }),
    proof: {
      source_version: sourceVersion,
      source_content_hash: sourceContentHash,
      evidence_id: input.evidenceId,
      projection,
    },
    source_version: sourceVersion,
    evidence: [
      discoveryEvidenceRef({
        evidenceId: input.evidenceId,
        sourceVersion,
        readAt,
      }),
    ],
  };
}

function indexedUuid(prefix: "a2" | "b2", index: number): string {
  return `${prefix}000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function customerDiscoveryMatch(
  ordinal = 1,
  options?: {
    readonly kind?: "client" | "sub_client";
    readonly basis?:
      | "exact_name"
      | "prefix_name"
      | "all_tokens_name"
      | "exact_email"
      | "exact_phone";
  }
): CustomerDiscoveryMatch {
  const kind = options?.kind ?? "client";
  const id =
    ordinal === 1 && kind === "client"
      ? DISCOVERY_CLIENT_ID
      : ordinal === 1
        ? DISCOVERY_SUB_CLIENT_ID
        : indexedUuid("a2", ordinal);
  const basis = options?.basis ?? ("prefix_name" as const);
  const evidenceId = `evidence:customer_discovery_projection:${kind}:${id}:ordinal:${ordinal}`;
  if (kind === "client") {
    return {
      customer_ref: { kind, id },
      display_name: `Acme Construction ${String(ordinal).padStart(3, "0")}`,
      relationship: { kind: "primary_client" },
      match_basis: {
        ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
        kind: basis,
      },
      content_kind: "untrusted_business_data",
      visibility_reason: "current_actor_authorized",
      evidence_ids: [evidenceId],
    };
  }
  return {
    customer_ref: { kind, id },
    display_name: `Acme Construction ${String(ordinal).padStart(3, "0")}`,
    relationship: {
      kind: "sub_client",
      parent_client_ref: {
        kind: "client",
        id: DISCOVERY_PARENT_CLIENT_ID,
      },
      parent_display_name: "Acme Construction",
    },
    match_basis: {
      ranking_revision: CUSTOMER_DISCOVERY_RANKING_REVISION,
      kind: basis,
    },
    content_kind: "untrusted_business_data",
    visibility_reason: "current_actor_authorized",
    evidence_ids: [evidenceId],
  };
}

export function opportunityDiscoveryMatch(ordinal = 1) {
  const id =
    ordinal === 1 ? DISCOVERY_OPPORTUNITY_ID : indexedUuid("b2", ordinal);
  const jobRef = { kind: "opportunity" as const, id };
  const evidenceId = `evidence:job_discovery_projection:opportunity:${id}:ordinal:${ordinal}`;
  return {
    job_ref: jobRef,
    anchor_refs: [jobRef],
    display_title: `Cedar Street deck ${String(ordinal).padStart(3, "0")}`,
    address: "100 Cedar Street, Vancouver, BC",
    lifecycle_state: "active" as const,
    status: { kind: "opportunity" as const, value: "quoting" as const },
    dates: {
      kind: "opportunity" as const,
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-14T10:00:00.000Z",
    },
    conversion: { state: "not_converted" as const },
    match_basis: {
      ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
      kind: "prefix_title" as const,
      field: "title" as const,
    },
    content_kind: "untrusted_business_data" as const,
    visibility_reason: "current_actor_authorized" as const,
    evidence_ids: [evidenceId],
  };
}

export function convertedProjectDiscoveryMatch(ordinal = 1) {
  const projectId =
    ordinal === 1 ? DISCOVERY_PROJECT_ID : indexedUuid("b2", 100 + ordinal);
  const opportunityId =
    ordinal === 1 ? DISCOVERY_OPPORTUNITY_ID : indexedUuid("b2", 200 + ordinal);
  const jobRef = { kind: "project" as const, id: projectId };
  const opportunityRef = {
    kind: "opportunity" as const,
    id: opportunityId,
  };
  const evidenceId = `evidence:job_discovery_projection:project:${projectId}:ordinal:${ordinal}`;
  return {
    job_ref: jobRef,
    anchor_refs: [opportunityRef, jobRef],
    display_title: `Cedar Street deck ${String(ordinal).padStart(3, "0")}`,
    address: "100 Cedar Street, Vancouver, BC",
    lifecycle_state: "active" as const,
    status: { kind: "project" as const, value: "in_progress" as const },
    dates: {
      kind: "project" as const,
      created_at: "2026-08-02T10:00:00.000Z",
      updated_at: "2026-08-14T11:00:00.000Z",
      start_date: "2026-08-21",
      end_date: null,
    },
    conversion: {
      state: "converted" as const,
      opportunity_ref: opportunityRef,
      project_ref: jobRef,
    },
    match_basis: {
      ranking_revision: JOB_DISCOVERY_RANKING_REVISION,
      kind: "prefix_title" as const,
      field: "title" as const,
    },
    content_kind: "untrusted_business_data" as const,
    visibility_reason: "current_actor_authorized" as const,
    evidence_ids: [evidenceId],
  };
}

function selectionAnchor(match: JobDiscoveryMatch) {
  return {
    job_ref: structuredClone(match.job_ref),
    display_title: match.display_title,
    address: match.address,
    lifecycle_state: match.lifecycle_state,
    status: structuredClone(match.status),
    dates: structuredClone(match.dates),
    match_basis: structuredClone(match.match_basis),
    ...(match.job_ref.kind === "opportunity"
      ? { archived: match.lifecycle_state === "archived" }
      : {}),
  };
}

export function jobSelectionWitness(match: JobDiscoveryMatch) {
  if (match.conversion.state !== "converted") {
    return { anchors: [selectionAnchor(match)] };
  }
  const opportunityAnchor = {
    job_ref: structuredClone(match.conversion.opportunity_ref),
    display_title: match.display_title,
    address: match.address,
    lifecycle_state: "active" as const,
    status: { kind: "opportunity" as const, value: "quoting" as const },
    dates: {
      kind: "opportunity" as const,
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-14T10:00:00.000Z",
    },
    match_basis: structuredClone(match.match_basis),
    archived: false,
  };
  return { anchors: [opportunityAnchor, selectionAnchor(match)] };
}

function customerContactSelectionWitness(
  authorization: DiscoveryAuthorization,
  match: CustomerDiscoveryMatch
) {
  if (
    authorization.capabilityId !== "search_customers" ||
    authorization.query.lookup === "name"
  ) {
    return undefined;
  }
  const binding = {
    schema_revision: "customer-discovery-contact-selection:v1",
    customer_ref: structuredClone(match.customer_ref),
    lookup: authorization.query.lookup,
    normalized_query: authorization.query.query,
  } as const;
  return {
    customer_ref: structuredClone(match.customer_ref),
    lookup: authorization.query.lookup,
    query_binding_hash: hashOperationalProjection(
      binding as unknown as CanonicalProjection
    ),
  };
}

function childClaim(input: {
  readonly authorization: DiscoveryAuthorization;
  readonly kind: "customer" | "job";
  readonly ordinal: number;
  readonly raw: Record<string, unknown>;
  readonly reference: {
    readonly kind: "client" | "sub_client" | "opportunity" | "project";
    readonly id: string;
  };
}) {
  const sourceType = `${input.kind}_discovery_projection`;
  const sourceId = `${input.reference.kind}:${input.reference.id}:ordinal:${input.ordinal}`;
  return atomicClaim({
    authorization: input.authorization,
    sourceType,
    sourceId,
    evidenceId: `evidence:${sourceType}:${sourceId}`,
    raw: input.raw,
    payloadKey: "match",
    rankOrdinal: input.ordinal,
    ...(input.kind === "job"
      ? {
          selectionWitness: jobSelectionWitness(
            input.raw as unknown as JobDiscoveryMatch
          ),
        }
      : {
          selectionWitness: customerContactSelectionWitness(
            input.authorization,
            input.raw as unknown as CustomerDiscoveryMatch
          ),
        }),
  });
}

function collectionClaim(input: {
  readonly authorization: DiscoveryAuthorization;
  readonly kind: "customer" | "job";
  readonly raw: Record<string, unknown>;
  readonly retainedProofSources: readonly DiscoverySourceVersion[];
}) {
  const sourceType = `${input.kind}_discovery_collection_projection`;
  return atomicClaim({
    authorization: input.authorization,
    sourceType,
    sourceId: `company:${input.authorization.actorContext.companyId}`,
    evidenceId: `evidence:${sourceType}:company:${input.authorization.actorContext.companyId}`,
    raw: input.raw,
    payloadKey: "collection",
    retainedProofSources: input.retainedProofSources,
  });
}

interface SnapshotOptions {
  readonly hasMore?: boolean;
  readonly authorizedCandidateCount?: number;
  readonly queryBound?: boolean;
  readonly startOrdinal?: number;
  readonly cursorAnchorRaw?: unknown;
}

export function customerDiscoverySnapshot(
  authorization: AuthorizedCustomerDiscoveryRead,
  matches: readonly unknown[] = [customerDiscoveryMatch()],
  options?: SnapshotOptions
) {
  const claims = matches.map((raw, index) => {
    const customer = raw as ReturnType<typeof customerDiscoveryMatch>;
    return childClaim({
      authorization,
      kind: "customer",
      ordinal: (options?.startOrdinal ?? 1) + index,
      raw: customer as unknown as Record<string, unknown>,
      reference: customer.customer_ref,
    });
  });
  return discoverySnapshot({
    authorization,
    kind: "customer",
    claims,
    options,
    cursorAnchorRaw:
      (options?.startOrdinal ?? 1) > 1
        ? (options?.cursorAnchorRaw ??
          customerDiscoveryMatch((options?.startOrdinal ?? 1) - 1, {
            basis:
              authorization.query.lookup === "name"
                ? "prefix_name"
                : authorization.query.lookup,
          }))
        : null,
  });
}

export function jobDiscoverySnapshot(
  authorization: AuthorizedJobDiscoveryRead,
  matches: readonly unknown[] = [opportunityDiscoveryMatch()],
  options?: SnapshotOptions
) {
  const claims = matches.map((raw, index) => {
    const job = raw as
      | ReturnType<typeof opportunityDiscoveryMatch>
      | ReturnType<typeof convertedProjectDiscoveryMatch>;
    return childClaim({
      authorization,
      kind: "job",
      ordinal: (options?.startOrdinal ?? 1) + index,
      raw: job as unknown as Record<string, unknown>,
      reference: job.job_ref,
    });
  });
  return discoverySnapshot({
    authorization,
    kind: "job",
    claims,
    options,
    cursorAnchorRaw:
      (options?.startOrdinal ?? 1) > 1
        ? (options?.cursorAnchorRaw ??
          opportunityDiscoveryMatch((options?.startOrdinal ?? 1) - 1))
        : null,
  });
}

function discoverySnapshot(input: {
  readonly authorization: DiscoveryAuthorization;
  readonly kind: "customer" | "job";
  readonly claims: readonly AtomicDiscoveryClaim[];
  readonly options?: SnapshotOptions;
  readonly cursorAnchorRaw: unknown | null;
}) {
  const queryBound = input.options?.queryBound ?? false;
  const hasMore = !queryBound && (input.options?.hasMore ?? false);
  const claims = queryBound ? [] : structuredClone(input.claims);
  const pageRows = claims.map((claim) => {
    const raw = claim.raw as {
      customer_ref?: { kind: "client" | "sub_client"; id: string };
      job_ref?: { kind: "opportunity" | "project"; id: string };
    };
    const reference = raw.customer_ref ?? raw.job_ref!;
    return {
      rank_ordinal: claim.rank_ordinal!,
      source_kind: reference.kind,
      source_id: reference.id,
    };
  });
  if (hasMore) {
    const last = pageRows.at(-1)!;
    pageRows.push({
      rank_ordinal: last.rank_ordinal + 1,
      source_kind: last.source_kind,
      source_id:
        input.kind === "customer"
          ? indexedUuid("a2", 900 + last.rank_ordinal)
          : indexedUuid("b2", 900 + last.rank_ordinal),
    });
  }
  const lastClaim = claims.at(-1);
  const lastRaw = lastClaim?.raw as
    | {
        customer_ref: { kind: "client" | "sub_client"; id: string };
      }
    | { job_ref: { kind: "opportunity" | "project"; id: string } }
    | undefined;
  const reference = lastRaw
    ? "customer_ref" in lastRaw
      ? lastRaw.customer_ref
      : lastRaw.job_ref
    : null;
  const nextCursorClaims =
    hasMore && lastClaim && reference
      ? {
          source_revision: DISCOVERY_SOURCE_REVISION,
          read_as_of: DISCOVERY_READ_AT,
          rank_ordinal: lastClaim.rank_ordinal!,
          source_kind: reference.kind,
          source_id: reference.id,
        }
      : null;
  const authorizedCandidateCount = queryBound
    ? 501
    : (input.options?.authorizedCandidateCount ??
      pageRows.at(-1)?.rank_ordinal ??
      0);
  const gaps = queryBound ? (["SOURCE_QUERY_BOUND"] as const) : ([] as const);
  const cursorAnchorOrderWitness =
    input.cursorAnchorRaw === null
      ? null
      : {
          rank_ordinal: (input.options?.startOrdinal ?? 1) - 1,
          raw: structuredClone(input.cursorAnchorRaw),
        };
  const collectionRaw = {
    authorized_candidate_count: authorizedCandidateCount,
    raw_page_count: pageRows.length,
    page_rows: pageRows,
    returned_match_count: claims.length,
    has_more: hasMore,
    next_cursor_claims: nextCursorClaims,
    cursor_anchor_order_witness: cursorAnchorOrderWitness,
    gaps,
  };
  const collection = collectionClaim({
    authorization: input.authorization,
    kind: input.kind,
    raw: collectionRaw,
    retainedProofSources: claims.map((claim) => claim.source_version),
  });
  return {
    company_id: input.authorization.actorContext.companyId,
    permission_snapshot_revision:
      input.authorization.actorContext.permissionSnapshotRevision,
    read_at: DISCOVERY_READ_AT,
    source_fence: discoverySourceFence(),
    ranking_revision: rankingRevision(input.authorization),
    authorized_candidate_count: authorizedCandidateCount,
    raw_page_count: pageRows.length,
    page_rows: pageRows,
    match_claims: claims,
    returned_match_count: claims.length,
    has_more: hasMore,
    next_cursor_claims: nextCursorClaims,
    gaps,
    collection_claim: collection,
  };
}

export function cloneDiscoveryFixture<T>(value: T): T {
  return structuredClone(value);
}

export function recoupleDiscoveryClaim(
  claim: AtomicDiscoveryClaim,
  payloadKey: "match" | "collection"
): void {
  claim.proof.projection[payloadKey] = structuredClone(claim.raw);
  if (claim.selection_witness === undefined) {
    delete claim.proof.projection.selection_witness;
  } else {
    claim.proof.projection.selection_witness = structuredClone(
      claim.selection_witness
    );
  }
  if (claim.rank_ordinal !== undefined) {
    claim.proof.projection.rank_ordinal = claim.rank_ordinal;
  }
  const hash = hashOperationalProjection(
    claim.proof.projection as CanonicalProjection
  );
  claim.proof.source_content_hash = hash;
  claim.proof.source_version.version = `${claim.proof.source_version.source_type}:v1:${hash}`;
  claim.source_version.version = claim.proof.source_version.version;
  claim.evidence[0]!.version = claim.proof.source_version.version;
}

export function recoupleDiscoveryCollection(
  snapshot: Record<string, unknown>
): void {
  const collection = snapshot.collection_claim as AtomicDiscoveryClaim;
  const cursorAnchorOrderWitness = structuredClone(
    collection.raw.cursor_anchor_order_witness
  );
  collection.raw = {
    authorized_candidate_count: snapshot.authorized_candidate_count,
    raw_page_count: snapshot.raw_page_count,
    page_rows: structuredClone(snapshot.page_rows),
    returned_match_count: snapshot.returned_match_count,
    has_more: snapshot.has_more,
    next_cursor_claims: structuredClone(snapshot.next_cursor_claims),
    cursor_anchor_order_witness: cursorAnchorOrderWitness,
    gaps: structuredClone(snapshot.gaps),
  };
  collection.proof.projection.retained_proof_sources = structuredClone(
    (snapshot.match_claims as AtomicDiscoveryClaim[]).map(
      (claim) => claim.source_version
    )
  );
  recoupleDiscoveryClaim(collection, "collection");
}

export { CAPABILITY_MANIFEST_REVISION };
