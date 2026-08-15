import "server-only";

import { z } from "zod-v4";

import {
  CommunicationJobRefSchema,
  CommunicationScheduleSourceSchema,
  JobCommunicationPurposeSchema,
  JobParticipantPurposeSchema,
  MAX_COMMUNICATION_GAPS,
  MAX_JOB_PARTICIPANTS,
  MAX_PARTICIPANT_EVIDENCE_IDS,
  ParticipantCountCompletenessSchema,
} from "@/lib/agent-control-plane/contracts/communication";
import {
  EvidenceRefSchema,
  OpaqueIdSchema,
  Rfc3339UtcTimestampSchema,
  SourceVersionSchema,
} from "@/lib/agent-control-plane/contracts";
import { CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import type { AuthorizedJobCommunicationRead } from "./job-communication-authorization";
import type { AuthorizedJobParticipantsRead } from "./job-participants-authorization";
import { RawSitePhotoSourceSchema } from "./readiness-rules";

const UUID_SCHEMA = z.string().uuid();
const SHA256_SCHEMA = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const PERMISSION_REVISION_SCHEMA = SHA256_SCHEMA;
const SOURCE_REVISION_SCHEMA = z.number().int().safe().nonnegative();
const UNKNOWN_PARTICIPANT_ID_SCHEMA = z
  .string()
  .regex(/^unknown:sha256:[0-9a-f]{64}$/);
const REDACTED_PARTICIPANT_ID_SCHEMA = z
  .string()
  .regex(/^redacted:sha256:[0-9a-f]{64}$/);

export const CommunicationParticipantSourceFenceSchema =
  SourceVersionSchema.refine(
    (value) =>
      value.source_domain === "operations" &&
      value.source_type === "operational_read_revision" &&
      value.source_id === "private.agent_operational_read_revisions" &&
      /^revision:\d+$/.test(value.version),
    "Communication participant source fence is invalid"
  );

export const CommunicationContactabilityFenceSchema =
  SourceVersionSchema.refine(
    (value) =>
      value.source_domain === "operations" &&
      value.source_type === "contactability_revision" &&
      /^sha256:[0-9a-f]{64}$/.test(value.source_id) &&
      /^revision:\d+$/.test(value.version),
    "Communication contactability fence is invalid"
  );

export const ParticipantEmailSourceSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      normalized_address: z
        .string()
        .email()
        .max(320)
        .refine(
          (value) => value === value.trim() && value === value.toLowerCase(),
          "Available email address must be normalized"
        ),
    })
    .strict(),
  z
    .object({
      state: z.literal("blocked"),
      code: z.literal("ADDRESS_SUPPRESSED"),
    })
    .strict(),
  z
    .object({
      state: z.literal("absent"),
      code: z.literal("NO_ADDRESS_ON_RECORD"),
    })
    .strict(),
  z
    .object({
      state: z.literal("ambiguous"),
      code: z.literal("IDENTITY_AMBIGUOUS"),
    })
    .strict(),
  z
    .object({
      state: z.literal("not_evaluated"),
      code: z.literal("SOURCE_UNAVAILABLE"),
    })
    .strict(),
  z
    .object({
      state: z.literal("query_bound"),
      code: z.literal("SOURCE_QUERY_BOUND"),
    })
    .strict(),
  z
    .object({
      state: z.literal("data_invalid"),
      code: z.literal("SOURCE_DATA_INVALID"),
    })
    .strict(),
]);

const ParticipantEvidenceFields = {
  evidence_ids: z
    .array(OpaqueIdSchema)
    .max(MAX_PARTICIPANT_EVIDENCE_IDS)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Participant evidence IDs must be unique"
    ),
  evidence_id_total: z.number().int().safe().nonnegative(),
};

const DisplayNameSchema = z.string().trim().min(1).max(256);
const RoleLabelSchema = z.string().trim().min(1).max(256).nullable();
const ResolutionRevisionSchema = z.literal("job-participant-resolution:v1");

