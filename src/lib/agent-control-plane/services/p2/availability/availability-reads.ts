import "server-only";

import { P2_MAX_SERIALIZED_CHARACTERS } from "@/lib/agent-control-plane/contracts";
import {
  ListTeamAvailabilityResultSchema,
  assertNoCompanyOperationsForbiddenFields,
  type ListTeamAvailabilityResult,
} from "@/lib/agent-control-plane/contracts/company-operations";
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
  isAuthorizedTeamAvailabilityRead,
  type AuthorizedTeamAvailabilityRead,
} from "./availability-authorization";
import type {
  TeamAvailabilityCursorContext,
  TeamAvailabilityCursorService,
} from "./availability-cursor";
import {
  teamAvailabilityCollectionProofRef,
  teamAvailabilityProofContext,
} from "./availability-proof";
import {
  isTrustedTeamAvailabilityRepository,
  type TeamAvailabilityRepository,
  type TeamAvailabilityRepositoryResult,
} from "./availability-repository";

export class TeamAvailabilityReadError extends Error {
  readonly code:
    | "INTERNAL"
    | "INVALID_CURSOR"
    | "RESULT_TOO_LARGE"
    | "STALE_CONTEXT"
    | "TEMPORARILY_UNAVAILABLE";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: TeamAvailabilityReadError["code"];
    readonly requestId: string;
  }) {
    const messages = {
      INTERNAL: "The availability read could not be completed.",
      INVALID_CURSOR: "This availability page expired. Start again.",
      RESULT_TOO_LARGE: "The availability result is too large to return.",
      STALE_CONTEXT: "Team availability changed. Start the read again.",
      TEMPORARILY_UNAVAILABLE: "Team availability is temporarily unavailable.",
    } as const;
    super(messages[input.code]);
    this.name = "TeamAvailabilityReadError";
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
  code: TeamAvailabilityReadError["code"],
  authorization: AuthorizedTeamAvailabilityRead
) {
  return new TeamAvailabilityReadError({
    code,
    requestId: authorization.actorContext.requestId,
  });
}

function parseRepositoryResult(raw: unknown): TeamAvailabilityRepositoryResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("TEAM_AVAILABILITY_REPOSITORY_RESULT_INVALID");
  }
  const record = raw as Readonly<Record<string, unknown>>;
  if (
    record.state === "source_bound" ||
    record.state === "source_invalid" ||
    record.state === "stale"
  ) {
    if (Object.keys(record).length !== 1) {
      throw new TypeError("TEAM_AVAILABILITY_REPOSITORY_RESULT_INVALID");
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
    throw new TypeError("TEAM_AVAILABILITY_REPOSITORY_RESULT_INVALID");
  }
  return raw as TeamAvailabilityRepositoryResult;
}

function buildResult(input: {
  readonly authorization: AuthorizedTeamAvailabilityRead;
  readonly repositoryResult: Extract<
    TeamAvailabilityRepositoryResult,
    { readonly state: "found" }
  >;
  readonly cursor: TeamAvailabilityCursorContext | null;
  readonly cursors: TeamAvailabilityCursorService;
}): ListTeamAvailabilityResult {
  const page = input.repositoryResult.page;
  const minimumUnits = page.units.length === 0 ? 0 : 1;
  for (
    let maximumUnits = page.units.length;
    maximumUnits >= minimumUnits;
    maximumUnits -= 1
  ) {
    try {
      const retained = page.units.slice(0, maximumUnits);
      const proofContext = teamAvailabilityProofContext({
        authorization: input.authorization,
        cursor: input.cursor,
        readAt: page.readAt,
        timezone: page.timezone,
        sourceRevisions: page.sourceRevisions,
        memberSourceInspected: page.memberSourceInspected,
        scheduleSourceInspected: page.scheduleSourceInspected,
        sourceHasMore: page.sourceHasMore,
      });
      const budgeted = reduceP2AtomicResultToBudget({
        envelope: {
          view: page.view,
          window: {
            starts_on: page.startsOn,
            ends_on: page.endsOn,
            timezone: page.timezone,
          },
          next_cursor: null,
        },
        units: retained.map((unit) => ({
          item: unit.item,
          proof: unit.proof,
          evidence: unit.evidence,
        })),
        sourceHasMore: page.sourceHasMore || maximumUnits < page.units.length,
        makeCollectionProof: (returnedCount, hasMore) => ({
          proof_ref: teamAvailabilityCollectionProofRef({
            context: proofContext,
            returnedCount,
            hasMore,
            children: retained.slice(0, returnedCount).map((unit) => ({
              member_ref: unit.item.member_ref,
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
        page.view === "company" && hasMore && predecessor
          ? input.cursors.encode({
              authorization: input.authorization,
              sourceRevisions: page.sourceRevisions,
              readAt: page.readAt,
              predecessor,
            })
          : null;
      const parsed = ListTeamAvailabilityResultSchema.parse({
        view: page.view,
        window: {
          starts_on: page.startsOn,
          ends_on: page.endsOn,
          timezone: page.timezone,
        },
        items: budgeted.items,
        item_proofs: budgeted.item_proofs,
        evidence: budgeted.evidence,
        collection_proof: budgeted.collection_proof,
        next_cursor: nextCursor,
      });
      assertNoCompanyOperationsForbiddenFields(parsed);
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

export async function listTeamAvailability(input: {
  readonly authorization: AuthorizedTeamAvailabilityRead;
  readonly repository: TeamAvailabilityRepository;
  readonly cursors: TeamAvailabilityCursorService;
  readonly signal?: AbortSignal;
}): Promise<ListTeamAvailabilityResult> {
  const authorization = input.authorization;
  if (!isAuthorizedTeamAvailabilityRead(authorization)) {
    throw new TeamAvailabilityReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
    });
  }
  if (!isTrustedTeamAvailabilityRepository(input.repository)) {
    throw readError("INTERNAL", authorization);
  }

  let cursor: TeamAvailabilityCursorContext | null = null;
  if (authorization.query.view === "company" && authorization.query.cursor) {
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

  let result: TeamAvailabilityRepositoryResult;
  try {
    result = await readThroughP2RepositoryBoundary({
      repository: input.repository,
      isTrusted: isTrustedTeamAvailabilityRepository,
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
  if (result.state === "stale") {
    throw readError("STALE_CONTEXT", authorization);
  }
  if (result.state === "source_invalid") {
    throw readError("TEMPORARILY_UNAVAILABLE", authorization);
  }

  try {
    return buildResult({
      authorization,
      repositoryResult: result,
      cursor,
      cursors: input.cursors,
    });
  } catch (error) {
    if (error instanceof TeamAvailabilityReadError) throw error;
    throw readError("INTERNAL", authorization);
  }
}
