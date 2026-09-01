import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import type {
  CatalogItemDetailResult,
  CatalogSearchItem,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type {
  AuthorizedGetCatalogItemRead,
  AuthorizedSearchCatalogItemsRead,
  CatalogAuthorizationCandidateBinding,
} from "./catalog-authorization";
import type { CatalogCursorContext } from "./catalog-cursor";

export interface CatalogSourceRevision {
  readonly domain: "catalog";
  readonly source_revision: number;
}

export function exactCatalogSourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly CatalogSourceRevision[] {
  if (revisions.length !== 1 || revisions[0]?.domain !== "catalog") {
    throw new TypeError("CATALOG_REVISION_VECTOR_INVALID");
  }
  return [
    {
      domain: "catalog",
      source_revision: revisions[0].source_revision,
    },
  ];
}

export interface CatalogListProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "search_catalog_items";
  readonly capability_revision: "search_catalog_items:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly ranking_revision: "catalog-ranking:2026-08-22.v1";
  readonly authorization_candidates: readonly CatalogAuthorizationCandidateBinding[];
  readonly query: Omit<AuthorizedSearchCatalogItemsRead["query"], "cursor">;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly CatalogSourceRevision[];
  readonly cursor_predecessor: CatalogCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly CatalogSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

export interface CatalogDetailSourceInspected {
  readonly families: number;
  readonly variants: number;
  readonly options: number;
  readonly option_values: number;
  readonly recipes: number;
  readonly stock_units: number;
  readonly supplier_costs: number;
}

export interface CatalogDetailProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_catalog_item";
  readonly capability_revision: "get_catalog_item:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly authorization_candidates: readonly CatalogAuthorizationCandidateBinding[];
  readonly query: AuthorizedGetCatalogItemRead["query"];
  readonly read_at: string;
  readonly source_revisions: readonly CatalogSourceRevision[];
  readonly source_inspected: CatalogDetailSourceInspected;
}

export interface CatalogCollectionChildProof {
  readonly variant_ref: CatalogSearchItem["variant_ref"];
  readonly proof_ref: string;
  readonly evidence_ref: string;
}

type WithoutCatalogProofEnvelope<T> = T extends unknown
  ? Omit<T, "evidence" | "proof">
  : never;

export type CatalogDetailSource =
  WithoutCatalogProofEnvelope<CatalogItemDetailResult>;

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

export function catalogListProofContext(input: {
  readonly authorization: AuthorizedSearchCatalogItemsRead;
  readonly cursor: CatalogCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): CatalogListProofContext {
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
    ranking_revision: "catalog-ranking:2026-08-22.v1",
    authorization_candidates: authorization.authorizationCandidates,
    query,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactCatalogSourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactCatalogSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function catalogSearchEntityProofRef(input: {
  readonly context: CatalogListProofContext;
  readonly item: CatalogSearchItem;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "catalog_search_entity",
    selected_authorization: input.context.authorization_candidates[0],
    item: input.item,
  });
}

export function catalogListEvidenceRef(input: {
  readonly context: CatalogListProofContext;
  readonly item: CatalogSearchItem;
}) {
  return evidenceRef({
    ...input.context,
    evidence_kind: "catalog_search_item",
    selected_authorization: input.context.authorization_candidates[0],
    variant_ref: input.item.variant_ref,
    updated_at: input.item.updated_at,
  });
}

export function catalogCollectionProofRef(input: {
  readonly context: CatalogListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly CatalogCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "catalog_search_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}

export function catalogDetailProofContext(input: {
  readonly authorization: AuthorizedGetCatalogItemRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: CatalogDetailSourceInspected;
}): CatalogDetailProofContext {
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
    authorization_candidates: authorization.authorizationCandidates,
    query: authorization.query,
    read_at: input.readAt,
    source_revisions: exactCatalogSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
  };
}

export function catalogDetailEntityProofRef(input: {
  readonly context: CatalogDetailProofContext;
  readonly result: CatalogDetailSource;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "catalog_detail_entity",
    result: input.result,
  });
}

export function catalogDetailEvidenceRef(input: {
  readonly companyId: string;
  readonly requestedRef: AuthorizedGetCatalogItemRead["query"]["item_ref"];
  readonly familyUpdatedAt: string;
}) {
  return evidenceRef({
    evidence_kind: "catalog_detail",
    company_id: input.companyId,
    requested_ref: input.requestedRef,
    family_updated_at: input.familyUpdatedAt,
  });
}
