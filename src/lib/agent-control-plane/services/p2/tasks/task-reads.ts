import "server-only";

import {
  assertP2NoForbiddenFields,
  P2_MAX_SERIALIZED_CHARACTERS,
} from "@/lib/agent-control-plane/contracts";
import {
  GetTaskContextResultSchema,
  ListTasksResultSchema,
  type GetTaskContextResult,
  type ListTasksResult,
} from "@/lib/agent-control-plane/contracts/tasks";
import { P2ReadCursorError } from "../shared/cursor";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { toP2ReadAgentError } from "../shared/read-error-transport";
import {
  measureP2SerializedCharacters,
  P2ResultBudgetError,
  reduceP2AtomicResultToBudget,
} from "../shared/result-budget";
import {
  isAuthorizedGetTaskContextRead,
  isAuthorizedListTasksRead,
  type AuthorizedGetTaskContextRead,
  type AuthorizedListTasksRead,
} from "./task-authorization";
import type { TaskListCursorService } from "./task-cursor";
import { taskListCollectionProofRef, taskListProofContext } from "./task-proof";
import {
  isTrustedTaskReadRepository,
  type TaskContextRepositoryResult,
  type TaskListRepositoryResult,
  type TaskReadRepository,
} from "./task-repository";

export class TaskReadError extends Error {
  readonly code:
    | "INVALID_CURSOR"
    | "NOT_FOUND"
    | "STALE_CONTEXT"
    | "RESULT_TOO_LARGE"
    | "TEMPORARILY_UNAVAILABLE"
    | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: TaskReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INVALID_CURSOR: "The task cursor is invalid or expired.",
      NOT_FOUND: "Task context was not found.",
      STALE_CONTEXT: "Task context changed. Start the read again.",
      RESULT_TOO_LARGE: "The task result is too large to return safely.",
      TEMPORARILY_UNAVAILABLE: "Task data is temporarily unavailable.",
      INTERNAL: "Task data could not be read.",
    } as const;
    super(messages[input.code]);
    this.name = "TaskReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable =
      input.code === "STALE_CONTEXT" ||
      input.code === "TEMPORARILY_UNAVAILABLE";
  }

  toAgentError() {
    return toP2ReadAgentError({
      code: this.code,
      requestId: this.requestId,
      message: this.message,
      retryable: this.retryable,
    });
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("TASK_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (terminalStates.includes(String(record.state))) {
    if (Object.keys(record).length !== 1) {
      throw new TypeError("TASK_REPOSITORY_RESULT_INVALID");
    }
  }
  return record;
}

function parseListRepositoryResult(raw: unknown): TaskListRepositoryResult {
  const record = exactStateRecord(raw, ["source_bound", "stale"]);
  if (record.state === "source_bound" || record.state === "stale") {
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    typeof record.page !== "object" ||
    record.page === null
  ) {
    throw new TypeError("TASK_REPOSITORY_RESULT_INVALID");
  }
  return raw as TaskListRepositoryResult;
}

function parseDetailRepositoryResult(
  raw: unknown
): TaskContextRepositoryResult {
  const record = exactStateRecord(raw, ["not_found", "source_bound", "stale"]);
  if (
    record.state === "not_found" ||
    record.state === "source_bound" ||
    record.state === "stale"
  ) {
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    !("value" in record)
  ) {
    throw new TypeError("TASK_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: GetTaskContextResultSchema.parse(record.value),
  });
}

