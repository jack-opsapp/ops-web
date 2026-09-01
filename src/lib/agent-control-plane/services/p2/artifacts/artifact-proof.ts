import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import type {
  ArtifactJobRef,
  ArtifactMetadata,
  ArtifactSourceKind,
  GetJobArtifactEvidenceSourceResult,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type {
  AuthorizedGetJobArtifactEvidenceRead,
  AuthorizedListJobArtifactsRead,
} from "./artifact-authorization";
import {
  ARTIFACT_LIST_RANKING_REVISION,
  type ArtifactListCursorContext,
} from "./artifact-cursor";

export interface ArtifactSourceRevision {
  readonly domain: "artifacts" | "legacy_operational";
  readonly source_revision: number;
}

export interface ArtifactSourceIdentity {
  readonly source_kind: ArtifactSourceKind;
  readonly source_id: string;
}

interface ArtifactProofAuthority {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly required_oauth_scopes: readonly string[];
  readonly resolved_permission_scopes: Readonly<Record<string, string>>;
}

export interface ArtifactListProofContext extends ArtifactProofAuthority {
  readonly capability_id: "list_job_artifacts";
  readonly capability_revision: "list_job_artifacts:2026-08-22.v1";
  readonly ranking_revision: typeof ARTIFACT_LIST_RANKING_REVISION;
  readonly job_ref: ArtifactJobRef;
  readonly source_kinds: readonly ArtifactSourceKind[];
  readonly item_limit: number;
  readonly cursor_read_at: string | null;
  readonly cursor_source_revisions: readonly ArtifactSourceRevision[];
  readonly cursor_predecessor: ArtifactListCursorContext["predecessor"] | null;
  readonly read_at: string;
  readonly source_revisions: readonly ArtifactSourceRevision[];
  readonly source_inspected: number;
  readonly source_has_more: boolean;
}

export interface ArtifactExactProofContext extends ArtifactProofAuthority {
  readonly capability_id: "get_job_artifact_evidence";
  readonly capability_revision: "get_job_artifact_evidence:2026-08-22.v1";
  readonly job_ref: ArtifactJobRef;
  readonly source_kinds: readonly [ArtifactSourceKind];
  readonly selected_source_kind: ArtifactSourceKind;
  readonly requested_evidence_ref: string;
  readonly read_at: string;
  readonly source_revisions: readonly ArtifactSourceRevision[];
  readonly source_inspected: number;
}

export interface ArtifactCollectionChildProof {
  readonly artifact_ref: Readonly<{
    source_kind: ArtifactSourceKind;
    evidence_ref: string;
  }>;
  readonly proof_ref: string;
  readonly evidence_ref: string;
}

function exactArtifactSourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly ArtifactSourceRevision[] {
  if (
    revisions.length !== 2 ||
    revisions[0]?.domain !== "artifacts" ||
    revisions[1]?.domain !== "legacy_operational"
  ) {
    throw new TypeError("ARTIFACT_REVISION_VECTOR_INVALID");
  }
  return [
    { domain: "artifacts", source_revision: revisions[0].source_revision },
    {
      domain: "legacy_operational",
      source_revision: revisions[1].source_revision,
    },
  ];
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
    AuthorizedListJobArtifactsRead | AuthorizedGetJobArtifactEvidenceRead
): ArtifactProofAuthority {
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
    resolved_permission_scopes: authorization.resolvedPermissionScopes,
  };
}

export function artifactEvidenceRef(input: {
  readonly companyId: string;
  readonly jobRef: ArtifactJobRef;
  readonly sourceIdentity: ArtifactSourceIdentity;
}) {
  return evidenceRef({
    company_id: input.companyId,
    job_kind: input.jobRef.kind,
    job_id: input.jobRef.id,
    source_kind: input.sourceIdentity.source_kind,
    source_id: input.sourceIdentity.source_id,
  });
}

export function artifactListProofContext(input: {
  readonly authorization: AuthorizedListJobArtifactsRead;
  readonly cursor: ArtifactListCursorContext | null;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}): ArtifactListProofContext {
  const authorization = input.authorization;
  return {
    ...authorityProjection(authorization),
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    ranking_revision: ARTIFACT_LIST_RANKING_REVISION,
    job_ref: authorization.query.job_ref,
    source_kinds: authorization.sourceKinds,
    item_limit: authorization.query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor
      ? exactArtifactSourceRevisions(input.cursor.sourceRevisions)
      : [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    read_at: input.readAt,
    source_revisions: exactArtifactSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
    source_has_more: input.sourceHasMore,
  };
}

export function artifactListEntityProofRef(input: {
  readonly context: ArtifactListProofContext;
  readonly sourceIdentity: ArtifactSourceIdentity;
  readonly artifact: ArtifactMetadata;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "artifact_list_entity",
    source_identity: input.sourceIdentity,
    artifact: input.artifact,
  });
}

export function artifactListCollectionProofRef(input: {
  readonly context: ArtifactListProofContext;
  readonly returnedCount: number;
  readonly hasMore: boolean;
  readonly children: readonly ArtifactCollectionChildProof[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "artifact_list_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}

export function artifactExactProofContext(input: {
  readonly authorization: AuthorizedGetJobArtifactEvidenceRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
}): ArtifactExactProofContext {
  const authorization = input.authorization;
  return {
    ...authorityProjection(authorization),
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    job_ref: authorization.query.job_ref,
    source_kinds: authorization.sourceKinds,
    selected_source_kind: authorization.query.source_kind,
    requested_evidence_ref: authorization.query.evidence_ref,
    read_at: input.readAt,
    source_revisions: exactArtifactSourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
  };
}

export function artifactExactEntityProofRef(input: {
  readonly context: ArtifactExactProofContext;
  readonly sourceIdentity: ArtifactSourceIdentity;
  readonly artifact: ArtifactMetadata;
  readonly content: GetJobArtifactEvidenceSourceResult["content"];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "artifact_exact_entity",
    source_identity: input.sourceIdentity,
    artifact: input.artifact,
    content: input.content,
  });
}
