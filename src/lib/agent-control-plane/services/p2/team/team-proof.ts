import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import type { TeamMemberSummary } from "@/lib/agent-control-plane/contracts/company-operations";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { AuthorizedTeamDirectoryRead } from "./team-authorization";
import type { TeamDirectoryCursorContext } from "./team-cursor";

export interface TeamDirectorySourceRevision {
  readonly domain: "company" | "team";
  readonly source_revision: number;
}

export function exactTeamDirectorySourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly TeamDirectorySourceRevision[] {
  if (
    revisions.length !== 2 ||
    revisions[0]?.domain !== "company" ||
    revisions[1]?.domain !== "team"
  ) {
    throw new TypeError("TEAM_DIRECTORY_REVISION_VECTOR_INVALID");
  }
  return [
    { domain: "company", source_revision: revisions[0].source_revision },
    { domain: "team", source_revision: revisions[1].source_revision },
  ];
}

export interface TeamDirectoryProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "list_team_members";
  readonly capability_revision: "list_team_members:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly ranking_revision: "team-member-order:2026-08-22.v1";
  readonly required_oauth_scopes: readonly ["ops.team.read"];
  readonly team_scope: "all";
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly TeamDirectorySourceRevision[];
  readonly cursor_predecessor: TeamDirectoryCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly TeamDirectorySourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

export interface TeamDirectoryCollectionChildProof {
  readonly member_ref: TeamMemberSummary["member_ref"];
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

export function teamDirectoryProofContext(input: {
  readonly authorization: AuthorizedTeamDirectoryRead;
  readonly cursor: TeamDirectoryCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): TeamDirectoryProofContext {
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
    ranking_revision: "team-member-order:2026-08-22.v1",
    required_oauth_scopes: authorization.requiredOAuthScopes,
    team_scope: authorization.teamScope,
    item_limit: authorization.query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactTeamDirectorySourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactTeamDirectorySourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function teamDirectoryEntityProofRef(input: {
  readonly context: TeamDirectoryProofContext;
  readonly item: TeamMemberSummary;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "team_member_entity",
    item: input.item,
  });
}

export function teamDirectoryEvidenceRef(input: {
  readonly context: TeamDirectoryProofContext;
  readonly memberRef: TeamMemberSummary["member_ref"];
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "team_member_evidence",
    member_ref: input.memberRef,
  });
}

export function teamDirectoryCollectionProofRef(input: {
  readonly context: TeamDirectoryProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly TeamDirectoryCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "team_member_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}
