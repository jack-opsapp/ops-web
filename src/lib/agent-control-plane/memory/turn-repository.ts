import type { JobConversationAnchor } from "./resolve-conversation";
import {
  CronDatabaseOperationError,
  supabaseDatabaseOperationCause,
} from "@/lib/api/services/cron-workload-error-contract";
import type { ConfirmedCustomerParticipant } from "./resolve-participant-side";

export interface DurableCorrespondenceEvent {
  readonly id: string;
  readonly opportunityId: string;
  readonly activityId: string | null;
  readonly connectionId: string;
  readonly providerMessageId: string;
  readonly direction: "inbound" | "outbound";
  readonly partyRole: string;
  readonly fromEmail: string | null;
}

export interface DurableEmailTurnSource {
  readonly providerSourceId: string;
  readonly providerSourceSha256: string;
  readonly companyId: string;
  readonly activityId: string;
  readonly activityOpportunityId: string | null;
  readonly activityProjectId: string | null;
  readonly connectionId: string;
  readonly providerMessageId: string;
  readonly direction: "inbound" | "outbound";
  readonly deliveredAt: string;
  readonly subject: string | null;
  readonly normalizedSubject: string | null;
  readonly normalizedPlainText: string;
  readonly normalizationRevision: string;
  readonly normalizationStatus: "normalized" | "rejected";
  readonly deliveredContent: {
    readonly mediaType: "text/plain" | "text/html";
    readonly value: string;
    readonly contentCharset: string | null;
    readonly sourceKind:
      "gmail_mime_part" | "microsoft_graph_body" | "ops_rendered_outbound";
    readonly selectionRevision: string;
    readonly providerPartId: string | null;
    readonly providerBodyAttachmentId: string | null;
  };
  readonly fromEmail: string | null;
  readonly recipientIdentities: readonly string[];
  readonly ccRecipientIdentities: readonly string[];
  readonly actorUserId: string | null;
  readonly event: DurableCorrespondenceEvent | null;
  readonly confirmedCustomerParticipants: readonly ConfirmedCustomerParticipant[];
  readonly attachmentEnumerationComplete: boolean;
  readonly attachmentEvidenceIds: readonly string[];
}

export interface DurableEmailTurnSourceKey {
  readonly companyId: string;
  readonly sourceConnectionId: string;
  readonly providerMessageId: string;
  readonly sourceActivityId: string;
}

export interface IngestConversationTurnInput {
  readonly companyId: string;
  readonly job: JobConversationAnchor;
  readonly sourceConnectionId: string;
  readonly providerMessageId: string;
  readonly providerDeliverySourceId: string;
  readonly providerDeliverySourceSha256: string;
  readonly sourceActivityId: string;
}

export interface IngestConversationTurnResult {
  readonly conversationId: string;
  readonly turnId: string;
  readonly inserted: boolean;
}

export interface TurnRepository {
  loadDurableEmailTurnSource(
    input: DurableEmailTurnSourceKey
  ): Promise<DurableEmailTurnSource | null>;
  ingest(
    input: IngestConversationTurnInput
  ): Promise<IngestConversationTurnResult>;
}

