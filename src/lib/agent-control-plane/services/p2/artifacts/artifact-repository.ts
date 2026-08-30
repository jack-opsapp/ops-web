import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  isCanonicalPostgresUuid,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  P2EvidenceRefSchema,
  P2ProofRefSchema,
  type P2DomainRevision,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  ARTIFACT_FETCH_LIMIT,
  ARTIFACT_MAX_PAGE_ITEMS,
  ARTIFACT_MAX_SOURCE_ROWS,
  ArtifactEvidenceContentSchema,
  ArtifactJobRefSchema,
  ArtifactMetadataSchema,
  ArtifactSourceKindSchema,
  GetJobArtifactEvidenceSourceResultSchema,
  assertNoArtifactForbiddenFields,
  type ArtifactMetadata,
  type GetJobArtifactEvidenceSourceResult,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetJobArtifactEvidenceRead,
  isAuthorizedListJobArtifactsRead,
  type AuthorizedGetJobArtifactEvidenceRead,
  type AuthorizedListJobArtifactsRead,
} from "./artifact-authorization";
import type {
  ArtifactListCursorContext,
  ArtifactListPredecessor,
} from "./artifact-cursor";
import {
  artifactEvidenceRef,
  artifactExactEntityProofRef,
  artifactExactProofContext,
  artifactListCollectionProofRef,
  artifactListEntityProofRef,
  artifactListProofContext,
} from "./artifact-proof";

const LIST_RPC = "read_agent_job_artifacts_as_system" as const;
const EXACT_RPC = "read_agent_job_artifact_evidence_as_system" as const;
const TRUSTED_ARTIFACT_REPOSITORIES = new WeakSet<object>();

const PermissionScopeSchema = z.enum(["all", "assigned", "own"]);
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), PermissionScopeSchema)
  .refine(
    (value) => Object.keys(value).length <= 32,
    "ARTIFACT_PERMISSIONS_BOUND"
  );
const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "ARTIFACT_ARRAY_NOT_CANONICAL"
  );
const CanonicalSourceKindsSchema = z
  .array(ArtifactSourceKindSchema)
  .min(1)
  .max(8)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "ARTIFACT_SOURCE_VECTOR_NOT_CANONICAL"
  );
const ExactArtifactRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 2 &&
    revisions[0]?.domain === "artifacts" &&
    revisions[1]?.domain === "legacy_operational",
  "ARTIFACT_REVISION_VECTOR_INVALID"
);
function isCanonicalArtifactSourceId(value: string): boolean {
  const parts = value.split(":");
  return (
    isCanonicalPostgresUuid(parts[0]) &&
    (parts.length === 1 ||
      (parts.length === 2 &&
        (parts[1] === "" || isCanonicalPostgresUuid(parts[1]))))
  );
}

const ArtifactSourceIdSchema = z
  .string()
  .min(36)
  .max(73)
  .refine(isCanonicalArtifactSourceId, "ARTIFACT_SOURCE_ID_NOT_CANONICAL");
const PredecessorSchema = z
  .object({
    order: z.tuple([
      P2CanonicalTimestampSchema,
      ArtifactSourceKindSchema,
      P2EvidenceRefSchema,
    ]),
    tie_breaker: P2EvidenceRefSchema,
  })
  .strict()
  .refine(
    (predecessor) => predecessor.order[2] === predecessor.tie_breaker,
    "ARTIFACT_PREDECESSOR_INVALID"
  );
