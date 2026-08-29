import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2EvidenceRefSchema,
  P2ProofRefSchema,
  type P2DomainRevision,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  GetSalesDocumentResultSchema,
  SALES_DOCUMENT_FETCH_LIMIT,
  SALES_DOCUMENT_MAX_LINES,
  SALES_DOCUMENT_MAX_MILESTONES,
  SALES_DOCUMENT_MAX_SOURCE_ROWS,
  SalesDocumentHeaderSchema,
  SalesDocumentKindSchema,
  assertNoSalesDocumentForbiddenFields,
  type GetSalesDocumentResult,
  type SalesDocumentHeader,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetSalesDocumentRead,
  isAuthorizedListSalesDocumentsRead,
  type AuthorizedGetSalesDocumentRead,
  type AuthorizedListSalesDocumentsRead,
  type SalesDocumentAuthorizationCandidateBinding,
} from "./sales-authorization";
import {
  SalesDocumentCursorPredecessorSchema,
  type SalesDocumentCursorContext,
  type SalesDocumentCursorPredecessor,
} from "./sales-cursor";
import {
  exactSalesDocumentSourceRevisions,
  salesDocumentCollectionProofRef,
  salesDocumentDetailEntityProofRef,
  salesDocumentDetailEvidenceRef,
  salesDocumentDetailProofContext,
  salesDocumentEntityProofRef,
  salesDocumentListEvidenceRef,
  salesDocumentListProofContext,
  type SalesDocumentAuthorityPath,
  type SalesDocumentDetailSource,
} from "./sales-proof";

const LIST_RPC = "read_agent_sales_documents_as_system" as const;
const DETAIL_RPC = "read_agent_sales_document_as_system" as const;
const TRUSTED_SALES_DOCUMENT_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "SALES_DOCUMENT_ARRAY_NOT_CANONICAL"
  );
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), z.enum(["all", "assigned", "own"]))
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.keys(value).every((key) =>
        (REGISTERED_ACTOR_PERMISSION_KEYS as readonly string[]).includes(key)
      ),
    "SALES_DOCUMENT_PERMISSION_VECTOR_INVALID"
  );
const SatisfiedGroupIndexesSchema = z
  .array(z.number().int().safe().min(0).max(31))
  .min(1)
  .max(32)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "SALES_DOCUMENT_GROUP_VECTOR_NOT_CANONICAL"
  );
const CandidateSchema = z
  .object({
    variant_key: SalesDocumentKindSchema,
    required_oauth_scopes: CanonicalStringArraySchema,
    resolved_permission_scopes: PermissionScopesSchema,
    satisfied_permission_group_indexes: SatisfiedGroupIndexesSchema,
  })
  .strict();
const CandidatesSchema = z
  .array(CandidateSchema)
  .min(1)
  .max(2)
  .refine(
    (values) =>
      new Set(values.map((value) => value.variant_key)).size ===
        values.length &&
      values.every(
        (value, index) =>
          index === 0 || values[index - 1]!.variant_key < value.variant_key
      ),
    "SALES_DOCUMENT_CANDIDATES_NOT_CANONICAL"
  );
const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => {
    try {
      exactSalesDocumentSourceRevisions(revisions);
      return true;
    } catch {
      return false;
    }
  },
  "SALES_DOCUMENT_REVISION_VECTOR_INVALID"
);
const AuthorityPathSchema = z.enum(["opportunity", "project", "unlinked"]);
const RawListRowSchema = z
  .object({
    item: SalesDocumentHeaderSchema,
    selected_authorization_variant: SalesDocumentKindSchema,
    authority_path: AuthorityPathSchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
    predecessor: SalesDocumentCursorPredecessorSchema,
  })
  .strict();

const BindingShape = {
  company_id: P2CanonicalUuidSchema,
  actor_user_id: P2CanonicalUuidSchema,
  oauth_grant_id: P2CanonicalUuidSchema,
  oauth_client_id: P2CanonicalUuidSchema,
  grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
  granted_scope_ceiling: CanonicalStringArraySchema,
  permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  capability_manifest_revision: z.literal("2026-08-22.capability-manifest.v8"),
  authorization_candidates: CandidatesSchema,
  query: z.unknown(),
  read_at: P2CanonicalTimestampSchema,
  source_revisions: ExactSourceRevisionsSchema,
} as const;

