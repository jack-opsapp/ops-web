import "server-only";

import { z } from "zod-v4";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  assertP2NoForbiddenFields,
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2EvidenceRefSchema,
  P2ProofRefSchema,
} from "@/lib/agent-control-plane/contracts";
import {
  WorkQueueCardSchema,
  WORK_QUEUE_MAX_PAGE_ITEMS,
  WORK_QUEUE_MAX_AGGREGATE_SOURCE_ROWS,
  WORK_QUEUE_MAX_SOURCE_ROWS,
  WorkQueueWarningSchema,
  type WorkQueueCard,
} from "@/lib/agent-control-plane/contracts/work-queue";
import {
  isAuthorizedWorkQueueRead,
  type AuthorizedWorkQueueRead,
} from "./work-queue-authorization";
import {
  WorkQueueCursorPredecessorSchema,
  type WorkQueueCursorContext,
} from "./work-queue-cursor";
import {
  workQueueCollectionProofRef,
  workQueueEntityProofRef,
  workQueueEvidenceRef,
  workQueueProofContext,
} from "./work-queue-proof";
import { deepFreezeWorkQueue } from "./work-queue-budget";
import { canonicalizeP2DomainRevisions } from "../shared/domain-revisions";

const RPC = "read_agent_work_queue_as_system" as const;
const TRUSTED = new WeakSet<object>();
const RevisionSchema = z
  .object({
    domain: z.string().min(1).max(128),
    source_revision: z.number().int().safe().nonnegative(),
  })
  .strict();
const RevisionsSchema = z
  .array(RevisionSchema)
  .max(64)
  .refine((values) =>
    values.every(
      (value, index) => index === 0 || values[index - 1]!.domain < value.domain
    )
  );
const SourceSlicesSchema = z
  .array(
    z
      .object({
        source: z.enum([
          "task",
          "lead",
          "correspondence",
          "commitment",
          "match_review",
          "schedule",
          "financial_document",
          "payment",
          "expense",
        ]),
        source_inspected: z.number().int().min(0).max(500),
        bounded_count: z.number().int().min(0).max(25),
        truncated: z.boolean(),
      })
      .strict()
  )
  .max(9)
  .refine(
    (slices) =>
      slices.every(
        (slice) =>
          slice.bounded_count <= slice.source_inspected &&
          (!slice.truncated || slice.bounded_count === 25)
      ),
    "WORK_QUEUE_SOURCE_SLICE_INVALID"
  );
const RowSchema = z
  .object({
    item: WorkQueueCardSchema,
    item_source_revisions: z.array(RevisionSchema).min(1).max(16),
    proof_ref: P2ProofRefSchema,
    evidence_ref: P2EvidenceRefSchema,
    predecessor: WorkQueueCursorPredecessorSchema,
  })
  .strict();
const SnapshotSchema = z
  .object({
    company_id: P2CanonicalUuidSchema,
    actor_user_id: P2CanonicalUuidSchema,
    oauth_grant_id: P2CanonicalUuidSchema,
    oauth_client_id: P2CanonicalUuidSchema,
    grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
    granted_scope_ceiling: z.array(z.string()).min(1).max(64),
    permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    capability_id: z.literal("list_work_queue"),
    capability_revision: z.literal("list_work_queue:2026-08-22.v1"),
    capability_manifest_revision: z.literal(
      "2026-08-22.capability-manifest.v8"
    ),
    selections: z
      .array(
        z
          .object({
            source: z.string(),
            origin: z.enum(["explicit", "default"]),
          })
          .strict()
      )
      .min(1)
      .max(9),
    authorized_sources: z
      .array(
        z
          .object({
            source: z.string(),
            origin: z.enum(["explicit", "default"]),
            required_oauth_scopes: z.array(z.string()),
            resolved_permission_scopes: z.record(
              z.string(),
              z.enum(["all", "assigned", "own"])
            ),
            satisfied_permission_group_indexes: z.array(
              z.number().int().nonnegative()
            ),
          })
          .strict()
      )
      .max(9),
    warnings: z.array(WorkQueueWarningSchema).max(9),
    read_at: P2CanonicalTimestampSchema,
    source_revisions: RevisionsSchema,
    source_inspected: z
      .number()
      .int()
      .min(0)
      .max(WORK_QUEUE_MAX_AGGREGATE_SOURCE_ROWS),
    source_slices: SourceSlicesSchema,
    source_has_more: z.boolean(),
    rows: z.array(RowSchema).max(WORK_QUEUE_MAX_PAGE_ITEMS),
    collection_proof_ref: P2ProofRefSchema,
  })
  .strict();