const ListRowSchema = z
  .object({
    artifact: ArtifactMetadataSchema,
    source_id: ArtifactSourceIdSchema,
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
    predecessor: PredecessorSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.evidence_ref === row.artifact.evidence_ref &&
      row.predecessor.tie_breaker === row.evidence_ref &&
      row.predecessor.order[0] === row.artifact.occurred_at &&
      row.predecessor.order[1] === row.artifact.source_kind,
    "ARTIFACT_ROW_BINDING_INVALID"
  );

const BindingShape = {
  company_id: P2CanonicalUuidSchema,
  actor_user_id: P2CanonicalUuidSchema,
  oauth_grant_id: P2CanonicalUuidSchema,
  oauth_client_id: P2CanonicalUuidSchema,
  grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
  granted_scope_ceiling: CanonicalStringArraySchema,
  permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  capability_manifest_revision: z.literal("2026-08-22.capability-manifest.v8"),
  required_oauth_scopes: CanonicalStringArraySchema,
  resolved_permission_scopes: PermissionScopesSchema,
  source_kinds: CanonicalSourceKindsSchema,
  read_at: P2CanonicalTimestampSchema,
  source_revisions: ExactArtifactRevisionsSchema,
} as const;

const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("list_job_artifacts"),
    capability_revision: z.literal("list_job_artifacts:2026-08-22.v1"),
    ranking_revision: z.literal("artifact-ranking:2026-08-22.v1"),
    job_ref: ArtifactJobRefSchema,
    item_limit: z.number().int().min(1).max(ARTIFACT_MAX_PAGE_ITEMS),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z
      .array(
        z
          .object({
            domain: z.string().min(1).max(128),
            source_revision: z.number().int().safe().nonnegative(),
          })
          .strict()
      )
      .max(2),
    cursor_predecessor: PredecessorSchema.nullable(),
    source_inspected: z.number().int().min(0).max(ARTIFACT_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(ListRowSchema).max(ARTIFACT_MAX_PAGE_ITEMS),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

const RawExactSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_job_artifact_evidence"),
    capability_revision: z.literal("get_job_artifact_evidence:2026-08-22.v1"),
    job_ref: ArtifactJobRefSchema,
    selected_source_kind: ArtifactSourceKindSchema,
    requested_evidence_ref: P2EvidenceRefSchema,
    source_inspected: z.number().int().min(0).max(ARTIFACT_MAX_SOURCE_ROWS),
    artifact: ArtifactMetadataSchema,
    content: ArtifactEvidenceContentSchema,
    source_id: ArtifactSourceIdSchema,
    proof_ref: P2ProofRefSchema,
  })
  .strict();

export interface ArtifactReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface ArtifactReadRpcRequest extends PromiseLike<ArtifactReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<ArtifactReadRpcResult>;
}

export interface ArtifactReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof EXACT_RPC,
    args: Readonly<Record<string, unknown>>
  ): ArtifactReadRpcRequest;
}

export interface ArtifactListRepositoryUnit {
  readonly item: ArtifactMetadata;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: ArtifactListPredecessor;
}

export interface ArtifactListRepositoryPage {
  readonly units: readonly ArtifactListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type ArtifactListRepositoryResult =
  | Readonly<{ state: "found"; page: ArtifactListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export type ArtifactExactRepositoryResult =
  | Readonly<{
      state: "found";
      value: GetJobArtifactEvidenceSourceResult;
    }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface ArtifactReadRepository {
  list(input: {
    readonly authorization: AuthorizedListJobArtifactsRead;
    readonly cursor: ArtifactListCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<ArtifactListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetJobArtifactEvidenceRead;
    readonly signal?: AbortSignal;
  }): Promise<ArtifactExactRepositoryResult>;
}

export class ArtifactReadRepositoryError extends Error {
  readonly code: "ARTIFACT_READ_FAILED" | "ARTIFACT_READ_INVALID";

  constructor(
    code: ArtifactReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "ArtifactReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new ArtifactReadRepositoryError("ARTIFACT_READ_INVALID", { cause });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameJson(left: unknown, right: unknown) {
  try {
    return (
      canonicalOperationalProjection(
        left as Parameters<typeof canonicalOperationalProjection>[0]
      ) ===
      canonicalOperationalProjection(
        right as Parameters<typeof canonicalOperationalProjection>[0]
      )
    );
  } catch {
    return false;
  }
}

function predecessorComesBefore(
  left: ArtifactListPredecessor,
  right: ArtifactListPredecessor
) {
  return (
    left.order[0] > right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] < right.order[1]) ||
    (left.order[0] === right.order[0] &&
      left.order[1] === right.order[1] &&
      left.order[2] < right.order[2])
  );
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawExactSnapshotSchema>,
  authorization:
    | AuthorizedListJobArtifactsRead
    | AuthorizedGetJobArtifactEvidenceRead
) {
  return (
    snapshot.company_id === authorization.actorContext.companyId &&
    snapshot.actor_user_id === authorization.actorContext.actorUserId &&
    snapshot.oauth_grant_id === authorization.oauthGrantId &&
    snapshot.oauth_client_id === authorization.oauthClientId &&
    snapshot.grant_revision === authorization.grantRevision &&
    sameStrings(
      snapshot.granted_scope_ceiling,
      authorization.grantedScopeCeiling
    ) &&
    snapshot.permission_snapshot_revision ===
      authorization.actorContext.permissionSnapshotRevision &&
    snapshot.capability_id === authorization.capabilityId &&
    snapshot.capability_revision === authorization.capabilityRevision &&
    snapshot.capability_manifest_revision ===
      authorization.capabilityManifestRevision &&
    sameStrings(
      snapshot.required_oauth_scopes,
      authorization.requiredOAuthScopes
    ) &&
    sameJson(
      snapshot.resolved_permission_scopes,
      authorization.resolvedPermissionScopes
    ) &&
    sameStrings(snapshot.source_kinds, authorization.sourceKinds)
  );
}

function knownErrorState(
  error: unknown,
  exact: boolean
): "not_found" | "source_bound" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const record = error as Readonly<Record<string, unknown>>;
    if (
      exact &&
      record.code === "P0002" &&
      record.message === "agent_artifact_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_artifact_source_query_bound" ||
        record.message === "agent_artifact_result_bound")
    ) {
      return "source_bound";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_artifact_read_stale"
    ) {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

function commonArguments(
  authorization:
    | AuthorizedListJobArtifactsRead
    | AuthorizedGetJobArtifactEvidenceRead
) {
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
    p_capability_id: authorization.capabilityId,
    p_capability_revision: authorization.capabilityRevision,
    p_capability_manifest_revision: authorization.capabilityManifestRevision,
    p_required_oauth_scopes: [...authorization.requiredOAuthScopes],
    p_resolved_permission_scopes: {
      ...authorization.resolvedPermissionScopes,
    },
    p_job_kind: authorization.query.job_ref.kind,
    p_job_id: authorization.query.job_ref.id,
    p_source_kinds: [...authorization.sourceKinds],
  };
}

