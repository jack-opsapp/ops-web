import "server-only";

import type {
  AgentError,
  AgentResult,
  AgentWarning,
  EvidenceRef,
  SourceVersion,
} from "@/lib/agent-control-plane/contracts";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts";
import {
  deriveReadinessRuleFacts,
  evaluateReadinessRules,
  type ReadinessRuleEvaluation,
} from "./readiness-rules";
import {
  isAuthorizedJobReadinessRead,
  type AuthorizedJobReadinessRead,
} from "./job-readiness-authorization";
import {
  isTrustedJobReadinessRepository,
  JobReadinessRepositoryError,
  type JobReadinessRepository,
  type JobReadinessRepositoryCandidate,
  type JobReadinessRepositorySnapshot,
} from "./job-readiness-repository";
import { OPERATIONAL_READ_PROMPT_SAFETY_DIRECTIVE } from "./list-scheduled-jobs";

const MAX_RESULT_CHARACTERS = 60_000;
const MAX_LOGICAL_SCAN = 250;
const PHYSICAL_SCAN_LIMIT = 50;
const MAX_PHYSICAL_READS = 5;
const SCAN_BOUND_WARNING: AgentWarning = Object.freeze({
  code: "READINESS_CANDIDATE_SCAN_BOUND",
  message:
    "Additional scheduled jobs may need readiness evaluation. Continue with the next page.",
});
const CHARACTER_BUDGET_WARNING: AgentWarning = Object.freeze({
  code: "RESULT_CHARACTER_BUDGET",
  message:
    "Additional readiness results are available on the next page because this result reached the prompt-safe character limit.",
});

export type JobReadinessRuleResult = ReadinessRuleEvaluation &
  Readonly<{
    source_versions: readonly SourceVersion[];
    evidence_ids: readonly string[];
  }>;
export interface JobReadinessResultItem {
  readonly job_ref: Readonly<{ kind: "project"; id: string }>;
  readonly title: string;
  readonly evaluated_occurrence_refs: readonly Readonly<{
    kind: "project_task";
    id: string;
  }>[];
  readonly rules: readonly JobReadinessRuleResult[];
}
export interface JobReadinessData {
  readonly prompt_safety_directive: typeof OPERATIONAL_READ_PROMPT_SAFETY_DIRECTIVE;
  readonly jobs: readonly JobReadinessResultItem[];
  readonly returned_job_count: number;
  readonly evaluated_candidate_count: number;
}
export type JobReadinessResult = AgentResult<JobReadinessData>;

export class JobReadinessReadError extends Error {
  readonly code: "STALE_CONTEXT" | "TEMPORARILY_UNAVAILABLE" | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;
  readonly currentSourceVersion: SourceVersion | null;
  constructor(input: {
    code: JobReadinessReadError["code"];
    requestId: string;
    retryable: boolean;
    currentSourceVersion?: SourceVersion | null;
    cause?: unknown;
  }) {
    super(
      input.code === "STALE_CONTEXT"
        ? "Readiness sources changed during pagination."
        : input.code === "TEMPORARILY_UNAVAILABLE"
          ? "Readiness context is temporarily unavailable."
          : "Readiness context could not be read.",
      { cause: input.cause }
    );
    this.name = "JobReadinessReadError";
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
    if (this.code === "TEMPORARILY_UNAVAILABLE") {
      return { ...base, code: "TEMPORARILY_UNAVAILABLE" };
    }
    return { ...base, code: "INTERNAL" };
  }
}

