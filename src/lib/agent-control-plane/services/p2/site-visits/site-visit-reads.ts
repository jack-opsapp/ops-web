import "server-only";

import {
  assertP2NoForbiddenFields,
  P2_MAX_SERIALIZED_CHARACTERS,
} from "@/lib/agent-control-plane/contracts";
import {
  GetSiteVisitContextResultSchema,
  ListSiteVisitsResultSchema,
  type GetSiteVisitContextResult,
  type ListSiteVisitsResult,
} from "@/lib/agent-control-plane/contracts/site-visits";
import { P2ReadCursorError } from "../shared/cursor";
import {
  P2RepositoryBoundaryError,
  readThroughP2RepositoryBoundary,
} from "../shared/repository-boundary";
import {
  measureP2SerializedCharacters,
  P2ResultBudgetError,
  reduceP2AtomicResultToBudget,
} from "../shared/result-budget";
import {
  isAuthorizedGetSiteVisitContextRead,
  isAuthorizedListSiteVisitsRead,
  type AuthorizedGetSiteVisitContextRead,
  type AuthorizedListSiteVisitsRead,
} from "./site-visit-authorization";
import type { SiteVisitListCursorService } from "./site-visit-cursor";
import {
  siteVisitContextEntityProofRef,
  siteVisitContextProofContext,
  siteVisitListCollectionProofRef,
  siteVisitListProofContext,
} from "./site-visit-proof";
import {
  isTrustedSiteVisitReadRepository,
  SiteVisitContextProofBindingSchema,
  type SiteVisitContextProofBinding,
  type SiteVisitContextRepositoryResult,
  type SiteVisitListRepositoryResult,
  type SiteVisitReadRepository,
} from "./site-visit-repository";

export class SiteVisitReadError extends Error {
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
    readonly code: SiteVisitReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INVALID_CURSOR: "The site-visit cursor is invalid or expired.",
      NOT_FOUND: "Site-visit context was not found.",
      STALE_CONTEXT: "Site-visit context changed. Start the read again.",
      RESULT_TOO_LARGE: "The site-visit result is too large to return safely.",
      TEMPORARILY_UNAVAILABLE: "Site-visit data is temporarily unavailable.",
      INTERNAL: "Site-visit data could not be read.",
    } as const;
    super(messages[input.code]);
    this.name = "SiteVisitReadError";
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

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("SITE_VISIT_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    terminalStates.includes(String(record.state)) &&
    Object.keys(record).length !== 1
  ) {
    throw new TypeError("SITE_VISIT_REPOSITORY_RESULT_INVALID");
  }
  return record;
}

function parseListRepositoryResult(
  raw: unknown
): SiteVisitListRepositoryResult {
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
    throw new TypeError("SITE_VISIT_REPOSITORY_RESULT_INVALID");
  }
  return raw as SiteVisitListRepositoryResult;
}

function parseContextRepositoryResult(
  raw: unknown
): SiteVisitContextRepositoryResult {
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
    Object.keys(record).length !== 3 ||
    !("value" in record) ||
    !("proofBinding" in record)
  ) {
    throw new TypeError("SITE_VISIT_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: GetSiteVisitContextResultSchema.parse(record.value),
    proofBinding: SiteVisitContextProofBindingSchema.parse(record.proofBinding),
  });
}

