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
  PURCHASE_ORDER_LINE_FETCH_LIMIT,
  PURCHASE_ORDER_MAX_SOURCE_ROWS,
  PurchaseOrderDetailResultSchema,
  PurchaseOrderSchema,
  PurchaseOrderWithCostsSchema,
  assertNoPurchaseOrderForbiddenFields,
  type PurchaseOrderDetailResult,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetPurchaseOrderRead,
  isAuthorizedListPurchaseOrdersRead,
  type AuthorizedGetPurchaseOrderRead,
  type AuthorizedListPurchaseOrdersRead,
  type PurchaseOrderAuthorizationCandidateBinding,
} from "./purchase-order-authorization";
import {
  PurchaseOrderCursorPredecessorSchema,
  type PurchaseOrderCursorContext,
} from "./purchase-order-cursor";
import {
  exactPurchaseOrderSourceRevisions,
  purchaseOrderCollectionProofRef,
  purchaseOrderDetailProofContext,
  purchaseOrderEntityProofRef,
  purchaseOrderEvidenceRef,
  purchaseOrderListProofContext,
  type PurchaseOrderSource,
  type PurchaseOrderSourceInspected,
} from "./purchase-order-proof";

const LIST_RPC = "read_agent_purchase_orders_as_system" as const;
const DETAIL_RPC = "read_agent_purchase_order_as_system" as const;
const TRUSTED_PURCHASE_ORDER_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "PURCHASE_ORDER_ARRAY_NOT_CANONICAL"
  );
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), z.enum(["all", "assigned", "own"]))
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.keys(value).every((key) =>
        (REGISTERED_ACTOR_PERMISSION_KEYS as readonly string[]).includes(key)
      ),
    "PURCHASE_ORDER_PERMISSION_VECTOR_INVALID"
  );
const SatisfiedGroupIndexesSchema = z
  .array(z.number().int().safe().min(0).max(31))
  .min(1)
  .max(32)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "PURCHASE_ORDER_GROUP_VECTOR_NOT_CANONICAL"
  );
const AuthorizationVariantSchema = z.enum(["orders", "costs"]);
const CandidateSchema = z
  .object({
    variant_key: AuthorizationVariantSchema,
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
      values[0]?.variant_key === "orders" &&
      (values.length === 1 || values[1]?.variant_key === "costs"),
    "PURCHASE_ORDER_CANDIDATES_NOT_CANONICAL"
  );
const SourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    (revisions.length === 1 && revisions[0]?.domain === "purchasing") ||
    (revisions.length === 2 &&
      revisions[0]?.domain === "catalog" &&
      revisions[1]?.domain === "purchasing"),
  "PURCHASE_ORDER_REVISION_VECTOR_INVALID"
);
const SourceInspectedSchema = z
  .object({
    orders: z.number().int().min(0).max(PURCHASE_ORDER_MAX_SOURCE_ROWS),
    lines: z.number().int().min(0).max(PURCHASE_ORDER_MAX_SOURCE_ROWS),
    catalog_costs: z.number().int().min(0).max(PURCHASE_ORDER_MAX_SOURCE_ROWS),
  })
  .strict();
const CostWitnessSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/)
  .nullable();
const CompanyCurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const PurchaseOrderSourceSchema = z.union([
  PurchaseOrderSchema,
  PurchaseOrderWithCostsSchema,
]);

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
  source_revisions: SourceRevisionsSchema,
  selected_authorization_variants: z
    .array(AuthorizationVariantSchema)
    .min(1)
    .max(2),
  source_inspected: SourceInspectedSchema,
  catalog_cost_witness: CostWitnessSchema,
  company_currency: CompanyCurrencySchema,
} as const;

const RawListRowSchema = z
  .object({
    purchase_order: PurchaseOrderSourceSchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
    predecessor: PurchaseOrderCursorPredecessorSchema,
  })
  .strict();