const PrimaryClientRawSchema = z
  .object({
    source_kind: z.literal("primary_client"),
    participant_ref: z
      .object({ kind: z.literal("client"), id: UUID_SCHEMA })
      .strict(),
    display_name: DisplayNameSchema,
    role_label: z.null(),
    conversation_side: z.literal("user"),
    resolution_status: z.literal("confirmed"),
    resolution_basis: z.literal("job_client"),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    email_source: ParticipantEmailSourceSchema,
    ...ParticipantEvidenceFields,
  })
  .strict();

const SubClientRawSchema = z
  .object({
    source_kind: z.literal("sub_client"),
    participant_ref: z
      .object({ kind: z.literal("sub_client"), id: UUID_SCHEMA })
      .strict(),
    display_name: DisplayNameSchema,
    role_label: RoleLabelSchema,
    conversation_side: z.literal("user"),
    resolution_status: z.literal("confirmed"),
    resolution_basis: z.literal("client_parent"),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    email_source: ParticipantEmailSourceSchema,
    ...ParticipantEvidenceFields,
  })
  .strict();

const RelatedContactRawSchema = z
  .object({
    source_kind: z.literal("related_contact_record"),
    participant_ref: z
      .object({ kind: z.literal("related_contact"), id: UUID_SCHEMA })
      .strict(),
    display_name: DisplayNameSchema,
    role_label: RoleLabelSchema,
    conversation_side: z.literal("user"),
    resolution_status: z.literal("confirmed"),
    resolution_basis: z.literal("explicit_related_contact"),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    email_source: ParticipantEmailSourceSchema,
    ...ParticipantEvidenceFields,
  })
  .strict();

const AmbiguousConversationRawSchema = z
  .object({
    source_kind: z.literal("conversation_ambiguous"),
    participant_ref: z
      .object({ kind: z.literal("unknown"), id: UNKNOWN_PARTICIPANT_ID_SCHEMA })
      .strict(),
    display_name: z.null(),
    role_label: z.null(),
    conversation_side: z.null(),
    resolution_status: z.literal("ambiguous"),
    resolution_basis: z.null(),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count_lower_bound: z.number().int().safe().min(2).max(50),
    email_source: z
      .object({
        state: z.literal("ambiguous"),
        code: z.literal("IDENTITY_AMBIGUOUS"),
      })
      .strict(),
    ...ParticipantEvidenceFields,
  })
  .strict();

const UnresolvedConversationRawSchema = z
  .object({
    source_kind: z.literal("conversation_unresolved"),
    participant_ref: z
      .object({ kind: z.literal("unknown"), id: UNKNOWN_PARTICIPANT_ID_SCHEMA })
      .strict(),
    display_name: z.null(),
    role_label: z.null(),
    conversation_side: z.null(),
    resolution_status: z.literal("unresolved"),
    resolution_basis: z.null(),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    email_source: z.union([
      z
        .object({
          state: z.literal("not_evaluated"),
          code: z.literal("SOURCE_UNAVAILABLE"),
        })
        .strict(),
      z
        .object({
          state: z.literal("query_bound"),
          code: z.literal("SOURCE_QUERY_BOUND"),
        })
        .strict(),
      z
        .object({
          state: z.literal("data_invalid"),
          code: z.literal("SOURCE_DATA_INVALID"),
        })
        .strict(),
    ]),
    ...ParticipantEvidenceFields,
  })
  .strict();

const RedactedConversationRawSchema = z
  .object({
    source_kind: z.literal("conversation_redacted"),
    participant_ref: z
      .object({
        kind: z.literal("redacted"),
        id: REDACTED_PARTICIPANT_ID_SCHEMA,
      })
      .strict(),
    display_name: z.null(),
    role_label: z.null(),
    conversation_side: z.null(),
    resolution_status: z.literal("redacted"),
    resolution_basis: z.null(),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    email_source: z
      .object({
        state: z.literal("not_evaluated"),
        code: z.literal("SOURCE_UNAVAILABLE"),
      })
      .strict(),
    ...ParticipantEvidenceFields,
  })
  .strict();

