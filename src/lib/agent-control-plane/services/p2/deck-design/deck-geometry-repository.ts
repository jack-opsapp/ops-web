import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  createP2CanonicalTextSchema,
  type P2DomainRevision,
} from "@/lib/agent-control-plane/contracts";
import {
  DECK_GEOMETRY_MAX_SOURCE_BYTES,
  DeckDesignGeometryInputSchema,
} from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import { DeckDesignRefSchema } from "@/lib/agent-control-plane/contracts/job-artifacts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedDeckDesignGeometryRead,
  type AuthorizedDeckDesignGeometryRead,
} from "./deck-geometry-authorization";
import {
  deckDesignRef,
  deckGeometryDrawingContentHash,
  exactDeckGeometrySourceRevisions,
  type DeckGeometryAuthorityPath,
  type DeckGeometryDesignParents,
  type DeckGeometrySelectedAuthorization,
  type DeckGeometrySourceInspected,
} from "./deck-geometry-proof";

const RPC = "read_agent_deck_design_geometry_as_system" as const;
const TRUSTED_DECK_GEOMETRY_REPOSITORIES = new WeakSet<object>();
export const DECK_GEOMETRY_SOURCE_FETCH_LIMIT = 501;

const PermissionScopeSchema = z.enum(["all", "assigned", "own"]);
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), PermissionScopeSchema)
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.keys(value).every((key) =>
        (REGISTERED_ACTOR_PERMISSION_KEYS as readonly string[]).includes(key)
      ),
    "DECK_GEOMETRY_PERMISSION_VECTOR_INVALID"
  );
const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "DECK_GEOMETRY_ARRAY_NOT_CANONICAL"
  );
const SatisfiedGroupIndexesSchema = z
  .array(z.number().int().safe().min(0).max(31))
  .min(1)
  .max(32)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "DECK_GEOMETRY_GROUP_VECTOR_NOT_CANONICAL"
  );
const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => {
    try {
      exactDeckGeometrySourceRevisions(revisions);
      return true;
    } catch {
      return false;
    }
  },
  "DECK_GEOMETRY_REVISION_VECTOR_INVALID"
);
const SourceInspectedSchema = z
  .object({
    artifact_bridges: z.number().int().min(0).max(1),
    deck_designs: z.number().int().min(0).max(1),
    jobs: z.number().int().min(0).max(2),
    site_visits: z.number().int().min(0).max(1),
    visit_opportunities: z.number().int().min(0).max(1),
  })
  .strict();
const AuthorizationVariantSchema = z.enum([
  "job_artifact_opportunity",
  "job_artifact_project",
  "site_visit_artifact_linked",
  "site_visit_artifact_unlinked",
]);
const DesignParentsSchema = z
  .object({
    opportunity_id: P2CanonicalUuidSchema.nullable(),
    project_id: P2CanonicalUuidSchema.nullable(),
  })
  .strict();
const DrawingContentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const TitleTextSchema = createP2CanonicalTextSchema({
  minimumScalars: 1,
  maximumScalars: 256,
  maximumUtf8Bytes: 1_024,
  allowTextWhitespace: true,
}).nullable();

const RawSnapshotSchema = z
  .object({
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
    granted_scope_ceiling: CanonicalStringArraySchema,
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    capability_id: z.literal("get_deck_design_geometry"),
    capability_revision: z.literal("get_deck_design_geometry:2026-08-22.v1"),
    selected_authorization_variant: AuthorizationVariantSchema,
    required_oauth_scopes: CanonicalStringArraySchema,
    resolved_permission_scopes: PermissionScopesSchema,
    satisfied_permission_group_indexes: SatisfiedGroupIndexesSchema,
    query: DeckDesignGeometryInputSchema,
    read_at: P2CanonicalTimestampSchema,
    source_revisions: ExactSourceRevisionsSchema,
    source_inspected: SourceInspectedSchema,
    authority_path: z.enum([
      "job_opportunity",
      "job_project",
      "site_visit_linked",
      "site_visit_unlinked",
    ]),
    visit_opportunity_id: P2CanonicalUuidSchema.nullable(),
    design_parents: DesignParentsSchema,
    design_id: P2CanonicalUuidSchema,
    deck_design_ref: DeckDesignRefSchema,
    title_text: TitleTextSchema,
    drawing_source: z.string(),
    drawing_content_hash: DrawingContentHashSchema,
  })
  .strict();

