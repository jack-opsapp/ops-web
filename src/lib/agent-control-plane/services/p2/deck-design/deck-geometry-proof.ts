import "server-only";

import { createHash } from "node:crypto";

import type { P2DomainRevision } from "@/lib/agent-control-plane/contracts";
import {
  DECK_GEOMETRY_CALCULATOR_REVISION,
  DECK_GEOMETRY_LOCAL_REF_REVISION,
  type DeckDesignGeometryResult,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import type { AuthorizedDeckDesignGeometryRead } from "./deck-geometry-authorization";

export type DeckGeometryAuthorityPath =
  | "job_opportunity"
  | "job_project"
  | "site_visit_linked"
  | "site_visit_unlinked";

export interface DeckGeometryDesignParents {
  readonly opportunityId: string | null;
  readonly projectId: string | null;
}

export type DeckGeometrySelectedAuthorization =
  AuthorizedDeckDesignGeometryRead["authorizationCandidates"][number];

export interface DeckGeometrySourceInspected {
  readonly artifact_bridges: number;
  readonly deck_designs: number;
  readonly jobs: number;
  readonly site_visits: number;
  readonly visit_opportunities: number;
}

interface DeckGeometryProofAuthority {
  readonly company_id: string;
  readonly actor_user_id: string;
  readonly oauth_grant_id: string;
  readonly oauth_client_id: string;
  readonly grant_revision: string;
  readonly granted_scope_ceiling: readonly string[];
  readonly permission_snapshot_revision: string;
  readonly capability_manifest_revision: "2026-08-22.capability-manifest.v8";
  readonly selected_authorization_variant: DeckGeometrySelectedAuthorization["variantKey"];
  readonly required_oauth_scopes: readonly string[];
  readonly resolved_permission_scopes: Readonly<Record<string, string>>;
  readonly satisfied_permission_group_indexes: readonly number[];
}

export interface DeckGeometryProofContext extends DeckGeometryProofAuthority {
  readonly capability_id: "get_deck_design_geometry";
  readonly capability_revision: "get_deck_design_geometry:2026-08-22.v1";
  readonly selected_anchor: AuthorizedDeckDesignGeometryRead["query"];
  readonly authority_path: DeckGeometryAuthorityPath;
  readonly design_id: string;
  readonly design_parents: Readonly<{
    opportunity_id: string | null;
    project_id: string | null;
  }>;
  readonly drawing_content_hash: string;
  readonly calculator_revision: typeof DECK_GEOMETRY_CALCULATOR_REVISION;
  readonly local_ref_revision: typeof DECK_GEOMETRY_LOCAL_REF_REVISION;
  readonly read_at: string;
  readonly source_revisions: readonly P2DomainRevision[];
  readonly source_inspected: DeckGeometrySourceInspected;
}

function canonicalDeckProjection(
  value: unknown,
  ancestors = new WeakSet<object>()
): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("DECK_GEOMETRY_PROOF_NUMBER_INVALID");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("DECK_GEOMETRY_PROOF_VALUE_INVALID");
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    (Array.isArray(value) && prototype !== Array.prototype) ||
    (!Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null)
  ) {
    throw new TypeError("DECK_GEOMETRY_PROOF_VALUE_INVALID");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.entries(descriptors).some(
      ([key, descriptor]) =>
        !(Array.isArray(value) && key === "length") &&
        (!("value" in descriptor) || descriptor.enumerable !== true)
    )
  ) {
    throw new TypeError("DECK_GEOMETRY_PROOF_VALUE_INVALID");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        throw new TypeError("DECK_GEOMETRY_PROOF_VALUE_INVALID");
      }
      return `[${value
        .map((item) => canonicalDeckProjection(item, ancestors))
        .join(",")}]`;
    }
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort((left, right) =>
      left.localeCompare(right)
    );
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalDeckProjection(
            record[key],
            ancestors
          )}`
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalHashHex(material: unknown): string {
  return createHash("sha256")
    .update(canonicalDeckProjection(material), "utf8")
    .digest("hex");
}

function proofRef(material: unknown): `ops_proof:v1:${string}` {
  return `ops_proof:v1:${canonicalHashHex(material)}`;
}

function evidenceRef(material: unknown): `ops_evidence:v1:${string}` {
  return `ops_evidence:v1:${canonicalHashHex(material)}`;
}

export function deckDesignRef(input: {
  readonly companyId: string;
  readonly designId: string;
}): `ops_deck_design:v1:${string}` {
  return `ops_deck_design:v1:${canonicalHashHex({
    company_id: input.companyId,
    deck_design_id: input.designId,
  })}`;
}

export function deckGeometryDrawingContentHash(
  canonicalDrawingSource: string
): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalDrawingSource, "utf8")
    .digest("hex")}`;
}

export function deckGeometryEvidenceRef(input: {
  readonly companyId: string;
  readonly designId: string;
  readonly drawingContentHash: string;
}): `ops_evidence:v1:${string}` {
  return evidenceRef({
    company_id: input.companyId,
    deck_design_id: input.designId,
    drawing_content_hash: input.drawingContentHash,
  });
}

