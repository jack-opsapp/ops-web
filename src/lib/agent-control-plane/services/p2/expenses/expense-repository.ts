import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  P2CanonicalTimestampSchema,
  P2CanonicalUuidSchema,
  P2DomainRevisionVectorSchema,
  type P2DomainRevision,
  type P2EntityProof,
  type P2EvidenceIdentity,
} from "@/lib/agent-control-plane/contracts";
import {
  EXPENSE_READ_FETCH_LIMIT,
  EXPENSE_READ_MAX_ALLOCATIONS,
  EXPENSE_READ_MAX_PAGE_ITEMS,
  EXPENSE_READ_MAX_SOURCE_ROWS,
  ExpenseListItemSchema,
  ExpenseListViewSchema,
  GetExpenseContextResultSchema,
  assertNoExpenseForbiddenFields,
  type ExpenseListItem,
  type GetExpenseContextResult,
} from "@/lib/agent-control-plane/contracts/expenses";
import { canonicalOperationalProjection } from "@/lib/agent-control-plane/services/operational-read-projection";
import {
  isAuthorizedGetExpenseContextRead,
  isAuthorizedListExpensesRead,
  type AuthorizedGetExpenseContextRead,
  type AuthorizedListExpensesRead,
} from "./expense-authorization";
import {
  ExpenseCursorPredecessorSchema,
  type ExpenseCursorContext,
} from "./expense-cursor";
import {
  ExpenseEvidenceRefSchema,
  ExpenseProofRefSchema,
  exactExpenseSourceRevisions,
  expenseCollectionProofRef,
  expenseContextEntityProofRef,
  expenseContextEvidenceRef,
  expenseEntityProofRef,
  expenseListEvidenceRef,
  expenseListProofContext,
} from "./expense-proof";

const LIST_RPC = "read_agent_expenses_as_system" as const;
const DETAIL_RPC = "read_agent_expense_context_as_system" as const;
const TRUSTED_EXPENSE_REPOSITORIES = new WeakSet<object>();

const CanonicalStringArraySchema = z
  .array(z.string().min(1).max(128))
  .max(128)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "EXPENSE_ARRAY_NOT_CANONICAL"
  );
const PermissionScopesSchema = z
  .record(z.string().min(1).max(128), z.enum(["all", "assigned", "own"]))
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.keys(value).every((key) =>
        (REGISTERED_ACTOR_PERMISSION_KEYS as readonly string[]).includes(key)
      ),
    "EXPENSE_PERMISSION_VECTOR_INVALID"
  );
const SatisfiedGroupIndexesSchema = z
  .array(z.number().int().safe().min(0).max(31))
  .min(1)
  .max(32)
  .refine(
    (values) =>
      new Set(values).size === values.length &&
      values.every((value, index) => index === 0 || values[index - 1]! < value),
    "EXPENSE_GROUP_VECTOR_NOT_CANONICAL"
  );
const AuthorizationCandidateSchema = z
  .object({
    variant_key: z.enum([
      "company",
      "expense",
      "job",
      "mine",
      "pending_approval",
      "reimbursement_batches",
    ]),
    required_oauth_scopes: CanonicalStringArraySchema,
    resolved_permission_scopes: PermissionScopesSchema,
    satisfied_permission_group_indexes: SatisfiedGroupIndexesSchema,
  })
  .strict();
const ExactSourceRevisionsSchema = P2DomainRevisionVectorSchema.refine(
  (revisions) => {
    try {
      exactExpenseSourceRevisions(revisions);
      return true;
    } catch {
      return false;
    }
  },
  "EXPENSE_REVISION_VECTOR_INVALID"
);
const QueryProjectionSchema = z
  .object({ view: ExpenseListViewSchema })
  .strict();
const RawListRowSchema = z
  .object({
    item: ExpenseListItemSchema,
    proof_ref: ExpenseProofRefSchema,
    evidence_ref: ExpenseEvidenceRefSchema,
    predecessor: ExpenseCursorPredecessorSchema,
  })
  .strict();

const BindingShape = {
  company_id: P2CanonicalUuidSchema,
  actor_user_id: P2CanonicalUuidSchema,
  oauth_grant_id: P2CanonicalUuidSchema,
  oauth_client_id: P2CanonicalUuidSchema,
  grant_revision: z.string().regex(/^[0-9a-f]{32}$/),
  granted_scope_ceiling: CanonicalStringArraySchema,
  permission_snapshot_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  capability_manifest_revision: z.literal("2026-08-22.capability-manifest.v8"),
  authorization_candidate: AuthorizationCandidateSchema,
  read_at: P2CanonicalTimestampSchema,
  source_revisions: ExactSourceRevisionsSchema,
} as const;

const RawListSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("list_expenses"),
    capability_revision: z.literal("list_expenses:2026-08-22.v1"),
    query: QueryProjectionSchema,
    ranking_revision: z.literal("expense-ranking:2026-08-22.v1"),
    item_limit: z.number().int().min(1).max(EXPENSE_READ_MAX_PAGE_ITEMS),
    cursor_read_at: P2CanonicalTimestampSchema.nullable(),
    cursor_source_revisions: z.array(z.unknown()).max(1),
    cursor_predecessor: ExpenseCursorPredecessorSchema.nullable(),
    source_inspected: z.number().int().min(0).max(EXPENSE_READ_MAX_SOURCE_ROWS),
    source_has_more: z.boolean(),
    rows: z.array(RawListRowSchema).max(EXPENSE_READ_MAX_PAGE_ITEMS),
    collection_proof_ref: ExpenseProofRefSchema,
  })
  .strict();

const RawDetailResultSchema = GetExpenseContextResultSchema.omit({
  evidence: true,
  proof: true,
});
const RawDetailSnapshotSchema = z
  .object({
    ...BindingShape,
    capability_id: z.literal("get_expense_context"),
    capability_revision: z.literal("get_expense_context:2026-08-22.v1"),
    source_inspected: z
      .object({
        allocations: z.number().int().min(0).max(EXPENSE_READ_MAX_SOURCE_ROWS),
        batches: z.number().int().min(0).max(1),
      })
      .strict(),
    result: RawDetailResultSchema,
    proof_ref: ExpenseProofRefSchema,
    evidence_ref: ExpenseEvidenceRefSchema,
  })
  .strict();

export interface ExpenseReadRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface ExpenseReadRpcRequest extends PromiseLike<ExpenseReadRpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<ExpenseReadRpcResult>;
}

export interface ExpenseReadRpcClient {
  rpc(
    functionName: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ): ExpenseReadRpcRequest;
}

export interface ExpenseListRepositoryUnit {
  readonly item: ExpenseListItem;
  readonly proof: P2EntityProof;
  readonly evidence: readonly P2EvidenceIdentity[];
  readonly predecessor: z.infer<typeof ExpenseCursorPredecessorSchema>;
}

export interface ExpenseListRepositoryPage {
  readonly units: readonly ExpenseListRepositoryUnit[];
  readonly readAt: string;
  readonly sourceRevisions: readonly P2DomainRevision[];
  readonly sourceInspected: number;
  readonly sourceHasMore: boolean;
}

export type ExpenseListRepositoryResult =
  | Readonly<{ state: "found"; page: ExpenseListRepositoryPage }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "source_invalid" }>
  | Readonly<{ state: "stale" }>;

export type ExpenseDetailRepositoryResult =
  | Readonly<{ state: "found"; value: GetExpenseContextResult }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "source_bound" }>
  | Readonly<{ state: "source_invalid" }>
  | Readonly<{ state: "stale" }>;

export interface ExpenseReadRepository {
  list(input: {
    readonly authorization: AuthorizedListExpensesRead;
    readonly cursor: ExpenseCursorContext | null;
    readonly signal?: AbortSignal;
  }): Promise<ExpenseListRepositoryResult>;
  get(input: {
    readonly authorization: AuthorizedGetExpenseContextRead;
    readonly signal?: AbortSignal;
  }): Promise<ExpenseDetailRepositoryResult>;
}

export class ExpenseReadRepositoryError extends Error {
  readonly code: "EXPENSE_READ_FAILED" | "EXPENSE_READ_INVALID";

  constructor(
    code: ExpenseReadRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "ExpenseReadRepositoryError";
    this.code = code;
  }
}

