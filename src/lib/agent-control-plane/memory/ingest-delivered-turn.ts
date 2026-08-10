import { createHash } from "node:crypto";

import { normalizeCorrespondence } from "../evidence/normalize-correspondence";
import { hasUnsafeUnicodeControls } from "../evidence/unicode-safety";
import { resolveConversationAnchor } from "./resolve-conversation";
import { resolveParticipantSide } from "./resolve-participant-side";
import type {
  DurableEmailTurnSource,
  DurableEmailTurnSourceKey,
  IngestConversationTurnResult,
  TurnRepository,
} from "./turn-repository";

export interface DeliveredEmailSourceEnvelope {
  readonly subject: string | null;
  readonly recipientIdentities: readonly string[];
  readonly ccRecipientIdentities: readonly string[];
  readonly normalizedPlainText: string;
  readonly originalContentHash: string;
  readonly attachmentEvidenceIds: readonly string[];
}

export function buildDeliveredEmailSourceEnvelope(
  source: DurableEmailTurnSource
): DeliveredEmailSourceEnvelope {
  const attachmentEvidenceIds = canonicalIdentities(
    source.attachmentEvidenceIds,
    "attachment",
    (identity) =>
      /^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        identity
      )
  );
  const recipientIdentities = canonicalIdentities(
    source.recipientIdentities,
    "recipient"
  );
  const ccRecipientIdentities = canonicalIdentities(
    source.ccRecipientIdentities,
    "cc recipient"
  );
  if (
    source.attachmentEnumerationComplete !== true ||
    !source.deliveredContent ||
    !["text/plain", "text/html"].includes(source.deliveredContent.mediaType) ||
    ![
      "gmail_mime_part",
      "microsoft_graph_body",
      "ops_rendered_outbound",
    ].includes(source.deliveredContent.sourceKind) ||
    !source.deliveredContent.selectionRevision.trim()
  ) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }

  const participant = resolveParticipantSide({
    direction: source.direction,
    partyRole: source.event?.partyRole ?? null,
    deliverySourceKind: source.deliveredContent.sourceKind,
    sourceActivityId: source.activityId,
    senderEmail: source.fromEmail,
    actorUserId: source.actorUserId,
    confirmedCustomerParticipants: source.confirmedCustomerParticipants,
  });
  const normalized = normalizeCorrespondence({
    evidenceId: `delivered_turn:${source.activityId}`,
    companyId: source.companyId,
    sourceDomain: "email",
    sourceType: "provider_message",
    sourceId: `${source.connectionId}:${source.providerMessageId}`,
    occurredAt: source.deliveredAt,
    subject: source.subject,
    content: {
      mediaType: source.deliveredContent.mediaType,
      value: source.deliveredContent.value,
    },
    attachments: [],
  });
  const subject = normalized.subject;
  const canonicalSource = JSON.stringify({
    schema: "ops.provider-delivered-turn.v1",
    company_id: source.companyId,
    source_activity_id: source.activityId,
    activity_opportunity_id: source.activityOpportunityId,
    activity_project_id: source.activityProjectId,
    connection_id: source.connectionId,
    provider_message_id: source.providerMessageId,
    direction: source.direction,
    delivered_at: source.deliveredAt,
    subject,
    sender_identity: source.fromEmail,
    participant: {
      side: participant.side,
      participant_id: participant.participantId,
      status: participant.status,
      revision: participant.revision,
    },
    recipient_identities: recipientIdentities,
    cc_recipient_identities: ccRecipientIdentities,
    content: {
      media_type: source.deliveredContent.mediaType,
      value: source.deliveredContent.value,
      content_charset: source.deliveredContent.contentCharset,
      source_kind: source.deliveredContent.sourceKind,
      selection_revision: source.deliveredContent.selectionRevision,
      provider_part_id: source.deliveredContent.providerPartId,
      provider_body_attachment_id:
        source.deliveredContent.providerBodyAttachmentId,
    },
    source_correspondence_event: source.event
      ? {
          id: source.event.id,
          opportunity_id: source.event.opportunityId,
          activity_id: source.event.activityId,
          connection_id: source.event.connectionId,
          provider_message_id: source.event.providerMessageId,
          direction: source.event.direction,
          party_role: source.event.partyRole,
          from_email: source.event.fromEmail,
        }
      : null,
    attachment_enumeration_complete: true,
    attachment_evidence_ids: attachmentEvidenceIds,
  });

  return Object.freeze({
    subject,
    recipientIdentities,
    ccRecipientIdentities,
    normalizedPlainText: normalized.normalizedPlainText,
    originalContentHash: `sha256:${createHash("sha256")
      .update(canonicalSource, "utf8")
      .digest("hex")}`,
    attachmentEvidenceIds,
  });
}