export interface DeckGeometryReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface DeckGeometryReadRpcRequest extends PromiseLike<DeckGeometryReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<DeckGeometryReadRpcResult>;
}

export interface DeckGeometryReadRpcClient {
  rpc(
    functionName: typeof RPC,
    args: Readonly<Record<string, unknown>>
  ): DeckGeometryReadRpcRequest;
}

export interface DeckGeometrySourceSnapshot {
  readonly designId: string;
  readonly titleText: string | null;
  readonly drawingSource: string;
  readonly drawingContentHash: string;
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: DeckGeometrySourceInspected;
  readonly selectedAuthorization: DeckGeometrySelectedAuthorization;
  readonly authorityPath: DeckGeometryAuthorityPath;
  readonly visitOpportunityId: string | null;
  readonly designParents: DeckGeometryDesignParents;
}

export type DeckGeometryRepositoryResult =
  | Readonly<{ state: "found"; snapshot: DeckGeometrySourceSnapshot }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface DeckGeometryReadRepository {
  get(input: {
    readonly authorization: AuthorizedDeckDesignGeometryRead;
    readonly signal?: AbortSignal;
  }): Promise<DeckGeometryRepositoryResult>;
}

export class DeckGeometryReadRepositoryError extends Error {
  readonly code: "DECK_GEOMETRY_READ_FAILED" | "DECK_GEOMETRY_READ_INVALID";

  constructor(
    code: DeckGeometryReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "DeckGeometryReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new DeckGeometryReadRepositoryError("DECK_GEOMETRY_READ_INVALID", {
    cause,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalOperationalProjection(left as never) ===
      canonicalOperationalProjection(right as never)
    );
  } catch {
    return false;
  }
}

function exactBinding(
  snapshot: z.infer<typeof RawSnapshotSchema>,
  authorization: AuthorizedDeckDesignGeometryRead
): DeckGeometrySelectedAuthorization | null {
  if (
    !(
      snapshot.company_id === authorization.actorContext.companyId &&
      snapshot.actor_user_id === authorization.actorContext.actorUserId &&
      snapshot.oauth_grant_id === authorization.oauthGrantId &&
      snapshot.oauth_client_id === authorization.oauthClientId &&
      snapshot.grant_revision === authorization.grantRevision &&
      sameJson(
        snapshot.granted_scope_ceiling,
        authorization.grantedScopeCeiling
      ) &&
      snapshot.permission_snapshot_revision ===
        authorization.actorContext.permissionSnapshotRevision &&
      snapshot.capability_manifest_revision ===
        authorization.capabilityManifestRevision &&
      snapshot.capability_id === authorization.capabilityId &&
      snapshot.capability_revision === authorization.capabilityRevision &&
      sameJson(snapshot.query, authorization.query)
    )
  ) {
    return null;
  }
  const selected = authorization.authorizationCandidates.find(
    (candidate) =>
      candidate.variantKey === snapshot.selected_authorization_variant
  );
  return selected &&
    sameJson(snapshot.required_oauth_scopes, selected.requiredOAuthScopes) &&
    sameJson(
      snapshot.resolved_permission_scopes,
      selected.resolvedPermissionScopes
    ) &&
    sameJson(
      snapshot.satisfied_permission_group_indexes,
      selected.satisfiedPermissionGroupIndexes
    )
    ? selected
    : null;
}

function scopeIn(scope: string | null, allowed: readonly string[]): boolean {
  return scope !== null && allowed.includes(scope);
}