const OpsDeliveryUserRawSchema = z
  .object({
    source_kind: z.literal("ops_delivery_user"),
    participant_ref: z
      .object({ kind: z.literal("ops_user"), id: UUID_SCHEMA })
      .strict(),
    display_name: DisplayNameSchema,
    role_label: z.null(),
    conversation_side: z.literal("assistant"),
    resolution_status: z.literal("confirmed"),
    resolution_basis: z.literal("ops_delivery_actor"),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    ...ParticipantEvidenceFields,
  })
  .strict();

const AssignedOpsUserRawSchema = z
  .object({
    source_kind: z.literal("task_assignment_user"),
    participant_ref: z
      .object({ kind: z.literal("ops_user"), id: UUID_SCHEMA })
      .strict(),
    display_name: DisplayNameSchema,
    role_label: z.null(),
    conversation_side: z.literal("assistant"),
    resolution_status: z.literal("confirmed"),
    resolution_basis: z.literal("task_assignment"),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    ...ParticipantEvidenceFields,
  })
  .strict();

const PhaseCRawSchema = z
  .object({
    source_kind: z.literal("phase_c"),
    participant_ref: z
      .object({ kind: z.literal("phase_c"), id: z.literal("phase_c") })
      .strict(),
    display_name: z.null(),
    role_label: z.null(),
    conversation_side: z.literal("assistant"),
    resolution_status: z.literal("confirmed"),
    resolution_basis: z.literal("phase_c_delivery_origin"),
    resolution_revision: ResolutionRevisionSchema,
    candidate_count: z.null(),
    ...ParticipantEvidenceFields,
  })
  .strict();

export const RawJobParticipantSchema = z
  .discriminatedUnion("source_kind", [
    PrimaryClientRawSchema,
    SubClientRawSchema,
    RelatedContactRawSchema,
    AmbiguousConversationRawSchema,
    UnresolvedConversationRawSchema,
    RedactedConversationRawSchema,
    OpsDeliveryUserRawSchema,
    AssignedOpsUserRawSchema,
    PhaseCRawSchema,
  ])
  .superRefine((participant, context) => {
    if (participant.evidence_id_total < participant.evidence_ids.length) {
      context.addIssue({
        code: "custom",
        path: ["evidence_id_total"],
        message: "Evidence total cannot be smaller than retained evidence",
      });
    }
  });

export const CommunicationSnapshotGapCodeSchema = z.enum([
  "PARTICIPANT_QUERY_BOUND",
  "PARTICIPANT_EVIDENCE_QUERY_BOUND",
  "RELATED_CONTACT_UNCONFIRMED",
  "CONTACTABILITY_SOURCE_UNAVAILABLE",
  "CONTACTABILITY_SOURCE_QUERY_BOUND",
  "CONTACTABILITY_SOURCE_DATA_INVALID",
  "REDACTED_SOURCE_DATA",
  "NO_CONTACTABLE_RECIPIENT",
  "SCHEDULE_SOURCE_UNAVAILABLE",
  "PHOTO_SOURCE_UNAVAILABLE",
]);

const SnapshotGapCodesSchema = z
  .array(CommunicationSnapshotGapCodeSchema)
  .max(MAX_COMMUNICATION_GAPS)
  .refine(
    (codes) => new Set(codes).size === codes.length,
    "Communication snapshot gap codes must be unique"
  );

const CommonRawCommunicationFields = {
  job_address: z.string().trim().min(1).max(2_000).nullable(),
  safe_job_description: z.string().trim().min(1).max(4_000).nullable(),
  participant_total: z.number().int().safe().nonnegative(),
  participants_omitted_count: z.number().int().safe().nonnegative(),
  participant_count_completeness: ParticipantCountCompletenessSchema,
  gaps: SnapshotGapCodesSchema,
};

function validateRawCommunicationParticipantCollection(
  value: {
    participant_count_completeness: "exact" | "lower_bound";
    gaps: readonly CommunicationSnapshotGapCode[];
  },
  context: z.RefinementCtx
) {
  if (
    value.participant_count_completeness === "lower_bound" &&
    !value.gaps.includes("PARTICIPANT_QUERY_BOUND")
  ) {
    context.addIssue({
      code: "custom",
      path: ["participant_count_completeness"],
      message: "A participant lower bound requires a query-bound gap",
    });
  }
}