function invalid(cause?: unknown): never {
  throw new ExpenseReadRepositoryError("EXPENSE_READ_INVALID", { cause });
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

function serializedCandidate(
  authorization: AuthorizedListExpensesRead | AuthorizedGetExpenseContextRead
) {
  const candidate = authorization.authorizationCandidate;
  return {
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  };
}

function exactBinding(
  snapshot:
    | z.infer<typeof RawListSnapshotSchema>
    | z.infer<typeof RawDetailSnapshotSchema>,
  authorization: AuthorizedListExpensesRead | AuthorizedGetExpenseContextRead
) {
  return (
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
    sameJson(
      snapshot.authorization_candidate,
      serializedCandidate(authorization)
    )
  );
}

function orderDate(item: ExpenseListItem) {
  return item.item_kind === "expense"
    ? (item.expense_date ?? "0001-01-01")
    : (item.period_end ?? item.period_start ?? "0001-01-01");
}

function itemId(item: ExpenseListItem) {
  return item.item_kind === "expense" ? item.expense_ref.id : item.batch_ref.id;
}

function predecessorComesBefore(
  left: z.infer<typeof ExpenseCursorPredecessorSchema>,
  right: z.infer<typeof ExpenseCursorPredecessorSchema>
) {
  return (
    left.order[0] > right.order[0] ||
    (left.order[0] === right.order[0] && left.order[1] < right.order[1])
  );
}

function validListAuthority(
  authorization: AuthorizedListExpensesRead,
  item: ExpenseListItem
) {
  const view = authorization.query.view;
  const candidate = authorization.authorizationCandidate;
  if (view.kind === "reimbursement_batches") {
    return (
      item.item_kind === "reimbursement_batch" &&
      (view.disposition === "all" || item.disposition === view.disposition) &&
      (candidate.expensesViewScope === "all" ||
        item.submitted_by.team_member_ref.id ===
          authorization.actorContext.actorUserId)
    );
  }
  if (item.item_kind !== "expense") return false;
  if (view.kind === "mine") {
    return (
      item.submitted_by.team_member_ref.id ===
      authorization.actorContext.actorUserId
    );
  }
  if (view.kind === "company") return candidate.expensesViewScope === "all";
  if (view.kind === "job") {
    return (
      candidate.projectsViewScope !== null &&
      item.allocations.length > 0 &&
      item.allocations.every(
        (allocation) => allocation.project_ref.id === view.job_ref.id
      ) &&
      (candidate.expensesViewScope === "all" ||
        item.submitted_by.team_member_ref.id ===
          authorization.actorContext.actorUserId)
    );
  }
  return (
    item.lifecycle === "submitted" &&
    candidate.expensesViewScope === "all" &&
    candidate.expensesApproveScope !== null &&
    (candidate.expensesApproveScope === "all" || item.allocations.length > 0)
  );
}

function knownErrorState(
  error: unknown,
  detail: boolean
): "not_found" | "source_bound" | "source_invalid" | "stale" | null {
  try {
    if (typeof error !== "object" || error === null || Array.isArray(error)) {
      return null;
    }
    const record = error as Readonly<Record<string, unknown>>;
    if (
      detail &&
      record.code === "P0002" &&
      record.message === "agent_expense_not_found_or_not_visible"
    ) {
      return "not_found";
    }
    if (
      record.code === "54000" &&
      (record.message === "agent_expense_source_query_bound" ||
        record.message === "agent_expense_result_bound")
    ) {
      return "source_bound";
    }
    if (
      record.code === "22000" &&
      record.message === "agent_expense_source_data_invalid"
    ) {
      return "source_invalid";
    }
    if (
      record.code === "40001" &&
      record.message === "agent_expense_read_stale"
    ) {
      return "stale";
    }
  } catch {
    return null;
  }
  return null;
}

function commonArguments(
  authorization: AuthorizedListExpensesRead | AuthorizedGetExpenseContextRead
) {
  return {
    p_request_id: authorization.actorContext.requestId,
    p_company_id: authorization.actorContext.companyId,
    p_actor_user_id: authorization.actorContext.actorUserId,
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
    p_authorization_candidate: serializedCandidate(authorization),
  };
}

async function execute(
  request: ExpenseReadRpcRequest,
  signal?: AbortSignal
): Promise<ExpenseReadRpcResult> {
  if (signal?.aborted) {
    throw new ExpenseReadRepositoryError("EXPENSE_READ_FAILED");
  }
  try {
    const response =
      signal && typeof request.abortSignal === "function"
        ? await Reflect.apply(request.abortSignal, request, [signal])
        : await request;
    if (signal?.aborted) {
      throw new ExpenseReadRepositoryError("EXPENSE_READ_FAILED");
    }
    return response;
  } catch (error) {
    if (error instanceof ExpenseReadRepositoryError) throw error;
    throw new ExpenseReadRepositoryError("EXPENSE_READ_FAILED", {
      cause: error,
    });
  }
}

export function createSupabaseExpenseReadRepository(
  client: ExpenseReadRpcClient
): ExpenseReadRepository {
  let suppliedRpc: ExpenseReadRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as ExpenseReadRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("An expense RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("An expense RPC client is required");
  }
  const rpc = (
    name: typeof LIST_RPC | typeof DETAIL_RPC,
    args: Readonly<Record<string, unknown>>
  ) =>
    Reflect.apply(suppliedRpc!, client, [name, args]) as ExpenseReadRpcRequest;

  const repository: ExpenseReadRepository = {
    async list(input) {
      if (!isAuthorizedListExpensesRead(input.authorization)) invalid();
      const cursor = input.cursor;
      if (
        cursor !== null &&
        (!P2CanonicalTimestampSchema.safeParse(cursor.readAt).success ||
          !ExactSourceRevisionsSchema.safeParse(cursor.sourceRevisions)
            .success ||
          !ExpenseCursorPredecessorSchema.safeParse(cursor.predecessor).success)
      ) {
        invalid();
      }
      const authorization = input.authorization;
      const query = authorization.query;
      const response = await execute(
        rpc(LIST_RPC, {
          ...commonArguments(authorization),
          p_view_kind: query.view.kind,
          p_project_id:
            query.view.kind === "job" ? query.view.job_ref.id : null,
          p_batch_disposition:
            query.view.kind === "reimbursement_batches"
              ? query.view.disposition
              : null,
          p_item_limit: query.limit,
          p_page_fetch_limit: Math.min(
            query.limit + 1,
            EXPENSE_READ_FETCH_LIMIT
          ),
          p_source_limit: EXPENSE_READ_MAX_SOURCE_ROWS,
          p_cursor_read_at: cursor?.readAt ?? null,
          p_cursor_source_revisions: cursor
            ? cursor.sourceRevisions.map((revision) => ({ ...revision }))
            : [],
          p_after_order_date: cursor?.predecessor.order[0] ?? null,
          p_after_id: cursor?.predecessor.tie_breaker ?? null,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, false);
        if (
          state === "source_bound" ||
          state === "source_invalid" ||
          state === "stale"
        ) {
          return deepFreeze({ state });
        }
        throw new ExpenseReadRepositoryError("EXPENSE_READ_FAILED");
      }
      try {
        assertNoExpenseForbiddenFields(response.data);
        const snapshot = RawListSnapshotSchema.parse(response.data);
        const context = expenseListProofContext({
          authorization,
          cursor,
          readAt: snapshot.read_at,
          sourceRevisions: snapshot.source_revisions,
          sourceInspected: snapshot.source_inspected,
          sourceHasMore: snapshot.source_has_more,
        });
        const validRows = snapshot.rows.every((row, index) => {
          const item = row.item;
          return (
            validListAuthority(authorization, item) &&
            row.predecessor.item_kind === item.item_kind &&
            row.predecessor.order[0] === orderDate(item) &&
            row.predecessor.order[1] === itemId(item) &&
            row.predecessor.tie_breaker === itemId(item) &&
            row.proof_ref === expenseEntityProofRef({ context, item }) &&
            row.evidence_ref === expenseListEvidenceRef({ context, item }) &&
            (index === 0 ||
              predecessorComesBefore(
                snapshot.rows[index - 1]!.predecessor,
                row.predecessor
              ))
          );
        });
        const expectedCollection = expenseCollectionProofRef({
          context,
          returnedCount: snapshot.rows.length,
          hasMore: snapshot.source_has_more,
          children: snapshot.rows.map((row) => ({
            item_ref:
              row.item.item_kind === "expense"
                ? row.item.expense_ref
                : row.item.batch_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
        });
        if (
          !exactBinding(snapshot, authorization) ||
          !sameJson(snapshot.query, { view: query.view }) ||
          snapshot.item_limit !== query.limit ||
          snapshot.cursor_read_at !== (cursor?.readAt ?? null) ||
          !sameJson(
            snapshot.cursor_source_revisions,
            cursor?.sourceRevisions ?? []
          ) ||
          !sameJson(snapshot.cursor_predecessor, cursor?.predecessor ?? null) ||
          snapshot.source_inspected >= EXPENSE_READ_MAX_SOURCE_ROWS ||
          snapshot.rows.length > query.limit ||
          (snapshot.source_has_more && snapshot.rows.length !== query.limit) ||
          !validRows ||
          snapshot.collection_proof_ref !== expectedCollection ||
          new Set(snapshot.rows.map((row) => itemId(row.item))).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.proof_ref)).size !==
            snapshot.rows.length ||
          new Set(snapshot.rows.map((row) => row.evidence_ref)).size !==
            snapshot.rows.length
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
              source_domain: "expenses" as const,
              source_type:
                row.item.item_kind === "expense"
                  ? ("expense" as const)
                  : ("expense_batch" as const),
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
        assertNoExpenseForbiddenFields(page);
        return deepFreeze({ state: "found" as const, page });
      } catch (error) {
        if (error instanceof ExpenseReadRepositoryError) throw error;
        invalid(error);
      }
    },

    async get(input) {
      if (!isAuthorizedGetExpenseContextRead(input.authorization)) invalid();
      const authorization = input.authorization;
      const response = await execute(
        rpc(DETAIL_RPC, {
          ...commonArguments(authorization),
          p_expense_id: authorization.query.expense_ref.id,
          p_source_limit: EXPENSE_READ_MAX_SOURCE_ROWS,
          p_allocation_limit: EXPENSE_READ_MAX_ALLOCATIONS,
          p_allocation_fetch_limit: EXPENSE_READ_MAX_ALLOCATIONS + 1,
          p_review_reason_character_limit: 1_000,
        }),
        input.signal
      );
      if (response.error) {
        const state = knownErrorState(response.error, true);
        if (state) return deepFreeze({ state });
        throw new ExpenseReadRepositoryError("EXPENSE_READ_FAILED");
      }
      try {
        assertNoExpenseForbiddenFields(response.data);
        const snapshot = RawDetailSnapshotSchema.parse(response.data);
        const source = snapshot.result;
        const evidence = {
          evidence_ref: snapshot.evidence_ref,
          source_domain: "expenses" as const,
          source_type: "expense" as const,
          occurred_at: source.expense.updated_at,
        };
        const proof = {
          proof_ref: snapshot.proof_ref,
          read_at: snapshot.read_at,
          source_revisions: snapshot.source_revisions,
        };
        const value = GetExpenseContextResultSchema.parse({
          ...source,
          evidence: [evidence],
          proof,
        });
        const candidate = authorization.authorizationCandidate;
        const ownsExpense =
          value.expense.submitted_by.team_member_ref.id ===
          authorization.actorContext.actorUserId;
        const canView = candidate.expensesViewScope === "all" || ownsExpense;
        const canReceiveReviewReason =
          value.review_reason === null ||
          ownsExpense ||
          candidate.expensesApproveScope !== null;
        if (
          !exactBinding(snapshot, authorization) ||
          value.expense.expense_ref.id !== authorization.query.expense_ref.id ||
          !canView ||
          !canReceiveReviewReason ||
          (candidate.expensesApproveScope === "assigned" &&
            value.review_reason !== null &&
            value.expense.allocations.length === 0) ||
          snapshot.source_inspected.allocations !==
            value.expense.allocations.length ||
          snapshot.source_inspected.allocations >=
            EXPENSE_READ_MAX_SOURCE_ROWS ||
          snapshot.source_inspected.batches !==
            (value.batch === null ? 0 : 1) ||
          snapshot.proof_ref !==
            expenseContextEntityProofRef({
              authorization,
              readAt: snapshot.read_at,
              sourceRevisions: snapshot.source_revisions,
              sourceInspected: snapshot.source_inspected,
              result: source,
            }) ||
          snapshot.evidence_ref !==
            expenseContextEvidenceRef({
              companyId: authorization.actorContext.companyId,
              expenseId: value.expense.expense_ref.id,
              occurredAt: value.expense.updated_at,
            })
        ) {
          invalid();
        }
        assertNoExpenseForbiddenFields(value);
        return deepFreeze({ state: "found" as const, value });
      } catch (error) {
        if (error instanceof ExpenseReadRepositoryError) throw error;
        invalid(error);
      }
    },
  };

  TRUSTED_EXPENSE_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedExpenseReadRepository(
  value: unknown
): value is ExpenseReadRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_EXPENSE_REPOSITORIES.has(value)
  );
}
