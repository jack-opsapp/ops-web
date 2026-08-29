import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  ListPaymentsResultSchema,
  assertNoPaymentForbiddenFields,
  type ListPaymentsResult,
} from "@/lib/agent-control-plane/contracts/sales-documents";
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
  isAuthorizedListPaymentsRead,
  type AuthorizedListPaymentsRead,
} from "./payment-authorization";
import type {
  PaymentCursorContext,
  PaymentCursorService,
} from "./payment-cursor";
import {
  paymentCollectionProofRef,
  paymentListProofContext,
} from "./payment-proof";
import {
  isTrustedPaymentReadRepository,
  type PaymentListRepositoryResult,
  type PaymentReadRepository,
} from "./payment-repository";

export class PaymentReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_CURSOR"
    | "RESULT_TOO_LARGE"
    | "SOURCE_DATA_INVALID"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: PaymentReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "Payments couldn't load. Try again.",
      INVALID_CURSOR: "This payment page expired. Start again.",
      RESULT_TOO_LARGE: "Too many payments. Narrow the filters and try again.",
      SOURCE_DATA_INVALID: "Payments couldn't load. Try again.",
      STALE_CONTEXT: "Payments changed. Start again.",
      TEMPORARILY_UNAVAILABLE: "Payments couldn't load. Try again.",
    } as const;
    super(messages[input.code]);
    this.name = "PaymentReadError";
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
  code: PaymentReadError["code"],
  authorization: AuthorizedListPaymentsRead
) {
  return new PaymentReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function parseRepositoryResult(raw: unknown): PaymentListRepositoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("PAYMENT_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    record.state === "source_bound" ||
    record.state === "source_invalid" ||
    record.state === "stale"
  ) {
    if (Object.keys(record).length !== 1) {
      throw new TypeError("PAYMENT_REPOSITORY_RESULT_INVALID");
    }
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    typeof record.page !== "object" ||
    record.page === null ||
    !Array.isArray((record.page as { units?: unknown }).units)
  ) {
    throw new TypeError("PAYMENT_REPOSITORY_RESULT_INVALID");
  }
  return raw as PaymentListRepositoryResult;
}

function buildResult(input: {
  readonly authorization: AuthorizedListPaymentsRead;
  readonly repositoryResult: Extract<
    PaymentListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: PaymentCursorContext | null;
  readonly cursors: PaymentCursorService;
}): ListPaymentsResult {
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
          proof_ref: paymentCollectionProofRef({
            context: paymentListProofContext({
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
              payment_ref: unit.item.payment_ref,
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
      const parsed = ListPaymentsResultSchema.parse({
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertNoPaymentForbiddenFields(parsed);
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

export async function listPayments(input: {
  readonly authorization: AuthorizedListPaymentsRead;
  readonly repository: PaymentReadRepository;
  readonly cursors: PaymentCursorService;
  readonly signal?: AbortSignal;
}): Promise<ListPaymentsResult> {
  const authorization = input.authorization;
  if (!isAuthorizedListPaymentsRead(authorization)) {
    throw new PaymentReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedPaymentReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let cursor: PaymentCursorContext | null = null;
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

  let result: PaymentListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedPaymentReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.list({
          authorization,
          cursor,
          ...(signal ? { signal } : {}),
        }),
      parse: parseRepositoryResult,
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
    return buildResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof PaymentReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}