const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("list_sales_documents"),
    capability_revision: z.literal("list_sales_documents:2026-08-22.v1"),
    ranking_revision: z.literal("sales-document-ranking:2026-08-22.v1"),
    item_limit: z.number().int().min(1).max(25),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z.array(z.unknown()).max(2),
    cursor_predecessor: SalesDocumentCursorPredecessorSchema.nullable(),
    source_inspected: z
      .number()
      .int()
      .min(0)
      .max(SALES_DOCUMENT_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(RawListRowSchema).max(25),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

const RawDetailSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_sales_document"),
    capability_revision: z.literal("get_sales_document:2026-08-22.v1"),
    selected_authorization_variant: SalesDocumentKindSchema,
    authority_path: AuthorityPathSchema,
    source_inspected: z
      .object({
        documents: z.number().int().min(0).max(1),
        lines: z.number().int().min(0).max(SALES_DOCUMENT_MAX_LINES),
        milestones: z.number().int().min(0).max(SALES_DOCUMENT_MAX_MILESTONES),
      })
      .strict(),
    result: z.unknown(),
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
  })
  .strict();

export interface SalesDocumentReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface SalesDocumentReadRpcRequest extends PromiseLike<SalesDocumentReadRpcResult> {
  abortSignal?: (
    signal: AbortSignal
  ) => PromiseLike<SalesDocumentReadRpcResult>;
}

export interface SalesDocumentReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ): SalesDocumentReadRpcRequest;
}

export interface SalesDocumentListRepositoryUnit {
  readonly item: SalesDocumentHeader;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof SalesDocumentCursorPredecessorSchema>;
  readonly selectedAuthorization: SalesDocumentAuthorizationCandidateBinding;
  readonly authorityPath: SalesDocumentAuthorityPath;
}

