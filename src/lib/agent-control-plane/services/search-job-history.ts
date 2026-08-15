import "server-only";

import {
  CONTRACT_VERSION,
  type AgentError,
  type SourceVersion,
} from "@/lib/agent-control-plane/contracts";
import {
  JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
  JobHistoryResultSchema,
  MAX_JOB_CATALOG_OUTPUT_CHARACTERS,
  type JobHistoryResult,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import {
  isAuthorizedJobHistoryRead,
  type AuthorizedJobHistoryRead,
} from "./job-history-authorization";
import {
  JobHistoryRepositoryError,
  isTrustedJobHistoryRepository,
  type JobHistoryRepository,
  type JobHistorySnapshot,
} from "./job-history-repository";

const CHARACTER_BUDGET_WARNING = Object.freeze({
  code: "RESULT_CHARACTER_BUDGET",
  message:
    "Additional job-history matches are available on the next page because this result reached the prompt-safe character limit.",
} as const);

function safeGeneratedAt(now?: () => Date): string | null {
  try {
    return (now?.() ?? new Date()).toISOString();
  } catch {
    return null;
  }
}

function safeMessage(code: JobHistoryReadError["code"]): string {
  if (code === "NOT_FOUND") return "Job history was not found.";
  if (code === "STALE_CONTEXT") return "Job history changed during pagination.";
  if (code === "TEMPORARILY_UNAVAILABLE") {
    return "Job history is temporarily unavailable.";
  }
  return "Job history could not be read.";
}

export class JobHistoryReadError extends Error {
  readonly code:
    "NOT_FOUND" | "STALE_CONTEXT" | "TEMPORARILY_UNAVAILABLE" | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;
  readonly currentSourceVersion: SourceVersion | null;

  constructor(input: {
    code: JobHistoryReadError["code"];
    requestId: string;
    retryable: boolean;
    currentSourceVersion?: SourceVersion | null;
    cause?: unknown;
  }) {
    super(safeMessage(input.code), { cause: input.cause });
    this.name = "JobHistoryReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
    this.currentSourceVersion = input.currentSourceVersion ?? null;
  }

  toAgentError(): AgentError {
    const base = {
      contract_version: CONTRACT_VERSION,
      request_id: this.requestId,
      message: this.message,
      retryable: this.retryable,
    } as const;
    if (this.code === "STALE_CONTEXT") {
      return {
        ...base,
        code: "STALE_CONTEXT",
        details: { current_source_versions: [this.currentSourceVersion!] },
      };
    }
    if (this.code === "NOT_FOUND") return { ...base, code: "NOT_FOUND" };
    if (this.code === "TEMPORARILY_UNAVAILABLE") {
      return { ...base, code: "TEMPORARILY_UNAVAILABLE" };
    }
    return { ...base, code: "INTERNAL" };
  }
}

function mapRepositoryError(
  error: unknown,
  authorization: AuthorizedJobHistoryRead
): never {
  if (error instanceof JobHistoryRepositoryError) {
    if (error.code === "JOB_HISTORY_NOT_FOUND") {
      throw new JobHistoryReadError({
        code: "NOT_FOUND",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (error.code === "JOB_HISTORY_STALE" && error.currentSourceVersion) {
      throw new JobHistoryReadError({
        code: "STALE_CONTEXT",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        currentSourceVersion: error.currentSourceVersion,
        cause: error,
      });
    }
    if (error.code === "JOB_HISTORY_READ_FAILED") {
      throw new JobHistoryReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        cause: error,
      });
    }
  }
  throw new JobHistoryReadError({
    code: "INTERNAL",
    requestId: authorization.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function buildResult(input: {
  authorization: AuthorizedJobHistoryRead;
  snapshot: JobHistorySnapshot;
  generatedAt: string;
  retainedCount: number;
  characterBounded: boolean;
}): JobHistoryResult {
  const retainedClaims = input.snapshot.event_claims.slice(
    0,
    input.retainedCount
  );
  const sourceOmitted =
    input.snapshot.event_claims.length - input.retainedCount;
  const hasMore = input.characterBounded || input.snapshot.page.has_more;
  const nextCursor = input.characterBounded
    ? input.retainedCount > 0
      ? input.snapshot.boundary_cursors[input.retainedCount - 1]!
      : null
    : input.snapshot.page.next_cursor;
  return {
    contract_version: CONTRACT_VERSION,
    request_id: input.authorization.actorContext.requestId,
    generated_at: input.generatedAt,
    company_id: input.snapshot.company_id,
    actor: {
      user_id: input.authorization.actorContext.actorUserId,
      permission_snapshot_revision:
        input.authorization.actorContext.permissionSnapshotRevision,
    },
    freshness: {
      read_at: input.snapshot.read_at,
      source_versions: [
        input.snapshot.source_fence,
        input.snapshot.history_fence,
        input.snapshot.collection_claim.source_version,
        ...retainedClaims.map((claim) => claim.source_version),
      ],
      stale_after: null,
    },
    data: {
      prompt_safety_directive: JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
      scope: input.snapshot.collection_claim.raw.scope,
      effective_window: input.snapshot.collection_claim.raw.effective_window,
      gaps: input.snapshot.collection_claim.raw.gaps,
      matches: retainedClaims.map((claim) => claim.raw),
      returned_match_count: retainedClaims.length,
      result_budget_omitted_count: sourceOmitted,
    },
    evidence: [
      ...input.snapshot.collection_claim.evidence,
      ...retainedClaims.flatMap((claim) => claim.evidence),
    ],
    page: { next_cursor: hasMore ? nextCursor : null, has_more: hasMore },
    warnings: input.characterBounded ? [CHARACTER_BUDGET_WARNING] : [],
  } as JobHistoryResult;
}

function reduceToBudget(input: {
  authorization: AuthorizedJobHistoryRead;
  snapshot: JobHistorySnapshot;
  generatedAt: string;
}): JobHistoryResult {
  const full = buildResult({
    ...input,
    retainedCount: input.snapshot.event_claims.length,
    characterBounded: false,
  });
  if (JSON.stringify(full).length <= MAX_JOB_CATALOG_OUTPUT_CHARACTERS) {
    return JobHistoryResultSchema.parse(full);
  }
  let lower = 0;
  let upper = input.snapshot.event_claims.length;
  let best: JobHistoryResult | null = null;
  let bestCount = -1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = buildResult({
      ...input,
      retainedCount: middle,
      characterBounded: true,
    });
    if (JSON.stringify(candidate).length <= MAX_JOB_CATALOG_OUTPUT_CHARACTERS) {
      best = candidate;
      bestCount = middle;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  if (
    best === null ||
    (input.snapshot.event_claims.length > 0 && bestCount === 0) ||
    (best.page?.has_more && best.page.next_cursor === null)
  ) {
    throw new JobHistoryReadError({
      code: "INTERNAL",
      requestId: input.authorization.actorContext.requestId,
      retryable: false,
    });
  }
  return JobHistoryResultSchema.parse(best);
}

export async function searchJobHistory(input: {
  readonly authorization: AuthorizedJobHistoryRead;
  readonly repository: JobHistoryRepository;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<JobHistoryResult> {
  const authorization = input.authorization;
  if (!isAuthorizedJobHistoryRead(authorization)) {
    throw new JobHistoryReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const repository = input.repository;
  if (!isTrustedJobHistoryRepository(repository)) {
    throw new JobHistoryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const generatedAt = safeGeneratedAt(input.now);
  if (generatedAt === null) {
    throw new JobHistoryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const signal = input.signal;
  let snapshot: JobHistorySnapshot;
  try {
    snapshot = await repository.read({
      authorization,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    mapRepositoryError(error, authorization);
  }
  try {
    return reduceToBudget({ authorization, snapshot: snapshot!, generatedAt });
  } catch (error) {
    if (error instanceof JobHistoryReadError) throw error;
    throw new JobHistoryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
      cause: error,
    });
  }
}