export const CommunicationSitePhotoRawSourceSchema = RawSitePhotoSourceSchema;

const GeneralRawCommunicationContextSchema = z
  .object({
    purpose: z.literal("general"),
    ...CommonRawCommunicationFields,
  })
  .strict()
  .superRefine(validateRawCommunicationParticipantCollection);

const ScheduleRawCommunicationContextSchema = z
  .object({
    purpose: z.literal("schedule_notice"),
    ...CommonRawCommunicationFields,
    schedule: CommunicationScheduleSourceSchema,
  })
  .strict()
  .superRefine(validateRawCommunicationParticipantCollection);

const PhotoRawCommunicationContextSchema = z
  .object({
    purpose: z.literal("photo_request"),
    ...CommonRawCommunicationFields,
    schedule: CommunicationScheduleSourceSchema,
    site_photos: CommunicationSitePhotoRawSourceSchema,
  })
  .strict()
  .superRefine(validateRawCommunicationParticipantCollection);

export const RawJobCommunicationContextSchema = z.discriminatedUnion(
  "purpose",
  [
    GeneralRawCommunicationContextSchema,
    ScheduleRawCommunicationContextSchema,
    PhotoRawCommunicationContextSchema,
  ]
);

const CommonProjectionFields = {
  actor_user_id: UUID_SCHEMA,
  capability_manifest_revision: z.literal(CAPABILITY_MANIFEST_REVISION),
  company_id: UUID_SCHEMA,
  job_ref: CommunicationJobRefSchema,
  permission_snapshot_revision: PERMISSION_REVISION_SCHEMA,
  read_at: Rfc3339UtcTimestampSchema,
  source_revision: SOURCE_REVISION_SCHEMA,
  contactability_digest: SHA256_SCHEMA,
  contactability_revision: SOURCE_REVISION_SCHEMA,
};

const ParticipantProjectionForCommunicationSchema = z
  .object({
    ...CommonProjectionFields,
    capability_id: z.literal("get_job_communication_context"),
    capability_revision: z.literal(
      "get_job_communication_context:2026-08-13.v1"
    ),
    purpose: JobCommunicationPurposeSchema,
    participant: RawJobParticipantSchema,
  })
  .strict();

const ParticipantProjectionForParticipantReadSchema = z
  .object({
    ...CommonProjectionFields,
    capability_id: z.literal("resolve_job_participants"),
    capability_revision: z.literal("resolve_job_participants:2026-08-13.v1"),
    purpose: JobParticipantPurposeSchema,
    participant: RawJobParticipantSchema,
  })
  .strict();

export const JobParticipantProjectionSchema = z.discriminatedUnion(
  "capability_id",
  [
    ParticipantProjectionForCommunicationSchema,
    ParticipantProjectionForParticipantReadSchema,
  ]
);

export const JobParticipantProjectionProofSchema = z
  .object({
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: OpaqueIdSchema,
    projection: JobParticipantProjectionSchema,
  })
  .strict();

export const JobParticipantClaimSchema = z
  .object({
    raw: RawJobParticipantSchema,
    proof: JobParticipantProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).length(1),
  })
  .strict();

export const JobParticipantsCollectionRawSchema = z
  .object({
    participant_total: z.number().int().safe().nonnegative(),
    participants_omitted_count: z.number().int().safe().nonnegative(),
    participant_count_completeness: ParticipantCountCompletenessSchema,
    gaps: SnapshotGapCodesSchema,
  })
  .strict()
  .superRefine((collection, context) => {
    if (
      collection.participant_count_completeness === "lower_bound" &&
      !collection.gaps.includes("PARTICIPANT_QUERY_BOUND")
    ) {
      context.addIssue({
        code: "custom",
        path: ["participant_count_completeness"],
        message: "A participant lower bound requires a query-bound gap",
      });
    }
  });

