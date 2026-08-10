import { z } from "zod";

import {
  collectMemoryEvidenceLinks,
  JobMemoryDocumentSchema,
  MemoryEvidenceRelationshipSchema,
  type JobMemoryDocument,
  type MemoryEvidenceRelationship,
} from "./memory-schema";

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const TURN_EVIDENCE_ID_PATTERN =
  /^job_conversation_turn:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const TURN_PROJECTION_REVISION_PATTERN =
  /^job-conversation-turn-projection:v1:([1-9][0-9]*)$/;

export interface MemoryEvidenceRecord {
  readonly evidenceId: string;
  readonly relationship: MemoryEvidenceRelationship;
  readonly sourceDomain: string;
  readonly sourceType: string;
  readonly sourceEntityId: string;
  readonly sourceRevision: string;
  readonly sourceContentHash: string | null;
  readonly sourceParticipantId: string;
  readonly sourceParticipantResolutionStatus:
    "resolved" | "unresolved" | "ambiguous";
}

export interface MemoryTurn {
  readonly id: string;
  readonly turnSequence: number;
  readonly sourceStateRevision: number;
  readonly side: "user" | "assistant" | null;
  readonly participantId: string;
  readonly participantResolutionStatus: "resolved" | "unresolved" | "ambiguous";
  readonly direction: "inbound" | "outbound";
  readonly channel: "email";
  readonly deliveredAt: string;
  readonly ingestedAt: string;
  readonly subject: string | null;
  readonly normalizedPlainText: string;
  readonly attachmentEvidenceIds: readonly string[];
  readonly providerDeliverySourceId: string;
  readonly providerDeliverySourceSha256: string;
  readonly evidenceSourceRevision: string;
  readonly evidenceContentHash: string;
  readonly redactionKinds: readonly (
    "content_redacted" | "attachment_redacted" | "participant_pseudonymized"
  )[];
}

export interface MemoryVersion {
  readonly id: string;
  readonly companyId: string;
  readonly conversationId: string;
  readonly versionNumber: number;
  readonly predecessorVersionId: string | null;
  readonly turnHighWatermarkId: string;
  readonly turnHighWatermarkSequence: number;
  readonly sourceStateRevision: number;
  readonly generationInputHash: string;
  readonly memoryDocument: JobMemoryDocument;
  readonly memoryDocumentHash: string;
  readonly generatorRevision: string;
  readonly createdAt: string;
}

export type RequiredThroughState =
  "not_requested" | "missing" | "pending" | "summarized";

export interface MemoryGenerationSnapshot {
  readonly companyId: string;
  readonly conversationId: string;
  readonly sourceStateRevision: number;
  readonly lastTurnSequence: number;
  readonly currentVersion: MemoryVersion | null;
  readonly currentEvidence: readonly MemoryEvidenceRecord[];
  readonly pendingTurns: readonly MemoryTurn[];
  readonly invalidatedEvidenceIds: readonly string[];
  readonly requiredThrough: {
    readonly turnId: string | null;
    readonly state: RequiredThroughState;
  };
}

export interface LoadMemoryGenerationSnapshotInput {
  readonly companyId: string;
  readonly conversationId: string;
  readonly requiredThroughTurnId?: string;
  readonly maxTurns: number;
  readonly signal?: AbortSignal;
}

export interface CommitMemoryVersionInput {
  readonly companyId: string;
  readonly conversationId: string;
  readonly expectedCurrentMemoryVersionId: string | null;
  readonly expectedSourceStateRevision: number;
  readonly processedTurnIds: readonly string[];
  readonly turnHighWatermarkId: string;
  readonly turnHighWatermarkSequence: number;
  readonly generationInputHash: string;
  readonly generatorRevision: string;
  readonly memoryDocument: JobMemoryDocument;
  readonly signal?: AbortSignal;
}

export type CommitMemoryVersionResult =
  | {
      readonly kind: "committed" | "already_committed";
      readonly version: MemoryVersion;
    }
  | { readonly kind: "conflict"; readonly current: MemoryVersion | null };

export interface MemoryRepository {
  loadGenerationSnapshot(
    input: LoadMemoryGenerationSnapshotInput
  ): Promise<MemoryGenerationSnapshot>;
  commitMemoryVersion(
    input: CommitMemoryVersionInput
  ): Promise<CommitMemoryVersionResult>;
  readCurrent(input: {
    readonly companyId: string;
    readonly conversationId: string;
    readonly signal?: AbortSignal;
  }): Promise<MemoryVersion | null>;
}

