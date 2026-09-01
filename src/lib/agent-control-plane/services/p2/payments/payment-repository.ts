import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  PAYMENT_FETCH_LIMIT,
  PAYMENT_MAX_PAGE_ITEMS,
  PAYMENT_MAX_SOURCE_ROWS,
  PAYMENT_METHOD_CATEGORIES,
  PAYMENT_RECONCILIATION_STATES,
  PaymentLedgerItemSchema,
  PaymentMethodCategorySchema,
  PaymentReconciliationStateSchema,
  assertNoPaymentForbiddenFields,
  type PaymentLedgerItem,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedListPaymentsRead,
  type AuthorizedListPaymentsRead,
} from "./payment-authorization";
import {
  PaymentCursorPredecessorSchema,
  type PaymentCursorContext,
  type PaymentCursorPredecessor,
} from "./payment-cursor";
import {
  exactPaymentSourceRevisions,
  paymentCollectionProofRef,
  paymentEntityProofRef,
  paymentListEvidenceRef,
  paymentListProofContext,
  type PaymentAuthorityPath,
} from "./payment-proof";

const LIST_RPC = "read_agent_payments_as_system" as const;
const TRUSTED_PAYMENT_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(128)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "PAYMENT_ARRAY_NOT_CANONICAL"
  );
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), z.enum(["all", "assigned", "own"]))
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.keys(value).every((key) =>
        (REGISTERED_ACTOR_PERMISSION_KEYS as readonly string[]).includes(key)
      ),
    "PAYMENT_PERMISSION_VECTOR_INVALID"
  );
const SatisfiedGroupIndexesSchema = z
  .array(z.number().int().safe().min(0).max(31))
  .min(1)
  .max(32)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "PAYMENT_GROUP_VECTOR_NOT_CANONICAL"
  );
const AuthorizationCandidateSchema = z
  .object({
    variant_key: z.literal("payment"),
    required_oauth_scopes: CanonicalStringArraySchema,
    resolved_permission_scopes: PermissionScopesSchema,
    satisfied_permission_group_indexes: SatisfiedGroupIndexesSchema,
  })
  .strict();
const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => {
    try {
      exactPaymentSourceRevisions(revisions);
      return true;
    } catch {
      return false;
    }
  },
  "PAYMENT_REVISION_VECTOR_INVALID"
);
const CanonicalDateSchema = z
  .string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = `${value}T00:00:00.000Z`;
    const instant = new Date(timestamp);
    return (
      !Number.isNaN(instant.getTime()) && instant.toISOString() === timestamp
    );
  });
const RefSchema = (kind: "customer" | "invoice" | "opportunity" | "project") =>
  z.object({ kind: z.literal(kind), id: P2CanonicalUuidSchema }).strict();
const QueryProjectionSchema = z
  .object({
    invoice_ref: RefSchema("invoice").nullable(),
    customer_ref: RefSchema("customer").nullable(),
    job_ref: z
      .union([RefSchema("opportunity"), RefSchema("project")])
      .nullable(),
    payment_date_window: z
      .object({
        start_date: CanonicalDateSchema,
        end_date: CanonicalDateSchema,
      })
      .strict()
      .nullable(),
    method_categories: z
      .array(PaymentMethodCategorySchema)
      .min(1)
      .max(PAYMENT_METHOD_CATEGORIES.length),
    reconciliation_states: z
      .array(PaymentReconciliationStateSchema)
      .min(1)
      .max(PAYMENT_RECONCILIATION_STATES.length),
  })
  .strict();
const ProofRefSchema = z.string().regex(/^ops_proof:v1:[0-9a-f]{64}$/);
const EvidenceRefSchema = z.string().regex(/^ops_evidence:v1:[0-9a-f]{64}$/);
const RawRowSchema = z
  .object({
    item: PaymentLedgerItemSchema,
    authority_path: z.enum(["opportunity", "project", "unlinked"]),
    proof_ref: ProofRefSchema,
    evidence_ref: EvidenceRefSchema,
    predecessor: PaymentCursorPredecessorSchema,
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
    granted_scope_ceiling: CanonicalStringArraySchema,
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    capability_id: z.literal("list_payments"),
    capability_revision: z.literal("list_payments:2026-08-22.v1"),
    authorization_candidate: AuthorizationCandidateSchema,
    query: QueryProjectionSchema,
    ranking_revision: z.literal("payment-ranking:2026-08-22.v1"),
    item_limit: z.number().int().min(1).max(PAYMENT_MAX_PAGE_ITEMS),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z.array(z.unknown()).max(3),
    cursor_predecessor: PaymentCursorPredecessorSchema.nullable(),
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactSourceRevisionsSchema,
    source_inspected: z.number().int().min(0).max(PAYMENT_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(RawRowSchema).max(PAYMENT_MAX_PAGE_ITEMS),
    collection_proof_ref: ProofRefSchema,
  })
  .strict();

export interface PaymentReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface PaymentReadRpcRequest extends PromiseLike<PaymentReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<PaymentReadRpcResult>;
}

