import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  PurchaseOrderDetailResultSchema,
  PurchaseOrderListResultSchema,
  assertNoPurchaseOrderForbiddenFields,
  type PurchaseOrderDetailResult,
  type PurchaseOrderListResult,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { P2ReadCursorError } from "../shared/cursor";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import { toP2ReadAgentError } from "../shared/read-error-transport";
import {
  P2ResultBudgetError,
  measureP2SerializedCharacters,
  reduceP2AtomicResultToBudget,
} from "../shared/result-budget";
import {
  isAuthorizedGetPurchaseOrderRead,
  isAuthorizedListPurchaseOrdersRead,
  type AuthorizedGetPurchaseOrderRead,
  type AuthorizedListPurchaseOrdersRead,
} from "./purchase-order-authorization";
import type {
  PurchaseOrderCursorContext,
  PurchaseOrderCursorService,
} from "./purchase-order-cursor";
import {
  purchaseOrderCollectionProofRef,
  purchaseOrderListProofContext,
} from "./purchase-order-proof";
import {
  isTrustedPurchaseOrderReadRepository,
  type PurchaseOrderDetailRepositoryResult,
  type PurchaseOrderListRepositoryResult,
  type PurchaseOrderReadRepository,
} from "./purchase-order-repository";

export class PurchaseOrderReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_CURSOR"
    | "NOT_FOUND"
    | "RESULT_TOO_LARGE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: PurchaseOrderReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "Purchase orders couldn't be read. Try again.",
      INVALID_CURSOR: "This purchase-order page expired. Start again.",
      NOT_FOUND: "Purchase order not found.",
      RESULT_TOO_LARGE:
        "This purchase-order result is too large. Narrow the search.",
      STALE_CONTEXT: "Purchase orders changed. Start the read again.",
      TEMPORARILY_UNAVAILABLE:
        "Purchase orders are temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code]);
    this.name = "PurchaseOrderReadError";
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
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function readError(
  code: PurchaseOrderReadError["code"],
  authorization:
    | AuthorizedListPurchaseOrdersRead
    | AuthorizedGetPurchaseOrderRead
) {
  return new PurchaseOrderReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("PURCHASE_ORDER_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    terminalStates.includes(String(record.state)) &&
    Object.keys(record).length !== 1
  ) {
    throw new TypeError("PURCHASE_ORDER_REPOSITORY_RESULT_INVALID");
  }
  return record;
}

function parseListRepositoryResult(
  raw: unknown
): PurchaseOrderListRepositoryResult {
  const record = exactStateRecord(raw, ["source_bound", "stale"]);
  if (record.state === "source_bound" || record.state === "stale") {
    return deepFreeze({ state: record.state });
  }
  if (
    record.state !== "found" ||
    Object.keys(record).length !== 2 ||
    typeof record.page !== "object" ||
    record.page === null ||
    !Array.isArray((record.page as { units?: unknown }).units)
  ) {
    throw new TypeError("PURCHASE_ORDER_REPOSITORY_RESULT_INVALID");
  }
  return raw as PurchaseOrderListRepositoryResult;
}

function parseDetailRepositoryResult(
  raw: unknown
): PurchaseOrderDetailRepositoryResult {
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
    throw new TypeError("PURCHASE_ORDER_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: PurchaseOrderDetailResultSchema.parse(record.value),
  });
}

function buildListResult(input: {
  readonly authorization: AuthorizedListPurchaseOrdersRead;
  readonly repositoryResult: Extract<
    PurchaseOrderListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: PurchaseOrderCursorContext | null;
  readonly cursors: PurchaseOrderCursorService;
}): PurchaseOrderListResult {
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
          proof_ref: purchaseOrderCollectionProofRef({
            context: purchaseOrderListProofContext({
              authorization: input.authorization,
              cursor: input.cursor,
              readAt: page.readAt,
              sourceRevisions: page.sourceRevisions,
              sourceInspected: page.sourceInspected,
              sourceHasMore: page.sourceHasMore,
              catalogCostWitness: page.catalogCostWitness,
            }),
            returnedCount,
            hasMore,
            children: retained.slice(0, returnedCount).map((unit) => ({
              purchase_order_ref: unit.item.purchase_order_ref,
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
      const result = PurchaseOrderListResultSchema.parse({
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertNoPurchaseOrderForbiddenFields(result, {
        costsSelected: input.authorization.query.sections.includes("costs"),
      });
      if (
        measureP2SerializedCharacters(result) <= P2_MAX_SERIALIZED_CHARACTERS
      ) {
        return deepFreeze(result);
      }
    } catch (error) {
      if (error instanceof P2ResultBudgetError || error instanceof RangeError) {
        continue;
      }
      throw error;
    }
  }
  throw readError("RESULT_TOO_LARGE", input.authorization);
}

export async function listPurchaseOrders(input: {
  readonly authorization: AuthorizedListPurchaseOrdersRead;
  readonly repository: PurchaseOrderReadRepository;
  readonly cursors: PurchaseOrderCursorService;
  readonly signal?: AbortSignal;
}): Promise<PurchaseOrderListResult> {
  const authorization = input.authorization;
  if (!isAuthorizedListPurchaseOrdersRead(authorization)) {
    throw new PurchaseOrderReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedPurchaseOrderReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let cursor: PurchaseOrderCursorContext | null = null;
  try {
    cursor = authorization.query.cursor
      ? input.cursors.decode({
          authorization,
          token: authorization.query.cursor,
        })
      : null;
  } catch (error) {
    if (error instanceof P2ReadCursorError) {
      throw readError("INVALID_CURSOR", authorization);
    }
    throw readError("INTERNAL", authorization);
  }
  let result: PurchaseOrderListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedPurchaseOrderReadRepository,
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
    if (error instanceof PurchaseOrderReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}

export async function getPurchaseOrder(input: {
  readonly authorization: AuthorizedGetPurchaseOrderRead;
  readonly repository: PurchaseOrderReadRepository;
  readonly signal?: AbortSignal;
}): Promise<PurchaseOrderDetailResult> {
  const authorization = input.authorization;
  if (!isAuthorizedGetPurchaseOrderRead(authorization)) {
    throw new PurchaseOrderReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedPurchaseOrderReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let result: PurchaseOrderDetailRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedPurchaseOrderReadRepository,
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
  if (result.state === "not_found") {
    throw readError("NOT_FOUND", authorization);
  }
  if (result.state === "source_bound") {
    throw readError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw readError("STALE_CONTEXT", authorization);
  }
  try {
    const parsed = PurchaseOrderDetailResultSchema.parse(result.value);
    assertNoPurchaseOrderForbiddenFields(parsed, {
      costsSelected: authorization.query.sections.includes("costs"),
    });
    if (measureP2SerializedCharacters(parsed) > P2_MAX_SERIALIZED_CHARACTERS) {
      throw readError("RESULT_TOO_LARGE", authorization);
    }
    return deepFreeze(parsed);
  } catch (error) {
    if (error instanceof PurchaseOrderReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}