export interface TurnRepositoryClient {
  readonly from?: (...args: never[]) => unknown;
  readonly rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export function createTurnRepository(
  client: TurnRepositoryClient
): TurnRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new TypeError("Turn repository client is invalid");
  }

  return Object.freeze({
    async loadDurableEmailTurnSource(
      input: DurableEmailTurnSourceKey
    ): Promise<DurableEmailTurnSource | null> {
      const response = await client.rpc(
        "read_agent_provider_delivery_source_as_system",
        {
          p_company_id: input.companyId,
          p_connection_id: input.sourceConnectionId,
          p_provider_message_id: input.providerMessageId,
          p_source_activity_id: input.sourceActivityId,
        }
      );
      if (response.error) {
        throw new CronDatabaseOperationError(
          "DELIVERED_TURN_SOURCE_READ_FAILED",
          { cause: supabaseDatabaseOperationCause(response) }
        );
      }
      if (!Array.isArray(response.data) || response.data.length === 0) {
        return null;
      }
      if (response.data.length !== 1 || !isRecord(response.data[0])) {
        throw new Error("DELIVERED_TURN_SOURCE_INVALID");
      }
      return durableSourceFromRpc(response.data[0]);
    },

    async ingest(
      input: IngestConversationTurnInput
    ): Promise<IngestConversationTurnResult> {
      const response = await client.rpc(
        "ingest_job_conversation_turn_as_system",
        {
          p_company_id: input.companyId,
          p_job_kind: input.job.kind,
          p_job_id: input.job.id,
          p_source_connection_id: input.sourceConnectionId,
          p_provider_message_id: input.providerMessageId,
          p_provider_delivery_source_id: input.providerDeliverySourceId,
          p_provider_delivery_source_sha256: input.providerDeliverySourceSha256,
          p_source_activity_id: input.sourceActivityId,
        }
      );
      if (response.error) {
        throw new CronDatabaseOperationError("DELIVERED_TURN_INGEST_FAILED", {
          cause: supabaseDatabaseOperationCause(response),
        });
      }
      if (
        !Array.isArray(response.data) ||
        response.data.length !== 1 ||
        !isRecord(response.data[0])
      ) {
        throw new Error("DELIVERED_TURN_INGEST_INVALID");
      }
      const row = response.data[0];
      if (
        typeof row.conversation_id !== "string" ||
        typeof row.turn_id !== "string" ||
        typeof row.inserted !== "boolean"
      ) {
        throw new Error("DELIVERED_TURN_INGEST_INVALID");
      }
      return Object.freeze({
        conversationId: row.conversation_id,
        turnId: row.turn_id,
        inserted: row.inserted,
      });
    },
  });
}

export interface ImmutableTurnProjectionInput {
  readonly id: string;
  readonly subject: string | null;
  readonly participantId: string;
  readonly normalizedPlainText: string;
  readonly attachmentEvidenceIds: readonly string[];
}

export interface TurnRedactionEvent {
  readonly id: string;
  readonly targetTurnId: string;
  readonly kind:
    "content_redacted" | "attachment_redacted" | "participant_pseudonymized";
  readonly replacementPlainText: string | null;
  readonly createdAt: string;
}