export interface PaymentReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC,
    args: Readonly<Record<string, unknown>>
  ): PaymentReadRpcRequest;
}

export interface PaymentListRepositoryUnit {
  readonly item: PaymentLedgerItem;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof PaymentCursorPredecessorSchema>;
}

export interface PaymentListRepositoryPage {
  readonly units: readonly PaymentListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type PaymentListRepositoryResult =
  | Readonly<{ state: "found"; page: PaymentListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "source_invalid" }>
  | Readonly<{ state: "stale" }>;

export interface PaymentReadRepository {
  list(input: {
    readonly authorization: AuthorizedListPaymentsRead;
    readonly cursor: PaymentCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<PaymentListRepositoryResult>;
}

export class PaymentReadRepositoryError extends Error {
  readonly code: "PAYMENT_READ_FAILED" | "PAYMENT_READ_INVALID";

  constructor(
    code: PaymentReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "PaymentReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new PaymentReadRepositoryError("PAYMENT_READ_INVALID", { cause });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
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

function serializedCandidate(authorization: AuthorizedListPaymentsRead) {
  const candidate = authorization.authorizationCandidate;
  return {
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  };
}

function queryProjection(authorization: AuthorizedListPaymentsRead) {
  const query = authorization.query;
  return {
    invoice_ref: query.invoice_ref ?? null,
    customer_ref: query.customer_ref ?? null,
    job_ref: query.job_ref ?? null,
    payment_date_window: query.payment_date_window ?? null,
    method_categories: query.method_categories,
    reconciliation_states: query.reconciliation_states,
  };
}

function exactBinding(
  snapshot: z.infer<typeof RawSnapshotSchema>,
  authorization: AuthorizedListPaymentsRead
) {
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
      snapshot.authorization_candidate,
      serializedCandidate(authorization)
    )
  );
}

function predecessorComesBefore(
  left: PaymentCursorPredecessor,
  right: PaymentCursorPredecessor
) {
  return (
    left.order[0] > right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] < right.order[1])
  );
}

function authorityPathMatches(
  authorization: AuthorizedListPaymentsRead,
  item: PaymentLedgerItem,
  authorityPath: PaymentAuthorityPath
) {
  const candidate = authorization.authorizationCandidate;
  if (candidate.financeScope !== "all") return false;
  if (item.job_ref === null) {
    return authorityPath === "unlinked" && candidate.invoiceScope === "all";
  }
  if (item.job_ref.kind === "opportunity") {
    return authorityPath === "opportunity" && candidate.pipelineScope !== null;
  }
  return authorityPath === "project" && candidate.projectsScope !== null;
}

function itemMatchesQuery(
  authorization: AuthorizedListPaymentsRead,
  item: PaymentLedgerItem
) {
  const query = authorization.query;
  const window = query.payment_date_window;
  return (
    (!query.invoice_ref || item.invoice_ref.id === query.invoice_ref.id) &&
    (!query.customer_ref || item.customer_ref.id === query.customer_ref.id) &&
    (!query.job_ref ||
      (item.job_ref?.kind === query.job_ref.kind &&
        item.job_ref.id === query.job_ref.id)) &&
    (!window ||
      (item.payment_date >= window.start_date &&
        item.payment_date <= window.end_date)) &&
    query.method_categories.includes(item.method_category) &&
    query.reconciliation_states.includes(item.reconciliation_state)
  );
}

function knownErrorState(
  error: unknown
): "source_bound" | "source_invalid" | "stale" | null {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }
  const record = error as Readonly<Record<string, unknown>>;
  if (
    record.code === "54000" &&
    (record.message === "agent_payment_source_query_bound" ||
      record.message === "agent_payment_result_bound")
  ) {
    return "source_bound";
  }
  if (
    record.code === "22000" &&
    record.message === "agent_payment_source_data_invalid"
  ) {
    return "source_invalid";
  }
  if (
    record.code === "40001" &&
    record.message === "agent_payment_read_stale"
  ) {
    return "stale";
  }
  return null;
}

async function execute(request: PaymentReadRpcRequest, signal?: AbortSignal) {
  if (signal?.aborted)
    throw new PaymentReadRepositoryError("PAYMENT_READ_FAILED");
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new PaymentReadRepositoryError("PAYMENT_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof PaymentReadRepositoryError) throw error;
    throw new PaymentReadRepositoryError("PAYMENT_READ_FAILED", {
      cause: error,
    });
  }
}