export const JobParticipantsCollectionProjectionSchema = z
  .object({
    ...CommonProjectionFields,
    capability_id: z.literal("resolve_job_participants"),
    capability_revision: z.literal("resolve_job_participants:2026-08-13.v1"),
    purpose: JobParticipantPurposeSchema,
    collection: JobParticipantsCollectionRawSchema,
    participant_proof_sources: z.array(SourceVersionSchema).max(50),
  })
  .strict();

export const JobParticipantsCollectionProjectionProofSchema = z
  .object({
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: OpaqueIdSchema,
    projection: JobParticipantsCollectionProjectionSchema,
  })
  .strict();

export const JobParticipantsCollectionClaimSchema = z
  .object({
    raw: JobParticipantsCollectionRawSchema,
    proof: JobParticipantsCollectionProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).length(1),
  })
  .strict();

export const JobCommunicationContextProjectionSchema = z
  .object({
    ...CommonProjectionFields,
    capability_id: z.literal("get_job_communication_context"),
    capability_revision: z.literal(
      "get_job_communication_context:2026-08-13.v1"
    ),
    purpose: JobCommunicationPurposeSchema,
    context: RawJobCommunicationContextSchema,
    participant_proof_sources: z.array(SourceVersionSchema).max(50),
  })
  .strict();

export const JobCommunicationContextProjectionProofSchema = z
  .object({
    source_version: SourceVersionSchema,
    source_content_hash: SHA256_SCHEMA,
    evidence_id: OpaqueIdSchema,
    projection: JobCommunicationContextProjectionSchema,
  })
  .strict();

export const JobCommunicationContextClaimSchema = z
  .object({
    raw: RawJobCommunicationContextSchema,
    proof: JobCommunicationContextProjectionProofSchema,
    source_version: SourceVersionSchema,
    evidence: z.array(EvidenceRefSchema).min(1).max(1),
  })
  .strict();

const CommonSnapshotFields = {
  company_id: UUID_SCHEMA,
  permission_snapshot_revision: PERMISSION_REVISION_SCHEMA,
  read_at: Rfc3339UtcTimestampSchema,
  source_fence: CommunicationParticipantSourceFenceSchema,
  contactability_fence: CommunicationContactabilityFenceSchema,
  participant_claims: z
    .array(JobParticipantClaimSchema)
    .max(MAX_JOB_PARTICIPANTS),
  participant_total: z.number().int().safe().nonnegative(),
  participants_omitted_count: z.number().int().safe().nonnegative(),
  participant_count_completeness: ParticipantCountCompletenessSchema,
  gaps: SnapshotGapCodesSchema,
};

function validateSnapshotBounds(
  snapshot: {
    participant_claims: readonly z.infer<typeof JobParticipantClaimSchema>[];
    participant_total: number;
    participants_omitted_count: number;
    participant_count_completeness: "exact" | "lower_bound";
    gaps: readonly CommunicationSnapshotGapCode[];
  },
  context: z.RefinementCtx
) {
  if (
    snapshot.participant_total !==
    snapshot.participant_claims.length + snapshot.participants_omitted_count
  ) {
    context.addIssue({
      code: "custom",
      path: ["participant_total"],
      message:
        "Participant total must equal retained plus omitted participants",
    });
  }
  if (
    snapshot.participant_count_completeness === "lower_bound" &&
    !snapshot.gaps.includes("PARTICIPANT_QUERY_BOUND")
  ) {
    context.addIssue({
      code: "custom",
      path: ["participant_count_completeness"],
      message: "A participant lower bound requires a query-bound gap",
    });
  }
  const participantKeys = snapshot.participant_claims.map(
    (claim) =>
      `${claim.raw.participant_ref.kind}:${claim.raw.participant_ref.id}`
  );
  if (new Set(participantKeys).size !== participantKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["participant_claims"],
      message: "Participant claims must be unique",
    });
  }
  const retainedBusinessEvidenceCount = snapshot.participant_claims.reduce(
    (count, claim) => count + claim.raw.evidence_ids.length,
    0
  );
  if (retainedBusinessEvidenceCount > 50) {
    context.addIssue({
      code: "custom",
      path: ["participant_claims"],
      message: "Retained participant evidence exceeds the global bound",
    });
  }
  const retainedEnvelopeEvidenceCount = snapshot.participant_claims.reduce(
    (count, claim) => count + claim.evidence.length,
    0
  );
  if (retainedEnvelopeEvidenceCount > 100) {
    context.addIssue({
      code: "custom",
      path: ["participant_claims"],
      message:
        "Retained participant envelope evidence exceeds the global bound",
    });
  }
}