interface MemoryRepositoryRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface MemoryRepositoryRpcRequest extends PromiseLike<MemoryRepositoryRpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<MemoryRepositoryRpcResult>;
}

export interface MemoryRepositoryClient {
  readonly rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ) => MemoryRepositoryRpcRequest;
}

export class MemoryRepositoryError extends Error {
  readonly code:
    | "MEMORY_SNAPSHOT_READ_FAILED"
    | "MEMORY_SNAPSHOT_INVALID"
    | "MEMORY_COMMIT_FAILED"
    | "MEMORY_COMMIT_INVALID";

  constructor(code: MemoryRepositoryError["code"], options?: ErrorOptions) {
    super(code, options);
    this.name = "MemoryRepositoryError";
    this.code = code;
  }
}

const EvidenceRowSchema = z
  .object({
    evidence_id: z.string().min(1),
    relationship: MemoryEvidenceRelationshipSchema,
    source_domain: z.string().min(1),
    source_type: z.string().min(1),
    source_entity_id: z.string().min(1),
    source_revision: z.string().min(1),
    source_content_hash: Sha256Schema.nullable(),
    source_participant_id: z.string().min(1),
    source_participant_resolution_status: z.enum([
      "resolved",
      "unresolved",
      "ambiguous",
    ]),
  })
  .strict();

const TurnRowSchema = z
  .object({
    id: UuidSchema,
    turn_sequence: z.number().int().positive(),
    source_state_revision: z.number().int().positive(),
    side: z.enum(["user", "assistant"]).nullable(),
    participant_id: z.string().min(1),
    participant_resolution_status: z.enum([
      "resolved",
      "unresolved",
      "ambiguous",
    ]),
    direction: z.enum(["inbound", "outbound"]),
    channel: z.literal("email"),
    delivered_at: TimestampSchema,
    ingested_at: TimestampSchema,
    subject: z.string().nullable(),
    normalized_plain_text: z.string(),
    attachment_evidence_ids: z.array(z.string()),
    provider_delivery_source_id: UuidSchema,
    provider_delivery_source_sha256: Sha256Schema,
    evidence_source_revision: z.string().min(1),
    evidence_content_hash: Sha256Schema,
    redaction_kinds: z.array(
      z.enum([
        "content_redacted",
        "attachment_redacted",
        "participant_pseudonymized",
      ])
    ),
  })
  .strict();

const VersionRowSchema = z
  .object({
    id: UuidSchema,
    company_id: UuidSchema,
    conversation_id: UuidSchema,
    version_number: z.number().int().positive(),
    predecessor_version_id: UuidSchema.nullable(),
    turn_high_watermark_id: UuidSchema,
    turn_high_watermark_sequence: z.number().int().positive(),
    source_state_revision: z.number().int().nonnegative(),
    generation_input_hash: Sha256Schema,
    memory_document: JobMemoryDocumentSchema,
    memory_document_hash: Sha256Schema,
    generator_revision: z.string().min(1),
    created_at: TimestampSchema,
  })
  .strict();

const SnapshotSchema = z
  .object({
    company_id: UuidSchema,
    conversation_id: UuidSchema,
    source_state_revision: z.number().int().nonnegative(),
    last_turn_sequence: z.number().int().nonnegative(),
    current_version: VersionRowSchema.nullable(),
    current_evidence: z.array(EvidenceRowSchema),
    pending_turns: z.array(TurnRowSchema),
    invalidated_evidence_ids: z.array(z.string().min(1)),
    required_through: z
      .object({
        turn_id: UuidSchema.nullable(),
        state: z.enum(["not_requested", "missing", "pending", "summarized"]),
      })
      .strict(),
  })
  .strict();

const CommitRowSchema = z
  .object({
    result_kind: z.enum(["committed", "already_committed", "conflict"]),
    current_version: VersionRowSchema.nullable(),
  })
  .strict();

