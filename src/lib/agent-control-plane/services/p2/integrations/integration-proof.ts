import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import type {
  IntegrationHealthItem,
  IntegrationHealthSelection,
} from "@/lib/agent-control-plane/contracts/company-operations";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { AuthorizedIntegrationHealthRead } from "./integration-authorization";

export interface IntegrationHealthSourceRevision {
  readonly domain: "company" | "integrations";
  readonly source_revision: number;
}

export interface IntegrationHealthSourceInspected {
  readonly accounting: number;
  readonly mailbox: number;
}

export function exactIntegrationHealthSourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly IntegrationHealthSourceRevision[] {
  if (
    revisions.length !== 2 ||
    revisions[0]?.domain !== "company" ||
    revisions[1]?.domain !== "integrations"
  ) {
    throw new TypeError("INTEGRATION_HEALTH_REVISION_VECTOR_INVALID");
  }
  return [
    { domain: "company", source_revision: revisions[0].source_revision },
    {
      domain: "integrations",
      source_revision: revisions[1].source_revision,
    },
  ];
}

export interface IntegrationHealthProofContext {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_integration_health";
  readonly capability_revision: "get_integration_health:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly required_oauth_scopes: readonly ["ops.integrations.read"];
  readonly settings_integrations_scope: "all";
  readonly accounting_scope: "all" | null;
  readonly email_scope: "all" | "own" | null;
  readonly selections: readonly IntegrationHealthSelection[];
  readonly read_at: string;
  readonly source_revisions: readonly IntegrationHealthSourceRevision[];
  readonly source_inspected: IntegrationHealthSourceInspected;
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

export function integrationHealthProofContext(input: {
  readonly authorization: AuthorizedIntegrationHealthRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: IntegrationHealthSourceInspected;
}): IntegrationHealthProofContext {
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
    required_oauth_scopes: authorization.requiredOAuthScopes,
    settings_integrations_scope: authorization.settingsIntegrationsScope,
    accounting_scope: authorization.accountingScope,
    email_scope: authorization.emailScope,
    selections: authorization.query.integrations,
    read_at: input.readAt,
    source_revisions: exactIntegrationHealthSourceRevisions(
      input.sourceRevisions
    ),
    source_inspected: input.sourceInspected,
  };
}

export function integrationHealthEntityProofRef(input: {
  readonly context: IntegrationHealthProofContext;
  readonly item: IntegrationHealthItem;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "integration_health_entity",
    item: input.item,
  });
}

export function integrationHealthEvidenceRef(input: {
  readonly context: IntegrationHealthProofContext;
  readonly selection: IntegrationHealthSelection;
}) {
  return evidenceRef({
    ...input.context,
    proof_kind: "integration_health_evidence",
    selection: input.selection,
  });
}

export function integrationHealthCollectionProofRef(input: {
  readonly context: IntegrationHealthProofContext;
  readonly children: readonly {
    readonly selection: IntegrationHealthSelection;
    readonly proof_ref: string;
    readonly evidence_ref: string;
  }[];
}) {
  return proofRef({
    ...input.context,
    proof_kind: "integration_health_collection",
    returned_count: input.children.length,
    has_more: false,
    children: input.children,
  });
}
