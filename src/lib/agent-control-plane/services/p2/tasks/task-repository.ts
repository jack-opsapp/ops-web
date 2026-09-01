import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  assertP2NoForbiddenFields,
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
  GetTaskContextResultSchema,
  TASK_READ_FETCH_LIMIT,
  TASK_READ_MAX_ASSIGNEES,
  TASK_READ_MAX_DEPENDENCIES,
  TASK_READ_MAX_PAGE_ITEMS,
  TASK_READ_MAX_SOURCE_ROWS,
  TaskListViewSchema,
  TaskSummarySchema,
  type GetTaskContextResult,
} from "@/lib/agent-control-plane/contracts/tasks";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetTaskContextRead,
  isAuthorizedListTasksRead,
  type AuthorizedGetTaskContextRead,
  type AuthorizedListTasksRead,
} from "./task-authorization";
import {
  taskContextEntityProofRef,
  taskContextEvidenceRef,
  taskContextProofContext,
  taskListCollectionProofRef,
  taskListEntityProofRef,
  taskListEvidenceRef,
  taskListProofContext,
} from "./task-proof";
import {
  TaskListCursorPredecessorSchema,
  type TaskListCursorContext,
} from "./task-cursor";

const LIST_RPC = "read_agent_tasks_as_system" as const;
const DETAIL_RPC = "read_agent_task_context_as_system" as const;
const TRUSTED_TASK_REPOSITORIES = new WeakSet<object>();

const ScopeSchema = z.enum(["all", "assigned"]);
const CalendarScopeSchema = z.enum(["all", "own"]);
const TaskProofRefSchema = P2ProofRefSchema.refine(
  (value) => /^ops_proof:v1:[0-9a-f]{64}$/.test(value),
  "TASK_PROOF_REF_INVALID"
);
const TaskEvidenceRefSchema = P2EvidenceRefSchema.refine(
  (value) => /^ops_evidence:v1:[0-9a-f]{64}$/.test(value),
  "TASK_EVIDENCE_REF_INVALID"
);
const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(64)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "TASK_ARRAY_NOT_CANONICAL"
  );
const ExactTaskRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) =>
    revisions.length === 2 &&
    revisions[0]?.domain === "legacy_operational" &&
    revisions[1]?.domain === "tasks",
  "TASK_REVISION_VECTOR_INVALID"
);
const PredecessorSchema = TaskListCursorPredecessorSchema;
const ListRowSchema = z
  .object({
    item: TaskSummarySchema,
    priority_rank_proof_text: z.string().min(1).max(64).nullable(),
    proof_ref: TaskProofRefSchema,
    evidence_ref: TaskEvidenceRefSchema,
    predecessor: PredecessorSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.predecessor.tie_breaker === row.item.task_ref.id &&
      row.predecessor.order[0] ===
        (row.item.schedule_summary.state === "unscheduled"
          ? "9999-12-31"
          : (row.item.schedule_summary.starts_on ?? "9999-12-31")),
    "TASK_ROW_PREDECESSOR_INVALID"
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
  tasks_scope: ScopeSchema,
  projects_scope: ScopeSchema,
  calendar_scope: CalendarScopeSchema.nullable(),
  estimates_scope: ScopeSchema.nullable(),
  project_financials_scope: z.literal("all").nullable(),
  read_at: P2CanonicalTimestampSchema,
  source_revisions: ExactTaskRevisionsSchema,
} as const;

const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("list_tasks"),
    capability_revision: z.literal("list_tasks:2026-08-22.v1"),
    view: TaskListViewSchema,
    item_limit: z.number().int().min(1).max(TASK_READ_MAX_PAGE_ITEMS),
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
    source_inspected: z.number().int().min(0).max(TASK_READ_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(ListRowSchema).max(TASK_READ_MAX_PAGE_ITEMS),
    collection_proof_ref: TaskProofRefSchema,
  })
  .strict();

const RawDetailResultSchema = GetTaskContextResultSchema.omit({
  evidence: true,
  proof: true,
});
const RawDetailSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_task_context"),
    capability_revision: z.literal("get_task_context:2026-08-22.v1"),
    task_ref: z
      .object({ kind: z.literal("task"), id: P2CanonicalUuidSchema })
      .strict(),
    selected_sections: z
      .array(
        z.enum([
          "dependencies",
          "evidence_state",
          "financial_origin",
          "material_readiness",
          "notes",
          "schedule",
        ])
      )
      .min(1)
      .max(6)
      .refine(
        (values) =>
          new Set(values).size === values.length &&
          values.every(
            (value, index) => index === 0 || values[index - 1]! < value
          ),
        "TASK_SECTION_VECTOR_NOT_CANONICAL"
      ),
    source_inspected: z
      .object({
        assignees: z.number().int().min(0).max(TASK_READ_MAX_SOURCE_ROWS),
        dependencies: z.number().int().min(0).max(TASK_READ_MAX_SOURCE_ROWS),
        task_evidence: z.number().int().min(0).max(TASK_READ_MAX_SOURCE_ROWS),
        materials: z.number().int().min(0).max(TASK_READ_MAX_SOURCE_ROWS),
      })
      .strict(),
    result: RawDetailResultSchema,
    priority_rank_proof_text: z.string().min(1).max(64).nullable(),
    proof_ref: TaskProofRefSchema,
    evidence_ref: TaskEvidenceRefSchema,
  })
  .strict();

