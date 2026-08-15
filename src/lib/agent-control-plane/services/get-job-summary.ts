import "server-only";

import {
  CONTRACT_VERSION,
  type AgentError,
} from "@/lib/agent-control-plane/contracts";
import {
  JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
  JobSummaryResultSchema,
  JobSummarySectionResultSchema,
  MAX_JOB_CATALOG_OUTPUT_CHARACTERS,
  type JobSummaryData,
  type JobSummaryResult,
} from "@/lib/agent-control-plane/contracts/job-catalog";
import type { ReadinessRuleCode } from "@/lib/agent-control-plane/contracts/schedule";
import {
  isAuthorizedJobSummaryRead,
  type AuthorizedJobSummaryRead,
} from "./job-summary-authorization";
import {
  isTrustedJobSummaryRepository,
  JobSummaryRepositoryError,
  type JobSummaryRepository,
  type JobSummaryParticipantSourcesValue,
  type JobSummarySnapshot,
} from "./job-summary-repository";
import {
  deriveReadinessRuleFacts,
  evaluateReadinessRules,
  type ReadinessRuleRawSources,
} from "./readiness-rules";

const CHARACTER_BUDGET_WARNING = Object.freeze({
  code: "RESULT_CHARACTER_BUDGET",
  message:
    "Additional bounded summary items were omitted because this result reached the prompt-safe character limit.",
} as const);

type SummarySection = JobSummaryData["sections"][number];
type ReducibleSection = Readonly<{
  index: number;
  maximum: number;
}>;
type ScheduleValue = Readonly<{
  occurrences: readonly unknown[];
  occurrence_total: number;
  occurrences_omitted_count: number;
  count_completeness: "exact" | "lower_bound";
}>;
type ParticipantsValue = Readonly<{
  participants: readonly unknown[];
  participant_total: number;
  participants_omitted_count: number;
}>;
type ActivityValue = Readonly<{
  events: readonly unknown[];
  event_total: number;
  events_omitted_count: number;
  count_completeness: "exact" | "lower_bound";
}>;

export function deriveSummaryReadinessSection(
  rawSources: ReadinessRuleRawSources,
  ruleCodes: readonly ReadinessRuleCode[],
  evidenceIds: readonly string[]
): SummarySection {
  const evaluations = evaluateReadinessRules(
    deriveReadinessRuleFacts(rawSources),
    { includeClear: true, ruleCodes }
  ).map((evaluation) =>
    evaluation.status === "not_evaluated"
      ? {
          rule_code: evaluation.rule_code,
          rule_revision: evaluation.rule_revision,
          status: evaluation.status,
          severity: evaluation.severity,
          gap_code: evaluation.gap.code,
          source_kind: evaluation.gap.source_kind,
        }
      : {
          rule_code: evaluation.rule_code,
          rule_revision: evaluation.rule_revision,
          status: evaluation.status,
          severity: evaluation.severity,
        }
  );
  return JobSummarySectionResultSchema.parse({
    section: "readiness",
    status: "evaluated",
    value: { evaluations },
    evidence_ids: [...evidenceIds],
  }) as SummarySection;
}

function publicSummaryParticipant(
  row: JobSummaryParticipantSourcesValue["participants"][number]
) {
  switch (row.source_kind) {
    case "primary_client":
      return {
        participant_ref: row.participant_ref,
        side: "user" as const,
        relationship: "primary_client" as const,
        display_name: row.display_name,
        content_kind: "untrusted_business_data" as const,
      };
    case "sub_client":
      return {
        participant_ref: row.participant_ref,
        side: "user" as const,
        relationship: "sub_client" as const,
        display_name: row.display_name,
        content_kind: "untrusted_business_data" as const,
      };
    case "conversation_ambiguous":
    case "conversation_unresolved":
      return {
        participant_ref: row.participant_ref,
        side: null,
        relationship: "unknown" as const,
        display_name: null,
        content_kind: "untrusted_business_data" as const,
      };
    case "conversation_redacted":
      return {
        participant_ref: row.participant_ref,
        side: null,
        relationship: "redacted" as const,
        display_name: null,
        content_kind: "untrusted_business_data" as const,
      };
    case "ops_delivery_user":
      return {
        participant_ref: row.participant_ref,
        side: "assistant" as const,
        relationship: "ops_user" as const,
        display_name: row.display_name,
        content_kind: "untrusted_business_data" as const,
      };
    case "phase_c":
      return {
        participant_ref: row.participant_ref,
        side: "assistant" as const,
        relationship: "phase_c" as const,
        display_name: null,
        content_kind: "untrusted_business_data" as const,
      };
  }
}

