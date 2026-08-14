import "server-only";

import {
  CONTRACT_VERSION,
  type AgentError,
} from "@/lib/agent-control-plane/contracts";
import {
  JOB_COMMUNICATION_PROMPT_SAFETY_DIRECTIVE,
  JobCommunicationContextResultSchema,
  type JobCommunicationContextResult,
  type JobParticipant,
} from "@/lib/agent-control-plane/contracts/communication";
import type {
  CommunicationSnapshotGapCode,
  JobCommunicationContextSnapshot,
  JobCommunicationContextSnapshotReader,
  JobParticipantClaim,
  RawJobCommunicationContext,
} from "./communication-participant-snapshot";
import {
  isAuthorizedJobCommunicationRead,
  type AuthorizedJobCommunicationRead,
} from "./job-communication-authorization";
import {
  isTrustedJobCommunicationContextRepository,
  JobCommunicationContextRepositoryError,
} from "./job-communication-context-repository";
import {
  deriveSitePhotoReadinessFact,
  evaluateSitePhotoReadinessFact,
} from "./readiness-rules";
import {
  COMMUNICATION_RESULT_CHARACTER_BUDGET_WARNING,
  deriveCommunicationParticipant,
  fixedCommunicationGaps,
} from "./resolve-job-participants";

export const MAX_JOB_COMMUNICATION_CONTEXT_RESULT_CHARACTERS = 60_000;

function safeGeneratedAt(now?: () => Date): string | null {
  try {
    return (now?.() ?? new Date()).toISOString();
  } catch {
    return null;
  }
}

function safeMessage(code: JobCommunicationContextReadError["code"]): string {
  if (code === "NOT_FOUND") return "Job communication context was not found.";
  if (code === "TEMPORARILY_UNAVAILABLE") {
    return "Job communication context is temporarily unavailable.";
  }
  return "Job communication context could not be read.";
}