function mapRepositoryError(
  error: unknown,
  proof: AuthorizedJobReadinessRead
): never {
  if (
    error instanceof JobReadinessRepositoryError &&
    error.code === "JOB_READINESS_STALE" &&
    error.currentSourceVersion
  ) {
    throw new JobReadinessReadError({
      code: "STALE_CONTEXT",
      requestId: proof.actorContext.requestId,
      retryable: true,
      currentSourceVersion: error.currentSourceVersion,
      cause: error,
    });
  }
  if (
    error instanceof JobReadinessRepositoryError &&
    error.code === "JOB_READINESS_READ_FAILED"
  ) {
    throw new JobReadinessReadError({
      code: "TEMPORARILY_UNAVAILABLE",
      requestId: proof.actorContext.requestId,
      retryable: true,
      cause: error,
    });
  }
  throw new JobReadinessReadError({
    code: "INTERNAL",
    requestId: proof.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function evaluateCandidate(
  candidate: JobReadinessRepositoryCandidate,
  proof: AuthorizedJobReadinessRead
): JobReadinessResultItem | null {
  const sourceByRule = new Map(
    candidate.rule_sources.map((source) => [source.rule_code, source])
  );
  const rules = evaluateReadinessRules(
    deriveReadinessRuleFacts(candidate.raw_sources),
    {
      includeClear: proof.query.include_clear,
      ruleCodes: proof.query.rule_codes,
    }
  ).map((evaluation) => {
    const source = sourceByRule.get(evaluation.rule_code)!;
    return {
      ...evaluation,
      source_versions: source.source_versions,
      evidence_ids: source.evidence_ids,
    };
  });
  if (rules.length === 0) return null;
  return {
    job_ref: candidate.job_ref,
    title: candidate.title,
    evaluated_occurrence_refs: candidate.evaluated_occurrence_refs,
    rules,
  };
}

function uniqueSources(
  fence: SourceVersion,
  retained: readonly JobReadinessRepositoryCandidate[]
): SourceVersion[] {
  return [
    fence,
    ...retained.map((item) => item.projection_proof.source_version),
  ];
}

function retainedEvidence(
  snapshots: readonly JobReadinessRepositorySnapshot[],
  retained: readonly JobReadinessRepositoryCandidate[]
): EvidenceRef[] {
  const ids = new Set(
    retained.map((item) => item.projection_proof.evidence_id)
  );
  return snapshots.flatMap((snapshot) =>
    snapshot.evidence.filter((item) => ids.has(item.evidence_id))
  );
}

export async function listJobReadinessIssues(input: {
  readonly authorization: AuthorizedJobReadinessRead;
  readonly repository: JobReadinessRepository;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<JobReadinessResult> {
  if (!isAuthorizedJobReadinessRead(input.authorization)) {
    throw new JobReadinessReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const proof = input.authorization;
  if (!isTrustedJobReadinessRepository(input.repository)) {
    throw new JobReadinessReadError({
      code: "INTERNAL",
      requestId: proof.actorContext.requestId,
      retryable: false,
    });
  }

  const generatedAt = (input.now?.() ?? new Date()).toISOString();
  const snapshots: JobReadinessRepositorySnapshot[] = [];
  const retainedCandidates: JobReadinessRepositoryCandidate[] = [];
  const retainedJobs: JobReadinessResultItem[] = [];
  let evaluatedCount = 0;
  let cursor: string | null | undefined = undefined;
  let continuationCursor: string | null = proof.query.cursor ?? null;
  let sourceFence: SourceVersion | null = null;
  let readAt: string | null = null;
  let sourceHasMore = false;
  let stoppedForCharacterBudget = false;
  const evaluatedJobIds = new Set<string>();
  let lastEvaluatedKey: readonly [string, string] | null = null;

  const buildResult = (
    warnings: readonly AgentWarning[],
    hasMore: boolean,
    nextCursor: string | null
  ): JobReadinessResult => {
    const sourceVersions = uniqueSources(sourceFence!, retainedCandidates);
    const evidence = retainedEvidence(snapshots, retainedCandidates);
    if (
      sourceVersions.length !== retainedCandidates.length + 1 ||
      evidence.length !== retainedCandidates.length ||
      new Set(
        sourceVersions.map(
          (source) =>
            `${source.source_domain}\0${source.source_type}\0${source.source_id}\0${source.version}`
        )
      ).size !== sourceVersions.length ||
      new Set(evidence.map((item) => item.evidence_id)).size !== evidence.length
    ) {
      throw new JobReadinessReadError({
        code: "INTERNAL",
        requestId: proof.actorContext.requestId,
        retryable: false,
      });
    }
    return {
      contract_version: CONTRACT_VERSION,
      request_id: proof.actorContext.requestId,
      generated_at: generatedAt,
      company_id: proof.actorContext.companyId,
      actor: {
        user_id: proof.actorContext.actorUserId,
        permission_snapshot_revision:
          proof.actorContext.permissionSnapshotRevision,
      },
      freshness: {
        read_at: readAt!,
        source_versions: sourceVersions,
        stale_after: null,
      },
      data: {
        prompt_safety_directive: OPERATIONAL_READ_PROMPT_SAFETY_DIRECTIVE,
        jobs: retainedJobs,
        returned_job_count: retainedJobs.length,
        evaluated_candidate_count: evaluatedCount,
      },
      evidence,
      page: { next_cursor: hasMore ? nextCursor : null, has_more: hasMore },
      warnings: [...warnings],
    };
  };

  for (let readIndex = 0; readIndex < MAX_PHYSICAL_READS; readIndex += 1) {
    let snapshot: JobReadinessRepositorySnapshot;
    try {
      snapshot = await input.repository.read({
        authorization: proof,
        cursor,
        scanLimit: PHYSICAL_SCAN_LIMIT,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      mapRepositoryError(error, proof);
    }
    snapshots.push(snapshot!);
    if (sourceFence === null) {
      sourceFence = snapshot!.source_fence;
      readAt = snapshot!.read_at;
    } else if (
      snapshot!.read_at !== readAt ||
      snapshot!.source_fence.source_domain !== sourceFence.source_domain ||
      snapshot!.source_fence.source_type !== sourceFence.source_type ||
      snapshot!.source_fence.source_id !== sourceFence.source_id ||
      snapshot!.source_fence.version !== sourceFence.version
    ) {
      throw new JobReadinessReadError({
        code: "INTERNAL",
        requestId: proof.actorContext.requestId,
        retryable: false,
      });
    }
    for (const [candidateIndex, candidate] of snapshot!.candidates.entries()) {
      if (evaluatedCount >= MAX_LOGICAL_SCAN) break;
      const candidateKey = [
        candidate.first_scheduled_start_utc,
        candidate.job_ref.id,
      ] as const;
      if (
        evaluatedJobIds.has(candidate.job_ref.id) ||
        (lastEvaluatedKey !== null &&
          (candidateKey[0] < lastEvaluatedKey[0] ||
            (candidateKey[0] === lastEvaluatedKey[0] &&
              candidateKey[1] <= lastEvaluatedKey[1])))
      ) {
        throw new JobReadinessReadError({
          code: "INTERNAL",
          requestId: proof.actorContext.requestId,
          retryable: false,
        });
      }
      evaluatedCount += 1;
      const evaluated = evaluateCandidate(candidate, proof);
      if (evaluated !== null) {
        retainedCandidates.push(candidate);
        retainedJobs.push(evaluated);
      }
      const budgetCandidate = buildResult(
        [CHARACTER_BUDGET_WARNING],
        true,
        candidate.boundary_cursor
      );
      if (JSON.stringify(budgetCandidate).length > MAX_RESULT_CHARACTERS) {
        if (evaluated !== null) {
          retainedCandidates.pop();
          retainedJobs.pop();
        }
        evaluatedCount -= 1;
        stoppedForCharacterBudget = true;
        break;
      }
      evaluatedJobIds.add(candidate.job_ref.id);
      lastEvaluatedKey = candidateKey;
      continuationCursor = candidate.boundary_cursor;
      if (retainedJobs.length >= proof.query.limit) {
        sourceHasMore =
          candidateIndex < snapshot!.candidates.length - 1 ||
          snapshot!.page.has_more;
        break;
      }
    }
    if (stoppedForCharacterBudget || retainedJobs.length >= proof.query.limit) {
      if (stoppedForCharacterBudget) sourceHasMore = true;
      break;
    }
    continuationCursor = snapshot!.page.next_cursor;
    sourceHasMore = snapshot!.page.has_more;
    if (!sourceHasMore) break;
    cursor = snapshot!.page.next_cursor;
  }

  if (sourceFence === null || readAt === null) {
    throw new JobReadinessReadError({
      code: "INTERNAL",
      requestId: proof.actorContext.requestId,
      retryable: false,
    });
  }
  const scanBounded = evaluatedCount >= MAX_LOGICAL_SCAN && sourceHasMore;
  const hasMore = sourceHasMore || stoppedForCharacterBudget;
  const warnings = [
    ...(scanBounded ? [SCAN_BOUND_WARNING] : []),
    ...(stoppedForCharacterBudget ? [CHARACTER_BUDGET_WARNING] : []),
  ];
  const result = buildResult(warnings, hasMore, continuationCursor);
  if (
    JSON.stringify(result).length > MAX_RESULT_CHARACTERS ||
    (hasMore && continuationCursor === null) ||
    (stoppedForCharacterBudget && retainedJobs.length === 0)
  ) {
    throw new JobReadinessReadError({
      code: "INTERNAL",
      requestId: proof.actorContext.requestId,
      retryable: false,
    });
  }
  return result;
}
