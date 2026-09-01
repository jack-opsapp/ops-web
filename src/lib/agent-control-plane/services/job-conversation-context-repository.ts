import "server-only";

import { z } from "zod";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { isCanonicalPostgresUuid } from "@/lib/agent-control-plane/contracts/postgres-uuid";
import { JobMemoryDocumentSchema } from "@/lib/agent-control-plane/memory/memory-schema";
import {
  isAuthorizedJobConversationContextRead,
  type AuthorizedJobConversationContextRead,
} from "./job-conversation-context-authorization";

const CONTEXT_RPC = "read_agent_job_conversation_context_as_system" as const;
const PHASE_C_CONTEXT_RPC =
  "read_agent_phase_c_job_conversation_context_as_system" as const;
const UuidSchema = z
  .string()
  .refine(isCanonicalPostgresUuid, "UUID must use canonical PostgreSQL text");
const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const TurnProjectionRevisionSchema = z
  .string()
  .regex(/^job-conversation-turn-projection:v1:[1-9][0-9]*$/);
const EvidenceProjectionRevisionSchema = z
  .string()
  .regex(/^job-conversation-evidence-projection:v2:[1-9][0-9]*$/);
const JOB_CONVERSATION_TURN_PREFIX = "job_conversation_turn:";
const CUSTOMER_JOB_HISTORY_PREFIX = "customer_job_history:";

function hasCanonicalPostgresUuidSuffix(
  value: string,
  prefix: string
): boolean {
  return (
    value.startsWith(prefix) &&
    isCanonicalPostgresUuid(value.slice(prefix.length))
  );
}

const EvidenceIdSchema = z
  .string()
  .refine((value) =>
    hasCanonicalPostgresUuidSuffix(value, JOB_CONVERSATION_TURN_PREFIX)
  );
const CustomerJobHistoryEvidenceIdSchema = z
  .string()
  .refine((value) =>
    hasCanonicalPostgresUuidSuffix(value, CUSTOMER_JOB_HISTORY_PREFIX)
  );
const RedactionKindSchema = z.enum([
  "content_redacted",
  "attachment_redacted",
  "participant_pseudonymized",
]);
const ResolutionStatusSchema = z.enum(["resolved", "unresolved", "ambiguous"]);

const RequestedJobSchema = z
  .object({
    kind: z.enum(["opportunity", "project"]),
    id: UuidSchema,
  })
  .strict();

const CurrentVersionSchema = z
  .object({
    id: UuidSchema,
    version_number: z.number().int().positive(),
    turn_high_watermark_id: UuidSchema,
    turn_high_watermark_sequence: z.number().int().positive(),
    source_state_revision: z.number().int().nonnegative(),
    memory_document: JobMemoryDocumentSchema,
    memory_document_hash: Sha256Schema,
    generator_revision: z.string().trim().min(1).max(256),
    created_at: TimestampSchema,
  })
  .strict();

const RecentTurnSchema = z
  .object({
    id: UuidSchema,
    turn_sequence: z.number().int().positive(),
    source_state_revision: z.number().int().positive(),
    side: z.enum(["user", "assistant"]).nullable(),
    participant_id: z.string().trim().min(1).max(512),
    participant_resolution_status: ResolutionStatusSchema,
    participant_resolution_revision: z.string().trim().min(1).max(256),
    direction: z.enum(["inbound", "outbound"]),
    channel: z.literal("email"),
    delivered_at: TimestampSchema,
    ingested_at: TimestampSchema,
    source_connection_id: UuidSchema,
    provider_message_id: z.string().trim().min(1).max(512),
    provider_delivery_source_id: UuidSchema,
    provider_delivery_source_sha256: Sha256Schema.nullable(),
    source_activity_id: UuidSchema.nullable(),
    source_correspondence_event_id: UuidSchema.nullable(),
    subject: z.string().max(2_048).nullable(),
    recipient_identities: z.array(z.string().min(1).max(512)).max(100),
    cc_recipient_identities: z.array(z.string().min(1).max(512)).max(100),
    normalized_plain_text: z.string().max(8_388_608),
    original_content_hash: Sha256Schema,
    attachment_evidence_ids: z.array(z.string().min(1).max(512)).max(100),
    evidence_source_revision: TurnProjectionRevisionSchema,
    evidence_content_hash: Sha256Schema,
    redaction_kinds: z.array(RedactionKindSchema).max(3),
  })
  .strict();

