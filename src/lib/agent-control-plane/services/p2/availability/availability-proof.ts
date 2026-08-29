import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import type { AvailabilityMemberSummary } from "@/lib/agent-control-plane/contracts/company-operations";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { AuthorizedTeamAvailabilityRead } from "./availability-authorization";
import type { TeamAvailabilityCursorContext } from "./availability-cursor";

export interface TeamAvailabilitySourceRevision {
  readonly domain: "availability" | "site_visits" | "tasks" | "team";
  readonly source_revision: number;
}

export function exactTeamAvailabilitySourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly TeamAvailabilitySourceRevision[] {
  if (
    revisions.length !== 4 ||
    revisions[0]?.domain !== "availability" ||
    revisions[1]?.domain !== "site_visits" ||
    revisions[2]?.domain !== "tasks" ||
    revisions[3]?.domain !== "team"
  ) {
    throw new TypeError("TEAM_AVAILABILITY_REVISION_VECTOR_INVALID");
  }
  return [
    {
      domain: "availability",
      source_revision: revisions[0].source_revision,
    },
    {
      domain: "site_visits",
      source_revision: revisions[1].source_revision,
    },
    { domain: "tasks", source_revision: revisions[2].source_revision },
    { domain: "team", source_revision: revisions[3].source_revision },
  ];
}

export interface TeamAvailabilityProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "list_team_availability";
  readonly capability_revision: "list_team_availability:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly ranking_revision: "availability-member-order:2026-08-22.v1";
  readonly required_oauth_scopes: readonly ["ops.team.read"];
  readonly view: "company" | "self";
  readonly team_scope: "all" | null;
  readonly calendar_scope: "all" | "own";
  readonly starts_on: string;
  readonly ends_on: string;
  readonly company_timezone: string;
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly TeamAvailabilitySourceRevision[];
  readonly cursor_predecessor:
    | TeamAvailabilityCursorContext["predecessor"]
    | null;
  readonly read_at: string;
  readonly source_revisions: readonly TeamAvailabilitySourceRevision[];
  readonly member_source_inspected: number;
  readonly schedule_source_inspected: number;
  readonly source_has_more: boolean;
}

export interface TeamAvailabilityCollectionChildProof {
  readonly member_ref: AvailabilityMemberSummary["member_ref"];
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

export function teamAvailabilityProofContext(input: {
  readonly authorization: AuthorizedTeamAvailabilityRead;
  readonly cursor: TeamAvailabilityCursorContext | null;
  readonly readAt: string;
  readonly timezone: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly memberSourceInspected: number;
  readonly scheduleSourceInspected: number;
  readonly sourceHasMore: boolean;
}): TeamAvailabilityProofContext {
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
    ranking_revision: "availability-member-order:2026-08-22.v1",
    required_oauth_scopes: authorization.requiredOAuthScopes,
    view: authorization.availabilityScope,
    team_scope: authorization.teamScope,
    calendar_scope: authorization.calendarScope,
    starts_on: authorization.query.starts_on,
    ends_on: authorization.query.ends_on,
    company_timezone: input.timezone,
    item_limit: authorization.itemLimit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactTeamAvailabilitySourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactTeamAvailabilitySourceRevisions(
      input.sourceRevisions
    ),
    member_source_inspected: input.memberSourceInspected,
    schedule_source_inspected: input.scheduleSourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function teamAvailabilityEntityProofRef(input: {
  readonly context: TeamAvailabilityProofContext;
  readonly item: AvailabilityMemberSummary;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "team_availability_entity",
    item: input.item,
  });
}

export function teamAvailabilityEvidenceRef(input: {
  readonly context: TeamAvailabilityProofContext;
  readonly memberRef: AvailabilityMemberSummary["member_ref"];
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "team_availability_evidence",
    member_ref: input.memberRef,
  });
}

export function teamAvailabilityCollectionProofRef(input: {
  readonly context: TeamAvailabilityProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly TeamAvailabilityCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "team_availability_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}
