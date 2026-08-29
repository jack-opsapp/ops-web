import "server-only";

import { createHash } from "node:crypto";

import type { CompanyContextResult } from "@/lib/agent-control-plane/contracts/company-operations";
import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { AuthorizedCompanyContextRead } from "./company-authorization";

export type CompanyContextProofPayload = Readonly<
  Pick<
    CompanyContextResult,
    | "company_ref"
    | "profile"
    | "regional"
    | "working_window"
    | "catalog"
    | "public_assets"
  >
>;

export interface CompanyContextSourceInspected {
  readonly companies: number;
  readonly inventory_settings: number;
  readonly company_settings: number;
}

export interface CompanyContextProofMaterial {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_company_context";
  readonly capability_revision: "get_company_context:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly required_oauth_scopes: readonly ["ops.company.read"];
  readonly settings_company_scope: "all";
  readonly query: Readonly<Record<string, never>>;
  readonly read_at: string;
  readonly source_revisions: readonly P2DomainRevision[];
  readonly source_inspected: CompanyContextSourceInspected;
  readonly result: CompanyContextProofPayload;
}

export interface CompanyContextProofBinding {
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: CompanyContextSourceInspected;
}

export function companyContextProofMaterial(input: {
  readonly authorization: AuthorizedCompanyContextRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: CompanyContextSourceInspected;
  readonly result: CompanyContextProofPayload;
}): CompanyContextProofMaterial {
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
    settings_company_scope: authorization.settingsCompanyScope,
    query: authorization.query,
    read_at: input.readAt,
    source_revisions: input.sourceRevisions,
    source_inspected: input.sourceInspected,
    result: input.result,
  };
}

export function companyContextProofRef(
  material: CompanyContextProofMaterial
): `ops_proof:v1:${string}` {
  const canonical = canonicalOperationalProjection(material as never);
  return `ops_proof:v1:${createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")}`;
}

export function companyContextEnvelopeProofRef(
  envelope: CompanyContextProofMaterial
): `ops_proof:v1:${string}` {
  return companyContextProofRef(envelope);
}
