import "server-only";

import { createHash } from "node:crypto";

import type {
  CorrespondenceAttachmentInput,
  CorrespondenceContentInput,
  CorrespondenceRedactionKind,
  DeliveredCorrespondenceMetadata,
  NormalizedCorrespondenceAttachment,
  NormalizedCorrespondenceEvidence,
} from "./types";
import { MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES } from "./limits";
import { hasUnsafeUnicodeControls } from "./unicode-safety";
import type {
  EvidenceTrust,
  SourceVersion,
} from "@/lib/agent-control-plane/contracts";

export const SHA256_SOURCE_VERSION_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const CANONICAL_RFC3339_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface HashableOriginalCorrespondence {
  readonly subject: string | null;
  readonly content: CorrespondenceContentInput;
  readonly attachments: readonly CorrespondenceAttachmentInput[];
}

interface HashableNormalizedCorrespondenceEnvelope {
  readonly evidenceId: string;
  readonly companyId: string;
  readonly sourceDomain: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly trust: EvidenceTrust;
  readonly originalContentHash: string;
  readonly subject: string | null;
  readonly normalizedPlainText: string;
  readonly attachments: readonly NormalizedCorrespondenceAttachment[];
  readonly delivery: DeliveredCorrespondenceMetadata | null;
  readonly redactionKinds: readonly CorrespondenceRedactionKind[];
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalOriginalAttachment(
  attachment: CorrespondenceAttachmentInput
) {
  return {
    attachment_id: attachment.attachmentId,
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes,
    inline: attachment.inline,
    content_hash: attachment.contentHash,
  };
}

function canonicalNormalizedAttachment(
  attachment: NormalizedCorrespondenceAttachment
) {
  return {
    attachment_id: attachment.attachmentId,
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes,
    inline: attachment.inline,
    content_hash: attachment.contentHash,
  };
}

function canonicalDelivery(delivery: DeliveredCorrespondenceMetadata | null) {
  if (delivery === null) return null;
  return {
    side: delivery.side,
    sender_identity: delivery.senderIdentity,
    participant_resolution_status: delivery.participantResolutionStatus,
    direction: delivery.direction,
    source_activity_id: delivery.sourceActivityId,
    source_correspondence_event_id: delivery.sourceCorrespondenceEventId,
    recipient_identities: delivery.recipientIdentities,
    cc_recipient_identities: delivery.ccRecipientIdentities,
  };
}

/** Canonical v1 representation of the validated source before normalization. */
export function canonicalOriginalCorrespondenceContent(
  source: HashableOriginalCorrespondence
): string {
  return JSON.stringify({
    schema: "ops.correspondence.original.v1",
    subject: source.subject,
    content: {
      media_type: source.content.mediaType,
      value: source.content.value,
    },
    attachments: source.attachments.map(canonicalOriginalAttachment),
  });
}

export function hashOriginalCorrespondenceContent(
  source: HashableOriginalCorrespondence
): string {
  return sha256(canonicalOriginalCorrespondenceContent(source));
}

/**
 * Canonical v3 normalized envelope. Provenance, delivery identity, redaction
 * state, occurrence time, trust, and the exact-source hash are deliberately
 * inside the integrity boundary.
 */
export function canonicalNormalizedCorrespondenceEnvelope(
  evidence: HashableNormalizedCorrespondenceEnvelope
): string {
  return JSON.stringify({
    schema: "ops.correspondence.normalized.v3",
    evidence_id: evidence.evidenceId,
    company_id: evidence.companyId,
    source_domain: evidence.sourceDomain,
    source_type: evidence.sourceType,
    source_id: evidence.sourceId,
    occurred_at: evidence.occurredAt,
    trust: evidence.trust,
    original_content_hash: evidence.originalContentHash,
    subject: evidence.subject,
    normalized_plain_text: evidence.normalizedPlainText,
    attachments: evidence.attachments.map(canonicalNormalizedAttachment),
    delivery: canonicalDelivery(evidence.delivery),
    redaction_kinds: evidence.redactionKinds,
  });
}

export function hashNormalizedCorrespondenceEnvelope(
  evidence: HashableNormalizedCorrespondenceEnvelope
): string {
  return sha256(canonicalNormalizedCorrespondenceEnvelope(evidence));
}

export function sourceVersionForCorrespondence(input: {
  readonly sourceDomain: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly originalContentHash: string;
}): SourceVersion {
  if (!SHA256_SOURCE_VERSION_PATTERN.test(input.originalContentHash)) {
    throw new TypeError("Correspondence original content hash is invalid");
  }
  return Object.freeze({
    source_domain: input.sourceDomain,
    source_type: input.sourceType,
    source_id: input.sourceId,
    version: input.originalContentHash,
  });
}

export function isCanonicalRfc3339UtcTimestamp(
  value: unknown
): value is string {
  if (typeof value !== "string" || !CANONICAL_RFC3339_UTC_PATTERN.test(value)) {
    return false;
  }
  const timestamp = new Date(value);
  return (
    Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isEvidenceTrust(value: unknown): value is EvidenceTrust {
  return (
    typeof value === "string" &&
    [
      "authoritative_ops",
      "delivered_correspondence",
      "operator_document",
      "model_transcribed",
    ].includes(value)
  );
}

function isBoundedNonBlankString(
  value: unknown,
  maximumLength: number
): value is string {
  return (
    isString(value) &&
    value.length <= maximumLength &&
    value.trim().length > 0 &&
    !hasUnsafeUnicodeControls(value)
  );
}

function isNullableBoundedString(
  value: unknown,
  maximumLength: number
): value is string | null {
  return (
    value === null ||
    (isString(value) &&
      value.length <= maximumLength &&
      !hasUnsafeUnicodeControls(value))
  );
}

function isNullableBoundedNonBlankString(
  value: unknown,
  maximumLength: number
): value is string | null {
  return value === null || isBoundedNonBlankString(value, maximumLength);
}

function isNormalizedAttachment(
  value: unknown
): value is NormalizedCorrespondenceAttachment {
  if (typeof value !== "object" || value === null) return false;
  const attachment = value as Record<string, unknown>;
  return (
    isBoundedNonBlankString(attachment.attachmentId, 512) &&
    isNullableBoundedNonBlankString(attachment.filename, 2_048) &&
    isNullableBoundedString(attachment.mimeType, 2_048) &&
    (attachment.sizeBytes === null ||
      (typeof attachment.sizeBytes === "number" &&
        Number.isSafeInteger(attachment.sizeBytes) &&
        attachment.sizeBytes >= 0)) &&
    typeof attachment.inline === "boolean" &&
    (attachment.contentHash === null ||
      (isString(attachment.contentHash) &&
        SHA256_SOURCE_VERSION_PATTERN.test(attachment.contentHash)))
  );
}

function attachmentsAreCanonical(
  attachments: readonly NormalizedCorrespondenceAttachment[]
): boolean {
  if (attachments.length > 100) return false;
  let previousKey: string | null = null;
  const attachmentIds = new Set<string>();
  for (const attachment of attachments) {
    if (!isNormalizedAttachment(attachment)) return false;
    if (attachmentIds.has(attachment.attachmentId)) return false;
    attachmentIds.add(attachment.attachmentId);
    const key = `${attachment.attachmentId}\u0000${attachment.filename ?? ""}`;
    if (previousKey !== null && bytewiseCompare(key, previousKey) <= 0) {
      return false;
    }
    previousKey = key;
  }
  return true;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REDACTION_KINDS: readonly CorrespondenceRedactionKind[] = [
  "content_redacted",
  "attachment_redacted",
  "participant_pseudonymized",
];

function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function identityArrayIsCanonical(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  let previous: string | null = null;
  for (const identity of value) {
    if (!isBoundedNonBlankString(identity, 512)) return false;
    if (previous !== null && bytewiseCompare(identity, previous) <= 0) {
      return false;
    }
    previous = identity;
  }
  return true;
}

function redactionKindsAreCanonical(
  value: unknown
): value is readonly CorrespondenceRedactionKind[] {
  if (!Array.isArray(value)) return false;
  const indexes = value.map((kind) => REDACTION_KINDS.indexOf(kind));
  return indexes.every(
    (index, position) =>
      index >= 0 && (position === 0 || index > indexes[position - 1]!)
  );
}

function isDeliveredMetadata(
  value: unknown
): value is DeliveredCorrespondenceMetadata {
  if (typeof value !== "object" || value === null) return false;
  const delivery = value as Record<string, unknown>;
  const status = delivery.participantResolutionStatus;
  const side = delivery.side;
  return (
    (side === "user" || side === "assistant" || side === null) &&
    (status === "resolved" ||
      status === "unresolved" ||
      status === "ambiguous") &&
    ((status === "resolved" && side !== null) ||
      (status !== "resolved" && side === null)) &&
    (status !== "resolved" ||
      (delivery.direction === "inbound" && side === "user") ||
      (delivery.direction === "outbound" && side === "assistant")) &&
    isBoundedNonBlankString(delivery.senderIdentity, 512) &&
    (delivery.direction === "inbound" || delivery.direction === "outbound") &&
    (delivery.sourceActivityId === null ||
      (isString(delivery.sourceActivityId) &&
        UUID_PATTERN.test(delivery.sourceActivityId))) &&
    (delivery.sourceCorrespondenceEventId === null ||
      (isString(delivery.sourceCorrespondenceEventId) &&
        UUID_PATTERN.test(delivery.sourceCorrespondenceEventId))) &&
    (delivery.sourceActivityId !== null ||
      delivery.sourceCorrespondenceEventId !== null) &&
    identityArrayIsCanonical(delivery.recipientIdentities) &&
    identityArrayIsCanonical(delivery.ccRecipientIdentities)
  );
}

/** Validate a persisted normalized envelope before any content reaches a prompt. */
export function hasValidCorrespondenceIntegrity(
  value: unknown
): value is NormalizedCorrespondenceEvidence {
  if (typeof value !== "object" || value === null) return false;
  const evidence = value as Record<string, unknown>;
  if (
    !isBoundedNonBlankString(evidence.evidenceId, 512) ||
    !isBoundedNonBlankString(evidence.companyId, 512) ||
    !isBoundedNonBlankString(evidence.sourceDomain, 512) ||
    !isBoundedNonBlankString(evidence.sourceType, 512) ||
    !isBoundedNonBlankString(evidence.sourceId, 512) ||
    !isCanonicalRfc3339UtcTimestamp(evidence.occurredAt) ||
    !isEvidenceTrust(evidence.trust) ||
    !isNullableBoundedString(evidence.subject, 2_048) ||
    !isString(evidence.normalizedPlainText) ||
    Buffer.byteLength(evidence.normalizedPlainText, "utf8") >
      MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES ||
    hasUnsafeUnicodeControls(evidence.normalizedPlainText, {
      allowTextWhitespace: true,
    }) ||
    !Array.isArray(evidence.attachments) ||
    !attachmentsAreCanonical(evidence.attachments) ||
    !(evidence.delivery === null || isDeliveredMetadata(evidence.delivery)) ||
    !redactionKindsAreCanonical(evidence.redactionKinds) ||
    !isString(evidence.originalContentHash) ||
    !SHA256_SOURCE_VERSION_PATTERN.test(evidence.originalContentHash) ||
    !isString(evidence.normalizedContentHash) ||
    !SHA256_SOURCE_VERSION_PATTERN.test(evidence.normalizedContentHash) ||
    typeof evidence.sourceVersion !== "object" ||
    evidence.sourceVersion === null
  ) {
    return false;
  }

  const version = evidence.sourceVersion as Record<string, unknown>;
  if (
    version.source_domain !== evidence.sourceDomain ||
    version.source_type !== evidence.sourceType ||
    version.source_id !== evidence.sourceId ||
    version.version !== evidence.originalContentHash
  ) {
    return false;
  }

  try {
    return (
      hashNormalizedCorrespondenceEnvelope({
        evidenceId: evidence.evidenceId,
        companyId: evidence.companyId,
        sourceDomain: evidence.sourceDomain,
        sourceType: evidence.sourceType,
        sourceId: evidence.sourceId,
        occurredAt: evidence.occurredAt,
        trust: evidence.trust,
        originalContentHash: evidence.originalContentHash,
        subject: evidence.subject,
        normalizedPlainText: evidence.normalizedPlainText,
        attachments: evidence.attachments,
        delivery: evidence.delivery,
        redactionKinds: evidence.redactionKinds,
      }) === evidence.normalizedContentHash
    );
  } catch {
    return false;
  }
}