function exactAuthorityPath(input: {
  readonly snapshot: z.infer<typeof RawSnapshotSchema>;
  readonly authorization: AuthorizedDeckDesignGeometryRead;
  readonly selectedAuthorization: DeckGeometrySelectedAuthorization;
}): boolean {
  const { snapshot, authorization, selectedAuthorization } = input;
  const query = authorization.query;
  const inspected = snapshot.source_inspected;
  const parents = snapshot.design_parents;
  const parentCount =
    Number(parents.opportunity_id !== null) +
    Number(parents.project_id !== null);
  if (parentCount === 0) {
    if (selectedAuthorization.deckBuilderScope !== "all") return false;
  } else if (
    !scopeIn(selectedAuthorization.deckBuilderScope, ["all", "assigned"])
  ) {
    return false;
  }
  if (parents.opportunity_id !== null) {
    if (!scopeIn(selectedAuthorization.pipelineScope, ["all", "assigned"])) {
      return false;
    }
  }
  if (parents.project_id !== null) {
    if (!scopeIn(selectedAuthorization.projectsScope, ["all", "assigned"])) {
      return false;
    }
  }

  if (query.source === "job_artifact") {
    const expectedVariant = `job_artifact_${query.job_ref.kind}`;
    const selectedParentId =
      query.job_ref.kind === "opportunity"
        ? parents.opportunity_id
        : parents.project_id;
    return (
      snapshot.authority_path === `job_${query.job_ref.kind}` &&
      selectedAuthorization.variantKey === expectedVariant &&
      snapshot.visit_opportunity_id === null &&
      selectedParentId === query.job_ref.id &&
      inspected.artifact_bridges === 0 &&
      inspected.deck_designs === 1 &&
      inspected.jobs === parentCount &&
      inspected.site_visits === 0 &&
      inspected.visit_opportunities === 0
    );
  }

  const linked = snapshot.authority_path === "site_visit_linked";
  const unlinked = snapshot.authority_path === "site_visit_unlinked";
  if (
    (!linked && !unlinked) ||
    inspected.artifact_bridges !== 1 ||
    inspected.deck_designs !== 1 ||
    inspected.jobs !== parentCount ||
    inspected.site_visits !== 1 ||
    inspected.visit_opportunities !== (linked ? 1 : 0) ||
    linked !== (snapshot.visit_opportunity_id !== null) ||
    selectedAuthorization.variantKey !==
      (linked ? "site_visit_artifact_linked" : "site_visit_artifact_unlinked")
  ) {
    return false;
  }
  if (unlinked) return selectedAuthorization.pipelineScope === "all";
  return (
    scopeIn(selectedAuthorization.calendarScope, ["all", "own"]) &&
    scopeIn(selectedAuthorization.clientsScope, ["all", "assigned"]) &&
    scopeIn(selectedAuthorization.pipelineScope, ["all", "assigned"])
  );
}