export async function ingestDeliveredTurn(input: {
  readonly repository: TurnRepository;
  readonly source: DurableEmailTurnSourceKey;
}): Promise<IngestConversationTurnResult> {
  const source = await input.repository.loadDurableEmailTurnSource(
    input.source
  );
  if (!source) throw new Error("DELIVERED_TURN_SOURCE_NOT_FOUND");
  try {
    assertSourceMatchesKey(source, input.source);
    const job = resolveConversationAnchor({
      eventOpportunityId: source.event?.opportunityId ?? null,
      activityOpportunityId: source.activityOpportunityId,
      activityProjectId: source.activityProjectId,
    });
    const participant = resolveParticipantSide({
      direction: source.direction,
      partyRole: source.event?.partyRole ?? null,
      deliverySourceKind: source.deliveredContent.sourceKind,
      sourceActivityId: source.activityId,
      senderEmail: source.fromEmail,
      actorUserId: source.actorUserId,
      confirmedCustomerParticipants: source.confirmedCustomerParticipants,
    });
    const envelope = buildDeliveredEmailSourceEnvelope(source);
    return await input.repository.ingest({
      companyId: source.companyId,
      job,
      side: participant.side,
      participantId: participant.participantId,
      participantResolutionStatus: participant.status,
      participantResolutionRevision: participant.revision,
      direction: source.direction,
      channel: "email",
      deliveredAt: source.deliveredAt,
      sourceConnectionId: source.connectionId,
      providerMessageId: source.providerMessageId,
      sourceActivityId: source.activityId,
      sourceCorrespondenceEventId: source.event?.id ?? null,
      subject: envelope.subject,
      recipientIdentities: envelope.recipientIdentities,
      ccRecipientIdentities: envelope.ccRecipientIdentities,
      normalizedPlainText: envelope.normalizedPlainText,
      originalContentHash: envelope.originalContentHash,
      attachmentEvidenceIds: envelope.attachmentEvidenceIds,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "DELIVERED_TURN_SOURCE_INVALID" ||
        error.message === "DELIVERED_TURN_SIDE_INVALID")
    ) {
      throw error;
    }
    throw new Error("DELIVERED_TURN_SOURCE_INVALID", { cause: error });
  }
}

function canonicalIdentities(
  values: readonly string[],
  label: string,
  predicate: (identity: string) => boolean = () => true
): readonly string[] {
  if (!Array.isArray(values) || values.length > 100) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }
  const identities = values.map((value) => {
    const identity = typeof value === "string" ? value.trim() : "";
    if (
      !identity ||
      Buffer.byteLength(identity, "utf8") > 512 ||
      hasUnsafeUnicodeControls(identity) ||
      !predicate(identity)
    ) {
      throw new Error(`DELIVERED_TURN_SOURCE_INVALID:${label}`);
    }
    return identity;
  });
  return Object.freeze(
    Array.from(new Set(identities)).sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
    )
  );
}

function assertSourceMatchesKey(
  source: DurableEmailTurnSource,
  key: DurableEmailTurnSourceKey
): void {
  const keyMismatch =
    source.companyId !== key.companyId ||
    source.connectionId !== key.sourceConnectionId ||
    source.providerMessageId !== key.providerMessageId ||
    source.activityId !== key.sourceActivityId;
  const eventMismatch = source.event
    ? source.event.activityId !== source.activityId ||
      source.event.connectionId !== source.connectionId ||
      source.event.providerMessageId !== source.providerMessageId ||
      source.event.direction !== source.direction
    : source.direction !== "outbound" ||
      source.activityOpportunityId !== null ||
      !source.activityProjectId ||
      !source.actorUserId;
  if (keyMismatch || eventMismatch) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }
}
