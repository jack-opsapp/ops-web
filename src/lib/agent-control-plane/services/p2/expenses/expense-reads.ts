import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  GetExpenseContextResultSchema,
  ListExpensesResultSchema,
  assertNoExpenseForbiddenFields,
  type GetExpenseContextResult,
  type ListExpensesResult,
} from "@/lib/agent-control-plane/contracts/expenses";
import { P2ReadCursorError } from "../shared/cursor";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import {
  P2ResultBudgetError,
  measureP2SerializedCharacters,
  reduceP2AtomicResultToBudget,
} from "../shared/result-budget";
import {
  isAuthorizedGetExpenseContextRead,
  isAuthorizedListExpensesRead,
  type AuthorizedGetExpenseContextRead,
  type AuthorizedListExpensesRead,
} from "./expense-authorization";
import type {
  ExpenseCursorContext,
  ExpenseCursorService,
} from "./expense-cursor";
import {
  expenseCollectionProofRef,
  expenseListProofContext,
} from "./expense-proof";
import {
  isTrustedExpenseReadRepository,
  type ExpenseDetailRepositoryResult,
  type ExpenseListRepositoryResult,
  type ExpenseReadRepository,
} from "./expense-repository";

export class ExpenseReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_CURSOR"
    | "NOT_FOUND"
    | "RESULT_TOO_LARGE"
    | "SOURCE_DATA_INVALID"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: ExpenseReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "Expenses could not be read.",
      INVALID_CURSOR: "This expense page expired. Start again.",
      NOT_FOUND: "Expense not found.",
      RESULT_TOO_LARGE: "This expense result is too large to return.",
      SOURCE_DATA_INVALID: "Expense data is temporarily unavailable.",
      STALE_CONTEXT: "Expenses changed. Start the read again.",
      TEMPORARILY_UNAVAILABLE: "Expenses are temporarily unavailable.",
    } as const;
    super(messages[input.code]);
    this.name = "ExpenseReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable =
      input.code === "STALE_CONTEXT" ||
      input.code === "TEMPORARILY_UNAVAILABLE";
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function readError(
  code: ExpenseReadError["code"],
  authorization: AuthorizedListExpensesRead | AuthorizedGetExpenseContextRead
) {
  return new ExpenseReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("EXPENSE_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    terminalStates.includes(String(record.state)) &&
    Object.keys(record).length !== 1
  ) {
    throw new TypeError("EXPENSE_REPOSITORY_RESULT_INVALID");
  }
  return record;
}

function parseListRepositoryResult(raw: unknown): ExpenseListRepositoryResult {
  const record = exactStateRecord(raw, [
    "source_bound",
    "source_invalid",
    "stale",
  ]);
  if (
    record.state === "source_bound" ||
    record.state === "source_invalid" ||
    record.state === "stale"
  ) {
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    typeof record.page !== "object" ||
    record.page === null ||
    !Array.isArray((record.page as { units?: unknown }).units)
  ) {
    throw new TypeError("EXPENSE_REPOSITORY_RESULT_INVALID");
  }
  return raw as ExpenseListRepositoryResult;
}

function parseDetailRepositoryResult(
  raw: unknown
): ExpenseDetailRepositoryResult {
  const record = exactStateRecord(raw, [
    "not_found",
    "source_bound",
    "source_invalid",
    "stale",
  ]);
  if (
    record.state === "not_found" ||
    record.state === "source_bound" ||
    record.state === "source_invalid" ||
    record.state === "stale"
  ) {
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    !("value" in record)
  ) {
    throw new TypeError("EXPENSE_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: GetExpenseContextResultSchema.parse(record.value),
  });
}