export function deriveSummaryParticipantsSection(
  rawValue: JobSummaryParticipantSourcesValue,
  evidenceIds: readonly string[]
): SummarySection {
  return JobSummarySectionResultSchema.parse({
    section: "participants",
    status: "evaluated",
    value: {
      participants: rawValue.participants.map(publicSummaryParticipant),
      participant_total: rawValue.participant_total,
      participants_omitted_count: rawValue.participants_omitted_count,
      participant_count_completeness: rawValue.participant_count_completeness,
    },
    evidence_ids: [...evidenceIds],
  }) as SummarySection;
}

function safeGeneratedAt(now?: () => Date): string | null {
  try {
    return (now?.() ?? new Date()).toISOString();
  } catch {
    return null;
  }
}

function safeMessage(code: JobSummaryReadError["code"]): string {
  if (code === "NOT_FOUND") return "Job summary was not found.";
  if (code === "TEMPORARILY_UNAVAILABLE") {
    return "Job summary is temporarily unavailable.";
  }
  return "Job summary could not be read.";
}

export class JobSummaryReadError extends Error {
  readonly code: "NOT_FOUND" | "TEMPORARILY_UNAVAILABLE" | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: JobSummaryReadError["code"];
    requestId: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(safeMessage(input.code), { cause: input.cause });
    this.name = "JobSummaryReadError";
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
  }

  toAgentError(): AgentError {
    const base = {
      contract_version: CONTRACT_VERSION,
      request_id: this.requestId,
      message: this.message,
      retryable: this.retryable,
    } as const;
    if (this.code === "NOT_FOUND") return { ...base, code: "NOT_FOUND" };
    if (this.code === "TEMPORARILY_UNAVAILABLE") {
      return { ...base, code: "TEMPORARILY_UNAVAILABLE" };
    }
    return { ...base, code: "INTERNAL" };
  }
}