async function execute(
  request: ArtifactReadRpcRequest,
  signal?: AbortSignal
): Promise<ArtifactReadRpcResult> {
  if (signal?.aborted) {
    throw new ArtifactReadRepositoryError("ARTIFACT_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new ArtifactReadRepositoryError("ARTIFACT_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof ArtifactReadRepositoryError) throw error;
    throw new ArtifactReadRepositoryError("ARTIFACT_READ_FAILED", {
      cause: error,
    });
  }
}

export function createSupabaseArtifactReadRepository(
  client: ArtifactReadRpcClient
): ArtifactReadRepository {
  let suppliedRpc: ArtifactReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as ArtifactReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("An artifact-read RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("An artifact-read RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof EXACT_RPC,
    args: Readonly<Record<string, unknown>>
  ) =>
    Reflect.apply(suppliedRpc!, client, [name, args]) as ArtifactReadRpcRequest;

  const repository: ArtifactReadRepository = {
    async list(input) {
      if (!isAuthorizedListJobArtifactsRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactArtifactRevisionsSchema.safeParse(cursor.sourceRevisions)
            .success ||
          !PredecessorSchema.safeParse(cursor.predecessor).success)
      ) {
        invalid();
      }
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(input.authorization),
          p_item_limit: input.authorization.query.limit,
          p_page_fetch_limit: Math.min(
            input.authorization.query.limit + 1,
            ARTIFACT_FETCH_LIMIT
          ),
          p_source_limit: ARTIFACT_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_occurred_at:
            cursor === null ? null : cursor.predecessor.order[0],
          p_after_source_kind:
            cursor === null ? null : cursor.predecessor.order[1],
          p_after_evidence_ref:
            cursor === null ? null : cursor.predecessor.tie_breaker,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, false);
        if (state === "source_bound" || state === "stale") {
          return deepFreeze({ state });
        }
        throw new ArtifactReadRepositoryError("ARTIFACT_READ_FAILED");
      }

      try {
        const snapshot = RawListSnapshotSchema.parse(response.data);
        const expectedCursorRevisions = cursor?.sourceRevisions ?? [];
        const proofRefs = snapshot.rows.map((row) => row.proof_ref);
        const evidenceRefs = snapshot.rows.map((row) => row.evidence_ref);
        const proofContext = artifactListProofContext({
          authorization: input.authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const validRowProofs = snapshot.rows.every((row) => {
          const sourceIdentity = {
            source_kind: row.artifact.source_kind,
            source_id: row.source_id,
          } as const;
          return (
            row.evidence_ref ===
              artifactEvidenceRef({
                companyId: input.authorization.actorContext.companyId,
                jobRef: input.authorization.query.job_ref,
                sourceIdentity,
              }) &&
            row.proof_ref ===
              artifactListEntityProofRef({
                context: proofContext,
                sourceIdentity,
                artifact: row.artifact,
              })
          );
        });
        const expectedCollectionProofRef = artifactListCollectionProofRef({
          context: proofContext,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            artifact_ref: {
              source_kind: row.artifact.source_kind,
              evidence_ref: row.evidence_ref,
            },
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          !sameJson(snapshot.job_ref, input.authorization.query.job_ref) ||
          snapshot.item_limit !== input.authorization.query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            expectedCursorRevisions
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          snapshot.source_inspected >= ARTIFACT_MAX_SOURCE_ROWS ||
          snapshot.rows.length > input.authorization.query.limit ||
          (snapshot.source_has_more &&
            snapshot.rows.length !== input.authorization.query.limit) ||
          !validRowProofs ||
          snapshot.collection_proof_ref !== expectedCollectionProofRef ||
          proofRefs.includes(snapshot.collection_proof_ref) ||
          new Set(proofRefs).size !== proofRefs.length ||
          new Set(evidenceRefs).size !== evidenceRefs.length ||
          !snapshot.rows.every(
            (row, index) =>
              input.authorization.sourceKinds.includes(
                row.artifact.source_kind
              ) &&
              (index === 0 ||
                predecessorComesBefore(
                  snapshot.rows[index - 1]!.predecessor,
                  row.predecessor
                ))
          )
        ) {
          invalid();
        }
        const units: ArtifactListRepositoryUnit[] = snapshot.rows.map(
          (row) => ({
            item: row.artifact,
            proof: {
              proof_ref: row.proof_ref,
              read_at: snapshot.read_at,
              source_revisions: snapshot.source_revisions,
            },
            evidence: [
              {
                evidence_ref: row.evidence_ref,
                source_domain: "artifacts",
                source_type: row.artifact.source_kind,
                occurred_at: snapshot.read_at,
              },
            ],
            predecessor: row.predecessor,
          })
        );
        const page: ArtifactListRepositoryPage = {
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertNoArtifactForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof ArtifactReadRepositoryError) throw error;
        invalid(error);
      }
    },

    async get(input) {
      if (!isAuthorizedGetJobArtifactEvidenceRead(input.authorization)) {
        invalid();
      }
      const response = await execute(
        rpc(EXACT_RPC, {
          ...commonArguments(input.authorization),
          p_source_kind: input.authorization.query.source_kind,
          p_evidence_ref: input.authorization.query.evidence_ref,
          p_source_limit: ARTIFACT_MAX_SOURCE_ROWS,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, true);
        if (state) return deepFreeze({ state });
        throw new ArtifactReadRepositoryError("ARTIFACT_READ_FAILED");
      }
      try {
        const snapshot = RawExactSnapshotSchema.parse(response.data);
        const sourceIdentity = {
          source_kind: snapshot.artifact.source_kind,
          source_id: snapshot.source_id,
        } as const;
        const proofContext = artifactExactProofContext({
          authorization: input.authorization,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          !sameJson(snapshot.job_ref, input.authorization.query.job_ref) ||
          snapshot.selected_source_kind !==
            input.authorization.query.source_kind ||
          snapshot.requested_evidence_ref !==
            input.authorization.query.evidence_ref ||
          snapshot.artifact.source_kind !==
            input.authorization.query.source_kind ||
          snapshot.artifact.evidence_ref !==
            input.authorization.query.evidence_ref ||
          snapshot.artifact.evidence_ref !==
            artifactEvidenceRef({
              companyId: input.authorization.actorContext.companyId,
              jobRef: input.authorization.query.job_ref,
              sourceIdentity,
            }) ||
          snapshot.proof_ref !==
            artifactExactEntityProofRef({
              context: proofContext,
              sourceIdentity,
              artifact: snapshot.artifact,
              content: snapshot.content,
            }) ||
          snapshot.source_inspected >= ARTIFACT_MAX_SOURCE_ROWS
        ) {
          invalid();
        }
        const value = GetJobArtifactEvidenceSourceResultSchema.parse({
          artifact: snapshot.artifact,
          content: snapshot.content,
          evidence: [
            {
              evidence_ref: snapshot.artifact.evidence_ref,
              source_domain: "artifacts",
              source_type: snapshot.artifact.source_kind,
              occurred_at: snapshot.read_at,
            },
          ],
          proof: {
            proof_ref: snapshot.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
        });
        assertNoArtifactForbiddenFields(value);
        return deepFreeze({ state: "found" as const, value });
      } catch (error) {
        if (error instanceof ArtifactReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_ARTIFACT_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedArtifactReadRepository(
  value: unknown
): value is ArtifactReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_ARTIFACT_REPOSITORIES.has(value)
  );
}
