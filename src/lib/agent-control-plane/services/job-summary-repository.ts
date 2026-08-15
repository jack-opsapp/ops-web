import "server-only";

import { z } from "zod-v4";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  EvidenceRefSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import { JobSummarySectionResultSchema } from "@/lib/agent-control-plane/contracts/job-catalog";
import { ParticipantCountCompletenessSchema } from "@/lib/agent-control-plane/contracts/communication";
import {
  isAuthorizedJobSummaryRead,
  type AuthorizedJobSummaryRead,
} from "./job-summary-authorization";
import {
  canonicalOperationalProjection,
  hashOperationalProjection,
  type CanonicalProjection,
} from "./operational-read-projection";
import { ReadinessRuleRawSourcesSchema } from "./readiness-rules";

const RPC_NAME = "read_agent_job_summary_as_system" as const;
const UUID_SCHEMA = z.string().uuid();
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const UTC_SCHEMA = z.string().datetime({ offset: false });
const JOB_REF_SCHEMA = z
  .object({ kind: z.enum(["opportunity", "project"]), id: UUID_SCHEMA })
  .strict();
const SOURCE_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "operational_read_revision" &&
    source.source_id === "private.agent_operational_read_revisions" &&
    /^revision:\d+$/.test(source.version),
  "Job-summary source fence is invalid"
);
const HISTORY_FENCE_SCHEMA = SourceVersionSchema.refine(
  (source) =>
    source.source_domain === "operations" &&
    source.source_type === "job_history_read_revision" &&
    source.source_id === "private.agent_job_history_revisions" &&
    /^revision:\d+$/.test(source.version),
  "Job-summary history fence is invalid"
);
const SUMMARY_SECTION_SCHEMA = z.enum([
  "identity",
  "schedule",
  "readiness",
  "participants",
  "financials",
  "activity",
  "conversation",
]);
const GAP_CODE_SCHEMA = z.enum([
  "SOURCE_UNAVAILABLE",
  "SOURCE_QUERY_BOUND",
  "SOURCE_DATA_INVALID",
]);
const SOURCE_KIND_SCHEMA = z.enum([
  "job_identity",
  "task_schedule",
  "job_readiness",
  "job_participants",
  "job_financials",
  "job_activity",
  "job_conversation",
]);
const SECTION_EVIDENCE_IDS_SCHEMA = z
  .array(z.string().min(1).max(512))
  .min(1)
  .max(20);
const SECTION_GAPS_SCHEMA = z.array(
  z.object({ code: GAP_CODE_SCHEMA, source_kind: SOURCE_KIND_SCHEMA }).strict()
);
const PUBLIC_EVALUATED_SECTION_SCHEMA = z
  .object({
    section: z.enum([
      "identity",
      "schedule",
      "financials",
      "activity",
      "conversation",
    ]),
    state: z.literal("evaluated"),
    value: z.unknown(),
    gaps: SECTION_GAPS_SCHEMA.length(0),
    evidence_ids: SECTION_EVIDENCE_IDS_SCHEMA,
  })
  .strict();
const GAP_SECTION_SCHEMA = z
  .object({
    section: SUMMARY_SECTION_SCHEMA,
    state: z.literal("gap"),
    value: z.null(),
    gaps: SECTION_GAPS_SCHEMA.length(1),
    evidence_ids: SECTION_EVIDENCE_IDS_SCHEMA,
  })
  .strict();

const PARTICIPANT_RESOLUTION_REVISION_SCHEMA = z.literal(
  "job-participant-resolution:v1"
);
const PARTICIPANT_CONTENT_KIND_SCHEMA = z.literal("untrusted_business_data");
const PARTICIPANT_DISPLAY_NAME_SCHEMA = z.string().trim().min(1).max(256);
const UNKNOWN_PARTICIPANT_ID_SCHEMA = z
  .string()
  .regex(/^unknown:sha256:[0-9a-f]{64}$/);
const REDACTED_PARTICIPANT_ID_SCHEMA = z
  .string()
  .regex(/^redacted:sha256:[0-9a-f]{64}$/);