export function exactDeckGeometrySourceRevisions(
  revisions: readonly P2DomainRevision[]
): readonly P2DomainRevision[] {
  const expected = [
    "artifacts",
    "deck_designs",
    "legacy_operational",
    "site_visits",
  ] as const;
  if (
    revisions.length !== expected.length ||
    revisions.some(
      (revision, index) =>
        revision.domain !== expected[index] ||
        !Number.isSafeInteger(revision.source_revision) ||
        revision.source_revision < 0
    )
  ) {
    throw new TypeError("DECK_GEOMETRY_REVISION_VECTOR_INVALID");
  }
  return Object.freeze(
    revisions.map((revision) => Object.freeze({ ...revision }))
  );
}

function assertSelectedAuthorization(input: {
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly selectedAuthorization: DeckGeometrySelectedAuthorization;
}): DeckGeometrySelectedAuthorization {
  if (
    !input.authorization.authorizationCandidates.some(
      (candidate) => candidate === input.selectedAuthorization
    )
  ) {
    throw new TypeError("DECK_GEOMETRY_AUTHORIZATION_SELECTION_INVALID");
  }
  return input.selectedAuthorization;
}

function designParentsProjection(
  parents: DeckGeometryDesignParents
): Readonly<{ opportunity_id: string | null; project_id: string | null }> {
  return {
    opportunity_id: parents.opportunityId,
    project_id: parents.projectId,
  };
}

function fenceMaterial(input: {
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly selectedAuthorization: DeckGeometrySelectedAuthorization;
  readonly designId: string;
  readonly drawingContentHash: string;
  readonly authorityPath: DeckGeometryAuthorityPath;
  readonly designParents: DeckGeometryDesignParents;
  readonly sourceRevisions: readonly P2DomainRevision[];
}) {
  const selectedAuthorization = assertSelectedAuthorization(input);
  return {
    ...authorityProjection(input.authorization, selectedAuthorization),
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    selected_anchor: input.authorization.query,
    authority_path: input.authorityPath,
    deck_design_id: input.designId,
    design_parents: designParentsProjection(input.designParents),
    drawing_content_hash: input.drawingContentHash,
    source_revisions: exactDeckGeometrySourceRevisions(input.sourceRevisions),
    calculator_revision: DECK_GEOMETRY_CALCULATOR_REVISION,
    local_ref_revision: DECK_GEOMETRY_LOCAL_REF_REVISION,
  };
}

export function deckGeometrySourceFence(input: {
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly selectedAuthorization: DeckGeometrySelectedAuthorization;
  readonly designId: string;
  readonly drawingContentHash: string;
  readonly authorityPath: DeckGeometryAuthorityPath;
  readonly designParents: DeckGeometryDesignParents;
  readonly sourceRevisions: readonly P2DomainRevision[];
}): `ops_deck_geometry_fence:v1:${string}` {
  const digest = createHash("sha256")
    .update(canonicalDeckProjection(fenceMaterial(input)), "utf8")
    .digest("base64url");
  return `ops_deck_geometry_fence:v1:${digest}`;
}

function authorityProjection(
  authorization: AuthorizedDeckDesignGeometryRead,
  selectedAuthorization: DeckGeometrySelectedAuthorization
): DeckGeometryProofAuthority {
  assertSelectedAuthorization({ authorization, selectedAuthorization });
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
    selected_authorization_variant: selectedAuthorization.variantKey,
    required_oauth_scopes: selectedAuthorization.requiredOAuthScopes,
    resolved_permission_scopes: selectedAuthorization.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      selectedAuthorization.satisfiedPermissionGroupIndexes,
  };
}

export function deckGeometryProofContext(input: {
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly selectedAuthorization: DeckGeometrySelectedAuthorization;
  readonly authorityPath: DeckGeometryAuthorityPath;
  readonly designId: string;
  readonly designParents: DeckGeometryDesignParents;
  readonly drawingContentHash: string;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: DeckGeometrySourceInspected;
}): DeckGeometryProofContext {
  return {
    ...authorityProjection(input.authorization, input.selectedAuthorization),
    capability_id: input.authorization.capabilityId,
    capability_revision: input.authorization.capabilityRevision,
    selected_anchor: input.authorization.query,
    authority_path: input.authorityPath,
    design_id: input.designId,
    design_parents: designParentsProjection(input.designParents),
    drawing_content_hash: input.drawingContentHash,
    calculator_revision: DECK_GEOMETRY_CALCULATOR_REVISION,
    local_ref_revision: DECK_GEOMETRY_LOCAL_REF_REVISION,
    read_at: input.readAt,
    source_revisions: exactDeckGeometrySourceRevisions(input.sourceRevisions),
    source_inspected: input.sourceInspected,
  };
}

export function deckGeometryEntityProofRef(input: {
  readonly context: DeckGeometryProofContext;
  readonly result: Omit<DeckDesignGeometryResult, "proof">;
}) {
  return proofRef({
    ...input.context,
    proof_kind: "deck_design_geometry_entity",
    result: input.result,
  });
}
