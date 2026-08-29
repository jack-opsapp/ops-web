import "server-only";

import { createHash } from "node:crypto";

import type {
  GetSalesDocumentResult,
  SalesDocumentHeader,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type {
  AuthorizedGetSalesDocumentRead,
  AuthorizedListSalesDocumentsRead,
  SalesDocumentAuthorizationCandidateBinding,
} from "./sales-authorization";
import type { SalesDocumentCursorContext } from "./sales-cursor";

export type SalesDocumentAuthorityPath = "opportunity" | "project" | "unlinked";

export interface SalesDocumentSourceRevision {
  readonly domain: "legacy_operational" | "sales_documents";
  readonly source_revision: number;
}

export function exactSalesDocumentSourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly SalesDocumentSourceRevision[] {
  if (
    revisions.length !== 2 ||
    revisions[0]?.domain !== "legacy_operational" ||
    revisions[1]?.domain !== "sales_documents"
  ) {
    throw new TypeError("SALES_DOCUMENT_REVISION_VECTOR_INVALID");
  }
  return [
    {
      domain: "legacy_operational",
      source_revision: revisions[0].source_revision,
    },
    {
      domain: "sales_documents",
      source_revision: revisions[1].source_revision,
    },
  ];
}

export interface SalesDocumentListProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "list_sales_documents";
  readonly capability_revision: "list_sales_documents:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly ranking_revision: "sales-document-ranking:2026-08-22.v1";
  readonly authorization_candidates: readonly SalesDocumentAuthorizationCandidateBinding[];
  readonly query: Omit<AuthorizedListSalesDocumentsRead["query"], "cursor">;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly SalesDocumentSourceRevision[];
  readonly cursor_predecessor: SalesDocumentCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly SalesDocumentSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

export interface SalesDocumentDetailSourceInspected {
  readonly documents: number;
  readonly lines: number;
  readonly milestones: number;
}

export interface SalesDocumentDetailProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_sales_document";
  readonly capability_revision: "get_sales_document:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly selected_authorization: SalesDocumentAuthorizationCandidateBinding;
  readonly authority_path: SalesDocumentAuthorityPath;
  readonly query: AuthorizedGetSalesDocumentRead["query"];
  readonly read_at: string;
  readonly source_revisions: readonly SalesDocumentSourceRevision[];
  readonly source_inspected: SalesDocumentDetailSourceInspected;
}

export interface SalesDocumentCollectionChildProof {
  readonly document_ref: SalesDocumentHeader["document_ref"];
  readonly proof_ref: string;
  readonly evidence_ref: string;
}

export type SalesDocumentDetailSource =
  GetSalesDocumentResult extends infer TResult
    ? TResult extends GetSalesDocumentResult
      ? Omit<TResult, "evidence" | "proof">
      : never
    : never;

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

export function salesDocumentListProofContext(input: {
  readonly authorization: AuthorizedListSalesDocumentsRead;
  readonly cursor: SalesDocumentCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): SalesDocumentListProofContext {
  const authorization = input.authorization;
  const { cursor: _cursor, ...query } = authorization.query;
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    ranking_revision: "sales-document-ranking:2026-08-22.v1",
    authorization_candidates: authorization.authorizationCandidates,
    query,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactSalesDocumentSourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactSalesDocumentSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function salesDocumentEntityProofRef(input: {
  readonly context: SalesDocumentListProofContext;
  readonly item: SalesDocumentHeader;
  readonly selectedAuthorization: SalesDocumentAuthorizationCandidateBinding;
  readonly authorityPath: SalesDocumentAuthorityPath;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "sales_document_list_entity",
    selected_authorization: input.selectedAuthorization,
    authority_path: input.authorityPath,
    item: input.item,
  });
}

export function salesDocumentListEvidenceRef(input: {
  readonly context: SalesDocumentListProofContext;
  readonly item: SalesDocumentHeader;
  readonly selectedAuthorization: SalesDocumentAuthorizationCandidateBinding;
  readonly authorityPath: SalesDocumentAuthorityPath;
}) {
  return evidenceRef({
    ...input.context,
    evidence_kind: "sales_document_list_item",
    selected_authorization: input.selectedAuthorization,
    authority_path: input.authorityPath,
    document_ref: input.item.document_ref,
    updated_at: input.item.updated_at,
  });
}

export function salesDocumentCollectionProofRef(input: {
  readonly context: SalesDocumentListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly SalesDocumentCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "sales_document_list_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}

export function salesDocumentDetailProofContext(input: {
  readonly authorization: AuthorizedGetSalesDocumentRead;
  readonly selectedAuthorization: SalesDocumentAuthorizationCandidateBinding;
  readonly authorityPath: SalesDocumentAuthorityPath;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: SalesDocumentDetailSourceInspected;
}): SalesDocumentDetailProofContext {
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
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    selected_authorization: input.selectedAuthorization,
    authority_path: input.authorityPath,
    query: authorization.query,
    read_at: input.readAt,
    source_revisions: exactSalesDocumentSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
  };
}

export function salesDocumentDetailEntityProofRef(input: {
  readonly context: SalesDocumentDetailProofContext;
  readonly result: SalesDocumentDetailSource;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "sales_document_detail_entity",
    result: input.result,
  });
}

export function salesDocumentDetailEvidenceRef(input: {
  readonly companyId: string;
  readonly documentRef: SalesDocumentHeader["document_ref"];
  readonly updatedAt: string;
}) {
  return evidenceRef({
    evidence_kind: "sales_document_detail",
    company_id: input.companyId,
    document_ref: input.documentRef,
    updated_at: input.updatedAt,
  });
}