const ActiveEvidenceSchema = z
  .object({
    evidence_id: EvidenceIdSchema,
    purposes: z
      .array(z.enum(["triggering_turn", "active_memory_claim"]))
      .min(1)
      .max(2),
    relationships: z
      .array(z.enum(["supports", "contradicts", "supersedes"]))
      .max(3),
    source_domain: z.literal("job_conversation"),
    source_type: z.literal("delivered_email_turn"),
    source_id: UuidSchema,
    source_revision: EvidenceProjectionRevisionSchema,
    source_content_hash: Sha256Schema,
    occurred_at: TimestampSchema,
    trust: z.literal("delivered_correspondence"),
    locator: z.string().trim().min(1).max(2_048),
    excerpt: z.string().max(8_000),
    excerpt_truncated: z.boolean(),
    participant_id: z.string().trim().min(1).max(512),
    participant_resolution_status: ResolutionStatusSchema,
    participant_resolution_revision: z.string().trim().min(1).max(256),
    redaction_kinds: z.array(RedactionKindSchema).max(3),
  })
  .strict();

const ParticipantEvidenceSchema = z
  .object({
    evidence_id: EvidenceIdSchema,
    source_domain: z.literal("job_conversation"),
    source_type: z.literal("delivered_email_participant_resolution"),
    source_id: UuidSchema,
    source_revision: z
      .string()
      .regex(/^job-conversation-participant-projection:v1:[1-9][0-9]*$/),
    source_content_hash: Sha256Schema,
    occurred_at: TimestampSchema,
    relationship: z.literal("supports"),
    locator: z.string().trim().min(1).max(2_048),
    trust: z.literal("delivered_correspondence"),
  })
  .strict();

const CrossJobEvidenceSchema = z
  .object({
    evidence_id: CustomerJobHistoryEvidenceIdSchema,
    source_domain: z.literal("customer_jobs"),
    source_type: z.literal("visible_prior_job_snapshot"),
    source_id: UuidSchema,
    source_revision: z
      .string()
      .regex(/^customer-job-history-projection:v1:sha256:[0-9a-f]{64}$/),
    source_content_hash: Sha256Schema,
    occurred_at: TimestampSchema,
    relationship: z.literal("supports"),
    locator: z.string().trim().min(1).max(2_048),
    trust: z.literal("authoritative_ops"),
  })
  .strict();

const ParticipantSchema = z
  .object({
    participant_id: z.string().trim().min(1).max(512),
    side: z.enum(["user", "assistant"]).nullable(),
    participant_resolution_status: ResolutionStatusSchema,
    participant_resolution_revision: z.string().trim().min(1).max(256),
    evidence_ids: z.array(EvidenceIdSchema).min(1).max(50),
    evidence_id_total: z.number().int().nonnegative(),
    redaction_kinds: z.array(RedactionKindSchema).max(3),
    primary_evidence: ParticipantEvidenceSchema,
  })
  .strict();

const LatestVisiblePriorJobSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum([
      "active",
      "scheduled",
      "in_progress",
      "completed",
      "closed",
      "cancelled",
      "converted",
      "archived",
    ]),
  })
  .strict();

const RelationshipContinuitySchema = z
  .object({
    marker: z.literal("returning_customer"),
    evidence_id: CustomerJobHistoryEvidenceIdSchema,
  })
  .strict();

const CrossJobSeedSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      customer_has_prior_ops_jobs: z.boolean(),
      visible_prior_job_count: z.number().int().nonnegative(),
      latest_visible_prior_job: LatestVisiblePriorJobSchema.nullable(),
      relationship_continuity: RelationshipContinuitySchema.nullable(),
      evidence: CrossJobEvidenceSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("customer_unresolved"),
      customer_has_prior_ops_jobs: z.null(),
      visible_prior_job_count: z.null(),
      latest_visible_prior_job: z.null(),
      relationship_continuity: z.null(),
      evidence: z.null(),
    })
    .strict(),
]);

const SnapshotSchema = z
  .object({
    company_id: UuidSchema,
    conversation_id: UuidSchema,
    requested_job: RequestedJobSchema,
    read_at: TimestampSchema,
    permission_snapshot_revision: Sha256Schema,
    source_state_revision: z.number().int().nonnegative(),
    last_turn_sequence: z.number().int().nonnegative(),
    current_version: CurrentVersionSchema.nullable(),
    recent_turns: z.array(RecentTurnSchema).max(50),
    recent_turns_omitted_count: z.number().int().nonnegative(),
    active_evidence: z.array(ActiveEvidenceSchema).max(20),
    active_evidence_total: z.number().int().nonnegative(),
    participants: z.array(ParticipantSchema).max(50),
    participant_total: z.number().int().nonnegative(),
    cross_job_seed: CrossJobSeedSchema,
    invalidated_evidence_ids: z.array(EvidenceIdSchema).max(100),
    invalidated_evidence_total: z.number().int().nonnegative(),
    required_through: z
      .object({
        turn_id: UuidSchema.nullable(),
        state: z.enum(["not_requested", "missing", "pending", "summarized"]),
      })
      .strict(),
  })
  .strict();