export function createMemoryRepository(
  client: MemoryRepositoryClient
): MemoryRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("Memory repository client is invalid");
  }

  const loadGenerationSnapshot = async (
    input: LoadMemoryGenerationSnapshotInput
  ): Promise<MemoryGenerationSnapshot> => {
    const response = await executeRpc(
      client,
      "read_job_memory_generation_snapshot_as_system",
      {
        p_company_id: input.companyId,
        p_conversation_id: input.conversationId,
        p_required_through_turn_id: input.requiredThroughTurnId ?? null,
        p_max_turns: input.maxTurns,
      },
      input.signal
    );
    if (response.error) {
      throw new MemoryRepositoryError("MEMORY_SNAPSHOT_READ_FAILED", {
        cause: response.error,
      });
    }
    const parsed = SnapshotSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new MemoryRepositoryError("MEMORY_SNAPSHOT_INVALID", {
        cause: parsed.error,
      });
    }
    assertSnapshotSemantics(parsed.data, input);
    return snapshotFromRow(parsed.data);
  };

  return Object.freeze({
    loadGenerationSnapshot,

    async commitMemoryVersion(
      input: CommitMemoryVersionInput
    ): Promise<CommitMemoryVersionResult> {
      const response = await executeRpc(
        client,
        "commit_job_memory_version_as_system",
        {
          p_company_id: input.companyId,
          p_conversation_id: input.conversationId,
          p_expected_current_memory_version_id:
            input.expectedCurrentMemoryVersionId,
          p_expected_source_state_revision: input.expectedSourceStateRevision,
          p_processed_turn_ids: input.processedTurnIds,
          p_turn_high_watermark_id: input.turnHighWatermarkId,
          p_turn_high_watermark_sequence: input.turnHighWatermarkSequence,
          p_generation_input_hash: input.generationInputHash,
          p_generator_revision: input.generatorRevision,
          p_memory_document: input.memoryDocument,
        },
        input.signal
      );
      if (response.error) {
        throw new MemoryRepositoryError("MEMORY_COMMIT_FAILED", {
          cause: response.error,
        });
      }
      const candidate = Array.isArray(response.data)
        ? response.data[0]
        : response.data;
      const parsed = CommitRowSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new MemoryRepositoryError("MEMORY_COMMIT_INVALID", {
          cause: parsed.error,
        });
      }
      const current = parsed.data.current_version
        ? versionFromRow(parsed.data.current_version)
        : null;
      if (parsed.data.result_kind === "conflict") {
        if (
          parsed.data.current_version &&
          !versionIsScopedAndInternallyConsistent(
            parsed.data.current_version,
            input.companyId,
            input.conversationId
          )
        ) {
          throw new MemoryRepositoryError("MEMORY_COMMIT_INVALID");
        }
        return { kind: "conflict", current };
      }
      if (
        !current ||
        !parsed.data.current_version ||
        !successfulCommitMatchesCandidate(parsed.data.current_version, input)
      ) {
        throw new MemoryRepositoryError("MEMORY_COMMIT_INVALID");
      }
      return { kind: parsed.data.result_kind, version: current };
    },

    async readCurrent(input: {
      readonly companyId: string;
      readonly conversationId: string;
      readonly signal?: AbortSignal;
    }): Promise<MemoryVersion | null> {
      const snapshot = await loadGenerationSnapshot({
        ...input,
        maxTurns: 1,
      });
      return snapshot.currentVersion;
    },
  });
}

async function executeRpc(
  client: MemoryRepositoryClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  signal?: AbortSignal
): Promise<MemoryRepositoryRpcResult> {
  const request = client.rpc(functionName, args);
  if (signal && typeof request.abortSignal === "function") {
    return await request.abortSignal(signal);
  }
  return await request;
}

function assertSnapshotSemantics(
  row: z.infer<typeof SnapshotSchema>,
  input: LoadMemoryGenerationSnapshotInput
): void {
  const current = row.current_version;
  const baseSequence = current?.turn_high_watermark_sequence ?? 0;
  const invalid = () => {
    throw new MemoryRepositoryError("MEMORY_SNAPSHOT_INVALID");
  };

  if (
    row.company_id !== input.companyId ||
    row.conversation_id !== input.conversationId ||
    !Number.isInteger(input.maxTurns) ||
    input.maxTurns < 1 ||
    input.maxTurns > 50 ||
    row.source_state_revision < row.last_turn_sequence ||
    baseSequence > row.last_turn_sequence ||
    row.pending_turns.length > input.maxTurns
  ) {
    invalid();
  }

  if (
    current &&
    (!versionIsScopedAndInternallyConsistent(
      current,
      input.companyId,
      input.conversationId
    ) ||
      current.turn_high_watermark_sequence > row.last_turn_sequence ||
      current.source_state_revision > row.source_state_revision)
  ) {
    invalid();
  }

  const turnIds = new Set<string>();
  let previousTurnSourceRevision = 0;
  for (const [index, turn] of row.pending_turns.entries()) {
    const expectedSequence = baseSequence + index + 1;
    const projectionRevision = turnProjectionRevision(
      turn.evidence_source_revision
    );
    const participantRedacted = turn.redaction_kinds.includes(
      "participant_pseudonymized"
    );
    const participantProjectionValid = participantRedacted
      ? turn.participant_id === "[PARTICIPANT REDACTED]" &&
        turn.participant_resolution_status === "unresolved" &&
        turn.side === null
      : (turn.participant_resolution_status === "resolved" &&
          ((turn.direction === "inbound" && turn.side === "user") ||
            (turn.direction === "outbound" && turn.side === "assistant"))) ||
        (turn.participant_resolution_status !== "resolved" &&
          turn.side === null);
    if (
      turn.turn_sequence !== expectedSequence ||
      turn.turn_sequence > row.last_turn_sequence ||
      turn.source_state_revision < turn.turn_sequence ||
      turn.source_state_revision > row.source_state_revision ||
      turn.source_state_revision <= previousTurnSourceRevision ||
      projectionRevision === null ||
      projectionRevision < turn.source_state_revision ||
      projectionRevision > row.source_state_revision ||
      !participantProjectionValid ||
      turnIds.has(turn.id) ||
      turn.id === current?.turn_high_watermark_id
    ) {
      invalid();
    }
    turnIds.add(turn.id);
    previousTurnSourceRevision = turn.source_state_revision;
  }

  if (baseSequence < row.last_turn_sequence) {
    if (row.pending_turns.length === 0) invalid();
    const lastPending = row.pending_turns[row.pending_turns.length - 1];
    if (
      row.pending_turns.length < input.maxTurns &&
      lastPending.turn_sequence !== row.last_turn_sequence
    ) {
      invalid();
    }
  } else if (row.pending_turns.length > 0) {
    invalid();
  }

  assertCurrentEvidenceSemantics(row, invalid);
  assertRequiredThroughSemantics(row, input, invalid);
}