export interface SalesDocumentListRepositoryPage {
  readonly units: readonly SalesDocumentListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type SalesDocumentListRepositoryResult =
  | Readonly<{ state: "found"; page: SalesDocumentListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export type SalesDocumentDetailRepositoryResult =
  | Readonly<{ state: "found"; value: GetSalesDocumentResult }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface SalesDocumentReadRepository {
  list(input: {
    readonly authorization: AuthorizedListSalesDocumentsRead;
    readonly cursor: SalesDocumentCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<SalesDocumentListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetSalesDocumentRead;
    readonly signal?: AbortSignal;
  }): Promise<SalesDocumentDetailRepositoryResult>;
}

export class SalesDocumentReadRepositoryError extends Error {
  readonly code: "SALES_DOCUMENT_READ_FAILED" | "SALES_DOCUMENT_READ_INVALID";

  constructor(
    code: SalesDocumentReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "SalesDocumentReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new SalesDocumentReadRepositoryError("SALES_DOCUMENT_READ_INVALID", {
    cause,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalOperationalProjection(left as never) ===
      canonicalOperationalProjection(right as never)
    );
  } catch {
    return false;
  }
}

function serializedCandidates(
  authorization:
    | AuthorizedListSalesDocumentsRead
    | AuthorizedGetSalesDocumentRead
) {
  return authorization.authorizationCandidates.map((candidate) => ({
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  }));
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawDetailSnapshotSchema>,
  authorization:
    | AuthorizedListSalesDocumentsRead
    | AuthorizedGetSalesDocumentRead
): boolean {
  const expectedQuery =
    authorization.capabilityId === "list_sales_documents"
      ? (({ cursor: _cursor, ...query }) => query)(authorization.query)
      : authorization.query;
  return (
    snapshot.company_id === authorization.actorContext.companyId &&
    snapshot.actor_user_id === authorization.actorContext.actorUserId &&
    snapshot.oauth_grant_id === authorization.oauthGrantId &&
    snapshot.oauth_client_id === authorization.oauthClientId &&
    snapshot.grant_revision === authorization.grantRevision &&
    sameJson(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) &&
    snapshot.permission_snapshot_revision ===
      authorization.actorContext.permissionSnapshotRevision &&
    snapshot.capability_manifest_revision ===
      authorization.capabilityManifestRevision &&
    snapshot.capability_id === authorization.capabilityId &&
    snapshot.capability_revision === authorization.capabilityRevision &&
    sameJson(
      snapshot.authorization_candidates,
      serializedCandidates(authorization)
    ) &&
    sameJson(snapshot.query, expectedQuery)
  );
}

function selectedCandidate(
  authorization:
    | AuthorizedListSalesDocumentsRead
    | AuthorizedGetSalesDocumentRead,
  variant: "estimate" | "invoice"
): SalesDocumentAuthorizationCandidateBinding | null {
  return (
    authorization.authorizationCandidates.find(
      (candidate) => candidate.variantKey === variant
    ) ?? null
  );
}

function validAuthority(input: {
  readonly item: SalesDocumentHeader;
  readonly selected: SalesDocumentAuthorizationCandidateBinding;
  readonly authorityPath: SalesDocumentAuthorityPath;
}): boolean {
  const { item, selected, authorityPath } = input;
  if (selected.variantKey !== item.document_ref.kind) return false;
  if (authorityPath === "unlinked") {
    return item.job_ref === null && selected.documentScope === "all";
  }
  if (authorityPath === "opportunity") {
    return (
      item.job_ref?.kind === "opportunity" &&
      (selected.pipelineScope === "all" ||
        selected.pipelineScope === "assigned")
    );
  }
  return (
    item.job_ref?.kind === "project" &&
    (selected.projectsScope === "all" ||
      selected.projectsScope === "assigned") &&
    selected.projectFinancialsScope === "all"
  );
}

function predecessorComesBefore(
  left: SalesDocumentCursorPredecessor,
  right: SalesDocumentCursorPredecessor
): boolean {
  return (
    left.order[0] > right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] < right.order[1]) ||
    (left.order[0] === right.order[0] &&
      left.order[1] === right.order[1] &&
      left.order[2] < right.order[2])
  );
}

function knownErrorState(
  error: unknown,
  detail: boolean
): "not_found" | "source_bound" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      detail &&
      record.code === "P0002" &&
      record.message === "agent_sales_document_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_sales_document_source_bound" ||
        record.message === "agent_sales_document_result_bound")
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_sales_document_read_stale"
    ) {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

function commonArguments(
  authorization:
    | AuthorizedListSalesDocumentsRead
    | AuthorizedGetSalesDocumentRead
) {
  return {
    p_request_id: authorization.actorContext.requestId,
    p_company_id: authorization.actorContext.companyId,
    p_actor_user_id: authorization.actorContext.actorUserId,
    p_oauth_grant_id: authorization.oauthGrantId,
    p_oauth_client_id: authorization.oauthClientId,
    p_grant_revision: authorization.grantRevision,
    p_granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    p_permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision: authorization.capabilityManifestRevision,
    p_capability_id: authorization.capabilityId,
    p_capability_revision: authorization.capabilityRevision,
    p_authorization_candidates: serializedCandidates(authorization),
  };
}

async function execute(
  request: SalesDocumentReadRpcRequest,
  signal?: AbortSignal
): Promise<SalesDocumentReadRpcResult> {
  if (signal?.aborted) {
    throw new SalesDocumentReadRepositoryError("SALES_DOCUMENT_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new SalesDocumentReadRepositoryError("SALES_DOCUMENT_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof SalesDocumentReadRepositoryError) throw error;
    throw new SalesDocumentReadRepositoryError("SALES_DOCUMENT_READ_FAILED", {
      cause: error,
    });
  }
}

function exactDetailSource(
  raw: unknown,
  kind: "estimate" | "invoice"
): SalesDocumentDetailSource {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  ) {
    invalid();
  }
  const keys = Object.keys(raw).sort();
  const expected = (
    kind === "estimate"
      ? ["client_text", "document", "lines", "milestones"]
      : ["client_text", "document", "lines"]
  ).sort();
  if (!sameJson(keys, expected)) invalid();
  assertNoSalesDocumentForbiddenFields(raw);
  return raw as SalesDocumentDetailSource;
}