export class JobCommunicationContextReadError extends Error {
  readonly code: "NOT_FOUND" | "TEMPORARILY_UNAVAILABLE" | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: JobCommunicationContextReadError["code"];
    requestId: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(safeMessage(input.code), { cause: input.cause });
    this.name = "JobCommunicationContextReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
  }

  toAgentError(): AgentError {
    return {
      contract_version: CONTRACT_VERSION,
      request_id: this.requestId,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

function mapRepositoryError(
  error: unknown,
  authorization: AuthorizedJobCommunicationRead
): never {
  if (error instanceof JobCommunicationContextRepositoryError) {
    if (error.code === "JOB_COMMUNICATION_CONTEXT_NOT_FOUND") {
      throw new JobCommunicationContextReadError({
        code: "NOT_FOUND",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (error.code === "JOB_COMMUNICATION_CONTEXT_READ_FAILED") {
      throw new JobCommunicationContextReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        cause: error,
      });
    }
  }
  throw new JobCommunicationContextReadError({
    code: "INTERNAL",
    requestId: authorization.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function sitePhotoFact(
  raw: Extract<RawJobCommunicationContext, { purpose: "photo_request" }>
) {
  const factSource = deriveSitePhotoReadinessFact(raw.site_photos);
  const evaluation = evaluateSitePhotoReadinessFact(factSource);
  if (evaluation.status === "not_evaluated") {
    return {
      status: evaluation.status,
      rule_code: evaluation.rule_code,
      rule_revision: evaluation.rule_revision,
      fact: evaluation.fact,
      gap_code: evaluation.gap.code,
      source_kind: evaluation.gap.source_kind,
    } as const;
  }
  if ("status" in factSource) {
    throw new Error("Evaluated photo rule lacked an evaluated fact source");
  }
  return {
    status: evaluation.status,
    rule_code: evaluation.rule_code,
    rule_revision: evaluation.rule_revision,
    fact: evaluation.fact,
    usable_photo_count: factSource.usable_photo_count,
  } as const;
}

function purposeContext(
  raw: RawJobCommunicationContext,
  retainedOccurrenceCount?: number
) {
  switch (raw.purpose) {
    case "general":
      return { purpose: "general" } as const;
    case "schedule_notice":
      return {
        purpose: raw.purpose,
        schedule: retainSchedulePrefix(raw.schedule, retainedOccurrenceCount),
      } as const;
    case "photo_request":
      return {
        purpose: raw.purpose,
        schedule: retainSchedulePrefix(raw.schedule, retainedOccurrenceCount),
        site_photos: sitePhotoFact(raw),
      } as const;
  }
}

function retainSchedulePrefix(
  schedule: Extract<
    RawJobCommunicationContext,
    { purpose: "schedule_notice" | "photo_request" }
  >["schedule"],
  retainedOccurrenceCount?: number
) {
  if (schedule.status === "not_evaluated") return schedule;
  const retained =
    retainedOccurrenceCount === undefined
      ? schedule.occurrences.length
      : Math.min(retainedOccurrenceCount, schedule.occurrences.length);
  return {
    ...schedule,
    occurrences: schedule.occurrences.slice(0, retained),
    occurrences_omitted_count:
      schedule.occurrences_omitted_count +
      (schedule.occurrences.length - retained),
  } as const;
}

function contextGapCodes(
  snapshot: JobCommunicationContextSnapshot
): CommunicationSnapshotGapCode[] {
  const codes = [...snapshot.gaps];
  const raw = snapshot.context_claim.raw;
  if (raw.purpose !== "general" && raw.schedule.status === "not_evaluated") {
    codes.push("SCHEDULE_SOURCE_UNAVAILABLE");
  }
  if (
    raw.purpose === "photo_request" &&
    "status" in raw.site_photos &&
    raw.site_photos.status === "not_evaluated"
  ) {
    codes.push("PHOTO_SOURCE_UNAVAILABLE");
  }
  return Array.from(new Set(codes));
}

function buildResult(input: {
  authorization: AuthorizedJobCommunicationRead;
  snapshot: JobCommunicationContextSnapshot;
  generatedAt: string;
  participants: readonly JobParticipant[];
  retainedClaims: readonly JobParticipantClaim[];
  characterBound: boolean;
  retainedOccurrenceCount?: number;
}): JobCommunicationContextResult {
  const { authorization, snapshot, retainedClaims } = input;
  const raw = snapshot.context_claim.raw;
  const omittedByCharacterBudget =
    snapshot.participant_claims.length - retainedClaims.length;
  return JobCommunicationContextResultSchema.parse({
    contract_version: CONTRACT_VERSION,
    request_id: authorization.actorContext.requestId,
    generated_at: input.generatedAt,
    company_id: snapshot.company_id,
    actor: {
      user_id: authorization.actorContext.actorUserId,
      permission_snapshot_revision:
        authorization.actorContext.permissionSnapshotRevision,
    },
    freshness: {
      read_at: snapshot.read_at,
      source_versions: [
        snapshot.source_fence,
        snapshot.contactability_fence,
        snapshot.context_claim.source_version,
        ...retainedClaims.map((claim) => claim.source_version),
      ],
      stale_after: null,
    },
    data: {
      requested_job: snapshot.requested_job,
      prompt_safety_directive: JOB_COMMUNICATION_PROMPT_SAFETY_DIRECTIVE,
      participants: input.participants,
      participant_total: snapshot.participant_total,
      participants_omitted_count:
        snapshot.participants_omitted_count + omittedByCharacterBudget,
      participant_count_completeness: snapshot.participant_count_completeness,
      address: raw.job_address,
      safe_job_description: raw.safe_job_description,
      purpose_context: purposeContext(raw, input.retainedOccurrenceCount),
      gaps: fixedCommunicationGaps(
        contextGapCodes(snapshot),
        retainedClaims.map((claim) => claim.raw),
        input.participants
      ),
    },
    evidence: [
      ...snapshot.context_claim.evidence,
      ...retainedClaims.flatMap((claim) => claim.evidence),
    ],
    warnings: input.characterBound
      ? [COMMUNICATION_RESULT_CHARACTER_BUDGET_WARNING]
      : [],
  });
}

function reduceToPromptBudget(input: {
  authorization: AuthorizedJobCommunicationRead;
  snapshot: JobCommunicationContextSnapshot;
  generatedAt: string;
}): JobCommunicationContextResult {
  const allParticipants = input.snapshot.participant_claims.map((claim) =>
    deriveCommunicationParticipant(claim, "communication")
  );
  const sourceOccurrenceCount =
    input.snapshot.context_claim.raw.purpose !== "general" &&
    input.snapshot.context_claim.raw.schedule.status === "evaluated"
      ? input.snapshot.context_claim.raw.schedule.occurrences.length
      : 0;
  const full = buildResult({
    ...input,
    retainedClaims: input.snapshot.participant_claims,
    participants: allParticipants,
    characterBound: false,
    retainedOccurrenceCount: sourceOccurrenceCount,
  });
  if (
    JSON.stringify(full).length <=
    MAX_JOB_COMMUNICATION_CONTEXT_RESULT_CHARACTERS
  ) {
    return full;
  }

  const candidate = (
    retainedOccurrenceCount: number,
    retainedParticipantCount: number
  ) =>
    buildResult({
      ...input,
      retainedClaims: input.snapshot.participant_claims.slice(
        0,
        retainedParticipantCount
      ),
      participants: allParticipants.slice(0, retainedParticipantCount),
      characterBound: true,
      retainedOccurrenceCount,
    });
  const largestFittingPrefix = (
    maximum: number,
    create: (retainedCount: number) => JobCommunicationContextResult
  ): { count: number; result: JobCommunicationContextResult } | null => {
    let lower = 0;
    let upper = maximum;
    let best: { count: number; result: JobCommunicationContextResult } | null =
      null;
    while (lower <= upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      const result = create(middle);
      if (
        JSON.stringify(result).length <=
        MAX_JOB_COMMUNICATION_CONTEXT_RESULT_CHARACTERS
      ) {
        best = { count: middle, result };
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }
    return best;
  };

  // Schedule facts are the purpose-bound core claim. Preserve their maximal
  // ordered prefix first, then use the remaining budget for participant claims.
  const occurrences = largestFittingPrefix(sourceOccurrenceCount, (count) =>
    candidate(count, 0)
  );
  if (occurrences === null) {
    throw new JobCommunicationContextReadError({
      code: "INTERNAL",
      requestId: input.authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const participants = largestFittingPrefix(
    input.snapshot.participant_claims.length,
    (count) => candidate(occurrences.count, count)
  );
  return participants?.result ?? occurrences.result;
}

export async function getJobCommunicationContext(input: {
  readonly authorization: AuthorizedJobCommunicationRead;
  readonly repository: JobCommunicationContextSnapshotReader;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<JobCommunicationContextResult> {
  if (!isAuthorizedJobCommunicationRead(input.authorization)) {
    throw new JobCommunicationContextReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const authorization = input.authorization;
  if (!isTrustedJobCommunicationContextRepository(input.repository)) {
    throw new JobCommunicationContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const generatedAt = safeGeneratedAt(input.now);
  if (generatedAt === null) {
    throw new JobCommunicationContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  let snapshot: JobCommunicationContextSnapshot;
  try {
    snapshot = await input.repository.read({
      authorization,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    mapRepositoryError(error, authorization);
  }
  try {
    return reduceToPromptBudget({
      authorization,
      snapshot: snapshot!,
      generatedAt,
    });
  } catch (error) {
    if (error instanceof JobCommunicationContextReadError) throw error;
    throw new JobCommunicationContextReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
      cause: error,
    });
  }
}