export interface WorkQueueRpcRequest extends PromiseLike<{
  data: unknown;
  error: unknown;
}> {
  abortSignal?: (
    signal: AbortSignal
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}
export interface WorkQueueRpcClient {
  rpc(
    name: typeof RPC,
    args: Readonly<Record<string, unknown>>
  ): WorkQueueRpcRequest;
}
export interface WorkQueueRepositoryUnit {
  readonly item: WorkQueueCard;
  readonly proof: {
    proof_ref: string;
    read_at: string;
    source_revisions: readonly { domain: string; source_revision: number }[];
  };
  readonly evidence: readonly {
    evidence_ref: string;
    source_domain: "work_queue";
    source_type: string;
    occurred_at: string;
  }[];
  readonly predecessor: z.infer<typeof WorkQueueCursorPredecessorSchema>;
}
export type WorkQueueRepositoryResult =
  | Readonly<{
      state: "found";
      units: readonly WorkQueueRepositoryUnit[];
      readAt: string;
      sourceRevisions: readonly { domain: string; source_revision: number }[];
      sourceInspected: number;
      sourceSlices: z.infer<typeof SourceSlicesSchema>;
      sourceHasMore: boolean;
    }>
  | Readonly<{ state: "source_bound" | "stale" }>;
export interface WorkQueueRepository {
  list(input: {
    authorization: AuthorizedWorkQueueRead;
    cursor: WorkQueueCursorContext | null;
    signal?: AbortSignal;
  }): Promise<WorkQueueRepositoryResult>;
}
export class WorkQueueRepositoryError extends Error {
  constructor() {
    super("WORK_QUEUE_READ_FAILED");
    this.name = "WorkQueueRepositoryError";
  }
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
const SOURCE_REVISION_DOMAINS: Readonly<
  Record<WorkQueueCard["source"], readonly string[]>
> = Object.freeze({
  task: ["legacy_operational", "tasks"],
  lead: ["legacy_operational", "work_queue"],
  correspondence: ["legacy_job_history", "legacy_operational", "work_queue"],
  commitment: ["work_queue"],
  match_review: ["work_queue"],
  schedule: ["legacy_operational"],
  financial_document: ["legacy_operational", "sales_documents"],
  payment: ["legacy_operational", "payments", "sales_documents"],
  expense: ["expenses"],
});
function canonicalRevisions(
  values: readonly { domain: string; source_revision: number }[]
) {
  const inputs = values.map((value) => {
    if (value.domain === "legacy_operational")
      return {
        source_domain: "operations",
        source_type: "operational_read_revision",
        source_id: "private.agent_operational_read_revisions",
        version: `revision:${value.source_revision}`,
      };
    if (value.domain === "legacy_job_history")
      return {
        source_domain: "operations",
        source_type: "job_history_read_revision",
        source_id: "private.agent_job_history_revisions",
        version: `revision:${value.source_revision}`,
      };
    return value;
  });
  return (
    values.length > 0 && same(canonicalizeP2DomainRevisions(inputs), values)
  );
}
function sourceAuthorizations(authorization: AuthorizedWorkQueueRead) {
  return authorization.authorizedSources.map((source) => ({
    source: source.source,
    origin: source.origin,
    required_oauth_scopes: [...source.requiredOAuthScopes],
    resolved_permission_scopes: { ...source.resolvedPermissionScopes },
    satisfied_permission_group_indexes: [
      ...source.satisfiedPermissionGroupIndexes,
    ],
  }));
}
function sourceComesBefore(
  left: z.infer<typeof WorkQueueCursorPredecessorSchema>,
  right: z.infer<typeof WorkQueueCursorPredecessorSchema>
) {
  for (let index = 0; index < left.order.length; index += 1) {
    if (left.order[index] === right.order[index]) continue;
    return left.order[index]! < right.order[index]!;
  }
  return false;
}
function invalid(cause?: unknown): never {
  const error = new WorkQueueRepositoryError();
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  throw error;
}
function knownError(error: unknown): "source_bound" | "stale" | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  const sourceBounds = new Set([
    "agent_work_queue_source_query_bound",
    "agent_p2_task_attention_source_bound",
    "agent_p2_legacy_lead_attention_source_bound",
    "agent_p2_legacy_correspondence_attention_source_bound",
    "agent_p2_legacy_schedule_attention_source_bound",
    "agent_sales_document_source_bound",
    "agent_payment_source_query_bound",
    "agent_expense_source_query_bound",
  ]);
  if (code === "54000" && sourceBounds.has(message)) return "source_bound";
  if (code === "40001" && message === "agent_work_queue_read_stale")
    return "stale";
  return null;
}

export function createWorkQueueRepository(
  client: WorkQueueRpcClient
): WorkQueueRepository {
  const supplied = client?.rpc;
  if (typeof supplied !== "function")
    throw new TypeError("A work-queue RPC client is required");
  const rpc = (args: Readonly<Record<string, unknown>>) =>
    Reflect.apply(supplied, client, [RPC, args]) as WorkQueueRpcRequest;
  const repository: WorkQueueRepository = {
    async list(input) {
      if (!isAuthorizedWorkQueueRead(input.authorization)) invalid();
      const authorization = input.authorization;
      const request = rpc({
        p_actor_user_id: authorization.actorContext.actorUserId,
        p_company_id: authorization.actorContext.companyId,
        p_oauth_grant_id: authorization.oauthGrantId,
        p_oauth_client_id: authorization.oauthClientId,
        p_grant_revision: authorization.grantRevision,
        p_granted_scope_ceiling: [...authorization.grantedScopeCeiling],
        p_permission_snapshot_revision:
          authorization.actorContext.permissionSnapshotRevision,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_manifest_revision:
          authorization.capabilityManifestRevision,
        p_selections: authorization.selections.map((selection) => ({
          ...selection,
        })),
        p_authorized_sources: sourceAuthorizations(authorization),
        p_warnings: authorization.warnings.map((warning) => ({ ...warning })),
        p_item_limit: authorization.query.limit,
        p_page_fetch_limit: Math.min(authorization.query.limit + 1, 26),
        p_source_limit: WORK_QUEUE_MAX_SOURCE_ROWS,
        p_cursor_read_at: input.cursor?.readAt ?? null,
        p_cursor_source_revisions: input.cursor?.sourceRevisions ?? [],
        p_after_priority: input.cursor?.predecessor.order[0] ?? null,
        p_after_attention_at: input.cursor?.predecessor.order[1] ?? null,
        p_after_source: input.cursor?.predecessor.order[2] ?? null,
        p_after_id: input.cursor?.predecessor.tie_breaker ?? null,
      });
      const response =
        input.signal && request.abortSignal
          ? await request.abortSignal(input.signal)
          : await request;
      if (response.error) {
        const state = knownError(response.error);
        if (state) return deepFreezeWorkQueue({ state });
        throw new WorkQueueRepositoryError();
      }
      try {
        const snapshot = SnapshotSchema.parse(response.data);
        const authorizations = sourceAuthorizations(authorization);
        const expectedCollectionDomains = [
          ...new Set(
            authorization.authorizedSources.flatMap(
              ({ source }) => SOURCE_REVISION_DOMAINS[source]
            )
          ),
        ].sort();
        const exactCollectionRevisionDomains = same(
          snapshot.source_revisions.map(({ domain }) => domain),
          expectedCollectionDomains
        );
        const collectionRevisionsCanonical =
          snapshot.source_revisions.length === 0
            ? authorization.authorizedSources.length === 0 &&
              authorization.warnings.length === 9
            : exactCollectionRevisionDomains &&
              canonicalRevisions(snapshot.source_revisions);
        const collectionRevisionByDomain = new Map(
          snapshot.source_revisions.map((revision) => [
            revision.domain,
            revision,
          ])
        );
        const context = workQueueProofContext({
          authorization,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceSlices: snapshot.source_slices,
          sourceHasMore: snapshot.source_has_more,
          cursor: input.cursor,
        });
        const validRows = snapshot.rows.every((row) => {
          const expectedDomains = SOURCE_REVISION_DOMAINS[row.item.source];
          const exactItemRevisions = expectedDomains.map((domain) =>
            collectionRevisionByDomain.get(domain)
          );
          return (
            exactItemRevisions.every(Boolean) &&
            canonicalRevisions(row.item_source_revisions) &&
            same(row.item_source_revisions, exactItemRevisions) &&
            row.proof_ref ===
              workQueueEntityProofRef({
                context,
                item: row.item,
                itemSourceRevisions: row.item_source_revisions,
              }) &&
            row.evidence_ref ===
              workQueueEvidenceRef({ context, item: row.item }) &&
            row.predecessor.order[0] === row.item.priority &&
            row.predecessor.order[1] === row.item.attention_at &&
            row.predecessor.order[2] === row.item.source &&
            row.predecessor.tie_breaker === row.item.queue_ref.id
          );
        });
        const queueIdentities = snapshot.rows.map(
          (row) => `${row.item.queue_ref.kind}:${row.item.queue_ref.id}`
        );
        const proofIdentities = snapshot.rows.map((row) => row.proof_ref);
        const evidenceIdentities = snapshot.rows.map((row) => row.evidence_ref);
        const predecessorIdentities = snapshot.rows.map((row) =>
          JSON.stringify(row.predecessor.order)
        );
        const expectedCollection = workQueueCollectionProofRef({
          context,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            queue_ref: row.item.queue_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          snapshot.company_id !== authorization.actorContext.companyId ||
          snapshot.actor_user_id !== authorization.actorContext.actorUserId ||
          snapshot.oauth_grant_id !== authorization.oauthGrantId ||
          snapshot.oauth_client_id !== authorization.oauthClientId ||
          snapshot.grant_revision !== authorization.grantRevision ||
          snapshot.permission_snapshot_revision !==
            authorization.actorContext.permissionSnapshotRevision ||
          !same(
            snapshot.granted_scope_ceiling,
            authorization.grantedScopeCeiling
          ) ||
          !same(snapshot.selections, authorization.selections) ||
          !same(snapshot.authorized_sources, authorizations) ||
          !same(snapshot.warnings, authorization.warnings) ||
          !same(
            snapshot.source_slices.map(({ source }) => source),
            authorization.authorizedSources.map(({ source }) => source)
          ) ||
          snapshot.source_slices.reduce(
            (total, slice) => total + slice.source_inspected,
            0
          ) !== snapshot.source_inspected ||
          !collectionRevisionsCanonical ||
          snapshot.source_inspected > WORK_QUEUE_MAX_AGGREGATE_SOURCE_ROWS ||
          snapshot.rows.length > authorization.query.limit ||
          (snapshot.source_has_more &&
            snapshot.rows.length !== authorization.query.limit) ||
          !validRows ||
          new Set(queueIdentities).size !== queueIdentities.length ||
          new Set(proofIdentities).size !== proofIdentities.length ||
          new Set(evidenceIdentities).size !== evidenceIdentities.length ||
          new Set(predecessorIdentities).size !==
            predecessorIdentities.length ||
          snapshot.collection_proof_ref !== expectedCollection ||
          snapshot.rows.some(
            (row, index) =>
              index > 0 &&
              !sourceComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              )
          )
        )
          invalid();
        const units = snapshot.rows.map((row) => ({
          item: row.item,
          proof: {
            proof_ref: row.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: row.item_source_revisions,
          },
          evidence: [
            {
              evidence_ref: row.evidence_ref,
              source_domain: "work_queue" as const,
              source_type: row.item.source,
              occurred_at: snapshot.read_at,
            },
          ],
          predecessor: row.predecessor,
        }));
        const value = {
          state: "found" as const,
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceSlices: snapshot.source_slices,
          sourceHasMore: snapshot.source_has_more,
        };
        assertP2NoForbiddenFields(value);
        return deepFreezeWorkQueue(value);
      } catch (error) {
        if (error instanceof WorkQueueRepositoryError) throw error;
        invalid(error);
      }
    },
  };
  TRUSTED.add(repository);
  return Object.freeze(repository);
}
export function isTrustedWorkQueueRepository(
  value: unknown
): value is WorkQueueRepository {
  return typeof value === "object" && value !== null && TRUSTED.has(value);
}