function buildListResult(input: {
  readonly authorization: AuthorizedListExpensesRead;
  readonly repositoryResult: Extract<
    ExpenseListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: ExpenseCursorContext | null;
  readonly cursors: ExpenseCursorService;
}): ListExpensesResult {
  const page = input.repositoryResult.page;
  for (
    let maximumUnits = page.units.length;
    maximumUnits >= (page.units.length === 0 ? 0 : 1);
    maximumUnits -= 1
  ) {
    try {
      const retained = page.units.slice(0, maximumUnits);
      const budgeted = reduceP2AtomicResultToBudget({
        envelope: { next_cursor: null },
        units: retained.map((unit) => ({
          item: unit.item,
          proof: unit.proof,
          evidence: unit.evidence,
        })),
        sourceHasMore: page.sourceHasMore || maximumUnits < page.units.length,
        makeCollectionProof: (returnedCount, hasMore) => ({
          proof_ref: expenseCollectionProofRef({
            context: expenseListProofContext({
              authorization: input.authorization,
              cursor: input.cursor,
              readAt: page.readAt,
              sourceRevisions: page.sourceRevisions,
              sourceInspected: page.sourceInspected,
              sourceHasMore: page.sourceHasMore,
            }),
            returnedCount,
            hasMore,
            children: retained.slice(0, returnedCount).map((unit) => ({
              item_ref:
                unit.item.item_kind === "expense"
                  ? unit.item.expense_ref
                  : unit.item.batch_ref,
              proof_ref: unit.proof.proof_ref,
              evidence_ref: unit.evidence[0]!.evidence_ref,
            })),
          }),
          read_at: page.readAt,
          source_revisions: page.sourceRevisions.map((revision) => ({
            ...revision,
          })),
          returned_count: returnedCount,
          has_more: hasMore,
        }),
      });
      const returnedCount = budgeted.items.length;
      const hasMore = budgeted.collection_proof.has_more;
      const predecessor =
        returnedCount === 0 ? null : retained[returnedCount - 1]!.predecessor;
      const nextCursor =
        hasMore && predecessor
          ? input.cursors.encode({
              authorization: input.authorization,
              sourceRevisions: page.sourceRevisions,
              readAt: page.readAt,
              predecessor,
            })
          : null;
      const parsed = ListExpensesResultSchema.parse({
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertNoExpenseForbiddenFields(parsed);
      if (
        measureP2SerializedCharacters(parsed) <= P2_MAX_SERIALIZED_CHARACTERS
      ) {
        return deepFreeze(parsed);
      }
    } catch (error) {
      if (
        !(error instanceof P2ResultBudgetError) &&
        !(error instanceof RangeError)
      ) {
        throw error;
      }
    }
  }
  throw readError("RESULT_TOO_LARGE", input.authorization);
}

export async function listExpenses(input: {
  readonly authorization: AuthorizedListExpensesRead;
  readonly repository: ExpenseReadRepository;
  readonly cursors: ExpenseCursorService;
  readonly signal?: AbortSignal;
}): Promise<ListExpensesResult> {
  const authorization = input.authorization;
  if (!isAuthorizedListExpensesRead(authorization)) {
    throw new ExpenseReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedExpenseReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let cursor: ExpenseCursorContext | null = null;
  if (authorization.query.cursor) {
    try {
      cursor = input.cursors.decode({
        authorization,
        token: authorization.query.cursor,
      });
    } catch (error) {
      if (error instanceof P2ReadCursorError) {
        throw readError("INVALID_CURSOR", authorization);
      }
      throw readError("INTERNAL", authorization);
    }
  }

  let result: ExpenseListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedExpenseReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.list({
          authorization,
          cursor,
          ...(signal ? { signal } : {}),
        }),
      parse: parseListRepositoryResult,
    });
  } catch (error) {
    throw readError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "source_bound") {
    throw readError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "source_invalid") {
    throw readError("SOURCE_DATA_INVALID", authorization);
  }
  if (result.state === "stale") {
    throw readError("STALE_CONTEXT", authorization);
  }
  try {
    return buildListResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof ExpenseReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}

export async function getExpenseContext(input: {
  readonly authorization: AuthorizedGetExpenseContextRead;
  readonly repository: ExpenseReadRepository;
  readonly signal?: AbortSignal;
}): Promise<GetExpenseContextResult> {
  const authorization = input.authorization;
  if (!isAuthorizedGetExpenseContextRead(authorization)) {
    throw new ExpenseReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedExpenseReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let result: ExpenseDetailRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedExpenseReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.get({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseDetailRepositoryResult,
    });
  } catch (error) {
    throw readError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "not_found") throw readError("NOT_FOUND", authorization);
  if (result.state === "source_bound") {
    throw readError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "source_invalid") {
    throw readError("SOURCE_DATA_INVALID", authorization);
  }
  if (result.state === "stale") {
    throw readError("STALE_CONTEXT", authorization);
  }
  try {
    const parsed = GetExpenseContextResultSchema.parse(result.value);
    assertNoExpenseForbiddenFields(parsed);
    if (measureP2SerializedCharacters(parsed) > P2_MAX_SERIALIZED_CHARACTERS) {
      throw readError("RESULT_TOO_LARGE", authorization);
    }
    return deepFreeze(parsed);
  } catch (error) {
    if (error instanceof ExpenseReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}
