import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  CatalogItemDetailResultSchema,
  CatalogSearchResultSchema,
  assertNoCatalogForbiddenFields,
  type CatalogItemDetailResult,
  type CatalogSearchResult,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
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
  isAuthorizedGetCatalogItemRead,
  isAuthorizedSearchCatalogItemsRead,
  type AuthorizedGetCatalogItemRead,
  type AuthorizedSearchCatalogItemsRead,
} from "./catalog-authorization";
import type {
  CatalogCursorContext,
  CatalogCursorService,
} from "./catalog-cursor";
import {
  catalogCollectionProofRef,
  catalogListProofContext,
} from "./catalog-proof";
import {
  isTrustedCatalogReadRepository,
  type CatalogDetailRepositoryResult,
  type CatalogListRepositoryResult,
  type CatalogReadRepository,
} from "./catalog-repository";

export class CatalogReadError extends Error {
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
    readonly code: CatalogReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "Catalog couldn't be read. Try again.",
      INVALID_CURSOR: "This catalog page expired. Start again.",
      NOT_FOUND: "Catalog item not found.",
      RESULT_TOO_LARGE: "This catalog result is too large. Narrow the search.",
      STALE_CONTEXT: "Catalog changed. Start the read again.",
      TEMPORARILY_UNAVAILABLE: "Catalog is temporarily unavailable. Try again.",
    } as const;
    super(messages[input.code]);
    this.name = "CatalogReadError";
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
  code: CatalogReadError["code"],
  authorization: AuthorizedSearchCatalogItemsRead | AuthorizedGetCatalogItemRead
) {
  return new CatalogReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("CATALOG_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    terminalStates.includes(String(record.state)) &&
    Object.keys(record).length !== 1
  ) {
    throw new TypeError("CATALOG_REPOSITORY_RESULT_INVALID");
  }
  return record;
}

function parseListRepositoryResult(raw: unknown): CatalogListRepositoryResult {
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
    throw new TypeError("CATALOG_REPOSITORY_RESULT_INVALID");
  }
  return raw as CatalogListRepositoryResult;
}

function parseDetailRepositoryResult(
  raw: unknown
): CatalogDetailRepositoryResult {
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
    throw new TypeError("CATALOG_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: CatalogItemDetailResultSchema.parse(record.value),
  });
}

function buildSearchResult(input: {
  readonly authorization: AuthorizedSearchCatalogItemsRead;
  readonly repositoryResult: Extract<
    CatalogListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: CatalogCursorContext | null;
  readonly cursors: CatalogCursorService;
}): CatalogSearchResult {
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
          proof_ref: catalogCollectionProofRef({
            context: catalogListProofContext({
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
              variant_ref: unit.item.variant_ref,
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
      const parsed = CatalogSearchResultSchema.parse({
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertNoCatalogForbiddenFields(parsed, {
        supplierCostsSelected: false,
      });
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

export async function searchCatalogItems(input: {
  readonly authorization: AuthorizedSearchCatalogItemsRead;
  readonly repository: CatalogReadRepository;
  readonly cursors: CatalogCursorService;
  readonly signal?: AbortSignal;
}): Promise<CatalogSearchResult> {
  const authorization = input.authorization;
  if (!isAuthorizedSearchCatalogItemsRead(authorization)) {
    throw new CatalogReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedCatalogReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let cursor: CatalogCursorContext | null = null;
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

  let result: CatalogListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedCatalogReadRepository,
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
    return buildSearchResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof CatalogReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}

export async function getCatalogItem(input: {
  readonly authorization: AuthorizedGetCatalogItemRead;
  readonly repository: CatalogReadRepository;
  readonly signal?: AbortSignal;
}): Promise<CatalogItemDetailResult> {
  const authorization = input.authorization;
  if (!isAuthorizedGetCatalogItemRead(authorization)) {
    throw new CatalogReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedCatalogReadRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }
  let result: CatalogDetailRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedCatalogReadRepository,
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
  if (result.state === "stale") {
    throw readError("STALE_CONTEXT", authorization);
  }
  try {
    const parsed = CatalogItemDetailResultSchema.parse(result.value);
    assertNoCatalogForbiddenFields(parsed, {
      supplierCostsSelected:
        authorization.query.sections.includes("supplier_costs"),
    });
    if (measureP2SerializedCharacters(parsed) > P2_MAX_SERIALIZED_CHARACTERS) {
      throw readError("RESULT_TOO_LARGE", authorization);
    }
    return deepFreeze(parsed);
  } catch (error) {
    if (error instanceof CatalogReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}
