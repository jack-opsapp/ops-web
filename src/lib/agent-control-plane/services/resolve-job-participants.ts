import "server-only";

import {
  CONTRACT_VERSION,
  type AgentError,
  type AgentWarning,
} from "@/lib/agent-control-plane/contracts";
import {
  JOB_COMMUNICATION_PROMPT_SAFETY_DIRECTIVE,
  JobParticipantsResultSchema,
  type JobParticipant,
  type JobParticipantPurpose,
  type JobParticipantsData,
  type JobParticipantsResult,
} from "@/lib/agent-control-plane/contracts/communication";
import type {
  CommunicationSnapshotGapCode,
  JobParticipantClaim,
  JobParticipantsSnapshot,
  JobParticipantsSnapshotReader,
  ParticipantEmailSource,
  RawJobParticipant,
} from "./communication-participant-snapshot";
import {
  isAuthorizedJobParticipantsRead,
  type AuthorizedJobParticipantsRead,
} from "./job-participants-authorization";
import {
  isTrustedJobParticipantsRepository,
  JobParticipantsRepositoryError,
} from "./job-participants-repository";

export const MAX_JOB_PARTICIPANTS_RESULT_CHARACTERS = 60_000;

const PARTICIPANT_RESOLUTION_REVISION =
  "job-participant-resolution:v1" as const;

export const COMMUNICATION_RESULT_CHARACTER_BUDGET_WARNING = {
  code: "RESULT_CHARACTER_BUDGET",
  message:
    "Additional bounded context was omitted because this result reached the prompt-safe character limit.",
} as const satisfies AgentWarning;

type CommunicationGap = JobParticipantsData["gaps"][number];

const COMMUNICATION_GAPS = {
  PARTICIPANT_QUERY_BOUND: {
    code: "PARTICIPANT_QUERY_BOUND",
    message: "Some authorized participants were omitted by the query bound.",
  },
  PARTICIPANT_EVIDENCE_QUERY_BOUND: {
    code: "PARTICIPANT_EVIDENCE_QUERY_BOUND",
    message: "Some participant evidence was omitted by the query bound.",
  },
  RELATED_CONTACT_UNCONFIRMED: {
    code: "RELATED_CONTACT_UNCONFIRMED",
    message: "A possible related contact was not confirmed.",
  },
  CONTACTABILITY_SOURCE_UNAVAILABLE: {
    code: "CONTACTABILITY_SOURCE_UNAVAILABLE",
    message: "Contactability could not be evaluated.",
  },
  CONTACTABILITY_SOURCE_QUERY_BOUND: {
    code: "CONTACTABILITY_SOURCE_QUERY_BOUND",
    message:
      "Contactability could not be fully evaluated within the query bound.",
  },
  CONTACTABILITY_SOURCE_DATA_INVALID: {
    code: "CONTACTABILITY_SOURCE_DATA_INVALID",
    message: "Contactability source data was invalid.",
  },
  REDACTED_SOURCE_DATA: {
    code: "REDACTED_SOURCE_DATA",
    message: "Some source data was withheld by the actor's permissions.",
  },
  NO_CONTACTABLE_RECIPIENT: {
    code: "NO_CONTACTABLE_RECIPIENT",
    message: "No eligible contactable recipient was proven.",
  },
  SCHEDULE_SOURCE_UNAVAILABLE: {
    code: "SCHEDULE_SOURCE_UNAVAILABLE",
    message: "Current schedule facts could not be evaluated.",
  },
  PHOTO_SOURCE_UNAVAILABLE: {
    code: "PHOTO_SOURCE_UNAVAILABLE",
    message: "Current site-photo facts could not be evaluated.",
  },
} as const satisfies Record<CommunicationSnapshotGapCode, CommunicationGap>;

type ParticipantChannel = JobParticipant["channels"][number];
type RecipientEligibility = JobParticipant["recipient_eligibility"];

function channelFromEmailSource(
  source: ParticipantEmailSource
): ParticipantChannel {
  switch (source.state) {
    case "available":
      return {
        channel: "email",
        state: "contactable",
        address: source.normalized_address,
        reason_code: "AVAILABLE",
      };
    case "blocked":
      return {
        channel: "email",
        state: "blocked",
        reason_code: source.code,
      };
    case "absent":
      return {
        channel: "email",
        state: "not_applicable",
        reason_code: source.code,
      };
    case "ambiguous":
      return {
        channel: "email",
        state: "ambiguous",
        reason_code: source.code,
      };
    case "not_evaluated":
    case "query_bound":
    case "data_invalid":
      return {
        channel: "email",
        state: "not_evaluated",
        reason_code: source.code,
      };
  }
}