function mapRepositoryError(
  error: unknown,
  authorization: AuthorizedJobSummaryRead
): never {
  if (error instanceof JobSummaryRepositoryError) {
    if (error.code === "JOB_SUMMARY_NOT_FOUND") {
      throw new JobSummaryReadError({
        code: "NOT_FOUND",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (error.code === "JOB_SUMMARY_READ_FAILED") {
      throw new JobSummaryReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        cause: error,
      });
    }
  }
  throw new JobSummaryReadError({
    code: "INTERNAL",
    requestId: authorization.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function publicSections(
  snapshot: JobSummarySnapshot,
  authorization: AuthorizedJobSummaryRead
): SummarySection[] {
  return snapshot.section_claims.map((claim) => {
    if (claim.raw.state === "readiness_sources") {
      const ruleCodes = authorization.query.readiness_rule_codes;
      if (ruleCodes === undefined) {
        throw new TypeError("Readiness sources require selected rules");
      }
      return deriveSummaryReadinessSection(
        claim.raw.value,
        ruleCodes,
        claim.raw.evidence_ids
      );
    }
    if (claim.raw.state === "participant_sources") {
      return deriveSummaryParticipantsSection(
        claim.raw.value,
        claim.raw.evidence_ids
      );
    }
    return JobSummarySectionResultSchema.parse(
      claim.raw.state === "evaluated"
        ? {
            section: claim.raw.section,
            status: "evaluated",
            value: claim.raw.value,
            evidence_ids: claim.raw.evidence_ids,
          }
        : {
            section: claim.raw.section,
            status: "not_evaluated",
            gap_code: claim.raw.gaps[0]!.code,
            source_kind: claim.raw.gaps[0]!.source_kind,
            evidence_ids: claim.raw.evidence_ids,
          }
    ) as SummarySection;
  });
}

function reducibleSections(
  sections: readonly SummarySection[]
): ReducibleSection[] {
  const reducible: ReducibleSection[] = [];
  sections.forEach((section, index) => {
    if (section.status !== "evaluated") return;
    if (section.section === "schedule") {
      const value = section.value as ScheduleValue;
      reducible.push({ index, maximum: value.occurrences.length });
    } else if (section.section === "participants") {
      const value = section.value as ParticipantsValue;
      reducible.push({ index, maximum: value.participants.length });
    } else if (section.section === "activity") {
      const value = section.value as ActivityValue;
      reducible.push({ index, maximum: value.events.length });
    }
  });
  return reducible;
}

function retainSectionPrefix(
  section: SummarySection,
  retainedCount: number | undefined
): SummarySection {
  if (retainedCount === undefined || section.status !== "evaluated") {
    return section;
  }
  if (section.section === "schedule") {
    const value = section.value as ScheduleValue;
    const retained = Math.min(retainedCount, value.occurrences.length);
    return {
      ...section,
      value: {
        ...value,
        occurrences: value.occurrences.slice(0, retained),
        occurrences_omitted_count:
          value.occurrences_omitted_count +
          (value.occurrences.length - retained),
      },
    } as SummarySection;
  }
  if (section.section === "participants") {
    const value = section.value as ParticipantsValue;
    const retained = Math.min(retainedCount, value.participants.length);
    return {
      ...section,
      value: {
        ...value,
        participants: value.participants.slice(0, retained),
        participants_omitted_count:
          value.participants_omitted_count +
          (value.participants.length - retained),
      },
    } as SummarySection;
  }
  if (section.section === "activity") {
    const value = section.value as ActivityValue;
    const retained = Math.min(retainedCount, value.events.length);
    return {
      ...section,
      value: {
        ...value,
        events: value.events.slice(0, retained),
        events_omitted_count:
          value.events_omitted_count + (value.events.length - retained),
      },
    } as SummarySection;
  }
  return section;
}

function buildResult(input: {
  authorization: AuthorizedJobSummaryRead;
  snapshot: JobSummarySnapshot;
  generatedAt: string;
  sourceSections: readonly SummarySection[];
  retainedCounts: ReadonlyMap<number, number>;
  characterBounded: boolean;
}): JobSummaryResult {
  const sections = input.sourceSections.map((section, index) =>
    retainSectionPrefix(section, input.retainedCounts.get(index))
  );
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
        input.snapshot.summary_claim.source_version,
        ...input.snapshot.section_claims.map((claim) => claim.source_version),
      ],
      stale_after: null,
    },
    data: {
      requested_job: input.snapshot.requested_job,
      prompt_safety_directive: JOB_CATALOG_PROMPT_SAFETY_DIRECTIVE,
      requested_sections: input.authorization.query.sections,
      sections,
    },
    evidence: [
      ...input.snapshot.summary_claim.evidence,
      ...input.snapshot.section_claims.flatMap((claim) => claim.evidence),
    ],
    warnings: input.characterBounded ? [CHARACTER_BUDGET_WARNING] : [],
  } as JobSummaryResult;
}

function reduceToBudget(input: {
  authorization: AuthorizedJobSummaryRead;
  snapshot: JobSummarySnapshot;
  generatedAt: string;
}): JobSummaryResult {
  const sourceSections = publicSections(input.snapshot, input.authorization);
  const full = buildResult({
    ...input,
    sourceSections,
    retainedCounts: new Map(),
    characterBounded: false,
  });
  if (JSON.stringify(full).length <= MAX_JOB_CATALOG_OUTPUT_CHARACTERS) {
    return JobSummaryResultSchema.parse(full);
  }

  const reducible = reducibleSections(sourceSections);
  const retainedCounts = new Map<number, number>(
    reducible.map(({ index }) => [index, 0])
  );
  const minimal = buildResult({
    ...input,
    sourceSections,
    retainedCounts,
    characterBounded: true,
  });
  if (JSON.stringify(minimal).length > MAX_JOB_CATALOG_OUTPUT_CHARACTERS) {
    throw new JobSummaryReadError({
      code: "INTERNAL",
      requestId: input.authorization.actorContext.requestId,
      retryable: false,
    });
  }

  for (const target of reducible) {
    let lower = 0;
    let upper = target.maximum;
    let best = 0;
    while (lower <= upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      retainedCounts.set(target.index, middle);
      const candidate = buildResult({
        ...input,
        sourceSections,
        retainedCounts,
        characterBounded: true,
      });
      if (
        JSON.stringify(candidate).length <= MAX_JOB_CATALOG_OUTPUT_CHARACTERS
      ) {
        best = middle;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }
    retainedCounts.set(target.index, best);
  }

  return JobSummaryResultSchema.parse(
    buildResult({
      ...input,
      sourceSections,
      retainedCounts,
      characterBounded: true,
    })
  );
}

export async function getJobSummary(input: {
  readonly authorization: AuthorizedJobSummaryRead;
  readonly repository: JobSummaryRepository;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<JobSummaryResult> {
  const authorization = input.authorization;
  if (!isAuthorizedJobSummaryRead(authorization)) {
    throw new JobSummaryReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const repository = input.repository;
  if (!isTrustedJobSummaryRepository(repository)) {
    throw new JobSummaryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const generatedAt = safeGeneratedAt(input.now);
  if (generatedAt === null) {
    throw new JobSummaryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const signal = input.signal;
  let snapshot: JobSummarySnapshot;
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
    if (error instanceof JobSummaryReadError) throw error;
    throw new JobSummaryReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
      cause: error,
    });
  }
}