function assertCurrentEvidenceSemantics(
  row: z.infer<typeof SnapshotSchema>,
  invalid: () => never
): void {
  if (!row.current_version) {
    if (
      row.current_evidence.length > 0 ||
      row.invalidated_evidence_ids.length > 0
    ) {
      invalid();
    }
    return;
  }

  const expectedLinks = new Set(
    collectMemoryEvidenceLinks(row.current_version.memory_document).map(
      (link) => evidenceRelationshipKey(link.evidence_id, link.relationship)
    )
  );
  const actualLinks = new Set<string>();
  const actualEvidenceIds = new Set<string>();

  for (const evidence of row.current_evidence) {
    const evidenceMatch = TURN_EVIDENCE_ID_PATTERN.exec(evidence.evidence_id);
    const projectionRevision = turnProjectionRevision(evidence.source_revision);
    const relationshipKey = evidenceRelationshipKey(
      evidence.evidence_id,
      evidence.relationship
    );
    if (
      !evidenceMatch ||
      evidenceMatch[1] !== evidence.source_entity_id ||
      evidence.source_domain !== "job_conversation" ||
      evidence.source_type !== "delivered_email_turn" ||
      evidence.source_content_hash === null ||
      (evidence.source_participant_id === "[PARTICIPANT REDACTED]" &&
        evidence.source_participant_resolution_status !== "unresolved") ||
      projectionRevision === null ||
      projectionRevision > row.source_state_revision ||
      actualLinks.has(relationshipKey)
    ) {
      invalid();
    }
    actualLinks.add(relationshipKey);
    actualEvidenceIds.add(evidence.evidence_id);
  }

  if (!setsEqual(expectedLinks, actualLinks)) invalid();

  const invalidated = new Set<string>();
  for (const evidenceId of row.invalidated_evidence_ids) {
    if (invalidated.has(evidenceId) || !actualEvidenceIds.has(evidenceId)) {
      invalid();
    }
    invalidated.add(evidenceId);
  }
}

function assertRequiredThroughSemantics(
  row: z.infer<typeof SnapshotSchema>,
  input: LoadMemoryGenerationSnapshotInput,
  invalid: () => never
): void {
  const requestedTurnId = input.requiredThroughTurnId ?? null;
  const required = row.required_through;
  if (required.turn_id !== requestedTurnId) invalid();
  if (requestedTurnId === null) {
    if (required.state !== "not_requested") invalid();
    return;
  }
  if (required.state === "not_requested") invalid();

  const currentIsSourceCurrent =
    row.current_version !== null &&
    row.current_version.turn_high_watermark_sequence ===
      row.last_turn_sequence &&
    row.current_version.source_state_revision === row.source_state_revision;
  if (required.state === "summarized" && !currentIsSourceCurrent) invalid();
  if (required.state === "pending" && currentIsSourceCurrent) invalid();
  if (
    required.state === "missing" &&
    (row.current_version?.turn_high_watermark_id === requestedTurnId ||
      row.pending_turns.some((turn) => turn.id === requestedTurnId))
  ) {
    invalid();
  }
}

