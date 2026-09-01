import "server-only";

import { createHash } from "node:crypto";
import {
  WorkQueueCardSchema,
  type WorkQueueCard,
} from "@/lib/agent-control-plane/contracts/work-queue";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedWorkQueueRead,
  type AuthorizedWorkQueueRead,
} from "./work-queue-authorization";

function hash(prefix: "ops_proof:v1:" | "ops_evidence:v1:", value: unknown) {
  return `${prefix}${createHash("sha256")
    .update(canonicalOperationalProjection(value as never))
    .digest("hex")}`;
}
export function workQueueProofContext(input: {
  authorization: AuthorizedWorkQueueRead;
  readAt: string;
  sourceRevisions: readonly unknown[];
  sourceInspected: number;
  sourceSlices: readonly unknown[];
  sourceHasMore: boolean;
  cursor: Readonly<{
    readAt: string;
    sourceRevisions: readonly unknown[];
    predecessor: Readonly<{
      order: readonly [number, string, string, string];
      tie_breaker: string;
    }>;
  }> | null;
}) {
  if (!isAuthorizedWorkQueueRead(input.authorization))
    throw new TypeError("WORK_QUEUE_AUTHORIZATION_INVALID");
  return Object.freeze({
    company_id: input.authorization.actorContext.companyId,
    actor_user_id: input.authorization.actorContext.actorUserId,
    oauth_grant_id: input.authorization.oauthGrantId,
    oauth_client_id: input.authorization.oauthClientId,
    grant_revision: input.authorization.grantRevision,
    granted_scope_ceiling: input.authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      input.authorization.actorContext.permissionSnapshotRevision,
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    capability_manifest_revision:
      input.authorization.capabilityManifestRevision,
    ranking_revision: "work-queue-ranking:2026-08-22.v1",
    item_limit: input.authorization.query.limit,
    cursor_read_at: input.cursor?.readAt ?? null,
    cursor_source_revisions: input.cursor?.sourceRevisions ?? [],
    cursor_predecessor: input.cursor?.predecessor ?? null,
    selections: input.authorization.selections,
    authorized_sources: input.authorization.authorizedSources.map((source) => ({
      source: source.source,
      origin: source.origin,
      required_oauth_scopes: source.requiredOAuthScopes,
      resolved_permission_scopes: source.resolvedPermissionScopes,
      satisfied_permission_group_indexes:
        source.satisfiedPermissionGroupIndexes,
    })),
    warnings: input.authorization.warnings,
    read_at: input.readAt,
    source_revisions: input.sourceRevisions,
    source_inspected: input.sourceInspected,
    source_slices: input.sourceSlices,
    source_has_more: input.sourceHasMore,
  });
}
export function workQueueEntityProofRef(input: {
  context: unknown;
  item: WorkQueueCard;
  itemSourceRevisions: readonly unknown[];
}) {
  return hash("ops_proof:v1:", {
    ...(input.context as object),
    proof_kind: "work_queue_entity",
    item: WorkQueueCardSchema.parse(input.item),
    item_source_revisions: input.itemSourceRevisions,
  });
}
export function workQueueEvidenceRef(input: {
  context: unknown;
  item: WorkQueueCard;
}) {
  return hash("ops_evidence:v1:", {
    ...(input.context as object),
    proof_kind: "work_queue_evidence",
    queue_ref: input.item.queue_ref,
  });
}
export function workQueueCollectionProofRef(input: {
  context: unknown;
  returnedCount: number;
  hasMore: boolean;
  children: readonly unknown[];
}) {
  return hash("ops_proof:v1:", {
    ...(input.context as object),
    proof_kind: "work_queue_collection",
    returned_count: input.returnedCount,
    has_more: input.hasMore,
    children: input.children,
  });
}
