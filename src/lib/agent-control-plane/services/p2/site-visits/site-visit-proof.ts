import "server-only";

import { createHash } from "node:crypto";

import type {
  GetSiteVisitContextResult,
  SiteVisitSummarySchema,
} from "@/lib/agent-control-plane/contracts/site-visits";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { z } from "zod-v4";
import type {
  AuthorizedGetSiteVisitContextRead,
  AuthorizedListSiteVisitsRead,
} from "./site-visit-authorization";
import type { SiteVisitListCursorContext } from "./site-visit-cursor";

type SiteVisitSummary = z.infer<typeof SiteVisitSummarySchema>;

export interface SiteVisitSourceRevision {
  readonly domain: "artifacts" | "site_visits";
  readonly source_revision: number;
}

export interface SiteVisitListQueryProjection {
  readonly view: "booked_appointments" | "visit_history";
  readonly window_from: string;
  readonly window_to: string;
  readonly statuses: readonly string[];
  readonly include_unlinked: boolean;
  readonly assignee_ref: Readonly<{
    kind: "team_member";
    id: string;
  }> | null;
  readonly opportunity_ref: Readonly<{
    kind: "opportunity";
    id: string;
  }> | null;
}

interface SiteVisitProofAuthority {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly required_oauth_scopes: readonly string[];
  readonly calendar_scope: "all" | "own" | null;
  readonly clients_scope: "all" | "assigned" | null;
  readonly deck_builder_scope: "all" | "assigned" | null;
  readonly pipeline_scope: "all" | "assigned";
  readonly photos_scope: "all" | "assigned" | null;
}

export interface SiteVisitListProofContext extends SiteVisitProofAuthority {
  readonly capability_id: "list_site_visits";
  readonly capability_revision: "list_site_visits:2026-08-22.v1";
  readonly ranking_revision: "site-visit-ranking:2026-08-22.v1";
  readonly query: SiteVisitListQueryProjection;
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly SiteVisitSourceRevision[];
  readonly cursor_predecessor: SiteVisitListCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly SiteVisitSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

export interface SiteVisitContextSourceInspected {
  readonly artifacts: number;
  readonly checklist_answers: number;
  readonly deck_designs: number;
  readonly visits: number;
}

export interface SiteVisitContextProofContext extends SiteVisitProofAuthority {
  readonly capability_id: "get_site_visit_context";
  readonly capability_revision: "get_site_visit_context:2026-08-22.v1";
  readonly anchor: "opportunity" | "unlinked";
  readonly opportunity_ref: Readonly<{
    kind: "opportunity";
    id: string;
  }> | null;
  readonly site_visit_ref: Readonly<{
    kind: "site_visit";
    id: string;
  }>;
  readonly selected_sections: readonly string[];
  readonly checklist_answer_limit: number | null;
  readonly timeline_limit: number | null;
  readonly read_at: string;
  readonly source_revisions: readonly SiteVisitSourceRevision[];
  readonly source_inspected: SiteVisitContextSourceInspected;
}

export interface SiteVisitCollectionChildProof {
  readonly site_visit_ref: SiteVisitSummary["site_visit_ref"];
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

function authorityProjection(
  authorization:
    AuthorizedListSiteVisitsRead | AuthorizedGetSiteVisitContextRead
): SiteVisitProofAuthority {
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
    required_oauth_scopes: authorization.requiredOAuthScopes,
    calendar_scope: authorization.calendarScope,
    clients_scope: authorization.clientsScope,
    deck_builder_scope: authorization.deckBuilderScope,
    pipeline_scope: authorization.pipelineScope,
    photos_scope: authorization.photosScope,
  };
}

export function siteVisitListQueryProjection(
  authorization: AuthorizedListSiteVisitsRead
): SiteVisitListQueryProjection {
  const query = authorization.query;
  return query.view === "booked_appointments"
    ? {
        view: query.view,
        window_from: query.from,
        window_to: query.to,
        statuses: query.statuses,
        include_unlinked: false,
        assignee_ref: query.assignee_ref ?? null,
        opportunity_ref: query.opportunity_ref ?? null,
      }
    : {
        view: query.view,
        window_from: query.created_from,
        window_to: query.created_to,
        statuses: query.statuses ?? [],
        include_unlinked: query.include_unlinked,
        assignee_ref: query.assignee_ref ?? null,
        opportunity_ref: query.opportunity_ref ?? null,
      };
}

export function siteVisitListProofContext(input: {
  readonly authorization: AuthorizedListSiteVisitsRead;
  readonly cursor: SiteVisitListCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly SiteVisitSourceRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): SiteVisitListProofContext {
  return {
    ...authorityProjection(input.authorization),
    capability_id: "list_site_visits",
    capability_revision: "list_site_visits:2026-08-22.v1",
    ranking_revision: "site-visit-ranking:2026-08-22.v1",
    query: siteVisitListQueryProjection(input.authorization),
    item_limit: input.authorization.query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor?.sourceRevisions ?? [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: input.sourceRevisions,
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function siteVisitListEntityProofRef(input: {
  readonly context: SiteVisitListProofContext;
  readonly visit: SiteVisitSummary;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "site_visit_list_entity",
    visit: input.visit,
  });
}

export function siteVisitListEvidenceRef(input: {
  readonly context: SiteVisitListProofContext;
  readonly siteVisitRef: SiteVisitSummary["site_visit_ref"];
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "site_visit_list_evidence",
    site_visit_ref: input.siteVisitRef,
  });
}

export function siteVisitListCollectionProofRef(input: {
  readonly context: SiteVisitListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly SiteVisitCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "site_visit_list_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}

export function siteVisitContextProofContext(input: {
  readonly authorization: AuthorizedGetSiteVisitContextRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly SiteVisitSourceRevision[];
  readonly sourceInspected: SiteVisitContextSourceInspected;
}): SiteVisitContextProofContext {
  const authorization = input.authorization;
  return {
    ...authorityProjection(authorization),
    capability_id: "get_site_visit_context",
    capability_revision: "get_site_visit_context:2026-08-22.v1",
    anchor: authorization.query.anchor,
    opportunity_ref:
      authorization.query.anchor === "opportunity"
        ? authorization.query.opportunity_ref
        : null,
    site_visit_ref: authorization.query.site_visit_ref,
    selected_sections: authorization.query.sections,
    checklist_answer_limit: authorization.query.checklist_answer_limit ?? null,
    timeline_limit: authorization.query.timeline_limit ?? null,
    read_at: input.readAt,
    source_revisions: input.sourceRevisions,
    source_inspected: input.sourceInspected,
  };
}

export function siteVisitContextEntityProofRef(input: {
  readonly context: SiteVisitContextProofContext;
  readonly result: Omit<GetSiteVisitContextResult, "evidence" | "proof">;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "site_visit_context_entity",
    result: input.result,
  });
}

export function siteVisitContextEvidenceRef(input: {
  readonly context: SiteVisitContextProofContext;
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "site_visit_context_evidence",
  });
}