function versionIsScopedAndInternallyConsistent(
  row: z.infer<typeof VersionRowSchema>,
  companyId: string,
  conversationId: string
): boolean {
  return (
    row.company_id === companyId &&
    row.conversation_id === conversationId &&
    row.source_state_revision >= row.turn_high_watermark_sequence &&
    row.predecessor_version_id !== row.id
  );
}

function successfulCommitMatchesCandidate(
  row: z.infer<typeof VersionRowSchema>,
  input: CommitMemoryVersionInput
): boolean {
  const memoryDocument = JobMemoryDocumentSchema.safeParse(
    input.memoryDocument
  );
  return (
    memoryDocument.success &&
    versionIsScopedAndInternallyConsistent(
      row,
      input.companyId,
      input.conversationId
    ) &&
    row.predecessor_version_id === input.expectedCurrentMemoryVersionId &&
    row.turn_high_watermark_id === input.turnHighWatermarkId &&
    row.turn_high_watermark_sequence === input.turnHighWatermarkSequence &&
    row.source_state_revision === input.expectedSourceStateRevision &&
    row.generation_input_hash === input.generationInputHash &&
    row.generator_revision === input.generatorRevision &&
    JSON.stringify(row.memory_document) === JSON.stringify(memoryDocument.data)
  );
}

function turnProjectionRevision(value: string): number | null {
  const match = TURN_PROJECTION_REVISION_PATTERN.exec(value);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

function evidenceRelationshipKey(
  evidenceId: string,
  relationship: MemoryEvidenceRelationship
): string {
  return `${evidenceId}\u0000${relationship}`;
}

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function snapshotFromRow(
  row: z.infer<typeof SnapshotSchema>
): MemoryGenerationSnapshot {
  return Object.freeze({
    companyId: row.company_id,
    conversationId: row.conversation_id,
    sourceStateRevision: row.source_state_revision,
    lastTurnSequence: row.last_turn_sequence,
    currentVersion: row.current_version
      ? versionFromRow(row.current_version)
      : null,
    currentEvidence: Object.freeze(
      row.current_evidence.map((evidence) =>
        Object.freeze({
          evidenceId: evidence.evidence_id,
          relationship: evidence.relationship,
          sourceDomain: evidence.source_domain,
          sourceType: evidence.source_type,
          sourceEntityId: evidence.source_entity_id,
          sourceRevision: evidence.source_revision,
          sourceContentHash: evidence.source_content_hash,
          sourceParticipantId: evidence.source_participant_id,
          sourceParticipantResolutionStatus:
            evidence.source_participant_resolution_status,
        })
      )
    ),
    pendingTurns: Object.freeze(
      row.pending_turns.map((turn) =>
        Object.freeze({
          id: turn.id,
          turnSequence: turn.turn_sequence,
          sourceStateRevision: turn.source_state_revision,
          side: turn.side,
          participantId: turn.participant_id,
          participantResolutionStatus: turn.participant_resolution_status,
          direction: turn.direction,
          channel: turn.channel,
          deliveredAt: turn.delivered_at,
          ingestedAt: turn.ingested_at,
          subject: turn.subject,
          normalizedPlainText: turn.normalized_plain_text,
          attachmentEvidenceIds: Object.freeze([
            ...turn.attachment_evidence_ids,
          ]),
          providerDeliverySourceId: turn.provider_delivery_source_id,
          providerDeliverySourceSha256: turn.provider_delivery_source_sha256,
          evidenceSourceRevision: turn.evidence_source_revision,
          evidenceContentHash: turn.evidence_content_hash,
          redactionKinds: Object.freeze([...turn.redaction_kinds]),
        })
      )
    ),
    invalidatedEvidenceIds: Object.freeze([...row.invalidated_evidence_ids]),
    requiredThrough: Object.freeze({
      turnId: row.required_through.turn_id,
      state: row.required_through.state,
    }),
  });
}

function versionFromRow(row: z.infer<typeof VersionRowSchema>): MemoryVersion {
  return Object.freeze({
    id: row.id,
    companyId: row.company_id,
    conversationId: row.conversation_id,
    versionNumber: row.version_number,
    predecessorVersionId: row.predecessor_version_id,
    turnHighWatermarkId: row.turn_high_watermark_id,
    turnHighWatermarkSequence: row.turn_high_watermark_sequence,
    sourceStateRevision: row.source_state_revision,
    generationInputHash: row.generation_input_hash,
    memoryDocument: row.memory_document,
    memoryDocumentHash: row.memory_document_hash,
    generatorRevision: row.generator_revision,
    createdAt: row.created_at,
  });
}
