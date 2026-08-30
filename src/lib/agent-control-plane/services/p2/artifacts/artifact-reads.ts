import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  GetJobArtifactEvidenceSourceResultSchema,
  ListJobArtifactsResultSchema,
  assertNoArtifactForbiddenFields,
  type GetJobArtifactEvidenceSourceResult,
  type ListJobArtifactsResult,
} from "@/lib/agent-control-plane/contracts/job-artifacts";
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
  isAuthorizedGetJobArtifactEvidenceRead,
  isAuthorizedListJobArtifactsRead,
  type AuthorizedGetJobArtifactEvidenceRead,
  type AuthorizedListJobArtifactsRead,
} from "./artifact-authorization";
import type { ArtifactListCursorService } from "./artifact-cursor";
import type { ArtifactListCursorContext } from "./artifact-cursor";
import {
  artifactListCollectionProofRef,
  artifactListProofContext,
} from "./artifact-proof";
import {
  isTrustedArtifactReadRepository,
  type ArtifactExactRepositoryResult,
  type ArtifactListRepositoryResult,
  type ArtifactReadRepository,
} from "./artifact-repository";

export class ArtifactReadError extends Error {
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
    readonly code: ArtifactReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "Artifact data could not be read.",
      INVALID_CURSOR: "The artifact cursor is invalid or expired.",
      NOT_FOUND: "Artifact evidence was not found.",
      RESULT_TOO_LARGE: "The artifact result is too large to return safely.",
      STALE_CONTEXT: "Artifact data changed. Start the read again.",
      TEMPORARILY_UNAVAILABLE: "Artifact data is temporarily unavailable.",
    } as const;
    super(messages[input.code]);
    this.name = "ArtifactReadError";
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

function exactStateRecord(
  raw: unknown,
  terminalStates: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("ARTIFACT_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (terminalStates.includes(String(record.state))) {
    if (Object.keys(record).length !== 1) {
      throw new TypeError("ARTIFACT_REPOSITORY_RESULT_INVALID");
    }
  }
  return record;
}

function parseListRepositoryResult(raw: unknown): ArtifactListRepositoryResult {
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
    throw new TypeError("ARTIFACT_REPOSITORY_RESULT_INVALID");
  }
  return raw as ArtifactListRepositoryResult;
}

function parseExactRepositoryResult(
  raw: unknown
): ArtifactExactRepositoryResult {
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
    throw new TypeError("ARTIFACT_REPOSITORY_RESULT_INVALID");
  }
  return deepFreeze({
    state: "found" as const,
    value: GetJobArtifactEvidenceSourceResultSchema.parse(record.value),
  });
}

function artifactError(
  code: ArtifactReadError["code"],
  authorization:
    | AuthorizedGetJobArtifactEvidenceRead
    | AuthorizedListJobArtifactsRead
) {
  return new ArtifactReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function buildListResult(input: {
  readonly authorization: AuthorizedListJobArtifactsRead;
  readonly repositoryResult: Extract<
    ArtifactListRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: ArtifactListCursorContext | null;
  readonly cursors: ArtifactListCursorService;
}): ListJobArtifactsResult {
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
          proof_ref: artifactListCollectionProofRef({
            context: artifactListProofContext({
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
              artifact_ref: {
                source_kind: unit.item.source_kind,
                evidence_ref: unit.item.evidence_ref,
              },
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
      const parsed = ListJobArtifactsResultSchema.parse({
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertNoArtifactForbiddenFields(parsed);
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
  throw artifactError("RESULT_TOO_LARGE", input.authorization);
}

export async function listJobArtifacts(input: {
  readonly authorization: AuthorizedListJobArtifactsRead;
  readonly repository: ArtifactReadRepository;
  readonly cursors: ArtifactListCursorService;
  readonly signal?: AbortSignal;
}): Promise<ListJobArtifactsResult> {
  const authorization = input.authorization;
  if (!isAuthorizedListJobArtifactsRead(authorization)) {
    throw new ArtifactReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedArtifactReadRepository(input.repository)) {
    throw artifactError("INTERNAL", authorization);
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
        throw artifactError("INVALID_CURSOR", authorization);
      }
      throw artifactError("INTERNAL", authorization);
    }
  }

  let result: ArtifactListRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedArtifactReadRepository,
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
    throw artifactError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "source_bound") {
    throw artifactError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw artifactError("STALE_CONTEXT", authorization);
  }
  try {
    return buildListResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof ArtifactReadError) throw error;
    throw artifactError("INTERNAL", authorization);
  }
}

export async function getJobArtifactEvidence(input: {
  readonly authorization: AuthorizedGetJobArtifactEvidenceRead;
  readonly repository: ArtifactReadRepository;
  readonly signal?: AbortSignal;
}): Promise<GetJobArtifactEvidenceSourceResult> {
  const authorization = input.authorization;
  if (!isAuthorizedGetJobArtifactEvidenceRead(authorization)) {
    throw new ArtifactReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedArtifactReadRepository(input.repository)) {
    throw artifactError("INTERNAL", authorization);
  }

  let result: ArtifactExactRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedArtifactReadRepository,
      ...(input.signal ? { signal: input.signal } : {}),
      read: (repository, signal) =>
        repository.get({
          authorization,
          ...(signal ? { signal } : {}),
        }),
      parse: parseExactRepositoryResult,
    });
  } catch (error) {
    throw artifactError(
      error instanceof P2RepositoryBoundaryError
        ? "TEMPORARILY_UNAVAILABLE"
        : "INTERNAL",
      authorization
    );
  }
  if (result.state === "not_found") {
    throw artifactError("NOT_FOUND", authorization);
  }
  if (result.state === "source_bound") {
    throw artifactError("RESULT_TOO_LARGE", authorization);
  }
  if (result.state === "stale") {
    throw artifactError("STALE_CONTEXT", authorization);
  }
  try {
    const parsed = GetJobArtifactEvidenceSourceResultSchema.parse(result.value);
    assertNoArtifactForbiddenFields(parsed);
    if (measureP2SerializedCharacters(parsed) > P2_MAX_SERIALIZED_CHARACTERS) {
      throw artifactError("RESULT_TOO_LARGE", authorization);
    }
    return deepFreeze(parsed);
  } catch (error) {
    if (error instanceof ArtifactReadError) throw error;
    throw artifactError("INTERNAL", authorization);
  }
}