export function applyTurnRedactionOverlay(
  turn: ImmutableTurnProjectionInput,
  redactions: readonly TurnRedactionEvent[]
) {
  const applicable = redactions.filter(
    (redaction) => redaction.targetTurnId === turn.id
  );
  const hasContent = applicable.some(
    (redaction) => redaction.kind === "content_redacted"
  );
  const hasAttachment = applicable.some(
    (redaction) => redaction.kind === "attachment_redacted"
  );
  const hasParticipant = applicable.some(
    (redaction) => redaction.kind === "participant_pseudonymized"
  );
  const redactionKinds = Object.freeze(
    [
      hasContent ? "content_redacted" : null,
      hasAttachment ? "attachment_redacted" : null,
      hasParticipant ? "participant_pseudonymized" : null,
    ].filter((kind): kind is TurnRedactionEvent["kind"] => kind !== null)
  );
  return Object.freeze({
    ...turn,
    subject: hasContent ? "[SUBJECT REDACTED]" : turn.subject,
    participantId: hasParticipant
      ? "[PARTICIPANT REDACTED]"
      : turn.participantId,
    normalizedPlainText: hasContent
      ? "[CONTENT REDACTED]"
      : turn.normalizedPlainText,
    attachmentEvidenceIds: hasAttachment
      ? Object.freeze([])
      : Object.freeze([...turn.attachmentEvidenceIds]),
    redactionKinds,
    redacted: redactionKinds.length > 0,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? Object.freeze([...value])
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function durableSourceFromRpc(
  row: Record<string, unknown>
): DurableEmailTurnSource {
  const recipientIdentities = stringArray(row.recipient_identities);
  const ccRecipientIdentities = stringArray(row.cc_recipient_identities);
  const attachmentEvidenceIds = stringArray(row.attachment_evidence_ids);
  const participants = Array.isArray(row.confirmed_customer_participants)
    ? row.confirmed_customer_participants
    : null;
  const event =
    row.source_correspondence_event === null
      ? null
      : isRecord(row.source_correspondence_event)
        ? row.source_correspondence_event
        : undefined;
  const subject = nullableString(row.subject);
  const normalizedSubject = nullableString(row.normalized_subject);
  const fromEmail = nullableString(row.sender_identity);
  const actorUserId = nullableString(row.actor_user_id);
  const activityOpportunityId = nullableString(row.activity_opportunity_id);
  const activityProjectId = nullableString(row.activity_project_id);
  const providerPartId = nullableString(row.provider_part_id);
  const providerBodyAttachmentId = nullableString(
    row.provider_body_attachment_id
  );
  const contentCharset = nullableString(row.content_charset);
  if (
    typeof row.source_id !== "string" ||
    typeof row.source_sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(row.source_sha256) ||
    typeof row.company_id !== "string" ||
    typeof row.source_activity_id !== "string" ||
    typeof row.connection_id !== "string" ||
    typeof row.provider_message_id !== "string" ||
    !(row.direction === "inbound" || row.direction === "outbound") ||
    typeof row.delivered_at !== "string" ||
    subject === undefined ||
    normalizedSubject === undefined ||
    typeof row.normalized_plain_text !== "string" ||
    typeof row.normalization_revision !== "string" ||
    !(
      row.normalization_status === "normalized" ||
      row.normalization_status === "rejected"
    ) ||
    fromEmail === undefined ||
    actorUserId === undefined ||
    activityOpportunityId === undefined ||
    activityProjectId === undefined ||
    !recipientIdentities ||
    !ccRecipientIdentities ||
    !attachmentEvidenceIds ||
    row.attachment_enumeration_complete !== true ||
    !(
      row.content_media_type === "text/plain" ||
      row.content_media_type === "text/html"
    ) ||
    typeof row.content_value !== "string" ||
    ![
      "gmail_mime_part",
      "microsoft_graph_body",
      "ops_rendered_outbound",
    ].includes(String(row.content_source_kind)) ||
    typeof row.content_selection_revision !== "string" ||
    providerPartId === undefined ||
    providerBodyAttachmentId === undefined ||
    contentCharset === undefined ||
    event === undefined ||
    (event !== null &&
      (typeof event.id !== "string" ||
        typeof event.opportunity_id !== "string" ||
        nullableString(event.activity_id) === undefined ||
        typeof event.connection_id !== "string" ||
        typeof event.provider_message_id !== "string" ||
        !(event.direction === "inbound" || event.direction === "outbound") ||
        typeof event.party_role !== "string" ||
        nullableString(event.from_email) === undefined)) ||
    !participants ||
    !participants.every(
      (participant) =>
        isRecord(participant) &&
        ["client", "sub_client", "related_contact"].includes(
          String(participant.kind)
        ) &&
        typeof participant.id === "string"
    )
  ) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }

  return Object.freeze({
    providerSourceId: row.source_id,
    providerSourceSha256: row.source_sha256,
    companyId: row.company_id,
    activityId: row.source_activity_id,
    activityOpportunityId,
    activityProjectId,
    connectionId: row.connection_id,
    providerMessageId: row.provider_message_id,
    direction: row.direction,
    deliveredAt: row.delivered_at,
    subject,
    normalizedSubject,
    normalizedPlainText: row.normalized_plain_text,
    normalizationRevision: row.normalization_revision,
    normalizationStatus: row.normalization_status,
    deliveredContent: Object.freeze({
      mediaType: row.content_media_type,
      value: row.content_value,
      contentCharset,
      sourceKind: row.content_source_kind as
        "gmail_mime_part" | "microsoft_graph_body" | "ops_rendered_outbound",
      selectionRevision: row.content_selection_revision,
      providerPartId,
      providerBodyAttachmentId,
    }),
    fromEmail,
    recipientIdentities,
    ccRecipientIdentities,
    actorUserId,
    event:
      event === null
        ? null
        : Object.freeze({
            id: event.id as string,
            opportunityId: event.opportunity_id as string,
            activityId: nullableString(event.activity_id)!,
            connectionId: event.connection_id as string,
            providerMessageId: event.provider_message_id as string,
            direction: event.direction as "inbound" | "outbound",
            partyRole: event.party_role as string,
            fromEmail: nullableString(event.from_email)!,
          }),
    confirmedCustomerParticipants: Object.freeze(
      participants.map((participant) =>
        Object.freeze({
          kind: (participant as Record<string, unknown>).kind as
            "client" | "sub_client" | "related_contact",
          id: (participant as Record<string, unknown>).id as string,
        })
      )
    ),
    attachmentEnumerationComplete: true,
    attachmentEvidenceIds,
  });
}