export function createSupabaseSalesDocumentReadRepository(
  client: SalesDocumentReadRpcClient
): SalesDocumentReadRepository {
  let suppliedRpc: SalesDocumentReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as SalesDocumentReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A sales-document RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A sales-document RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ) =>
    Reflect.apply(suppliedRpc!, client, [
      name,
      args,
    ]) as SalesDocumentReadRpcRequest;

  const repository: SalesDocumentReadRepository = {
    async list(input) {
      if (!isAuthorizedListSalesDocumentsRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactSourceRevisionsSchema.safeParse(cursor.sourceRevisions)
            .success ||
          !SalesDocumentCursorPredecessorSchema.safeParse(cursor.predecessor)
            .success)
      ) {
        invalid();
      }
      const query = input.authorization.query;
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(input.authorization),
          p_document_kinds: [...query.document_kinds],
          p_customer_id: query.customer_ref?.id ?? null,
          p_job_kind: query.job_ref?.kind ?? null,
          p_job_id: query.job_ref?.id ?? null,
          p_item_limit: query.limit,
          p_page_fetch_limit: Math.min(
            query.limit + 1,
            SALES_DOCUMENT_FETCH_LIMIT
          ),
          p_source_limit: SALES_DOCUMENT_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_updated_at: cursor?.predecessor.order[0] ?? null,
          p_after_document_kind: cursor?.predecessor.order[1] ?? null,
          p_after_document_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, false);
        if (state === "source_bound" || state === "stale") {
          return deepFreeze({ state });
        }
        throw new SalesDocumentReadRepositoryError(
          "SALES_DOCUMENT_READ_FAILED"
        );
      }
      try {
        const snapshot = RawListSnapshotSchema.parse(response.data);
        const expectedCursorRevisions = cursor?.sourceRevisions ?? [];
        const context = salesDocumentListProofContext({
          authorization: input.authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const selected = snapshot.rows.map((row) =>
          selectedCandidate(
            input.authorization,
            row.selected_authorization_variant
          )
        );
        const validRows = snapshot.rows.every((row, index) => {
          const candidate = selected[index];
          return (
            candidate !== null &&
            row.item.document_ref.kind === row.selected_authorization_variant &&
            query.document_kinds.includes(row.item.document_ref.kind) &&
            (!query.customer_ref ||
              row.item.customer_ref.id === query.customer_ref.id) &&
            (!query.job_ref || sameJson(row.item.job_ref, query.job_ref)) &&
            validAuthority({
              item: row.item,
              selected: candidate,
              authorityPath: row.authority_path,
            }) &&
            row.predecessor.order[0] === row.item.updated_at &&
            row.predecessor.order[1] === row.item.document_ref.kind &&
            row.predecessor.order[2] === row.item.document_ref.id &&
            row.proof_ref ===
              salesDocumentEntityProofRef({
                context,
                item: row.item,
                selectedAuthorization: candidate,
                authorityPath: row.authority_path,
              }) &&
            row.evidence_ref ===
              salesDocumentListEvidenceRef({
                context,
                item: row.item,
                selectedAuthorization: candidate,
                authorityPath: row.authority_path,
              }) &&
            (cursor === null ||
              predecessorComesBefore(cursor.predecessor, row.predecessor)) &&
            (index === 0 ||
              predecessorComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              ))
          );
        });
        const expectedCollection = salesDocumentCollectionProofRef({
          context,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            document_ref: row.item.document_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          snapshot.ranking_revision !==
            "sales-document-ranking:2026-08-22.v1" ||
          snapshot.item_limit !== query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            expectedCursorRevisions
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          snapshot.source_inspected >= SALES_DOCUMENT_MAX_SOURCE_ROWS ||
          snapshot.rows.length > query.limit ||
          (snapshot.source_has_more && snapshot.rows.length !== query.limit) ||
          !validRows ||
          snapshot.collection_proof_ref !== expectedCollection ||
          new Set(
            snapshot.rows.map(
              (row) =>
                `${row.item.document_ref.kind}:${row.item.document_ref.id}`
            )
          ).size !== snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.proof_ref)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.evidence_ref)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.item.total.currency)).size > 1
        ) {
          invalid();
        }
        const units = snapshot.rows.map((row, index) => ({
          item: row.item,
          proof: {
            proof_ref: row.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
          evidence: [
            {
              evidence_ref: row.evidence_ref,
              source_domain: "sales_documents",
              source_type: row.item.document_ref.kind,
              occurred_at: snapshot.read_at,
            },
          ],
          predecessor: row.predecessor,
          selectedAuthorization: selected[index]!,
          authorityPath: row.authority_path,
        }));
        const page = {
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertNoSalesDocumentForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof SalesDocumentReadRepositoryError) throw error;
        invalid(error);
      }
    },

    async get(input) {
      if (!isAuthorizedGetSalesDocumentRead(input.authorization)) invalid();
      const query = input.authorization.query;
      const response = await execute(
        rpc(DETAIL_RPC, {
          ...commonArguments(input.authorization),
          p_document_kind: query.document_ref.kind,
          p_document_id: query.document_ref.id,
          p_source_limit: SALES_DOCUMENT_MAX_SOURCE_ROWS,
          p_line_limit: SALES_DOCUMENT_MAX_LINES,
          p_line_fetch_limit: SALES_DOCUMENT_MAX_LINES + 1,
          p_milestone_limit: SALES_DOCUMENT_MAX_MILESTONES,
          p_milestone_fetch_limit: SALES_DOCUMENT_MAX_MILESTONES + 1,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, true);
        if (state) return deepFreeze({ state });
        throw new SalesDocumentReadRepositoryError(
          "SALES_DOCUMENT_READ_FAILED"
        );
      }
      try {
        const snapshot = RawDetailSnapshotSchema.parse(response.data);
        const selected = selectedCandidate(
          input.authorization,
          snapshot.selected_authorization_variant
        );
        if (!selected) invalid();
        const source = exactDetailSource(
          snapshot.result,
          query.document_ref.kind
        );
        const evidence = {
          evidence_ref: snapshot.evidence_ref,
          source_domain: "sales_documents" as const,
          source_type: query.document_ref.kind,
          occurred_at: snapshot.read_at,
        };
        const proof = {
          proof_ref: snapshot.proof_ref,
          read_at: snapshot.read_at,
          source_revisions: snapshot.source_revisions,
        };
        const value = GetSalesDocumentResultSchema.parse({
          ...source,
          evidence: [evidence],
          proof,
        });
        const context = salesDocumentDetailProofContext({
          authorization: input.authorization,
          selectedAuthorization: selected,
          authorityPath: snapshot.authority_path,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          snapshot.selected_authorization_variant !== query.document_ref.kind ||
          value.document.document_ref.kind !== query.document_ref.kind ||
          value.document.document_ref.id !== query.document_ref.id ||
          snapshot.source_inspected.documents !== 1 ||
          snapshot.source_inspected.lines !== value.lines.length ||
          snapshot.source_inspected.milestones !==
            ("milestones" in value ? value.milestones.length : 0) ||
          !validAuthority({
            item: value.document,
            selected,
            authorityPath: snapshot.authority_path,
          }) ||
          snapshot.proof_ref !==
            salesDocumentDetailEntityProofRef({ context, result: source }) ||
          snapshot.evidence_ref !==
            salesDocumentDetailEvidenceRef({
              companyId: input.authorization.actorContext.companyId,
              documentRef: value.document.document_ref,
              updatedAt: value.document.updated_at,
            })
        ) {
          invalid();
        }
        assertNoSalesDocumentForbiddenFields(value);
        return deepFreeze({ state: "found" as const, value });
      } catch (error) {
        if (error instanceof SalesDocumentReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_SALES_DOCUMENT_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedSalesDocumentReadRepository(
  value: unknown
): value is SalesDocumentReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_SALES_DOCUMENT_REPOSITORIES.has(value)
  );
}
