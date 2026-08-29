import "server-only";

import { createHash } from "node:crypto";

import {
  OperationalOverviewComponentSourceInspectionVectorSchema,
  OperationalOverviewComponentItemSchema,
  OperationalOverviewRevisionVectorSchema,
  type OperationalOverviewComponent,
  type OperationalOverviewComponentItem,
  type OperationalOverviewComponentSourceInspection,
  type OperationalOverviewRevision,
} from "@/lib/agent-control-plane/contracts/operational-overview";
import { P2CanonicalTimestampSchema } from "@/lib/agent-control-plane/contracts/p2-common";
import {
  P2EvidenceRefSchema,
  P2ProofRefSchema,
} from "@/lib/agent-control-plane/contracts/p2-proof";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedOperationalOverviewRead,
  type AuthorizedOperationalOverviewRead,
} from "./overview-authorization";

export interface OperationalOverviewProofContext {
  readonly request_id: string;
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_id: "get_operational_overview";
  readonly capability_revision: "get_operational_overview:2026-08-22.v1";
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly selections: AuthorizedOperationalOverviewRead["selections"];
  readonly authorized_components: readonly Readonly<{
    component: OperationalOverviewComponent;
    origin: "explicit" | "default";
    required_oauth_scopes: readonly string[];
    resolved_permission_scopes: Readonly<Record<string, string>>;
    satisfied_permission_group_indexes: readonly [0];
  }>[];
  readonly warnings: AuthorizedOperationalOverviewRead["warnings"];
  readonly read_at: string;
  readonly component_source_inspected: readonly OperationalOverviewComponentSourceInspection[];
  readonly source_inspected: number;
}

