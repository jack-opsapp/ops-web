import "server-only";

import {
  assertP2NoForbiddenFields,
  P2_MAX_SERIALIZED_CHARACTERS,
} from "@/lib/agent-control-plane/contracts";
import {
  ListWorkQueueResultSchema,
  type ListWorkQueueResult,
} from "@/lib/agent-control-plane/contracts/work-queue";
import { P2ReadCursorError } from "../shared/cursor";
import { readThroughP2RepositoryBoundary } from "../shared/repository-boundary";
import { toP2ReadAgentError } from "../shared/read-error-transport";
import { measureP2SerializedCharacters } from "../shared/result-budget";
import {
  isAuthorizedWorkQueueRead,
  type AuthorizedWorkQueueRead,
} from "./work-queue-authorization";
import type { createWorkQueueCursorService } from "./work-queue-cursor";
import {
  isTrustedWorkQueueRepository,
  type WorkQueueRepository,
  type WorkQueueRepositoryResult,
} from "./work-queue-repository";
import {
  workQueueCollectionProofRef,
  workQueueProofContext,
} from "./work-queue-proof";
import {
  deepFreezeWorkQueue,
  reduceWorkQueueAtomicPrefix,
  WorkQueueBudgetError,
} from "./work-queue-budget";

export class WorkQueueReadError extends Error {
  readonly code:
    | "INVALID_CURSOR"
    | "STALE_CONTEXT"
    | "RESULT_TOO_LARGE"
    | "TEMPORARILY_UNAVAILABLE"
    | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(code: WorkQueueReadError["code"], requestId: string) {
    const messages = {
      INVALID_CURSOR: "This work queue page expired. Start again.",
      STALE_CONTEXT: "Work queue changed. Start again.",
      RESULT_TOO_LARGE: "Work queue is too large. Narrow the filters.",
      TEMPORARILY_UNAVAILABLE: "Work queue couldn't load. Try again.",
      INTERNAL: "Work queue couldn't load. Try again.",
    } as const;
    super(messages[code]);
    this.name = "WorkQueueReadError";
    this.code = code;
    this.requestId = requestId;
    this.retryable =
      code === "STALE_CONTEXT" || code === "TEMPORARILY_UNAVAILABLE";
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
type CursorService = ReturnType<typeof createWorkQueueCursorService>;
function fail(
  code: WorkQueueReadError["code"],
  authorization?: AuthorizedWorkQueueRead
): never {
  throw new WorkQueueReadError(
    code,
    authorization?.actorContext.requestId ?? "unknown-request"
  );
}

export async function listWorkQueue(input: {
  authorization: AuthorizedWorkQueueRead;
  repository: WorkQueueRepository;
  cursors: CursorService;
  signal?: AbortSignal;
}): Promise<ListWorkQueueResult> {
  const authorization = input.authorization;
  if (
    !isAuthorizedWorkQueueRead(authorization) ||
    !isTrustedWorkQueueRepository(input.repository)
  )
    fail("INTERNAL", authorization);
  let cursor = null;
  try {
    cursor = authorization.query.cursor
      ? input.cursors.decode({
          authorization,
          token: authorization.query.cursor,
        })
      : null;
  } catch (error) {
    if (error instanceof P2ReadCursorError)
      fail("INVALID_CURSOR", authorization);
    fail("INTERNAL", authorization);
  }
  let result: WorkQueueRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedWorkQueueRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.list({
          authorization,
          cursor,
          ...(signal ? { signal } : {}),
        }),
      parse: (raw) => raw,
    });
  } catch {
    fail("TEMPORARILY_UNAVAILABLE", authorization);
  }
  if (result.state !== "found") {
    fail(
      result.state === "source_bound" ? "RESULT_TOO_LARGE" : "STALE_CONTEXT",
      authorization
    );
  }
  const proofContext = workQueueProofContext({
    authorization,
    readAt: result.readAt,
    sourceRevisions: result.sourceRevisions,
    sourceInspected: result.sourceInspected,
    sourceSlices: result.sourceSlices,
    sourceHasMore: result.sourceHasMore,
    cursor,
  });
  if (authorization.authorizedSources.length === 0) {
    if (
      result.units.length !== 0 ||
      result.sourceRevisions.length !== 0 ||
      result.sourceInspected !== 0 ||
      result.sourceSlices.length !== 0 ||
      result.sourceHasMore
    )
      fail("INTERNAL", authorization);
    const warningsOnly = ListWorkQueueResultSchema.parse({
      items: [],
      item_proofs: [],
      evidence: [],
      warnings: authorization.warnings,
      collection_proof: {
        proof_ref: workQueueCollectionProofRef({
          context: proofContext,
          returnedCount: 0,
          hasMore: false,
          children: [],
        }),
        read_at: result.readAt,
        source_revisions: [],
        returned_count: 0,
        has_more: false,
      },
      next_cursor: null,
    });
    return deepFreezeWorkQueue(warningsOnly);
  }
  let candidateUnits = [...result.units];
  for (;;) {
    try {
      const budgeted = reduceWorkQueueAtomicPrefix({
        warnings: authorization.warnings,
        units: candidateUnits.map((unit) => ({
          item: unit.item,
          proof: {
            ...unit.proof,
            source_revisions: unit.proof.source_revisions.map((revision) => ({
              ...revision,
            })),
          },
          evidence: unit.evidence,
        })),
        sourceHasMore:
          result.sourceHasMore || candidateUnits.length < result.units.length,
        collectionSourceRevisions: result.sourceRevisions,
        makeCollectionProof: (returnedCount, hasMore) => ({
          proof_ref: workQueueCollectionProofRef({
            context: proofContext,
            returnedCount,
            hasMore,
            children: candidateUnits.slice(0, returnedCount).map((unit) => ({
              queue_ref: unit.item.queue_ref,
              proof_ref: unit.proof.proof_ref,
              evidence_ref: unit.evidence[0]!.evidence_ref,
            })),
          }),
          read_at: result.readAt,
          source_revisions: result.sourceRevisions.map((revision) => ({
            ...revision,
          })),
          returned_count: returnedCount,
          has_more: hasMore,
        }),
      });
      const returnedCount = budgeted.items.length;
      const predecessor = returnedCount
        ? candidateUnits[returnedCount - 1]!.predecessor
        : null;
      const nextCursor =
        budgeted.collection_proof.has_more && predecessor
          ? input.cursors.encode({
              authorization,
              sourceRevisions: result.sourceRevisions,
              readAt: result.readAt,
              predecessor,
            })
          : null;
      const parsed = ListWorkQueueResultSchema.parse({
        ...budgeted,
        warnings: authorization.warnings,
        next_cursor: nextCursor,
      });
      assertP2NoForbiddenFields(parsed);
      if (measureP2SerializedCharacters(parsed) <= P2_MAX_SERIALIZED_CHARACTERS)
        return deepFreezeWorkQueue(parsed);
      if (returnedCount <= 1) fail("RESULT_TOO_LARGE", authorization);
      candidateUnits = candidateUnits.slice(0, returnedCount - 1);
    } catch (error) {
      if (error instanceof WorkQueueReadError) throw error;
      if (
        error instanceof WorkQueueBudgetError &&
        error.code === "BUDGET_EXCEEDED"
      )
        fail("RESULT_TOO_LARGE", authorization);
      fail("INTERNAL", authorization);
    }
  }
}