export interface TaskReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface TaskReadRpcRequest extends PromiseLike<TaskReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<TaskReadRpcResult>;
}

export interface TaskReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ): TaskReadRpcRequest;
}

export interface TaskListRepositoryUnit {
  readonly item: z.infer<typeof TaskSummarySchema>;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof PredecessorSchema>;
}

export interface TaskListRepositoryPage {
  readonly units: readonly TaskListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type TaskListRepositoryResult =
  | Readonly<{ state: "found"; page: TaskListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export type TaskContextRepositoryResult =
  | Readonly<{ state: "found"; value: GetTaskContextResult }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "stale" }>;

export interface TaskReadRepository {
  list(input: {
    readonly authorization: AuthorizedListTasksRead;
    readonly cursor: TaskListCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<TaskListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetTaskContextRead;
    readonly signal?: AbortSignal;
  }): Promise<TaskContextRepositoryResult>;
}

export class TaskReadRepositoryError extends Error {
  readonly code: "TASK_READ_INVALID" | "TASK_READ_FAILED";

  constructor(code: TaskReadRepositoryError["code"], options?: ErrorOptions) {
    super(code, options);
    this.name = "TaskReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new TaskReadRepositoryError("TASK_READ_INVALID", { cause });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
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
  left: z.infer<typeof PredecessorSchema>,
  right: z.infer<typeof PredecessorSchema>
) {
  return (
    left.order[0] < right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] < right.order[1])
  );
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawDetailSnapshotSchema>,
  authorization: AuthorizedListTasksRead | AuthorizedGetTaskContextRead
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
    snapshot.tasks_scope === authorization.tasksScope &&
    snapshot.projects_scope === authorization.projectsScope &&
    snapshot.calendar_scope === authorization.calendarScope &&
    snapshot.estimates_scope === authorization.estimatesScope &&
    snapshot.project_financials_scope === authorization.projectFinancialsScope
  );
}

function knownErrorState(
  error: unknown,
  detail: boolean
): "not_found" | "source_bound" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const record = error as Readonly<Record<string, unknown>>;
    if (
      detail &&
      record.code === "P0002" &&
      record.message === "agent_task_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_task_source_query_bound" ||
        record.message === "agent_task_result_bound")
    ) {
      return "source_bound";
    }
    if (record.code === "40001" && record.message === "agent_task_read_stale") {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

function viewArguments(view: z.infer<typeof TaskListViewSchema>) {
  return {
    p_view_kind: view.kind,
    p_job_id: view.kind === "job" ? view.job_ref.id : null,
    p_assignee_user_id: view.kind === "assignee" ? view.assignee_ref.id : null,
    p_task_states: view.kind === "status" ? [...view.states] : [],
    p_window_starts_at: view.kind === "schedule_window" ? view.starts_at : null,
    p_window_ends_before:
      view.kind === "schedule_window" ? view.ends_before : null,
    p_overdue_as_of: view.kind === "overdue" ? view.as_of : null,
  };
}

function commonArguments(
  authorization: AuthorizedListTasksRead | AuthorizedGetTaskContextRead
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
    p_tasks_scope: authorization.tasksScope,
    p_projects_scope: authorization.projectsScope,
    p_calendar_scope: authorization.calendarScope,
    p_estimates_scope: authorization.estimatesScope,
    p_project_financials_scope: authorization.projectFinancialsScope,
  };
}

async function execute(
  request: TaskReadRpcRequest,
  signal?: AbortSignal
): Promise<TaskReadRpcResult> {
  if (signal?.aborted) throw new TaskReadRepositoryError("TASK_READ_FAILED");
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) throw new TaskReadRepositoryError("TASK_READ_FAILED");
    return response;
  } catch (error) {
    if (error instanceof TaskReadRepositoryError) throw error;
    throw new TaskReadRepositoryError("TASK_READ_FAILED", { cause: error });
  }
}