export interface OperationalOverviewProofChild {
  readonly component: OperationalOverviewComponent;
  readonly proof_ref: string;
  readonly evidence_ref: string;
  readonly source_inspected: number;
  readonly source_revisions: readonly OperationalOverviewRevision[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
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

function exactItemRevisions(revisions: readonly OperationalOverviewRevision[]) {
  const parsed = OperationalOverviewRevisionVectorSchema.parse(revisions);
  if (parsed.length === 0) {
    throw new TypeError("OPERATIONAL_OVERVIEW_ITEM_REVISION_VECTOR_EMPTY");
  }
  return parsed;
}

function componentAuthorization(
  context: OperationalOverviewProofContext,
  component: OperationalOverviewComponent
) {
  const authorization = context.authorized_components.find(
    (candidate) => candidate.component === component
  );
  if (!authorization) {
    throw new TypeError("OPERATIONAL_OVERVIEW_COMPONENT_NOT_AUTHORIZED");
  }
  return authorization;
}

function componentInspection(
  context: OperationalOverviewProofContext,
  component: OperationalOverviewComponent
) {
  const inspection = context.component_source_inspected.find(
    (candidate) => candidate.component === component
  );
  if (!inspection) {
    throw new TypeError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  }
  return inspection;
}

function requestProofIdentity(context: OperationalOverviewProofContext) {
  return {
    request_id: context.request_id,
    company_id: context.company_id,
    actor_user_id: context.actor_user_id,
    oauth_grant_id: context.oauth_grant_id,
    oauth_client_id: context.oauth_client_id,
    grant_revision: context.grant_revision,
    granted_scope_ceiling: context.granted_scope_ceiling,
    permission_snapshot_revision: context.permission_snapshot_revision,
    capability_id: context.capability_id,
    capability_revision: context.capability_revision,
    capability_manifest_revision: context.capability_manifest_revision,
    read_at: context.read_at,
  } as const;
}

export function operationalOverviewProofContext(input: {
  readonly authorization: AuthorizedOperationalOverviewRead;
  readonly readAt: string;
  readonly componentSourceInspected: readonly OperationalOverviewComponentSourceInspection[];
}): OperationalOverviewProofContext {
  if (!isAuthorizedOperationalOverviewRead(input.authorization)) {
    throw new TypeError("OPERATIONAL_OVERVIEW_AUTHORIZATION_INVALID");
  }
  const readAt = P2CanonicalTimestampSchema.parse(input.readAt);
  let componentSourceInspected: readonly OperationalOverviewComponentSourceInspection[];
  try {
    componentSourceInspected =
      OperationalOverviewComponentSourceInspectionVectorSchema.parse(
        input.componentSourceInspected
      );
  } catch {
    throw new TypeError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  }
  const expectedComponents = input.authorization.authorizedComponents.map(
    (component) => component.component
  );
  const inspectedComponents = componentSourceInspected.map(
    (inspection) => inspection.component
  );
  const sourceInspected = componentSourceInspected.reduce(
    (total, inspection) => total + inspection.source_inspected,
    0
  );
  if (
    JSON.stringify(inspectedComponents) !==
      JSON.stringify(expectedComponents) ||
    !Number.isSafeInteger(sourceInspected) ||
    sourceInspected < 0
  ) {
    throw new TypeError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  }
  return deepFreeze({
    request_id: input.authorization.actorContext.requestId,
    company_id: input.authorization.actorContext.companyId,
    actor_user_id: input.authorization.actorContext.actorUserId,
    oauth_grant_id: input.authorization.oauthGrantId,
    oauth_client_id: input.authorization.oauthClientId,
    grant_revision: input.authorization.grantRevision,
    granted_scope_ceiling: [...input.authorization.grantedScopeCeiling],
    permission_snapshot_revision:
      input.authorization.actorContext.permissionSnapshotRevision,
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    capability_manifest_revision:
      input.authorization.capabilityManifestRevision,
    selections: input.authorization.selections.map((selection) => ({
      ...selection,
    })),
    authorized_components: input.authorization.authorizedComponents.map(
      (component) => ({
        component: component.component,
        origin: component.origin,
        required_oauth_scopes: [...component.requiredOAuthScopes],
        resolved_permission_scopes: {
          ...component.resolvedPermissionScopes,
        },
        satisfied_permission_group_indexes: [0] as const,
      })
    ),
    warnings: input.authorization.warnings.map((warning) => ({ ...warning })),
    read_at: readAt,
    component_source_inspected: componentSourceInspected.map((inspection) => ({
      ...inspection,
    })),
    source_inspected: sourceInspected,
  });
}

export function operationalOverviewEntityProofRef(input: {
  readonly context: OperationalOverviewProofContext;
  readonly item: OperationalOverviewComponentItem;
  readonly sourceInspected: number;
  readonly sourceRevisions: readonly OperationalOverviewRevision[];
}) {
  const item = OperationalOverviewComponentItemSchema.parse(input.item);
  const authorization = componentAuthorization(input.context, item.component);
  const inspection = componentInspection(input.context, item.component);
  const sourceRevisions = exactItemRevisions(input.sourceRevisions);
  if (input.sourceInspected !== inspection.source_inspected) {
    throw new TypeError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  }
  return proofRef({
    ...requestProofIdentity(input.context),
    proof_kind: "operational_overview_entity",
    component_authorization: authorization,
    source_inspected: inspection.source_inspected,
    source_revisions: sourceRevisions,
    item,
  });
}

export function operationalOverviewEvidenceRef(input: {
  readonly context: OperationalOverviewProofContext;
  readonly component: OperationalOverviewComponent;
  readonly sourceInspected: number;
  readonly sourceRevisions: readonly OperationalOverviewRevision[];
}) {
  const authorization = componentAuthorization(input.context, input.component);
  const inspection = componentInspection(input.context, input.component);
  const sourceRevisions = exactItemRevisions(input.sourceRevisions);
  if (input.sourceInspected !== inspection.source_inspected) {
    throw new TypeError("OPERATIONAL_OVERVIEW_SOURCE_INSPECTION_INVALID");
  }
  return evidenceRef({
    ...requestProofIdentity(input.context),
    proof_kind: "operational_overview_evidence",
    component_authorization: authorization,
    source_inspected: inspection.source_inspected,
    source_revisions: sourceRevisions,
  });
}

export function operationalOverviewCollectionProofRef(input: {
  readonly context: OperationalOverviewProofContext;
  readonly sourceRevisions: readonly OperationalOverviewRevision[];
  readonly children: readonly OperationalOverviewProofChild[];
}) {
  const sourceRevisions = OperationalOverviewRevisionVectorSchema.parse(
    input.sourceRevisions
  );
  const authorizedComponents = input.context.authorized_components.map(
    (component) => component.component
  );
  if (
    input.children.length !== authorizedComponents.length ||
    input.children.some(
      (child, index) =>
        child.component !== authorizedComponents[index] ||
        child.source_inspected !==
          input.context.component_source_inspected[index]?.source_inspected ||
        !P2ProofRefSchema.safeParse(child.proof_ref).success ||
        !P2EvidenceRefSchema.safeParse(child.evidence_ref).success ||
        exactItemRevisions(child.source_revisions).length === 0
    )
  ) {
    throw new TypeError("OPERATIONAL_OVERVIEW_COLLECTION_CHILDREN_INVALID");
  }

  const revisionByDomain = new Map<string, number>();
  for (const child of input.children) {
    for (const revision of child.source_revisions) {
      const existing = revisionByDomain.get(revision.domain);
      if (existing !== undefined && existing !== revision.source_revision) {
        throw new TypeError("OPERATIONAL_OVERVIEW_REVISION_CONFLICT");
      }
      revisionByDomain.set(revision.domain, revision.source_revision);
    }
  }
  const aggregate = [...revisionByDomain.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([domain, source_revision]) => ({ domain, source_revision }));
  if (JSON.stringify(aggregate) !== JSON.stringify(sourceRevisions)) {
    throw new TypeError("OPERATIONAL_OVERVIEW_COLLECTION_REVISIONS_INVALID");
  }

  return proofRef({
    ...requestProofIdentity(input.context),
    selections: input.context.selections,
    authorized_components: input.context.authorized_components,
    warnings: input.context.warnings,
    component_source_inspected: input.context.component_source_inspected,
    source_inspected: input.context.source_inspected,
    proof_kind: "operational_overview_collection",
    source_revisions: sourceRevisions,
    returned_count: input.children.length,
    has_more: false,
    children: input.children,
  });
}
