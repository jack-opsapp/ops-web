import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import type {
  PurchaseOrder,
  PurchaseOrderWithCosts,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type {
  AuthorizedGetPurchaseOrderRead,
  AuthorizedListPurchaseOrdersRead,
  PurchaseOrderAuthorizationCandidateBinding,
} from "./purchase-order-authorization";
import type { PurchaseOrderCursorContext } from "./purchase-order-cursor";

export type PurchaseOrderSourceRevision = Readonly<{
  domain: "catalog" | "purchasing";
  source_revision: number;
}>;

export function exactPurchaseOrderSourceRevisions(
  revisions: readonly P2DomainRevision[],
  costsSelected: boolean
): readonly PurchaseOrderSourceRevision[] {
  const valid = costsSelected
    ? revisions.length === 2 &&
      revisions[0]?.domain === "catalog" &&
      revisions[1]?.domain === "purchasing"
    : revisions.length === 1 && revisions[0]?.domain === "purchasing";
  if (!valid) throw new TypeError("PURCHASE_ORDER_REVISION_VECTOR_INVALID");
  return revisions.map((revision) => ({
    domain: revision.domain as "catalog" | "purchasing",
    source_revision: revision.source_revision,
  }));
}

export interface PurchaseOrderSourceInspected {
  readonly orders: number;
  readonly lines: number;
  readonly catalog_costs: number;
}

interface PurchaseOrderProofContextCommon {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly authorization_candidates: readonly PurchaseOrderAuthorizationCandidateBinding[];
  readonly read_at: string;
  readonly source_revisions: readonly PurchaseOrderSourceRevision[];
  readonly source_inspected: PurchaseOrderSourceInspected;
  readonly catalog_cost_witness: string | null;
}

export interface PurchaseOrderListProofContext extends PurchaseOrderProofContextCommon {
  readonly capability_id: "list_purchase_orders";
  readonly capability_revision: "list_purchase_orders:2026-08-22.v1";
  readonly ranking_revision: "purchase-order-ranking:2026-08-22.v1";
  readonly query: Omit<AuthorizedListPurchaseOrdersRead["query"], "cursor">;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly PurchaseOrderSourceRevision[];
  readonly cursor_predecessor: PurchaseOrderCursorContext["predecessor"] | null;
  readonly source_has_more: boolean;
}

export interface PurchaseOrderDetailProofContext extends PurchaseOrderProofContextCommon {
  readonly capability_id: "get_purchase_order";
  readonly capability_revision: "get_purchase_order:2026-08-22.v1";
  readonly query: AuthorizedGetPurchaseOrderRead["query"];
}

export type PurchaseOrderSource = PurchaseOrder | PurchaseOrderWithCosts;

export interface PurchaseOrderCollectionChildProof {
  readonly purchase_order_ref: PurchaseOrder["purchase_order_ref"];
  readonly proof_ref: string;
  readonly evidence_ref: string;
}

function proofRef(material: unknown): `ops_proof:v1:${string}` {
  return `ops_proof:v1:${createHash("sha256")
    .update(canonicalOperationalProjection(material as never), "utf8")
    .digest("hex")}`;
}

function evidenceRef(material: unknown): `ops_evidence:v1:${string}` {
  return `ops_evidence:v1:${createHash("sha256")
    .update(canonicalOperationalProjection(material as never), "utf8")
    .digest("hex")}`;
}

function commonContext(input: {
  readonly authorization:
    | AuthorizedListPurchaseOrdersRead
    | AuthorizedGetPurchaseOrderRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: PurchaseOrderSourceInspected;
  readonly catalogCostWitness: string | null;
}) {
  const authorization = input.authorization;
  const costsSelected = authorization.query.sections.includes("costs");
  if (
    costsSelected !== (input.catalogCostWitness !== null) ||
    (!costsSelected && input.sourceInspected.catalog_costs !== 0)
  ) {
    throw new TypeError("PURCHASE_ORDER_COST_WITNESS_INVALID");
  }
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    authorization_candidates: authorization.authorizationCandidates,
    read_at: input.readAt,
    source_revisions: exactPurchaseOrderSourceRevisions(
      input.sourceRevisions,
      costsSelected
    ),
    source_inspected: input.sourceInspected,
    catalog_cost_witness: input.catalogCostWitness,
  } as const;
}

export function purchaseOrderListProofContext(input: {
  readonly authorization: AuthorizedListPurchaseOrdersRead;
  readonly cursor: PurchaseOrderCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: PurchaseOrderSourceInspected;
  readonly sourceHasMore: boolean;
  readonly catalogCostWitness: string | null;
}): PurchaseOrderListProofContext {
  const { cursor: _cursor, ...query } = input.authorization.query;
  return {
    ...commonContext(input),
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    ranking_revision: "purchase-order-ranking:2026-08-22.v1",
    query,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactPurchaseOrderSourceRevisions(
          input.cursor.sourceRevisions,
          input.authorization.query.sections.includes("costs")
        )
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    source_has_more: input.sourceHasMore,
  };
}

export function purchaseOrderDetailProofContext(input: {
  readonly authorization: AuthorizedGetPurchaseOrderRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: PurchaseOrderSourceInspected;
  readonly catalogCostWitness: string | null;
}): PurchaseOrderDetailProofContext {
  return {
    ...commonContext(input),
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    query: input.authorization.query,
  };
}

export function purchaseOrderEntityProofRef(input: {
  readonly context:
    | PurchaseOrderListProofContext
    | PurchaseOrderDetailProofContext;
  readonly order: PurchaseOrderSource;
}) {
  return proofRef({
    ...input.context,
    proof_kind:
      input.context.capability_id === "list_purchase_orders"
        ? "purchase_order_list_entity"
        : "purchase_order_detail_entity",
    order: input.order,
  });
}

export function purchaseOrderEvidenceRef(input: {
  readonly context:
    | PurchaseOrderListProofContext
    | PurchaseOrderDetailProofContext;
  readonly order: PurchaseOrderSource;
}) {
  return evidenceRef({
    ...input.context,
    evidence_kind: "purchase_order",
    purchase_order_ref: input.order.purchase_order_ref,
    updated_at: input.order.updated_at,
  });
}

export function purchaseOrderCollectionProofRef(input: {
  readonly context: PurchaseOrderListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly PurchaseOrderCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "purchase_order_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}