function knownErrorState(
  error: unknown
): "not_found" | "source_bound" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      record.code === "P0002" &&
      record.message === "agent_deck_geometry_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      record.message === "agent_deck_geometry_source_bound"
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_deck_geometry_read_stale"
    ) {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

async function execute(
  request: DeckGeometryReadRpcRequest,
  signal?: AbortSignal
): Promise<DeckGeometryReadRpcResult> {
  if (signal?.aborted) {
    throw new DeckGeometryReadRepositoryError("DECK_GEOMETRY_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new DeckGeometryReadRepositoryError("DECK_GEOMETRY_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof DeckGeometryReadRepositoryError) throw error;
    throw new DeckGeometryReadRepositoryError("DECK_GEOMETRY_READ_FAILED", {
      cause: error,
    });
  }
}

function rpcArguments(authorization: AuthorizedDeckDesignGeometryRead) {
  const query = authorization.query;
  return {
    p_request_id: authorization.actorContext.requestId,
    p_actor_user_id: authorization.actorContext.actorUserId,
    p_company_id: authorization.actorContext.companyId,
    p_oauth_grant_id: authorization.oauthGrantId,
    p_oauth_client_id: authorization.oauthClientId,
    p_grant_revision: authorization.grantRevision,
    p_granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    p_permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision: authorization.capabilityManifestRevision,
    p_capability_id: authorization.capabilityId,
    p_capability_revision: authorization.capabilityRevision,
    p_authorization_candidates: authorization.authorizationCandidates.map(
      (candidate) => ({
        variant_key: candidate.variantKey,
        required_oauth_scopes: [...candidate.requiredOAuthScopes],
        resolved_permission_scopes: {
          ...candidate.resolvedPermissionScopes,
        },
        satisfied_permission_group_indexes: [
          ...candidate.satisfiedPermissionGroupIndexes,
        ],
      })
    ),
    p_source: query.source,
    p_job_kind: query.source === "job_artifact" ? query.job_ref.kind : null,
    p_job_id: query.source === "job_artifact" ? query.job_ref.id : null,
    p_site_visit_id:
      query.source === "site_visit_artifact" ? query.site_visit_ref.id : null,
    p_deck_design_ref: query.deck_design_ref,
    p_source_limit: DECK_GEOMETRY_SOURCE_FETCH_LIMIT,
  };
}

export function createSupabaseDeckGeometryReadRepository(
  client: DeckGeometryReadRpcClient
): DeckGeometryReadRepository {
  let suppliedRpc: DeckGeometryReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as DeckGeometryReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A deck-geometry RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A deck-geometry RPC client is required");
  }
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(suppliedRpc!, client, [
      RPC,
      args,
    ]) as DeckGeometryReadRpcRequest;

  const repository: DeckGeometryReadRepository = {
    async get(input) {
      if (!isAuthorizedDeckDesignGeometryRead(input.authorization)) invalid();
      const response = await execute(
        rpc(rpcArguments(input.authorization)),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error);
        if (state) return deepFreeze({ state });
        throw new DeckGeometryReadRepositoryError("DECK_GEOMETRY_READ_FAILED");
      }
      try {
        const raw = RawSnapshotSchema.parse(response.data);
        const selectedAuthorization = exactBinding(raw, input.authorization);
        const sourceBytes = new TextEncoder().encode(raw.drawing_source).length;
        if (
          selectedAuthorization === null ||
          !exactAuthorityPath({
            snapshot: raw,
            authorization: input.authorization,
            selectedAuthorization,
          }) ||
          raw.deck_design_ref !== input.authorization.query.deck_design_ref ||
          raw.deck_design_ref !==
            deckDesignRef({
              companyId: input.authorization.actorContext.companyId,
              designId: raw.design_id,
            }) ||
          raw.drawing_content_hash !==
            deckGeometryDrawingContentHash(raw.drawing_source) ||
          sourceBytes > DECK_GEOMETRY_MAX_SOURCE_BYTES
        ) {
          invalid();
        }
        const snapshot: DeckGeometrySourceSnapshot = {
          designId: raw.design_id,
          titleText: raw.title_text,
          drawingSource: raw.drawing_source,
          drawingContentHash: raw.drawing_content_hash,
          readAt: raw.read_at,
          sourceRevisions: exactDeckGeometrySourceRevisions(
            raw.source_revisions
          ),
          sourceInspected: raw.source_inspected,
          selectedAuthorization,
          authorityPath: raw.authority_path,
          visitOpportunityId: raw.visit_opportunity_id,
          designParents: {
            opportunityId: raw.design_parents.opportunity_id,
            projectId: raw.design_parents.project_id,
          },
        };
        return deepFreeze({ state: "found" as const, snapshot });
      } catch (error) {
        if (error instanceof DeckGeometryReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_DECK_GEOMETRY_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedDeckGeometryReadRepository(
  value: unknown
): value is DeckGeometryReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_DECK_GEOMETRY_REPOSITORIES.has(value)
  );
}