const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("list_purchase_orders"),
    capability_revision: z.literal("list_purchase_orders:2026-08-22.v1"),
    ranking_revision: z.literal("purchase-order-ranking:2026-08-22.v1"),
    item_limit: z.number().int().min(1).max(25),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z.array(z.unknown()).max(2),
    cursor_predecessor: PurchaseOrderCursorPredecessorSchema.nullable(),
    source_has_more: z.boolean(),
    rows: z.array(RawListRowSchema).max(25),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();
const RawDetailSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_purchase_order"),
    capability_revision: z.literal("get_purchase_order:2026-08-22.v1"),
    purchase_order: PurchaseOrderSourceSchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
  })
  .strict();

export interface PurchaseOrderReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface PurchaseOrderReadRpcRequest extends PromiseLike<PurchaseOrderReadRpcResult> {
  abortSignal?: (
    signal: AbortSignal
  ) => PromiseLike<PurchaseOrderReadRpcResult>;
}

export interface PurchaseOrderReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ): PurchaseOrderReadRpcRequest;
}

export interface PurchaseOrderListRepositoryUnit {
  readonly item: PurchaseOrderSource;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof PurchaseOrderCursorPredecessorSchema>;
  readonly selectedAuthorizations: readonly PurchaseOrderAuthorizationCandidateBinding[];
}

export interface PurchaseOrderListRepositoryPage {
  readonly units: readonly PurchaseOrderListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: PurchaseOrderSourceInspected;
  readonly sourceHasMore: boolean;
  readonly catalogCostWitness: string | null;
}

export type PurchaseOrderListRepositoryResult =
  | Readonly<{ state: "found"; page: PurchaseOrderListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export type PurchaseOrderDetailRepositoryResult =
  | Readonly<{ state: "found"; value: PurchaseOrderDetailResult }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface PurchaseOrderReadRepository {
  list(input: {
    readonly authorization: AuthorizedListPurchaseOrdersRead;
    readonly cursor: PurchaseOrderCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<PurchaseOrderListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetPurchaseOrderRead;
    readonly signal?: AbortSignal;
  }): Promise<PurchaseOrderDetailRepositoryResult>;
}

export class PurchaseOrderReadRepositoryError extends Error {
  readonly code: "PURCHASE_ORDER_READ_FAILED" | "PURCHASE_ORDER_READ_INVALID";

  constructor(
    code: PurchaseOrderReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "PurchaseOrderReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new PurchaseOrderReadRepositoryError("PURCHASE_ORDER_READ_INVALID", {
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
    | AuthorizedListPurchaseOrdersRead
    | AuthorizedGetPurchaseOrderRead
) {
  return authorization.authorizationCandidates.map((candidate) => ({
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  }));
}

function projectedQuery(
  authorization:
    | AuthorizedListPurchaseOrdersRead
    | AuthorizedGetPurchaseOrderRead
) {
  if (authorization.capabilityId === "get_purchase_order") {
    return authorization.query;
  }
  const { cursor: _cursor, ...query } = authorization.query;
  return query;
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawDetailSnapshotSchema>,
  authorization:
    | AuthorizedListPurchaseOrdersRead
    | AuthorizedGetPurchaseOrderRead
): boolean {
  const costsSelected = authorization.query.sections.includes("costs");
  try {
    exactPurchaseOrderSourceRevisions(snapshot.source_revisions, costsSelected);
  } catch {
    return false;
  }
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
    sameJson(
      snapshot.selected_authorization_variants,
      authorization.variantKeys
    ) &&
    sameJson(snapshot.query, projectedQuery(authorization)) &&
    costsSelected === (snapshot.catalog_cost_witness !== null) &&
    (costsSelected || snapshot.source_inspected.catalog_costs === 0)
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
      record.message === "agent_purchase_order_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_purchase_order_source_bound" ||
        record.message === "agent_purchase_order_result_bound")
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_purchase_order_read_stale"
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
    | AuthorizedListPurchaseOrdersRead
    | AuthorizedGetPurchaseOrderRead
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
  request: PurchaseOrderReadRpcRequest,
  signal?: AbortSignal
): Promise<PurchaseOrderReadRpcResult> {
  if (signal?.aborted) {
    throw new PurchaseOrderReadRepositoryError("PURCHASE_ORDER_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new PurchaseOrderReadRepositoryError("PURCHASE_ORDER_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof PurchaseOrderReadRepositoryError) throw error;
    throw new PurchaseOrderReadRepositoryError("PURCHASE_ORDER_READ_FAILED", {
      cause: error,
    });
  }
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function orderMatchesQuery(
  order: PurchaseOrderSource,
  authorization: AuthorizedListPurchaseOrdersRead
) {
  const query = authorization.query;
  return (
    query.statuses.includes(order.status) &&
    (!query.supplier ||
      (order.supplier_label !== null &&
        normalized(order.supplier_label) ===
          normalized(query.supplier.value))) &&
    (!query.delivery_window ||
      (order.expected_delivery_date !== null &&
        order.expected_delivery_date >= query.delivery_window.starts_on &&
        order.expected_delivery_date <= query.delivery_window.ends_on))
  );
}

function expectedPredecessor(order: PurchaseOrderSource) {
  return {
    order: [
      order.expected_delivery_date ?? "9999-12-31",
      order.updated_at,
      order.purchase_order_ref.id,
    ],
    tie_breaker: order.purchase_order_ref.id,
  } as const;
}

function predecessorComesBefore(
  left: z.infer<typeof PurchaseOrderCursorPredecessorSchema>,
  right: z.infer<typeof PurchaseOrderCursorPredecessorSchema>
) {
  return (
    left.order[0] < right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] > right.order[1]) ||
    (left.order[0] === right.order[0] &&
      left.order[1] === right.order[1] &&
      left.order[2] < right.order[2])
  );
}

