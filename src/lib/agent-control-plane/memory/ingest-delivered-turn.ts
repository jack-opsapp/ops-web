import {
  CORRESPONDENCE_NORMALIZATION_REJECTED_SUBJECT,
  CORRESPONDENCE_NORMALIZATION_REJECTED_TEXT,
  CORRESPONDENCE_NORMALIZATION_REVISION,
  normalizeCorrespondence,
} from "../evidence/normalize-correspondence";
import { hasUnsafeUnicodeControls } from "../evidence/unicode-safety";
import { resolveConversationAnchor } from "./resolve-conversation";
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
    !sameStrings(attachmentEvidenceIds, source.attachmentEvidenceIds) ||
    !sameStrings(recipientIdentities, source.recipientIdentities) ||
    !sameStrings(ccRecipientIdentities, source.ccRecipientIdentities) ||
    source.attachmentEnumerationComplete !== true ||
    !source.deliveredContent ||
    !["text/plain", "text/html"].includes(source.deliveredContent.mediaType) ||
    ![
      "gmail_mime_part",
      "microsoft_graph_body",
      "ops_rendered_outbound",
    ].includes(source.deliveredContent.sourceKind) ||
    !source.deliveredContent.selectionRevision.trim() ||
    source.normalizationRevision !== CORRESPONDENCE_NORMALIZATION_REVISION ||
    !["normalized", "rejected"].includes(source.normalizationStatus)
  ) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }
  const occurredAt = canonicalDeliveredAt(source.deliveredAt);
  let normalized: ReturnType<typeof normalizeCorrespondence> | null = null;
  try {
    normalized = normalizeCorrespondence({
      evidenceId: `delivered_turn:${source.activityId}`,
      companyId: source.companyId,
      sourceDomain: "email",
      sourceType: "provider_message",
      sourceId: `${source.connectionId}:${source.providerMessageId}`,
      occurredAt,
      subject: source.subject,
      content: {
        mediaType: source.deliveredContent.mediaType,
        value: source.deliveredContent.value,
      },
      attachments: [],
    });
  } catch {
    normalized = null;
  }
  const projectionMatches =
    source.normalizationStatus === "normalized"
      ? normalized !== null &&
        normalized.subject === source.normalizedSubject &&
        normalized.normalizedPlainText === source.normalizedPlainText
      : normalized === null &&
        source.normalizedSubject ===
          CORRESPONDENCE_NORMALIZATION_REJECTED_SUBJECT &&
        source.normalizedPlainText ===
          CORRESPONDENCE_NORMALIZATION_REJECTED_TEXT;
  if (!projectionMatches) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }

  return Object.freeze({
    subject: source.normalizedSubject,
    recipientIdentities,
    ccRecipientIdentities,
    normalizedPlainText: source.normalizedPlainText,
    originalContentHash: source.providerSourceSha256,
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
    buildDeliveredEmailSourceEnvelope(source);
    return await input.repository.ingest({
      companyId: source.companyId,
      job,
      sourceConnectionId: source.connectionId,
      providerMessageId: source.providerMessageId,
      providerDeliverySourceId: source.providerSourceId,
      providerDeliverySourceSha256: source.providerSourceSha256,
      sourceActivityId: source.activityId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "DELIVERED_TURN_SOURCE_INVALID"
    ) {
      throw error;
    }
    throw new Error("DELIVERED_TURN_SOURCE_INVALID", { cause: error });
  }
}

function canonicalDeliveredAt(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  ) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("DELIVERED_TURN_SOURCE_INVALID");
  }
  return parsed.toISOString();
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      source.providerSourceId
    ) ||
    !/^sha256:[0-9a-f]{64}$/.test(source.providerSourceSha256) ||
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