export type JobConversationContextSnapshot = z.infer<typeof SnapshotSchema>;

export class JobConversationContextRepositoryError extends Error {
  readonly code:
    | "JOB_CONVERSATION_CONTEXT_READ_FAILED"
    | "JOB_CONVERSATION_CONTEXT_NOT_FOUND"
    | "JOB_CONVERSATION_CONTEXT_INVALID";

  constructor(
    code: JobConversationContextRepositoryError["code"],
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "JobConversationContextRepositoryError";
    this.code = code;
  }
}

interface ContextRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface JobConversationContextRpcRequest extends PromiseLike<ContextRpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<ContextRpcResult>;
}

export interface JobConversationContextRpcClient {
  rpc(
    functionName: typeof CONTEXT_RPC | typeof PHASE_C_CONTEXT_RPC,
    args: Readonly<Record<string, unknown>>
  ): JobConversationContextRpcRequest;
}

declare const TRUSTED_JOB_CONVERSATION_CONTEXT_REPOSITORY: unique symbol;
const TRUSTED_REPOSITORIES = new WeakSet<object>();

interface TrustedJobConversationContextRepositoryBrand {
  readonly [TRUSTED_JOB_CONVERSATION_CONTEXT_REPOSITORY]: true;
}

export interface JobConversationContextRepository extends TrustedJobConversationContextRepositoryBrand {
  read(input: {
    readonly authorization: AuthorizedJobConversationContextRead;
    readonly signal?: AbortSignal;
  }): Promise<JobConversationContextSnapshot>;
}

export function createSupabaseJobConversationContextRepository(
  client: JobConversationContextRpcClient
): JobConversationContextRepository {
  const rpc = client?.rpc;
  if (!client || typeof rpc !== "function") {
    throw new TypeError("A job conversation context RPC client is required");
  }
  const repository = {
    async read(input: {
      readonly authorization: AuthorizedJobConversationContextRead;
      readonly signal?: AbortSignal;
    }): Promise<JobConversationContextSnapshot> {
      if (!isAuthorizedJobConversationContextRead(input.authorization)) {
        throw new JobConversationContextRepositoryError(
          "JOB_CONVERSATION_CONTEXT_INVALID"
        );
      }
      const proof = input.authorization;
      const phaseCRoute = proof.actorContext.phaseCRoute;
      if (
        phaseCRoute &&
        (proof.jobRef.kind !== "opportunity" ||
          proof.jobRef.id !== phaseCRoute.opportunityId ||
          proof.requiredThroughTurnId !== phaseCRoute.sourceTurnId)
      ) {
        throw new JobConversationContextRepositoryError(
          "JOB_CONVERSATION_CONTEXT_INVALID"
        );
      }
      const args = Object.freeze({
        p_request_id: proof.actorContext.requestId,
        p_actor_user_id: proof.actorContext.actorUserId,
        p_company_id: proof.actorContext.companyId,
        p_permission_snapshot_revision:
          proof.actorContext.permissionSnapshotRevision,
        p_registered_permission_keys: Object.freeze([
          ...REGISTERED_ACTOR_PERMISSION_KEYS,
        ]),
        p_capability_id: proof.capabilityId,
        p_capability_revision: proof.capabilityRevision,
        p_capability_manifest_revision: proof.capabilityManifestRevision,
        p_required_oauth_scopes: Object.freeze([...proof.requiredOAuthScopes]),
        p_inbox_scope: proof.inboxScope,
        p_clients_scope: proof.clientsScope,
        p_job_permission: proof.jobPermission,
        p_job_scope: proof.jobScope,
        p_job_kind: proof.jobRef.kind,
        p_job_id: proof.jobRef.id,
        p_exact_turn_limit: proof.exactTurnLimit,
        p_sections: Object.freeze([...proof.sections]),
        p_required_through_turn_id: proof.requiredThroughTurnId,
        ...(phaseCRoute
          ? {
              p_phase_c_assignment_version: phaseCRoute.assignmentVersion,
              p_phase_c_connection_id: phaseCRoute.connectionId,
              p_phase_c_internal_thread_id: phaseCRoute.internalThreadId,
              p_phase_c_provider_thread_id: phaseCRoute.providerThreadId,
              p_phase_c_source_activity_id: phaseCRoute.sourceActivityId,
              p_phase_c_source_turn_id: phaseCRoute.sourceTurnId,
              p_phase_c_source_conversation_id:
                phaseCRoute.sourceConversationId,
            }
          : {}),
      });
      const request = rpc.call(
        client,
        phaseCRoute ? PHASE_C_CONTEXT_RPC : CONTEXT_RPC,
        args
      );
      const response =
        input.signal && request.abortSignal
          ? await request.abortSignal(input.signal)
          : await request;
      if (response.error) {
        if (isContextNotFoundError(response.error)) {
          throw new JobConversationContextRepositoryError(
            "JOB_CONVERSATION_CONTEXT_NOT_FOUND",
            { cause: response.error }
          );
        }
        throw new JobConversationContextRepositoryError(
          "JOB_CONVERSATION_CONTEXT_READ_FAILED",
          { cause: response.error }
        );
      }
      const parsed = SnapshotSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new JobConversationContextRepositoryError(
          "JOB_CONVERSATION_CONTEXT_INVALID",
          { cause: parsed.error }
        );
      }
      assertSnapshotSemantics(parsed.data, proof);
      return parsed.data;
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository) as JobConversationContextRepository;
}

function isContextNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Readonly<Record<string, unknown>>;
  return (
    value.code === "P0002" &&
    value.message === "agent_job_conversation_context_not_found"
  );
}

export function isTrustedJobConversationContextRepository(
  value: unknown
): value is JobConversationContextRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}

function assertSnapshotSemantics(
  snapshot: JobConversationContextSnapshot,
  proof: AuthorizedJobConversationContextRead
): void {
  const invalid = () => {
    throw new JobConversationContextRepositoryError(
      "JOB_CONVERSATION_CONTEXT_INVALID"
    );
  };
  if (
    snapshot.company_id !== proof.actorContext.companyId ||
    snapshot.permission_snapshot_revision !==
      proof.actorContext.permissionSnapshotRevision ||
    snapshot.requested_job.kind !== proof.jobRef.kind ||
    snapshot.requested_job.id !== proof.jobRef.id ||
    snapshot.recent_turns.length > proof.exactTurnLimit ||
    snapshot.active_evidence_total < snapshot.active_evidence.length ||
    snapshot.participant_total < snapshot.participants.length ||
    snapshot.invalidated_evidence_ids.length !==
      Math.min(100, snapshot.invalidated_evidence_total) ||
    new Set(snapshot.invalidated_evidence_ids).size !==
      snapshot.invalidated_evidence_ids.length ||
    snapshot.source_state_revision < snapshot.last_turn_sequence ||
    (proof.actorContext.phaseCRoute !== null &&
      snapshot.conversation_id !==
        proof.actorContext.phaseCRoute.sourceConversationId) ||
    snapshot.recent_turns.length + snapshot.recent_turns_omitted_count !==
      (proof.sections.includes("recent_turns")
        ? Math.min(proof.exactTurnLimit, snapshot.last_turn_sequence)
        : 0)
  ) {
    invalid();
  }

  const current = snapshot.current_version;
  if (
    current &&
    (current.turn_high_watermark_sequence > snapshot.last_turn_sequence ||
      current.source_state_revision < current.turn_high_watermark_sequence ||
      current.source_state_revision > snapshot.source_state_revision)
  ) {
    invalid();
  }

  const firstExpectedSequence =
    snapshot.last_turn_sequence - snapshot.recent_turns.length + 1;
  const turnIds = new Set<string>();
  const recentTurnById = new Map<
    string,
    JobConversationContextSnapshot["recent_turns"][number]
  >();
  for (const [index, turn] of snapshot.recent_turns.entries()) {
    if (
      turn.turn_sequence !== firstExpectedSequence + index ||
      turn.turn_sequence > snapshot.last_turn_sequence ||
      turn.source_state_revision > snapshot.source_state_revision ||
      projectionRevision(turn.evidence_source_revision) <
        turn.source_state_revision ||
      projectionRevision(turn.evidence_source_revision) >
        snapshot.source_state_revision ||
      turnIds.has(turn.id) ||
      (turn.participant_resolution_status === "resolved" &&
        ((turn.direction === "inbound" && turn.side !== "user") ||
          (turn.direction === "outbound" && turn.side !== "assistant"))) ||
      (turn.participant_resolution_status !== "resolved" && turn.side !== null)
    ) {
      invalid();
    }
    turnIds.add(turn.id);
    recentTurnById.set(turn.id, turn);
  }

  const evidenceIds = new Set<string>();
  for (const evidence of snapshot.active_evidence) {
    const recentTurn = recentTurnById.get(evidence.source_id);
    const recentText = recentTurn
      ? Array.from(recentTurn.normalized_plain_text)
      : null;
    if (
      evidenceIds.has(evidence.evidence_id) ||
      evidence.evidence_id !== `job_conversation_turn:${evidence.source_id}` ||
      projectionRevision(evidence.source_revision) >
        snapshot.source_state_revision ||
      new Set(evidence.purposes).size !== evidence.purposes.length ||
      new Set(evidence.relationships).size !== evidence.relationships.length ||
      (recentTurn !== undefined &&
        (projectionRevision(evidence.source_revision) !==
          projectionRevision(recentTurn.evidence_source_revision) ||
          evidence.occurred_at !== recentTurn.delivered_at ||
          evidence.participant_id !== recentTurn.participant_id ||
          evidence.participant_resolution_status !==
            recentTurn.participant_resolution_status ||
          evidence.participant_resolution_revision !==
            recentTurn.participant_resolution_revision ||
          evidence.excerpt !== recentText!.slice(0, 4000).join("") ||
          evidence.excerpt_truncated !== recentText!.length > 4000))
    ) {
      invalid();
    }
    evidenceIds.add(evidence.evidence_id);
  }

  const requiredTurnId = proof.requiredThroughTurnId;
  const participantEvidenceIds = new Set<string>();
  for (const participant of snapshot.participants) {
    const primary = participant.primary_evidence;
    const recentTurn = recentTurnById.get(primary.source_id);
    if (
      participant.evidence_id_total < participant.evidence_ids.length ||
      !participant.evidence_ids.includes(primary.evidence_id) ||
      primary.evidence_id !== `job_conversation_turn:${primary.source_id}` ||
      projectionRevision(primary.source_revision) >
        snapshot.source_state_revision ||
      participantEvidenceIds.has(primary.evidence_id) ||
      (recentTurn !== undefined &&
        (projectionRevision(primary.source_revision) !==
          projectionRevision(recentTurn.evidence_source_revision) ||
          primary.occurred_at !== recentTurn.delivered_at ||
          participant.participant_id !== recentTurn.participant_id ||
          participant.participant_resolution_status !==
            recentTurn.participant_resolution_status ||
          participant.participant_resolution_revision !==
            recentTurn.participant_resolution_revision ||
          participant.side !== recentTurn.side))
    ) {
      invalid();
    }
    participantEvidenceIds.add(primary.evidence_id);
  }

  const crossJob = snapshot.cross_job_seed;
  if (crossJob.state === "available") {
    const crossJobEvidence = crossJob.evidence;
    if (
      crossJob.customer_has_prior_ops_jobs !==
        crossJob.visible_prior_job_count > 0 ||
      (crossJob.visible_prior_job_count === 0) !==
        (crossJob.latest_visible_prior_job === null) ||
      (crossJob.visible_prior_job_count === 0) !==
        (crossJob.relationship_continuity === null) ||
      crossJobEvidence.evidence_id !==
        `customer_job_history:${crossJobEvidence.source_id}` ||
      crossJobEvidence.source_revision !==
        `customer-job-history-projection:v1:${crossJobEvidence.source_content_hash}` ||
      crossJobEvidence.occurred_at !== snapshot.read_at ||
      (crossJob.relationship_continuity !== null &&
        crossJob.relationship_continuity.evidence_id !==
          crossJobEvidence.evidence_id)
    ) {
      invalid();
    }
  }
  if (
    snapshot.required_through.turn_id !== requiredTurnId ||
    (requiredTurnId === null &&
      snapshot.required_through.state !== "not_requested") ||
    (requiredTurnId !== null &&
      snapshot.required_through.state === "not_requested") ||
    (snapshot.required_through.state === "summarized" &&
      (!current ||
        current.turn_high_watermark_sequence !== snapshot.last_turn_sequence ||
        current.source_state_revision !== snapshot.source_state_revision ||
        !snapshot.active_evidence.some(
          (evidence) =>
            evidence.evidence_id ===
              `job_conversation_turn:${requiredTurnId}` &&
            evidence.purposes.includes("triggering_turn")
        )))
  ) {
    invalid();
  }
}

function projectionRevision(value: string): number {
  const parsed = Number(value.slice(value.lastIndexOf(":") + 1));
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
