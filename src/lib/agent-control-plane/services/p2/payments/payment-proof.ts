import "server-only";

import { createHash } from "node:crypto";

import {
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import type { PaymentLedgerItem } from "@/lib/agent-control-plane/contracts/sales-documents";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type {
  AuthorizedListPaymentsRead,
  PaymentAuthorizationCandidateBinding,
} from "./payment-authorization";
import type { PaymentCursorContext } from "./payment-cursor";

const ExactPaymentSourceRevisionSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 3 &&
    revisions[0]?.domain === "legacy_operational" &&
    revisions[1]?.domain === "payments" &&
    revisions[2]?.domain === "sales_documents",
  "PAYMENT_REVISION_VECTOR_INVALID"
);

export type PaymentAuthorityPath = "opportunity" | "project" | "unlinked";

export interface PaymentSourceRevision {
  readonly domain: "legacy_operational" | "payments" | "sales_documents";
  readonly source_revision: number;
}

export interface PaymentListProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "list_payments";
  readonly capability_revision: "list_payments:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly ranking_revision: "payment-ranking:2026-08-22.v1";
  readonly authorization_candidate: PaymentAuthorizationCandidateBinding;
  readonly query: Readonly<Record<string, unknown>>;
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly PaymentSourceRevision[];
  readonly cursor_predecessor: PaymentCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly PaymentSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
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

export function exactPaymentSourceRevisions(
  value: unknown
): readonly PaymentSourceRevision[] {
  const parsed = ExactPaymentSourceRevisionSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("PAYMENT_REVISION_VECTOR_INVALID");
  return Object.freeze(
    parsed.data.map((revision) =>
      Object.freeze({
        domain: revision.domain as PaymentSourceRevision["domain"],
        source_revision: revision.source_revision,
      })
    )
  );
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

export function paymentListProofContext(input: {
  readonly authorization: AuthorizedListPaymentsRead;
  readonly cursor: PaymentCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): PaymentListProofContext {
  const authorization = input.authorization;
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_id: "list_payments",
    capability_revision: "list_payments:2026-08-22.v1",
    capability_manifest_revision: authorization.capabilityManifestRevision,
    ranking_revision: "payment-ranking:2026-08-22.v1",
    authorization_candidate: authorization.authorizationCandidate,
    query: queryProjection(authorization),
    item_limit: authorization.query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactPaymentSourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactPaymentSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function paymentEntityProofRef(input: {
  readonly context: PaymentListProofContext;
  readonly item: PaymentLedgerItem;
  readonly authorityPath: PaymentAuthorityPath;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "payment_list_entity",
    authority_path: input.authorityPath,
    item: input.item,
  });
}

export function paymentListEvidenceRef(input: {
  readonly context: PaymentListProofContext;
  readonly item: PaymentLedgerItem;
  readonly authorityPath: PaymentAuthorityPath;
}) {
  return evidenceRef({
    ...input.context,
    evidence_kind: "payment_list_item",
    authority_path: input.authorityPath,
    payment_ref: input.item.payment_ref,
    payment_date: input.item.payment_date,
  });
}

export function paymentCollectionProofRef(input: {
  readonly context: PaymentListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly Readonly<{
    payment_ref: PaymentLedgerItem["payment_ref"];
    proof_ref: string;
    evidence_ref: string;
  }>[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "payment_list_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}