export const JobParticipantsSnapshotSchema = z
  .object({
    ...CommonSnapshotFields,
    requested_job: CommunicationJobRefSchema,
    purpose: JobParticipantPurposeSchema,
    collection_claim: JobParticipantsCollectionClaimSchema,
  })
  .strict()
  .superRefine(validateSnapshotBounds);

export const JobCommunicationContextSnapshotSchema = z
  .object({
    ...CommonSnapshotFields,
    requested_job: CommunicationJobRefSchema,
    purpose: JobCommunicationPurposeSchema,
    context_claim: JobCommunicationContextClaimSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    validateSnapshotBounds(snapshot, context);
    const envelopeEvidenceCount =
      snapshot.context_claim.evidence.length +
      snapshot.participant_claims.reduce(
        (count, claim) => count + claim.evidence.length,
        0
      );
    if (envelopeEvidenceCount > 100) {
      context.addIssue({
        code: "custom",
        path: ["context_claim"],
        message: "Communication envelope evidence exceeds the global bound",
      });
    }
  });

declare const JOB_PARTICIPANTS_SNAPSHOT_READER: unique symbol;
export interface JobParticipantsSnapshotReader {
  readonly [JOB_PARTICIPANTS_SNAPSHOT_READER]: true;
  read(input: {
    readonly authorization: AuthorizedJobParticipantsRead;
    readonly signal?: AbortSignal;
  }): Promise<JobParticipantsSnapshot>;
}

declare const JOB_COMMUNICATION_CONTEXT_SNAPSHOT_READER: unique symbol;
export interface JobCommunicationContextSnapshotReader {
  readonly [JOB_COMMUNICATION_CONTEXT_SNAPSHOT_READER]: true;
  read(input: {
    readonly authorization: AuthorizedJobCommunicationRead;
    readonly signal?: AbortSignal;
  }): Promise<JobCommunicationContextSnapshot>;
}

export type ParticipantEmailSource = z.infer<
  typeof ParticipantEmailSourceSchema
>;
export type RawJobParticipant = z.infer<typeof RawJobParticipantSchema>;
export type CommunicationSnapshotGapCode = z.infer<
  typeof CommunicationSnapshotGapCodeSchema
>;
export type RawJobCommunicationContext = z.infer<
  typeof RawJobCommunicationContextSchema
>;
export type JobParticipantProjection = z.infer<
  typeof JobParticipantProjectionSchema
>;
export type JobParticipantProjectionProof = z.infer<
  typeof JobParticipantProjectionProofSchema
>;
export type JobParticipantClaim = z.infer<typeof JobParticipantClaimSchema>;
export type JobParticipantsCollectionRaw = z.infer<
  typeof JobParticipantsCollectionRawSchema
>;
export type JobParticipantsCollectionProjection = z.infer<
  typeof JobParticipantsCollectionProjectionSchema
>;
export type JobParticipantsCollectionProjectionProof = z.infer<
  typeof JobParticipantsCollectionProjectionProofSchema
>;
export type JobParticipantsCollectionClaim = z.infer<
  typeof JobParticipantsCollectionClaimSchema
>;
export type JobCommunicationContextProjection = z.infer<
  typeof JobCommunicationContextProjectionSchema
>;
export type JobCommunicationContextProjectionProof = z.infer<
  typeof JobCommunicationContextProjectionProofSchema
>;
export type JobCommunicationContextClaim = z.infer<
  typeof JobCommunicationContextClaimSchema
>;
export type JobParticipantsSnapshot = z.infer<
  typeof JobParticipantsSnapshotSchema
>;
export type JobCommunicationContextSnapshot = z.infer<
  typeof JobCommunicationContextSnapshotSchema
>;