function visitError(
  code: SiteVisitReadError["code"],
  authorization:
    AuthorizedListSiteVisitsRead | AuthorizedGetSiteVisitContextRead
): SiteVisitReadError {
  return new SiteVisitReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function buildListResult(input: {
  readonly authorization: AuthorizedListSiteVisitsRead;
  readonly repositoryResult: Extract<
    SiteVisitListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: Parameters<SiteVisitReadRepository["list"]>[0]["cursor"];
  readonly cursors: SiteVisitListCursorService;
}): ListSiteVisitsResult {
  const page = input.repositoryResult.page;
  for (
    let maximumUnits = page.units.length;
    maximumUnits >= (page.units.length === 0 ? 0 : 1);
    maximumUnits -= 1
  ) {
    try {
      const budgeted = reduceP2AtomicResultToBudget({
        envelope: {
          view: input.authorization.query.view,
          next_cursor: null,
        },
        units: page.units.slice(0, maximumUnits).map((unit) => ({
          item: unit.item,
          proof: unit.proof,
          evidence: unit.evidence,
        })),
        sourceHasMore: page.sourceHasMore || maximumUnits < page.units.length,
        makeCollectionProof: (returnedCount, hasMore) => ({
          proof_ref: siteVisitListCollectionProofRef({
            context: siteVisitListProofContext({
              authorization: input.authorization,
              cursor: input.cursor,
              readAt: page.readAt,
              sourceRevisions: page.sourceRevisions as never,
              sourceInspected: page.sourceInspected,
              sourceHasMore: page.sourceHasMore,
            }),
            returnedCount,
            hasMore,
            children: page.units.slice(0, returnedCount).map((unit) => ({
              site_visit_ref: unit.item.site_visit_ref,
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
      const parsed = ListSiteVisitsResultSchema.parse({
        view: budgeted.view,
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
  throw visitError("RESULT_TOO_LARGE", input.authorization);
}

export async function listSiteVisits(input: {
  readonly authorization: AuthorizedListSiteVisitsRead;
  readonly repository: SiteVisitReadRepository;
  readonly cursors: SiteVisitListCursorService;
  readonly signal?: AbortSignal;
}): Promise<ListSiteVisitsResult> {
  const authorization = input.authorization;
  if (!isAuthorizedListSiteVisitsRead(authorization)) {
    throw new SiteVisitReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedSiteVisitReadRepository(input.repository)) {
    throw visitError("INTERNAL", authorization);
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
        throw visitError("INVALID_CURSOR", authorization);
      }
      throw visitError("INTERNAL", authorization);
    }
  }

  let result: SiteVisitListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedSiteVisitReadRepository,
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
    throw visitError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "source_bound") {
    throw visitError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw visitError("STALE_CONTEXT", authorization);
  }
  try {
    return buildListResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof SiteVisitReadError) throw error;
    throw visitError("INTERNAL", authorization);
  }
}

function parseSafeContext(candidate: unknown): GetSiteVisitContextResult {
  const parsed = GetSiteVisitContextResultSchema.parse(candidate);
  assertP2NoForbiddenFields(parsed);
  return deepFreeze(parsed);
}

function reproofContext(input: {
  readonly value: GetSiteVisitContextResult;
  readonly sections: GetSiteVisitContextResult["sections"];
  readonly authorization: AuthorizedGetSiteVisitContextRead;
  readonly proofBinding: SiteVisitContextProofBinding;
}) {
  const payload = { visit: input.value.visit, sections: input.sections };
  const context = siteVisitContextProofContext({
    authorization: input.authorization,
    readAt: input.value.proof.read_at,
    sourceRevisions: input.value.proof.source_revisions as never,
    sourceInspected: input.proofBinding.sourceInspected,
  });
  return parseSafeContext({
    ...payload,
    evidence: input.value.evidence,
    proof: {
      ...input.value.proof,
      proof_ref: siteVisitContextEntityProofRef({ context, result: payload }),
    },
  });
}

function reduceContextToBudget(input: {
  readonly value: GetSiteVisitContextResult;
  readonly authorization: AuthorizedGetSiteVisitContextRead;
  readonly proofBinding: SiteVisitContextProofBinding;
}) {
  let candidate = parseSafeContext(input.value);
  if (
    measureP2SerializedCharacters(candidate) <= P2_MAX_SERIALIZED_CHARACTERS
  ) {
    return candidate;
  }

  const original = candidate.sections.checklist_answers;
  if (!original || original.answers.length === 0) {
    throw visitError("RESULT_TOO_LARGE", input.authorization);
  }
  for (
    let retainedCount = original.answers.length - 1;
    retainedCount >= 0;
    retainedCount -= 1
  ) {
    const sections = {
      ...candidate.sections,
      checklist_answers: {
        ...original,
        answers: original.answers.slice(0, retainedCount),
        returned_count: retainedCount,
        result_budget_omitted_count: original.source_count - retainedCount,
      },
    };
    candidate = reproofContext({
      value: input.value,
      sections,
      authorization: input.authorization,
      proofBinding: input.proofBinding,
    });
    if (
      measureP2SerializedCharacters(candidate) <= P2_MAX_SERIALIZED_CHARACTERS
    ) {
      return candidate;
    }
  }
  throw visitError("RESULT_TOO_LARGE", input.authorization);
}

export async function getSiteVisitContext(input: {
  readonly authorization: AuthorizedGetSiteVisitContextRead;
  readonly repository: SiteVisitReadRepository;
  readonly signal?: AbortSignal;
}): Promise<GetSiteVisitContextResult> {
  const authorization = input.authorization;
  if (!isAuthorizedGetSiteVisitContextRead(authorization)) {
    throw new SiteVisitReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedSiteVisitReadRepository(input.repository)) {
    throw visitError("INTERNAL", authorization);
  }

  let result: SiteVisitContextRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedSiteVisitReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.get({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseContextRepositoryResult,
    });
  } catch (error) {
    throw visitError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "not_found") {
    throw visitError("NOT_FOUND", authorization);
  }
  if (result.state === "source_bound") {
    throw visitError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw visitError("STALE_CONTEXT", authorization);
  }
  try {
    return reduceContextToBudget({
      value: result.value,
      authorization,
      proofBinding: result.proofBinding,
    });
  } catch (error) {
    if (error instanceof SiteVisitReadError) throw error;
    throw visitError("INTERNAL", authorization);
  }
}
