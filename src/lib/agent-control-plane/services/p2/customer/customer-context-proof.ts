import "server-only";

import { createHash } from "node:crypto";

import type {
  CustomerContextResult,
  CustomerContextSections,
} from "@/lib/agent-control-plane/contracts/customer-context";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import type { AuthorizedCustomerContextRead } from "./customer-context-authorization";

export type CustomerContextRawSourceRevision =
  | Readonly<{
      domain: "customer";
      source_revision: number;
    }>
  | Readonly<{
      source_domain: "operations";
      source_type: "operational_read_revision";
      source_id: "private.agent_operational_read_revisions";
      version: string;
    }>
  | Readonly<{
      source_domain: "operations";
      source_type: "contactability_revision";
      source_id: string;
      version: string;
    }>;

export interface CustomerContextProofPayload {
  readonly customer: CustomerContextResult["customer"];
  readonly sections: CustomerContextSections;
}

export interface CustomerContextSourceInspected {
  readonly contacts: number;
  readonly duplicate_candidates: number;
  readonly opportunities: number;
  readonly projects: number;
}

export interface CustomerContextProofMaterial {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_customer_context";
  readonly capability_revision: "get_customer_context:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly required_oauth_scopes: readonly string[];
  readonly clients_scope: "all" | "assigned";
  readonly pipeline_scope: "all" | "assigned" | null;
  readonly projects_scope: "all" | "assigned" | null;
  readonly customer_ref: Readonly<{
    kind: "client" | "sub_client";
    id: string;
  }>;
  readonly selected_sections: readonly string[];
  readonly contact_purpose: "communication" | "scheduling" | null;
  readonly job_kinds: readonly string[];
  readonly read_at: string;
  readonly source_revisions: readonly CustomerContextRawSourceRevision[];
  readonly source_inspected: CustomerContextSourceInspected;
  readonly result: CustomerContextProofPayload;
}

export interface CustomerContextProofBinding {
  readonly sourceRevisions: readonly CustomerContextRawSourceRevision[];
  readonly sourceInspected: CustomerContextSourceInspected;
}

export type CustomerContextProofEnvelope = CustomerContextProofMaterial;

export function customerContextProofMaterial(input: {
  readonly authorization: AuthorizedCustomerContextRead;
  readonly readAt: string;
  readonly sourceRevisions: readonly CustomerContextRawSourceRevision[];
  readonly sourceInspected: CustomerContextSourceInspected;
  readonly result: CustomerContextProofPayload;
}): CustomerContextProofMaterial {
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
    clients_scope: authorization.clientsScope,
    pipeline_scope: authorization.pipelineScope,
    projects_scope: authorization.projectsScope,
    customer_ref: authorization.query.customer_ref,
    selected_sections: authorization.query.sections,
    contact_purpose: authorization.query.contact_purpose ?? null,
    job_kinds: authorization.query.job_kinds ?? [],
    read_at: input.readAt,
    source_revisions: input.sourceRevisions,
    source_inspected: input.sourceInspected,
    result: input.result,
  };
}

export function customerContextProofRef(
  material: CustomerContextProofMaterial
): `ops_proof:v1:${string}` {
  const canonical = canonicalOperationalProjection(material as never);
  return `ops_proof:v1:${createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")}`;
}

export function customerContextEnvelopeProofRef(
  envelope: CustomerContextProofEnvelope
): `ops_proof:v1:${string}` {
  return customerContextProofRef(envelope);
}