export function createSupabaseTaskReadRepository(
  client: TaskReadRpcClient
): TaskReadRepository {
  let suppliedRpc: TaskReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as TaskReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A task-read RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A task-read RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc!, client, [name, args]) as TaskReadRpcRequest;

  const repository: TaskReadRepository = {
    async list(input) {
      if (!isAuthorizedListTasksRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactTaskRevisionsSchema.safeParse(cursor.sourceRevisions).success ||
          !PredecessorSchema.safeParse(cursor.predecessor).success)
      ) {
        invalid();
      }
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(input.authorization),
          ...viewArguments(input.authorization.query.view),
          p_item_limit: input.authorization.query.limit,
          p_page_fetch_limit: Math.min(
            input.authorization.query.limit + 1,
            TASK_READ_FETCH_LIMIT
          ),
          p_source_limit: TASK_READ_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_order_date:
            cursor === null ? null : cursor.predecessor.order[0],
          p_after_task_id:
            cursor === null ? null : cursor.predecessor.tie_breaker,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, false);
        if (state === "source_bound" || state === "stale") {
          return deepFreeze({ state });
        }
        throw new TaskReadRepositoryError("TASK_READ_FAILED");
      }

      try {
        const snapshot = RawListSnapshotSchema.parse(response.data);
        const expectedCursorRevisions = cursor?.sourceRevisions ?? [];
        const proofRefs = snapshot.rows.map((row) => row.proof_ref);
        const evidenceRefs = snapshot.rows.map((row) => row.evidence_ref);
        const itemIds = snapshot.rows.map((row) => row.item.task_ref.id);
        const proofContext = taskListProofContext({
          authorization: input.authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const validRowProofs = snapshot.rows.every(
          (row) =>
            row.proof_ref ===
              taskListEntityProofRef({
                context: proofContext,
                task: row.item,
                priorityRankText: row.priority_rank_proof_text,
              }) &&
            row.evidence_ref ===
              taskListEvidenceRef({
                context: proofContext,
                taskRef: row.item.task_ref,
              })
        );
        const expectedCollectionProofRef = taskListCollectionProofRef({
          context: proofContext,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            task_ref: row.item.task_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, input.authorization) ||
          !sameJson(snapshot.view, input.authorization.query.view) ||
          snapshot.item_limit !== input.authorization.query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            expectedCursorRevisions
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          snapshot.source_inspected >= TASK_READ_MAX_SOURCE_ROWS ||
          snapshot.rows.length > input.authorization.query.limit ||
          (snapshot.source_has_more &&
            snapshot.rows.length !== input.authorization.query.limit) ||
          !validRowProofs ||
          snapshot.collection_proof_ref !== expectedCollectionProofRef ||
          proofRefs.includes(snapshot.collection_proof_ref) ||
          new Set(proofRefs).size !== proofRefs.length ||
          new Set(evidenceRefs).size !== evidenceRefs.length ||
          new Set(itemIds).size !== itemIds.length ||
          !snapshot.rows.every(
            (row, index) =>
              index === 0 ||
              predecessorComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              )
          )
        ) {
          invalid();
        }
        const units = snapshot.rows.map((row) => ({
          item: row.item,
          proof: {
            proof_ref: row.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
          evidence: [
            {
              evidence_ref: row.evidence_ref,
              source_domain: "tasks",
              source_type: "task_snapshot",
              occurred_at: snapshot.read_at,
            },
          ],
          predecessor: row.predecessor,
        }));
        const page = {
          units,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        };
        assertP2NoForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof TaskReadRepositoryError) throw error;
        invalid(error);
      }
    },

    async get(input) {
      if (!isAuthorizedGetTaskContextRead(input.authorization)) invalid();
      const response = await execute(
        rpc(DETAIL_RPC, {
          ...commonArguments(input.authorization),
          p_task_id: input.authorization.query.task_ref.id,
          p_sections: [...input.authorization.query.sections],
          p_source_limit: TASK_READ_MAX_SOURCE_ROWS,
          p_dependency_limit: TASK_READ_MAX_DEPENDENCIES,
          p_assignee_limit: TASK_READ_MAX_ASSIGNEES,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, true);
        if (state) return deepFreeze({ state });
        throw new TaskReadRepositoryError("TASK_READ_FAILED");
      }
      try {
        const snapshot = RawDetailSnapshotSchema.parse(response.data);
        const resultSections = Object.keys(snapshot.result.sections).sort(
          (left, right) => left.localeCompare(right)
        );
        if (
          !exactBinding(snapshot, input.authorization) ||
          snapshot.task_ref.id !== input.authorization.query.task_ref.id ||
          !sameStrings(
            snapshot.selected_sections,
            input.authorization.query.sections
          ) ||
          !sameStrings(resultSections, input.authorization.query.sections) ||
          Object.values(snapshot.source_inspected).some(
            (count) => count >= TASK_READ_MAX_SOURCE_ROWS
          )
        ) {
          invalid();
        }
        const proofContext = taskContextProofContext({
          authorization: input.authorization,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
        });
        if (
          snapshot.proof_ref !==
            taskContextEntityProofRef({
              context: proofContext,
              result: snapshot.result,
              priorityRankText: snapshot.priority_rank_proof_text,
            }) ||
          snapshot.evidence_ref !==
            taskContextEvidenceRef({ context: proofContext })
        ) {
          invalid();
        }
        const value = GetTaskContextResultSchema.parse({
          ...snapshot.result,
          evidence: [
            {
              evidence_ref: snapshot.evidence_ref,
              source_domain: "tasks",
              source_type: "task_snapshot",
              occurred_at: snapshot.read_at,
            },
          ],
          proof: {
            proof_ref: snapshot.proof_ref,
            read_at: snapshot.read_at,
            source_revisions: snapshot.source_revisions,
          },
        });
        assertP2NoForbiddenFields(value);
        return deepFreeze({ state: "found" as const, value });
      } catch (error) {
        if (error instanceof TaskReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_TASK_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedTaskReadRepository(
  value: unknown
): value is TaskReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_TASK_REPOSITORIES.has(value)
  );
}