const SUMMARY_PARTICIPANT_SOURCE_SCHEMA = z.discriminatedUnion("source_kind", [
  z
    .object({
      source_kind: z.literal("primary_client"),
      participant_ref: z
        .object({ kind: z.literal("client"), id: UUID_SCHEMA })
        .strict(),
      display_name: PARTICIPANT_DISPLAY_NAME_SCHEMA,
      conversation_side: z.literal("user"),
      resolution_status: z.literal("confirmed"),
      resolution_basis: z.literal("job_client"),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count: z.null(),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
  z
    .object({
      source_kind: z.literal("sub_client"),
      participant_ref: z
        .object({ kind: z.literal("sub_client"), id: UUID_SCHEMA })
        .strict(),
      display_name: PARTICIPANT_DISPLAY_NAME_SCHEMA,
      conversation_side: z.literal("user"),
      resolution_status: z.literal("confirmed"),
      resolution_basis: z.literal("client_parent"),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count: z.null(),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
  z
    .object({
      source_kind: z.literal("conversation_ambiguous"),
      participant_ref: z
        .object({
          kind: z.literal("unknown"),
          id: UNKNOWN_PARTICIPANT_ID_SCHEMA,
        })
        .strict(),
      display_name: z.null(),
      conversation_side: z.null(),
      resolution_status: z.literal("ambiguous"),
      resolution_basis: z.null(),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count_lower_bound: z.number().int().safe().min(2).max(50),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
  z
    .object({
      source_kind: z.literal("conversation_unresolved"),
      participant_ref: z
        .object({
          kind: z.literal("unknown"),
          id: UNKNOWN_PARTICIPANT_ID_SCHEMA,
        })
        .strict(),
      display_name: z.null(),
      conversation_side: z.null(),
      resolution_status: z.literal("unresolved"),
      resolution_basis: z.null(),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count: z.null(),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
  z
    .object({
      source_kind: z.literal("conversation_redacted"),
      participant_ref: z
        .object({
          kind: z.literal("redacted"),
          id: REDACTED_PARTICIPANT_ID_SCHEMA,
        })
        .strict(),
      display_name: z.null(),
      conversation_side: z.null(),
      resolution_status: z.literal("redacted"),
      resolution_basis: z.null(),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count: z.null(),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
  z
    .object({
      source_kind: z.literal("ops_delivery_user"),
      participant_ref: z
        .object({ kind: z.literal("ops_user"), id: UUID_SCHEMA })
        .strict(),
      display_name: PARTICIPANT_DISPLAY_NAME_SCHEMA,
      conversation_side: z.literal("assistant"),
      resolution_status: z.literal("confirmed"),
      resolution_basis: z.literal("ops_delivery_actor"),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count: z.null(),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
  z
    .object({
      source_kind: z.literal("phase_c"),
      participant_ref: z
        .object({ kind: z.literal("phase_c"), id: z.literal("phase_c") })
        .strict(),
      display_name: z.null(),
      conversation_side: z.literal("assistant"),
      resolution_status: z.literal("confirmed"),
      resolution_basis: z.literal("phase_c_delivery_origin"),
      resolution_revision: PARTICIPANT_RESOLUTION_REVISION_SCHEMA,
      candidate_count: z.null(),
      content_kind: PARTICIPANT_CONTENT_KIND_SCHEMA,
    })
    .strict(),
]);

function participantSourceRank(
  sourceKind: z.infer<typeof SUMMARY_PARTICIPANT_SOURCE_SCHEMA>["source_kind"]
): number {
  if (sourceKind === "primary_client") return 1;
  if (sourceKind === "sub_client") return 2;
  if (sourceKind.startsWith("conversation_")) return 4;
  if (sourceKind === "ops_delivery_user") return 5;
  return 7;
}

const SUMMARY_PARTICIPANT_SOURCES_VALUE_SCHEMA = z
  .object({
    participants: z.array(SUMMARY_PARTICIPANT_SOURCE_SCHEMA).max(50),
    participant_total: z.number().int().safe().nonnegative(),
    participants_omitted_count: z.number().int().safe().nonnegative(),
    participant_count_completeness: ParticipantCountCompletenessSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const participantKeys = value.participants.map(
      ({ participant_ref: ref }) => `${ref.kind}:${ref.id}`
    );
    const sourcePartitionIsValid =
      value.participant_count_completeness === "exact"
        ? value.participant_total === value.participants.length &&
          value.participants_omitted_count === 0
        : value.participants.length === 50 &&
          value.participant_total === 51 &&
          value.participants_omitted_count === 1;
    let ordered = true;
    for (let index = 1; index < value.participants.length; index += 1) {
      const previous = value.participants[index - 1]!;
      const current = value.participants[index]!;
      const previousRank = participantSourceRank(previous.source_kind);
      const currentRank = participantSourceRank(current.source_kind);
      if (
        previousRank > currentRank ||
        (previousRank === currentRank &&
          previous.participant_ref.id >= current.participant_ref.id)
      ) {
        ordered = false;
        break;
      }
    }
    if (
      !sourcePartitionIsValid ||
      new Set(participantKeys).size !== participantKeys.length ||
      !ordered
    ) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "Summary participant sources are invalid",
      });
    }
  });
const READINESS_SOURCES_SECTION_SCHEMA = z
  .object({
    section: z.literal("readiness"),
    state: z.literal("readiness_sources"),
    value: ReadinessRuleRawSourcesSchema,
    gaps: SECTION_GAPS_SCHEMA.length(0),
    evidence_ids: SECTION_EVIDENCE_IDS_SCHEMA,
  })
  .strict();
const PARTICIPANT_SOURCES_SECTION_SCHEMA = z
  .object({
    section: z.literal("participants"),
    state: z.literal("participant_sources"),
    value: SUMMARY_PARTICIPANT_SOURCES_VALUE_SCHEMA,
    gaps: SECTION_GAPS_SCHEMA.length(0),
    evidence_ids: SECTION_EVIDENCE_IDS_SCHEMA,
  })
  .strict();
const SECTION_RAW_SCHEMA = z
  .discriminatedUnion("state", [
    PUBLIC_EVALUATED_SECTION_SCHEMA,
    GAP_SECTION_SCHEMA,
    READINESS_SOURCES_SECTION_SCHEMA,
    PARTICIPANT_SOURCES_SECTION_SCHEMA,
  ])
  .superRefine((raw, context) => {
    const publicSection =
      raw.state === "evaluated"
        ? {
            section: raw.section,
            status: "evaluated" as const,
            value: raw.value,
            evidence_ids: raw.evidence_ids,
          }
        : raw.state === "gap"
          ? {
              section: raw.section,
              status: "not_evaluated" as const,
              gap_code: raw.gaps[0]?.code,
              source_kind: raw.gaps[0]?.source_kind,
              evidence_ids: raw.evidence_ids,
            }
          : null;
    if (
      new Set(raw.evidence_ids).size !== raw.evidence_ids.length ||
      (publicSection !== null &&
        !JobSummarySectionResultSchema.safeParse(publicSection).success)
    ) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "Summary section raw claim is invalid",
      });
    }
  });
const GapCodesSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(20)
  .refine((values) => new Set(values).size === values.length);
const SummaryRawSchema = z
  .object({
    requested_job: JOB_REF_SCHEMA,
    requested_sections: z.array(SUMMARY_SECTION_SCHEMA).min(1).max(7),
    section_count: z.number().int().min(1).max(7),
    gaps: GapCodesSchema,
  })
  .strict();
const PromptReductionSchema = z
  .object({
    max_output_characters: z.literal(60_000),
    atomic_claim_kind: z.literal("job_summary_section"),
    retention: z.literal("all_or_error"),
    claim_path: z.literal("section_claims"),
    envelope_claim_path: z.literal("summary_claim"),
  })
  .strict();
const ProjectionProofSchema = z
  .object({
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: z.string().min(1).max(512),
    projection: z.record(z.string(), z.unknown()),
  })
  .strict();
const SectionClaimSchema = z
  .object({
    raw: SECTION_RAW_SCHEMA,
    proof: ProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).length(1),
  })
  .strict();
const SummaryClaimSchema = z
  .object({
    raw: SummaryRawSchema,
    proof: ProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).length(1),
  })
  .strict();
const RawSnapshotSchema = z
  .object({
    company_id: UUID_SCHEMA,
    permission_snapshot_revision: SHA256_SCHEMA,
    read_at: UTC_SCHEMA,
    source_fence: SOURCE_FENCE_SCHEMA,
    history_fence: HISTORY_FENCE_SCHEMA,
    requested_job: JOB_REF_SCHEMA,
    section_claims: z.array(SectionClaimSchema).min(1).max(7),
    gaps: GapCodesSchema,
    summary_claim: SummaryClaimSchema,
    prompt_reduction: PromptReductionSchema,
  })
  .strict();

export type JobSummarySnapshot = Readonly<z.infer<typeof RawSnapshotSchema>>;
export type JobSummaryReadinessSourcesValue = z.infer<
  typeof ReadinessRuleRawSourcesSchema
>;
export type JobSummaryParticipantSourcesValue = z.infer<
  typeof SUMMARY_PARTICIPANT_SOURCES_VALUE_SCHEMA
>;
type SourceVersion = z.infer<typeof SourceVersionSchema>;
type RawJobSummarySnapshot = z.infer<typeof RawSnapshotSchema>;
type AtomicClaim =
  z.infer<typeof SectionClaimSchema> | z.infer<typeof SummaryClaimSchema>;

export class JobSummaryRepositoryError extends Error {
  readonly code:
    "JOB_SUMMARY_READ_FAILED" | "JOB_SUMMARY_NOT_FOUND" | "JOB_SUMMARY_INVALID";

  constructor(code: JobSummaryRepositoryError["code"], options?: ErrorOptions) {
    super(code, options);
    this.name = "JobSummaryRepositoryError";
    this.code = code;
  }
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}
export interface JobSummaryRpcRequest extends PromiseLike<RpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<RpcResult>;
}
export interface JobSummaryRpcClient {
  rpc(
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ): JobSummaryRpcRequest;
}

declare const TRUSTED_JOB_SUMMARY_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();
export interface JobSummaryRepository {
  readonly [TRUSTED_JOB_SUMMARY_REPOSITORY]: true;
  read(input: {
    readonly authorization: AuthorizedJobSummaryRead;
    readonly signal?: AbortSignal;
  }): Promise<JobSummarySnapshot>;
}

function invalid(cause?: unknown): never {
  throw new JobSummaryRepositoryError("JOB_SUMMARY_INVALID", { cause });
}

function sameSource(left: SourceVersion, right: SourceVersion): boolean {
  return (
    left.source_domain === right.source_domain &&
    left.source_type === right.source_type &&
    left.source_id === right.source_id &&
    left.version === right.version
  );
}

function sourceIdentity(source: SourceVersion): string {
  return [
    source.source_domain,
    source.source_type,
    source.source_id,
    source.version,
  ].join("\u0000");
}

function revision(source: SourceVersion): number {
  const value = Number(source.version.slice(9));
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function canonicalInput(proof: AuthorizedJobSummaryRead) {
  return proof.query;
}

function assertEvidence(input: {
  readonly evidence: z.infer<typeof EvidenceRefSchema>;
  readonly source: SourceVersion;
  readonly evidenceId: string;
  readonly readAt: string;
}): void {
  if (
    input.evidence.evidence_id !== input.evidenceId ||
    input.evidence.locator !==
      `ops://evidence/${encodeURIComponent(input.evidenceId)}` ||
    !sameSource(input.evidence, input.source) ||
    input.evidence.occurred_at !== input.readAt ||
    input.evidence.relationship !== "supports" ||
    input.evidence.trust !== "authoritative_ops" ||
    input.evidence.excerpt !== undefined
  ) {
    invalid();
  }
}

function assertAtomicClaim(input: {
  readonly claim: AtomicClaim;
  readonly proof: AuthorizedJobSummaryRead;
  readonly snapshot: RawJobSummarySnapshot;
  readonly sourceType:
    "job_summary_section_projection" | "job_summary_projection";
  readonly sourceId: string;
  readonly evidenceId: string;
  readonly versionPrefix:
    "job-summary-section-projection:v1" | "job-summary-projection:v1";
  readonly payloadKey: "section" | "summary";
  readonly expectedRaw: CanonicalProjection;
  readonly retainedProofSources: readonly SourceVersion[];
}): void {
  const expectedProjection = {
    actor_user_id: input.proof.actorContext.actorUserId,
    company_id: input.proof.actorContext.companyId,
    capability_id: input.proof.capabilityId,
    capability_revision: input.proof.capabilityRevision,
    capability_manifest_revision: input.proof.capabilityManifestRevision,
    permission_snapshot_revision:
      input.proof.actorContext.permissionSnapshotRevision,
    canonical_input: canonicalInput(input.proof),
    read_at: input.snapshot.read_at,
    source_revision: revision(input.snapshot.source_fence),
    history_revision: revision(input.snapshot.history_fence),
    retained_proof_sources: input.retainedProofSources,
    [input.payloadKey]: input.expectedRaw,
  } as const;
  const claim = input.claim;
  try {
    if (
      canonicalOperationalProjection(claim.raw as CanonicalProjection) !==
        canonicalOperationalProjection(input.expectedRaw) ||
      canonicalOperationalProjection(
        claim.proof.projection as CanonicalProjection
      ) !== canonicalOperationalProjection(expectedProjection) ||
      hashOperationalProjection(
        claim.proof.projection as CanonicalProjection
      ) !== claim.proof.source_content_hash ||
      claim.proof.source_version.source_domain !== "operations" ||
      claim.proof.source_version.source_type !== input.sourceType ||
      claim.proof.source_version.source_id !== input.sourceId ||
      claim.proof.evidence_id !== input.evidenceId ||
      claim.proof.source_version.version !==
        `${input.versionPrefix}:${claim.proof.source_content_hash}` ||
      !sameSource(claim.source_version, claim.proof.source_version) ||
      claim.evidence.length !== 1
    ) {
      invalid();
    }
  } catch (error) {
    if (error instanceof JobSummaryRepositoryError) throw error;
    invalid(error);
  }
  assertEvidence({
    evidence: claim.evidence[0]!,
    source: claim.source_version,
    evidenceId: claim.proof.evidence_id,
    readAt: input.snapshot.read_at,
  });
}

function sameJob(
  left: { readonly kind: string; readonly id: string },
  right: { readonly kind: string; readonly id: string }
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function observedSectionTimestampsAreCurrent(
  claim: z.infer<typeof SectionClaimSchema>,
  readAt: string
): boolean {
  if (claim.raw.state !== "evaluated") return true;
  const readAtMillis = Date.parse(readAt);
  switch (claim.raw.section) {
    case "identity": {
      const dates = (
        claim.raw.value as {
          dates: { created_at: string; updated_at: string };
        }
      ).dates;
      const createdAt = Date.parse(dates.created_at);
      const updatedAt = Date.parse(dates.updated_at);
      return createdAt <= updatedAt && updatedAt <= readAtMillis;
    }
    case "schedule":
      return (
        claim.raw.value as {
          occurrences: readonly {
            task_updated_at: string;
            project_updated_at: string;
            schedule_confirmed_at: string | null;
          }[];
        }
      ).occurrences.every(
        (occurrence) =>
          Date.parse(occurrence.task_updated_at) <= readAtMillis &&
          Date.parse(occurrence.project_updated_at) <= readAtMillis &&
          (occurrence.schedule_confirmed_at === null ||
            Date.parse(occurrence.schedule_confirmed_at) <= readAtMillis)
      );
    case "activity":
      return (
        claim.raw.value as {
          events: readonly { occurred_at: string }[];
        }
      ).events.every((event) => Date.parse(event.occurred_at) <= readAtMillis);
    case "conversation": {
      const deliveredAt = (
        claim.raw.value as {
          last_actor_visible_delivered_at: string | null;
        }
      ).last_actor_visible_delivered_at;
      return deliveredAt === null || Date.parse(deliveredAt) <= readAtMillis;
    }
    default:
      return true;
  }
}

function assertSnapshot(
  snapshot: RawJobSummarySnapshot,
  proof: AuthorizedJobSummaryRead
): void {
  const requestedSections = [...proof.query.sections];
  const returnedSections = snapshot.section_claims.map(
    ({ raw }) => raw.section
  );
  const summaryRaw = {
    requested_job: snapshot.requested_job,
    requested_sections: returnedSections,
    section_count: snapshot.section_claims.length,
    gaps: snapshot.gaps,
  } as const;
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    !sameJob(snapshot.requested_job, proof.query.job_ref) ||
    requestedSections.length !== returnedSections.length ||
    requestedSections.some(
      (section, index) => section !== returnedSections[index]
    ) ||
    new Set(returnedSections).size !== returnedSections.length ||
    canonicalOperationalProjection(snapshot.summary_claim.raw) !==
      canonicalOperationalProjection(summaryRaw)
  ) {
    invalid();
  }

  const sources = new Set<string>();
  const evidenceIds = new Set<string>();
  const retainedSources: SourceVersion[] = [];
  for (const claim of snapshot.section_claims) {
    const returnedIdentityJob =
      claim.raw.state === "evaluated" && claim.raw.section === "identity"
        ? (
            claim.raw.value as {
              job_ref: { kind: string; id: string };
            }
          ).job_ref
        : null;
    const returnedScheduleJobs =
      claim.raw.state === "evaluated" && claim.raw.section === "schedule"
        ? (
            claim.raw.value as {
              occurrences: readonly {
                job_ref: { kind: string; id: string };
              }[];
            }
          ).occurrences.map(({ job_ref }) => job_ref)
        : null;
    const returnedFinancialComponents =
      claim.raw.state === "evaluated" && claim.raw.section === "financials"
        ? (
            claim.raw.value as {
              components: readonly {
                kind: "estimate_rollup" | "invoice_rollup";
              }[];
            }
          ).components.map(({ kind }) => kind)
        : null;
    const returnedActivityStatusKinds =
      claim.raw.state === "evaluated" && claim.raw.section === "activity"
        ? (
            claim.raw.value as {
              events: readonly (
                | {
                    event_kind: "job_status_event";
                    to_status: { kind: string };
                  }
                | { event_kind: "task_event" }
              )[];
            }
          ).events.flatMap((event) =>
            event.event_kind === "job_status_event"
              ? [event.to_status.kind]
              : []
          )
        : null;
    const requestedFinancialComponents = proof.query.financial_components;
    const restrictedConversationValue =
      claim.raw.state === "evaluated" &&
      claim.raw.section === "conversation" &&
      proof.inboxScope !== "all"
        ? (claim.raw.value as Readonly<Record<string, unknown>>)
        : null;
    if (
      !observedSectionTimestampsAreCurrent(claim, snapshot.read_at) ||
      claim.raw.evidence_ids.length !== 1 ||
      claim.raw.evidence_ids[0] !== claim.proof.evidence_id ||
      (returnedIdentityJob !== null &&
        !sameJob(returnedIdentityJob, snapshot.requested_job)) ||
      (returnedScheduleJobs !== null &&
        (snapshot.requested_job.kind !== "project" ||
          returnedScheduleJobs.some(
            (job) => !sameJob(job, snapshot.requested_job)
          ))) ||
      (returnedFinancialComponents !== null &&
        (requestedFinancialComponents === undefined ||
          returnedFinancialComponents.length !==
            requestedFinancialComponents.length ||
          returnedFinancialComponents.some(
            (component) => !requestedFinancialComponents.includes(component)
          ))) ||
      (returnedActivityStatusKinds !== null &&
        returnedActivityStatusKinds.some(
          (kind) => kind !== snapshot.requested_job.kind
        )) ||
      (restrictedConversationValue !== null &&
        (restrictedConversationValue.memory_version !== null ||
          restrictedConversationValue.turn_high_watermark_id !== null)) ||
      sources.has(sourceIdentity(claim.source_version)) ||
      evidenceIds.has(claim.proof.evidence_id)
    ) {
      invalid();
    }
    assertAtomicClaim({
      claim,
      proof,
      snapshot,
      sourceType: "job_summary_section_projection",
      sourceId: `${snapshot.requested_job.kind}:${snapshot.requested_job.id}:${claim.raw.section}`,
      evidenceId: `evidence:job_summary_section_projection:${snapshot.requested_job.kind}:${snapshot.requested_job.id}:${claim.raw.section}`,
      versionPrefix: "job-summary-section-projection:v1",
      payloadKey: "section",
      expectedRaw: claim.raw as CanonicalProjection,
      retainedProofSources: [],
    });
    sources.add(sourceIdentity(claim.source_version));
    evidenceIds.add(claim.proof.evidence_id);
    retainedSources.push(claim.source_version);
  }

  assertAtomicClaim({
    claim: snapshot.summary_claim,
    proof,
    snapshot,
    sourceType: "job_summary_projection",
    sourceId: `${snapshot.requested_job.kind}:${snapshot.requested_job.id}`,
    evidenceId: `evidence:job_summary_projection:${snapshot.requested_job.kind}:${snapshot.requested_job.id}`,
    versionPrefix: "job-summary-projection:v1",
    payloadKey: "summary",
    expectedRaw: summaryRaw,
    retainedProofSources: retainedSources,
  });
  if (
    sources.has(sourceIdentity(snapshot.summary_claim.source_version)) ||
    evidenceIds.has(snapshot.summary_claim.proof.evidence_id)
  ) {
    invalid();
  }
}

function isNotFound(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const value = error as Readonly<Record<string, unknown>>;
    return (
      value.code === "P0002" &&
      value.message === "agent_job_summary_not_found_or_not_visible"
    );
  } catch {
    return false;
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

export function createSupabaseJobSummaryRepository(
  client: JobSummaryRpcClient
): JobSummaryRepository {
  let suppliedRpc: JobSummaryRpcClient["rpc"] | undefined;
  try {
    suppliedRpc = (client as JobSummaryRpcClient | null)?.rpc;
  } catch {
    throw new TypeError("A job-summary RPC client is required");
  }
  if (typeof suppliedRpc !== "function") {
    throw new TypeError("A job-summary RPC client is required");
  }
  const rpc = (
    functionName: typeof RPC_NAME,
    args: Readonly<Record<string, unknown>>
  ) => Reflect.apply(suppliedRpc, client, [functionName, args]);

  const repository = {
    async read(input: {
      readonly authorization: AuthorizedJobSummaryRead;
      readonly signal?: AbortSignal;
    }): Promise<JobSummarySnapshot> {
      let proof: AuthorizedJobSummaryRead;
      let signal: AbortSignal | undefined;
      try {
        proof = input.authorization;
        signal = input.signal;
      } catch (error) {
        invalid(error);
      }
      if (!isAuthorizedJobSummaryRead(proof)) invalid();
      if (signal?.aborted) {
        throw new JobSummaryRepositoryError("JOB_SUMMARY_READ_FAILED");
      }

      let response: RpcResult;
      try {
        const query = proof.query;
        const request = rpc(RPC_NAME, {
          p_request_id: proof.actorContext.requestId,
          p_actor_user_id: proof.actorContext.actorUserId,
          p_company_id: proof.actorContext.companyId,
          p_permission_snapshot_revision:
            proof.actorContext.permissionSnapshotRevision,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_id: proof.capabilityId,
          p_capability_revision: proof.capabilityRevision,
          p_capability_manifest_revision: proof.capabilityManifestRevision,
          p_required_oauth_scopes: [...proof.requiredOAuthScopes],
          p_inbox_scope: proof.inboxScope,
          p_clients_scope: proof.clientsScope,
          p_pipeline_scope: proof.pipelineScope,
          p_projects_scope: proof.projectsScope,
          p_calendar_scope: proof.calendarScope,
          p_tasks_scope: proof.tasksScope,
          p_photos_scope: proof.photosScope,
          p_estimates_scope: proof.estimatesScope,
          p_invoices_scope: proof.invoicesScope,
          p_projects_financials_scope: proof.projectsFinancialsScope,
          p_job_kind: query.job_ref.kind,
          p_job_id: query.job_ref.id,
          p_sections: [...query.sections],
          p_readiness_rule_codes: query.readiness_rule_codes
            ? [...query.readiness_rule_codes]
            : null,
          p_financial_components: query.financial_components
            ? [...query.financial_components]
            : null,
        });
        const abortSignal = request?.abortSignal;
        response =
          signal && typeof abortSignal === "function"
            ? await Reflect.apply(abortSignal, request, [signal])
            : await request;
      } catch (error) {
        if (error instanceof JobSummaryRepositoryError) throw error;
        throw new JobSummaryRepositoryError("JOB_SUMMARY_READ_FAILED", {
          cause: error,
        });
      }
      if (signal?.aborted) {
        throw new JobSummaryRepositoryError("JOB_SUMMARY_READ_FAILED");
      }

      let responseError: unknown;
      let responseData: unknown;
      try {
        responseError = response?.error;
        responseData = response?.data;
      } catch (error) {
        throw new JobSummaryRepositoryError("JOB_SUMMARY_READ_FAILED", {
          cause: error,
        });
      }
      if (responseError) {
        throw new JobSummaryRepositoryError(
          isNotFound(responseError)
            ? "JOB_SUMMARY_NOT_FOUND"
            : "JOB_SUMMARY_READ_FAILED",
          { cause: responseError }
        );
      }
      let parsedData: RawJobSummarySnapshot;
      try {
        const parsed = RawSnapshotSchema.safeParse(responseData);
        if (!parsed.success) invalid(parsed.error);
        parsedData = parsed.data;
      } catch (error) {
        if (error instanceof JobSummaryRepositoryError) throw error;
        invalid(error);
      }
      assertSnapshot(parsedData, proof);
      return deepFreeze(parsedData);
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as JobSummaryRepository;
}

export function isTrustedJobSummaryRepository(
  value: unknown
): value is JobSummaryRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