function eligibilityForConfirmedCustomer(
  relationship: "primary_client" | "sub_client" | "related_contact",
  source: ParticipantEmailSource
): RecipientEligibility {
  switch (source.state) {
    case "available":
      return relationship === "primary_client"
        ? { state: "eligible" }
        : {
            state: "selection_required",
            reason_code: "PURPOSE_SELECTION_REQUIRED",
          };
    case "blocked":
      return {
        state: "ineligible",
        reason_code: "CONTACTABILITY_BLOCKED",
      };
    case "absent":
      return { state: "ineligible", reason_code: "NO_CHANNEL_ADDRESS" };
    case "ambiguous":
      return { state: "ineligible", reason_code: "IDENTITY_AMBIGUOUS" };
    case "not_evaluated":
    case "query_bound":
    case "data_invalid":
      return {
        state: "ineligible",
        reason_code: "CONTACTABILITY_NOT_EVALUATED",
      };
  }
}

function displayIdentity(
  displayName: string,
  roleLabel: string | null
): NonNullable<JobParticipant["display_identity"]> {
  return {
    display_name: displayName,
    role_label: roleLabel,
    content_kind: "untrusted_business_data",
  };
}

function projectionEvidence(
  claim: JobParticipantClaim
): Pick<JobParticipant, "evidence_ids" | "evidence_id_total"> {
  return {
    evidence_ids: [claim.evidence[0]!.evidence_id],
    evidence_id_total: 1,
  };
}