function taskError(
  code: TaskReadError["code"],
  authorization: AuthorizedListTasksRead | AuthorizedGetTaskContextRead
): TaskReadError {
  return new TaskReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function buildListResult(input: {
  readonly authorization: AuthorizedListTasksRead;
  readonly repositoryResult: Extract<
    TaskListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: Parameters<TaskReadRepository["list"]>[0]["cursor"];
  readonly cursors: TaskListCursorService;
}): ListTasksResult {
  const page = input.repositoryResult.page;
  for (
    let maximumUnits = page.units.length;
    maximumUnits >= (page.units.length === 0 ? 0 : 1);
    maximumUnits -= 1
  ) {
    try {
      const budgeted = reduceP2AtomicResultToBudget({
        envelope: { next_cursor: null },
        units: page.units.slice(0, maximumUnits).map((unit) => ({
          item: unit.item,
          proof: unit.proof,
          evidence: unit.evidence,
        })),
        sourceHasMore: page.sourceHasMore || maximumUnits < page.units.length,
        makeCollectionProof: (returnedCount, hasMore) => ({
          proof_ref: taskListCollectionProofRef({
            context: taskListProofContext({
              authorization: input.authorization,
              cursor: input.cursor,
              readAt: page.readAt,
              sourceRevisions: page.sourceRevisions,
              sourceInspected: page.sourceInspected,
              sourceHasMore: page.sourceHasMore,
            }),
            returnedCount,
            hasMore,
            children: page.units.slice(0, returnedCount).map((unit) => ({
              task_ref: unit.item.task_ref,
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
        returnedCount === 0 ? null : page.units[returnedCount - 1]!.predecessor;
      const nextCursor =
        hasMore && predecessor
          ? input.cursors.encode({
              authorization: input.authorization,
              sourceRevisions: page.sourceRevisions,
              readAt: page.readAt,
              predecessor,
            })
          : null;
      const parsed = ListTasksResultSchema.parse({
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertP2NoForbiddenFields(parsed);
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
  throw taskError("RESULT_TOO_LARGE", input.authorization);
}

export async function listTasks(input: {
  readonly authorization: AuthorizedListTasksRead;
  readonly repository: TaskReadRepository;
  readonly cursors: TaskListCursorService;
  readonly signal?: AbortSignal;
}): Promise<ListTasksResult> {
  const authorization = input.authorization;
  if (!isAuthorizedListTasksRead(authorization)) {
    throw new TaskReadError({ code: "INTERNAL", requestId: "unknown-request" });
  }
  if (!isTrustedTaskReadRepository(input.repository)) {
    throw taskError("INTERNAL", authorization);
  }

  let cursor = null;
  if (authorization.query.cursor) {
    try {
      cursor = input.cursors.decode({
        authorization,
        token: authorization.query.cursor,
      });
    } catch (error) {
      if (error instanceof P2ReadCursorError) {
        throw taskError("INVALID_CURSOR", authorization);
      }
      throw taskError("INTERNAL", authorization);
    }
  }

  let result: TaskListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedTaskReadRepository,
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
    throw taskError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "source_bound") {
    throw taskError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw taskError("STALE_CONTEXT", authorization);
  }
  try {
    return buildListResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof TaskReadError) throw error;
    throw taskError("INTERNAL", authorization);
  }
}

export async function getTaskContext(input: {
  readonly authorization: AuthorizedGetTaskContextRead;
  readonly repository: TaskReadRepository;
  readonly signal?: AbortSignal;
}): Promise<GetTaskContextResult> {
  const authorization = input.authorization;
  if (!isAuthorizedGetTaskContextRead(authorization)) {
    throw new TaskReadError({ code: "INTERNAL", requestId: "unknown-request" });
  }
  if (!isTrustedTaskReadRepository(input.repository)) {
    throw taskError("INTERNAL", authorization);
  }
  let result: TaskContextRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedTaskReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.get({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseDetailRepositoryResult,
    });
  } catch (error) {
    throw taskError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "not_found") throw taskError("NOT_FOUND", authorization);
  if (result.state === "source_bound") {
    throw taskError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") throw taskError("STALE_CONTEXT", authorization);
  try {
    const parsed = GetTaskContextResultSchema.parse(result.value);
    assertP2NoForbiddenFields(parsed);
    if (measureP2SerializedCharacters(parsed) > P2_MAX_SERIALIZED_CHARACTERS) {
      throw taskError("RESULT_TOO_LARGE", authorization);
    }
    return deepFreeze(parsed);
  } catch (error) {
    if (error instanceof TaskReadError) throw error;
    throw taskError("INTERNAL", authorization);
  }
}