function exactOrderSource(
  raw: unknown,
  costsSelected: boolean,
  companyCurrency: string
): PurchaseOrderSource {
  if (costsSelected) {
    const parsed = PurchaseOrderWithCostsSchema.safeParse(raw);
    if (!parsed.success) invalid(parsed.error);
    if (
      (parsed.data.costs.subtotal !== null &&
        parsed.data.costs.subtotal.currency !== companyCurrency) ||
      parsed.data.lines.some(
        (line) =>
          (line.unit_cost !== null &&
            line.unit_cost.currency !== companyCurrency) ||
          (line.line_total !== null &&
            line.line_total.currency !== companyCurrency)
      )
    ) {
      invalid();
    }
    assertNoPurchaseOrderForbiddenFields(parsed.data, { costsSelected: true });
    return parsed.data;
  }
  const parsed = PurchaseOrderSchema.safeParse(raw);
  if (!parsed.success) invalid(parsed.error);
  assertNoPurchaseOrderForbiddenFields(parsed.data, { costsSelected: false });
  return parsed.data;
}

export function createSupabasePurchaseOrderReadRepository(
  client: PurchaseOrderReadRpcClient
): PurchaseOrderReadRepository {
  let suppliedRpc: PurchaseOrderReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as PurchaseOrderReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A purchase-order RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A purchase-order RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ) =>
    Reflect.apply(suppliedRpc!, client, [
      name,
      args,
    ]) as PurchaseOrderReadRpcRequest;

  const repository: PurchaseOrderReadRepository = {
    async list(input) {
      if (!isAuthorizedListPurchaseOrdersRead(input.authorization)) invalid();
      const authorization = input.authorization;
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !PurchaseOrderCursorPredecessorSchema.safeParse(cursor.predecessor)
            .success)
      ) {
        invalid();
      }
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(authorization),
          p_statuses: [...authorization.query.statuses],
          p_supplier_label: authorization.query.supplier?.value ?? null,
          p_delivery_starts_on:
            authorization.query.delivery_window?.starts_on ?? null,
          p_delivery_ends_on:
            authorization.query.delivery_window?.ends_on ?? null,
          p_include_costs: authorization.query.sections.includes("costs"),
          p_item_limit: authorization.query.limit,
          p_page_fetch_limit: authorization.query.limit + 1,
          p_source_limit: PURCHASE_ORDER_MAX_SOURCE_ROWS,
          p_line_fetch_limit: PURCHASE_ORDER_LINE_FETCH_LIMIT,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor?.sourceRevisions ?? [],
          p_after_delivery_sort_date: cursor?.predecessor.order[0] ?? null,
          p_after_updated_at: cursor?.predecessor.order[1] ?? null,
          p_after_order_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error !== null && response.error !== undefined) {
        const state = knownErrorState(response.error, false);
        if (state === "source_bound" || state === "stale") {
          return deepFreeze({ state });
        }
        throw new PurchaseOrderReadRepositoryError(
          "PURCHASE_ORDER_READ_FAILED",
          { cause: response.error }
        );
      }
      const snapshot = RawListSnapshotSchema.safeParse(response.data);
      if (!snapshot.success || !exactBinding(snapshot.data, authorization)) {
        invalid(snapshot.success ? undefined : snapshot.error);
      }
      const raw = snapshot.data;
      if (
        raw.item_limit !== authorization.query.limit ||
        raw.ranking_revision !== "purchase-order-ranking:2026-08-22.v1" ||
        raw.cursor_read_at !== (cursor?.readAt ?? null) ||
        !sameJson(raw.cursor_source_revisions, cursor?.sourceRevisions ?? []) ||
        !sameJson(raw.cursor_predecessor, cursor?.predecessor ?? null) ||
        (cursor !== null &&
          (raw.read_at !== cursor.readAt ||
            !sameJson(raw.source_revisions, cursor.sourceRevisions)))
      ) {
        invalid();
      }
      const context = purchaseOrderListProofContext({
        authorization,
        cursor,
        readAt: raw.read_at,
        sourceRevisions: raw.source_revisions,
        sourceInspected: raw.source_inspected,
        sourceHasMore: raw.source_has_more,
        catalogCostWitness: raw.catalog_cost_witness,
      });
      const costsSelected = authorization.query.sections.includes("costs");
      const units: PurchaseOrderListRepositoryUnit[] = [];
      for (const [index, row] of raw.rows.entries()) {
        const order = exactOrderSource(
          row.purchase_order,
          costsSelected,
          raw.company_currency
        );
        const predecessor = PurchaseOrderCursorPredecessorSchema.parse(
          row.predecessor
        );
        const prior = index === 0 ? null : raw.rows[index - 1]!.predecessor;
        if (
          !orderMatchesQuery(order, authorization) ||
          !sameJson(predecessor, expectedPredecessor(order)) ||
          (prior !== null && !predecessorComesBefore(prior, predecessor)) ||
          (cursor !== null &&
            index === 0 &&
            !predecessorComesBefore(
              cursor.predecessor as z.infer<
                typeof PurchaseOrderCursorPredecessorSchema
              >,
              predecessor
            ))
        ) {
          invalid();
        }
        const proofRef = purchaseOrderEntityProofRef({ context, order });
        const evidenceRef = purchaseOrderEvidenceRef({ context, order });
        if (row.proof_ref !== proofRef || row.evidence_ref !== evidenceRef) {
          invalid();
        }
        units.push({
          item: order,
          proof: {
            proof_ref: proofRef,
            read_at: raw.read_at,
            source_revisions: raw.source_revisions,
          },
          evidence: [
            {
              evidence_ref: evidenceRef,
              source_domain: "purchasing",
              source_type: "purchase_order",
              occurred_at: raw.read_at,
            },
          ],
          predecessor,
          selectedAuthorizations: authorization.authorizationCandidates,
        });
      }
      const expectedCollectionProof = purchaseOrderCollectionProofRef({
        context,
        returnedCount: units.length,
        hasMore: raw.source_has_more,
        children: units.map((unit) => ({
          purchase_order_ref: unit.item.purchase_order_ref,
          proof_ref: unit.proof.proof_ref,
          evidence_ref: unit.evidence[0]!.evidence_ref,
        })),
      });
      if (
        raw.collection_proof_ref !== expectedCollectionProof ||
        raw.source_inspected.orders >= PURCHASE_ORDER_MAX_SOURCE_ROWS ||
        raw.source_inspected.lines >= PURCHASE_ORDER_MAX_SOURCE_ROWS ||
        raw.source_inspected.catalog_costs >= PURCHASE_ORDER_MAX_SOURCE_ROWS ||
        raw.source_inspected.orders <
          raw.rows.length + (raw.source_has_more ? 1 : 0) ||
        raw.rows.length > authorization.query.limit ||
        (raw.source_has_more &&
          raw.rows.length !== authorization.query.limit) ||
        raw.source_inspected.lines <
          raw.rows.reduce((sum, row) => sum + row.purchase_order.line_count, 0)
      ) {
        invalid();
      }
      return deepFreeze({
        state: "found" as const,
        page: {
          units,
          readAt: raw.read_at,
          sourceRevisions: raw.source_revisions,
          sourceInspected: raw.source_inspected,
          sourceHasMore: raw.source_has_more,
          catalogCostWitness: raw.catalog_cost_witness,
        },
      });
    },

    async get(input) {
      if (!isAuthorizedGetPurchaseOrderRead(input.authorization)) invalid();
      const authorization = input.authorization;
      const response = await execute(
        rpc(DETAIL_RPC, {
          ...commonArguments(authorization),
          p_purchase_order_id: authorization.query.purchase_order_ref.id,
          p_include_costs: authorization.query.sections.includes("costs"),
          p_source_limit: PURCHASE_ORDER_MAX_SOURCE_ROWS,
          p_line_fetch_limit: PURCHASE_ORDER_LINE_FETCH_LIMIT,
        }),
        input.signal
      );
      if (response.error !== null && response.error !== undefined) {
        const state = knownErrorState(response.error, true);
        if (state !== null) return deepFreeze({ state });
        throw new PurchaseOrderReadRepositoryError(
          "PURCHASE_ORDER_READ_FAILED",
          { cause: response.error }
        );
      }
      const snapshot = RawDetailSnapshotSchema.safeParse(response.data);
      if (!snapshot.success || !exactBinding(snapshot.data, authorization)) {
        invalid(snapshot.success ? undefined : snapshot.error);
      }
      const raw = snapshot.data;
      const costsSelected = authorization.query.sections.includes("costs");
      const order = exactOrderSource(
        raw.purchase_order,
        costsSelected,
        raw.company_currency
      );
      if (
        order.purchase_order_ref.id !==
          authorization.query.purchase_order_ref.id ||
        raw.source_inspected.orders !== 1 ||
        raw.source_inspected.lines >= PURCHASE_ORDER_MAX_SOURCE_ROWS ||
        raw.source_inspected.catalog_costs >= PURCHASE_ORDER_MAX_SOURCE_ROWS ||
        raw.source_inspected.lines < order.line_count
      ) {
        invalid();
      }
      const context = purchaseOrderDetailProofContext({
        authorization,
        readAt: raw.read_at,
        sourceRevisions: raw.source_revisions,
        sourceInspected: raw.source_inspected,
        catalogCostWitness: raw.catalog_cost_witness,
      });
      const proofRef = purchaseOrderEntityProofRef({ context, order });
      const evidenceRef = purchaseOrderEvidenceRef({ context, order });
      if (raw.proof_ref !== proofRef || raw.evidence_ref !== evidenceRef) {
        invalid();
      }
      const value = PurchaseOrderDetailResultSchema.parse({
        purchase_order: order,
        evidence: [
          {
            evidence_ref: evidenceRef,
            source_domain: "purchasing",
            source_type: "purchase_order",
            occurred_at: raw.read_at,
          },
        ],
        proof: {
          proof_ref: proofRef,
          read_at: raw.read_at,
          source_revisions: raw.source_revisions,
        },
      });
      assertNoPurchaseOrderForbiddenFields(value, { costsSelected });
      return deepFreeze({ state: "found" as const, value });
    },
  };
  TRUSTED_PURCHASE_ORDER_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedPurchaseOrderReadRepository(
  value: unknown
): value is PurchaseOrderReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_PURCHASE_ORDER_REPOSITORIES.has(value)
  );
}