export function deriveCommunicationParticipant(
  claim: JobParticipantClaim,
  purpose: JobParticipantPurpose
): JobParticipant {
  const raw = claim.raw;
  const evidence = projectionEvidence(claim);
  switch (raw.source_kind) {
    case "primary_client":
      return {
        participant_ref: raw.participant_ref,
        side: "user",
        relationship: "primary_client",
        resolution: {
          state: "confirmed",
          basis: "job_client",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: displayIdentity(raw.display_name, null),
        recipient_eligibility: eligibilityForConfirmedCustomer(
          "primary_client",
          raw.email_source
        ),
        channels: [channelFromEmailSource(raw.email_source)],
        preferred_channel: null,
        ...evidence,
      };
    case "sub_client":
      return {
        participant_ref: raw.participant_ref,
        side: "user",
        relationship: "sub_client",
        resolution: {
          state: "confirmed",
          basis: "client_parent",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: displayIdentity(raw.display_name, raw.role_label),
        recipient_eligibility: eligibilityForConfirmedCustomer(
          "sub_client",
          raw.email_source
        ),
        channels: [channelFromEmailSource(raw.email_source)],
        preferred_channel: null,
        ...evidence,
      };
    case "related_contact_record":
      return {
        participant_ref: raw.participant_ref,
        side: "user",
        relationship: "related_contact",
        resolution: {
          state: "confirmed",
          basis: "explicit_related_contact",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: displayIdentity(raw.display_name, raw.role_label),
        recipient_eligibility: eligibilityForConfirmedCustomer(
          "related_contact",
          raw.email_source
        ),
        channels: [channelFromEmailSource(raw.email_source)],
        preferred_channel: null,
        ...evidence,
      };
    case "conversation_ambiguous":
      return {
        participant_ref: raw.participant_ref,
        side: null,
        relationship: "unknown",
        resolution: {
          state: "ambiguous",
          candidate_count_lower_bound: raw.candidate_count_lower_bound,
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: null,
        recipient_eligibility: {
          state: "ineligible",
          reason_code: "IDENTITY_AMBIGUOUS",
        },
        channels: [channelFromEmailSource(raw.email_source)],
        preferred_channel: null,
        ...evidence,
      };
    case "conversation_unresolved":
      return {
        participant_ref: raw.participant_ref,
        side: null,
        relationship: "unknown",
        resolution: {
          state: "unresolved",
          reason_code: raw.email_source.code,
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: null,
        recipient_eligibility: {
          state: "ineligible",
          reason_code: "IDENTITY_UNRESOLVED",
        },
        channels: [channelFromEmailSource(raw.email_source)],
        preferred_channel: null,
        ...evidence,
      };
    case "conversation_redacted":
      return {
        participant_ref: raw.participant_ref,
        side: null,
        relationship: "redacted",
        resolution: {
          state: "redacted",
          reason_code: "ACTOR_NOT_AUTHORIZED",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: null,
        recipient_eligibility: {
          state: "ineligible",
          reason_code: "ACTOR_NOT_AUTHORIZED",
        },
        channels: [],
        preferred_channel: null,
        ...evidence,
      };
    case "ops_delivery_user":
      return {
        participant_ref: raw.participant_ref,
        side: "assistant",
        relationship: "ops_user",
        resolution: {
          state: "confirmed",
          basis: "ops_delivery_actor",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: displayIdentity(raw.display_name, null),
        recipient_eligibility: { state: "not_applicable" },
        channels: [],
        preferred_channel: null,
        ...evidence,
      };
    case "task_assignment_user":
      if (purpose !== "schedule" && purpose !== "assignment") {
        throw new Error(
          "Assignment-only participant escaped purpose minimization"
        );
      }
      return {
        participant_ref: raw.participant_ref,
        side: "assistant",
        relationship: "ops_user",
        resolution: {
          state: "confirmed",
          basis: "task_assignment",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: displayIdentity(raw.display_name, null),
        recipient_eligibility: { state: "not_applicable" },
        channels: [],
        preferred_channel: null,
        ...evidence,
      };
    case "phase_c":
      return {
        participant_ref: raw.participant_ref,
        side: "assistant",
        relationship: "phase_c",
        resolution: {
          state: "confirmed",
          basis: "phase_c_delivery_origin",
          revision: PARTICIPANT_RESOLUTION_REVISION,
        },
        display_identity: null,
        recipient_eligibility: { state: "not_applicable" },
        channels: [],
        preferred_channel: null,
        ...evidence,
      };
  }
}

function participantGapCodes(
  rows: readonly RawJobParticipant[],
  participants: readonly JobParticipant[]
): CommunicationSnapshotGapCode[] {
  const codes: CommunicationSnapshotGapCode[] = [];
  for (const row of rows) {
    if (row.source_kind === "conversation_redacted") {
      codes.push("REDACTED_SOURCE_DATA");
    }
    if ("email_source" in row) {
      if (row.email_source.state === "not_evaluated") {
        codes.push("CONTACTABILITY_SOURCE_UNAVAILABLE");
      } else if (row.email_source.state === "query_bound") {
        codes.push("CONTACTABILITY_SOURCE_QUERY_BOUND");
      } else if (row.email_source.state === "data_invalid") {
        codes.push("CONTACTABILITY_SOURCE_DATA_INVALID");
      }
    }
  }
  if (
    !participants.some(
      (participant) => participant.recipient_eligibility.state === "eligible"
    )
  ) {
    codes.push("NO_CONTACTABLE_RECIPIENT");
  }
  return codes;
}

export function fixedCommunicationGaps(
  sourceCodes: readonly CommunicationSnapshotGapCode[],
  rows: readonly RawJobParticipant[],
  participants: readonly JobParticipant[]
): CommunicationGap[] {
  const codes = [...sourceCodes, ...participantGapCodes(rows, participants)];
  return Array.from(new Set(codes)).map((code) => COMMUNICATION_GAPS[code]);
}

function safeGeneratedAt(now?: () => Date): string | null {
  try {
    return (now?.() ?? new Date()).toISOString();
  } catch {
    return null;
  }
}

function safeMessage(code: JobParticipantsReadError["code"]): string {
  if (code === "NOT_FOUND") return "Job participants were not found.";
  if (code === "TEMPORARILY_UNAVAILABLE") {
    return "Job participant context is temporarily unavailable.";
  }
  return "Job participant context could not be read.";
}

export class JobParticipantsReadError extends Error {
  readonly code: "NOT_FOUND" | "TEMPORARILY_UNAVAILABLE" | "INTERNAL";
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: JobParticipantsReadError["code"];
    requestId: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(safeMessage(input.code), { cause: input.cause });
    this.name = "JobParticipantsReadError";
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
  authorization: AuthorizedJobParticipantsRead
): never {
  if (error instanceof JobParticipantsRepositoryError) {
    if (error.code === "JOB_PARTICIPANTS_NOT_FOUND") {
      throw new JobParticipantsReadError({
        code: "NOT_FOUND",
        requestId: authorization.actorContext.requestId,
        retryable: false,
        cause: error,
      });
    }
    if (error.code === "JOB_PARTICIPANTS_READ_FAILED") {
      throw new JobParticipantsReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: authorization.actorContext.requestId,
        retryable: true,
        cause: error,
      });
    }
  }
  throw new JobParticipantsReadError({
    code: "INTERNAL",
    requestId: authorization.actorContext.requestId,
    retryable: false,
    cause: error,
  });
}

function buildResult(input: {
  authorization: AuthorizedJobParticipantsRead;
  snapshot: JobParticipantsSnapshot;
  generatedAt: string;
  participants: readonly JobParticipant[];
  retainedClaims: readonly JobParticipantClaim[];
  characterBound: boolean;
}): JobParticipantsResult {
  const { authorization, snapshot, retainedClaims } = input;
  const omittedByCharacterBudget =
    snapshot.participant_claims.length - retainedClaims.length;
  const data = {
    requested_job: snapshot.requested_job,
    purpose: snapshot.purpose,
    prompt_safety_directive: JOB_COMMUNICATION_PROMPT_SAFETY_DIRECTIVE,
    participants: input.participants,
    participant_total: snapshot.participant_total,
    participants_omitted_count:
      snapshot.participants_omitted_count + omittedByCharacterBudget,
    participant_count_completeness: snapshot.participant_count_completeness,
    gaps: fixedCommunicationGaps(
      snapshot.gaps,
      retainedClaims.map((claim) => claim.raw),
      input.participants
    ),
  } as const;
  return JobParticipantsResultSchema.parse({
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
        snapshot.collection_claim.source_version,
        ...retainedClaims.map((claim) => claim.source_version),
      ],
      stale_after: null,
    },
    data,
    evidence: [
      ...snapshot.collection_claim.evidence,
      ...retainedClaims.flatMap((claim) => claim.evidence),
    ],
    warnings: input.characterBound
      ? [COMMUNICATION_RESULT_CHARACTER_BUDGET_WARNING]
      : [],
  });
}

function reduceToPromptBudget(input: {
  authorization: AuthorizedJobParticipantsRead;
  snapshot: JobParticipantsSnapshot;
  generatedAt: string;
}): JobParticipantsResult {
  const allParticipants = input.snapshot.participant_claims.map((claim) =>
    deriveCommunicationParticipant(claim, input.snapshot.purpose)
  );
  const full = buildResult({
    ...input,
    retainedClaims: input.snapshot.participant_claims,
    participants: allParticipants,
    characterBound: false,
  });
  if (JSON.stringify(full).length <= MAX_JOB_PARTICIPANTS_RESULT_CHARACTERS) {
    return full;
  }

  let best: JobParticipantsResult | null = null;
  for (
    let retainedCount = 0;
    retainedCount < input.snapshot.participant_claims.length;
    retainedCount += 1
  ) {
    const candidate = buildResult({
      ...input,
      retainedClaims: input.snapshot.participant_claims.slice(0, retainedCount),
      participants: allParticipants.slice(0, retainedCount),
      characterBound: true,
    });
    if (
      JSON.stringify(candidate).length <= MAX_JOB_PARTICIPANTS_RESULT_CHARACTERS
    ) {
      best = candidate;
    } else {
      break;
    }
  }
  if (best !== null) return best;
  throw new JobParticipantsReadError({
    code: "INTERNAL",
    requestId: input.authorization.actorContext.requestId,
    retryable: false,
  });
}

export async function resolveJobParticipants(input: {
  readonly authorization: AuthorizedJobParticipantsRead;
  readonly repository: JobParticipantsSnapshotReader;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<JobParticipantsResult> {
  if (!isAuthorizedJobParticipantsRead(input.authorization)) {
    throw new JobParticipantsReadError({
      code: "INTERNAL",
      requestId: "unknown-request",
      retryable: false,
    });
  }
  const authorization = input.authorization;
  if (!isTrustedJobParticipantsRepository(input.repository)) {
    throw new JobParticipantsReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  const generatedAt = safeGeneratedAt(input.now);
  if (generatedAt === null) {
    throw new JobParticipantsReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
    });
  }
  let snapshot: JobParticipantsSnapshot;
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
    if (error instanceof JobParticipantsReadError) throw error;
    throw new JobParticipantsReadError({
      code: "INTERNAL",
      requestId: authorization.actorContext.requestId,
      retryable: false,
      cause: error,
    });
  }
}