export function createSupabasePaymentReadRepository(
  client: PaymentReadRpcClient
): PaymentReadRepository {
  let suppliedRpc: PaymentReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as PaymentReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A payment RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A payment RPC client is required");
  }
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(suppliedRpc!, client, [
      LIST_RPC,
      args,
    ]) as PaymentReadRpcRequest;

  const repository: PaymentReadRepository = {
    async list(input) {
      if (!isAuthorizedListPaymentsRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactSourceRevisionsSchema.safeParse(cursor.sourceRevisions)
            .success ||
          !PaymentCursorPredecessorSchema.safeParse(cursor.predecessor).success)
      ) {
        invalid();
      }
      const authorization = input.authorization;
      const query = authorization.query;
      const response = await execute(
        rpc({
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
          p_capability_manifest_revision:
            authorization.capabilityManifestRevision,
          p_capability_id: authorization.capabilityId,
          p_capability_revision: authorization.capabilityRevision,
          p_authorization_candidate: serializedCandidate(authorization),
          p_invoice_id: query.invoice_ref?.id ?? null,
          p_client_id: query.customer_ref?.id ?? null,
          p_job_kind: query.job_ref?.kind ?? null,
          p_job_id: query.job_ref?.id ?? null,
          p_start_date: query.payment_date_window?.start_date ?? null,
          p_end_date: query.payment_date_window?.end_date ?? null,
          p_method_categories: [...query.method_categories],
          p_reconciliation_states: [...query.reconciliation_states],
          p_item_limit: query.limit,
          p_page_fetch_limit: Math.min(query.limit + 1, PAYMENT_FETCH_LIMIT),
          p_source_limit: PAYMENT_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_payment_date: cursor?.predecessor.order[0] ?? null,
          p_after_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error);
        if (state) return deepFreeze({ state });
        throw new PaymentReadRepositoryError("PAYMENT_READ_FAILED");
      }
      try {
        const snapshot = RawSnapshotSchema.parse(response.data);
        const context = paymentListProofContext({
          authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const validRows = snapshot.rows.every(
          (row, index) =>
            authorityPathMatches(authorization, row.item, row.authority_path) &&
            itemMatchesQuery(authorization, row.item) &&
            (row.item.voided_at === null ||
              row.item.voided_at <= snapshot.read_at) &&
            row.predecessor.order[0] === row.item.payment_date &&
            row.predecessor.order[1] === row.item.payment_ref.id &&
            row.predecessor.tie_breaker === row.item.payment_ref.id &&
            (cursor === null ||
              predecessorComesBefore(cursor.predecessor, row.predecessor)) &&
            row.proof_ref ===
              paymentEntityProofRef({
                context,
                item: row.item,
                authorityPath: row.authority_path,
              }) &&
            row.evidence_ref ===
              paymentListEvidenceRef({
                context,
                item: row.item,
                authorityPath: row.authority_path,
              }) &&
            (index === 0 ||
              predecessorComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              ))
        );
        const expectedCollection = paymentCollectionProofRef({
          context,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            payment_ref: row.item.payment_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, authorization) ||
          !sameJson(snapshot.query, queryProjection(authorization)) ||
          snapshot.item_limit !== query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            cursor?.sourceRevisions ?? []
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          snapshot.source_inspected >= PAYMENT_MAX_SOURCE_ROWS ||
          snapshot.rows.length > query.limit ||
          (snapshot.source_has_more && snapshot.rows.length !== query.limit) ||
          !validRows ||
          snapshot.collection_proof_ref !== expectedCollection ||
          new Set(snapshot.rows.map((row) => row.item.payment_ref.id)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.proof_ref)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.evidence_ref)).size !==
            snapshot.rows.length ||
          (snapshot.rows.length > 0 &&
            snapshot.rows.some(
              (row) =>
                row.item.amount.currency !==
                snapshot.rows[0]!.item.amount.currency
            ))
        ) {
          invalid();
        }
        const units = snapshot.rows.map((row) => ({
          item: row.item,
          proof: {
            proof_ref: row.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
          evidence: [
            {
              evidence_ref: row.evidence_ref,
              source_domain: "payments" as const,
              source_type: "payment" as const,
              occurred_at: snapshot.read_at,
            },
          ],
          predecessor: row.predecessor,
        }));
        const page = {
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertNoPaymentForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof PaymentReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };
  TRUSTED_PAYMENT_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedPaymentReadRepository(
  value: unknown
): value is PaymentReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_PAYMENT_REPOSITORIES.has(value)
  );
}
