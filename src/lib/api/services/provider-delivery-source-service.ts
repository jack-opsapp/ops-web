import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES } from "@/lib/agent-control-plane/evidence/limits";
import {
  CORRESPONDENCE_NORMALIZATION_REJECTED_SUBJECT,
  CORRESPONDENCE_NORMALIZATION_REJECTED_TEXT,
  CORRESPONDENCE_NORMALIZATION_REVISION,
  normalizeCorrespondence,
} from "@/lib/agent-control-plane/evidence/normalize-correspondence";
import { hasUnsafeUnicodeControls } from "@/lib/agent-control-plane/evidence/unicode-safety";
import type {
  EmailConnection,
  EmailProvider,
} from "@/lib/types/email-connection";
import { extractEmailAddress } from "@/lib/utils/email-parsing";
import type { EmailAttachmentMeta, NormalizedEmail } from "./email-provider";
import {
  CronDatabaseOperationError,
  supabaseDatabaseOperationCause,
} from "./cron-workload-control-service";
import {
  PROVIDER_DELIVERY_SELECTION_REVISIONS,
  type ProviderDeliveredContent,
  type ProviderDeliveryDirection,
  type ProviderDeliverySource,
  type ProviderDeliverySourceReceipt,
} from "./provider-delivery-source-types";

const ATTACHMENT_ENUMERATION_BUDGET_ID = "ops-enumeration-budget";
const MAX_ATTACHMENT_DESCRIPTORS = 100;
const MAX_IDENTITY_COUNT = 100;
const MAX_IDENTITY_LENGTH = 512;
const MAX_PROVIDER_ID_LENGTH = 512;
const MAX_ATTACHMENT_FILENAME_LENGTH = 4_096;
const MAX_ATTACHMENT_MIME_LENGTH = 255;
const MAX_ATTACHMENT_SOURCE_URL_LENGTH = 8_192;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_IDENTITY = /^[^\s@]+@[^\s@]+$/;

function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertContentBound(value: string): void {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_CONTENT_TOO_LARGE"
    );
  }
}

type DeliverySourceSupabase = Pick<SupabaseClient, "rpc">;

interface ProviderAttachmentEnumerator {
  readonly providerType: EmailProvider;
  getAttachmentsFromMessage(
    messageId: string,
    context?: { fromEmail?: string; date?: Date }
  ): Promise<EmailAttachmentMeta[]>;
}

interface CanonicalProviderAttachmentDescriptor {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  provider_kind: "file" | "inline" | "item" | "reference";
  provider_part_id: string | null;
  content_id: string | null;
  is_inline: boolean;
  source_url: string | null;
  occurred_at: string;
  from_email: string;
}

export interface AcceptedOutboundProviderDeliveryIntent {
  outboundIntentKind: "email_send_intent" | "approved_action_email_intent";
  outboundIntentId: string;
  status: string;
  companyId: string;
  connectionId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
  providerAcceptedAt: string | null;
  senderIdentity: string;
  recipientIdentities: string[];
  ccRecipientIdentities: string[];
  subject: string;
  renderedBody: string;
  renderedBodyHash: string | null;
  contentType: "text" | "html";
}

export class ProviderDeliverySourceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderDeliverySourceError";
  }
}

function requiredTrimmedId(value: string, label: string): string {
  if (
    !value ||
    value !== value.trim() ||
    value.length > MAX_PROVIDER_ID_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new ProviderDeliverySourceError(
      `PROVIDER_DELIVERY_SOURCE_INVALID_${label}`
    );
  }
  return value;
}

function canonicalIdentity(value: string, label: string): string {
  const identity = extractEmailAddress(value).trim().toLowerCase();
  if (
    !identity ||
    identity.length > MAX_IDENTITY_LENGTH ||
    !EMAIL_IDENTITY.test(identity) ||
    hasUnsafeUnicodeControls(identity)
  ) {
    throw new ProviderDeliverySourceError(
      `PROVIDER_DELIVERY_SOURCE_INVALID_${label}`
    );
  }
  return identity;
}

function canonicalIdentities(values: string[], label: string): string[] {
  if (!Array.isArray(values) || values.length > MAX_IDENTITY_COUNT) {
    throw new ProviderDeliverySourceError(
      `PROVIDER_DELIVERY_SOURCE_INVALID_${label}`
    );
  }
  return [
    ...new Set(values.map((value) => canonicalIdentity(value, label))),
  ].sort(bytewiseCompare);
}

function optionalBoundedText(
  value: string | null,
  maxLength: number,
  label: string
): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new ProviderDeliverySourceError(
      `PROVIDER_DELIVERY_SOURCE_INVALID_${label}`
    );
  }
  return value;
}

function canonicalAttachmentDescriptors(input: {
  attachments: EmailAttachmentMeta[];
  messageId: string;
  deliveredAt: Date;
  senderIdentity: string;
}): CanonicalProviderAttachmentDescriptor[] {
  const { attachments } = input;
  if (
    !Array.isArray(attachments) ||
    attachments.length > MAX_ATTACHMENT_DESCRIPTORS ||
    attachments.some(
      (attachment) =>
        attachment.attachmentId === ATTACHMENT_ENUMERATION_BUDGET_ID
    )
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_ATTACHMENT_ENUMERATION_INCOMPLETE"
    );
  }

  const senderIdentity = canonicalIdentity(
    input.senderIdentity,
    "ATTACHMENT_SENDER_IDENTITY"
  );
  const descriptors = new Map<string, CanonicalProviderAttachmentDescriptor>();
  for (const attachment of attachments) {
    if (
      attachment.messageId !== input.messageId ||
      !(attachment.date instanceof Date) ||
      attachment.date.getTime() !== input.deliveredAt.getTime() ||
      canonicalIdentity(attachment.fromEmail, "ATTACHMENT_FROM_EMAIL") !==
        senderIdentity ||
      typeof attachment.filename !== "string" ||
      attachment.filename.length > MAX_ATTACHMENT_FILENAME_LENGTH ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(attachment.filename) ||
      typeof attachment.mimeType !== "string" ||
      attachment.mimeType !== attachment.mimeType.trim() ||
      !attachment.mimeType ||
      attachment.mimeType.length > MAX_ATTACHMENT_MIME_LENGTH ||
      !Number.isSafeInteger(attachment.size) ||
      attachment.size < 0 ||
      !["file", "inline", "item", "reference"].includes(
        attachment.providerKind
      ) ||
      typeof attachment.isInline !== "boolean"
    ) {
      throw new ProviderDeliverySourceError(
        "PROVIDER_DELIVERY_SOURCE_ATTACHMENT_DESCRIPTOR_INVALID"
      );
    }
    const attachmentId = requiredTrimmedId(
      attachment.attachmentId,
      "ATTACHMENT_ID"
    );
    const descriptor: CanonicalProviderAttachmentDescriptor = {
      attachment_id: attachmentId,
      filename: attachment.filename,
      mime_type: attachment.mimeType.toLowerCase(),
      size_bytes: attachment.size,
      provider_kind: attachment.providerKind,
      provider_part_id: optionalBoundedText(
        attachment.providerPartId,
        MAX_PROVIDER_ID_LENGTH,
        "ATTACHMENT_PROVIDER_PART_ID"
      ),
      content_id: optionalBoundedText(
        attachment.contentId,
        MAX_PROVIDER_ID_LENGTH,
        "ATTACHMENT_CONTENT_ID"
      ),
      is_inline: attachment.isInline,
      source_url: attachment.sourceUrl,
      occurred_at: attachment.date.toISOString(),
      from_email: senderIdentity,
    };
    if (
      attachment.sourceUrl !== null &&
      (typeof attachment.sourceUrl !== "string" ||
        !attachment.sourceUrl ||
        attachment.sourceUrl.length > MAX_ATTACHMENT_SOURCE_URL_LENGTH)
    ) {
      throw new ProviderDeliverySourceError(
        "PROVIDER_DELIVERY_SOURCE_ATTACHMENT_DESCRIPTOR_INVALID"
      );
    }
    const existing = descriptors.get(attachmentId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(descriptor)) {
      throw new ProviderDeliverySourceError(
        "PROVIDER_DELIVERY_SOURCE_ATTACHMENT_DESCRIPTOR_CONFLICT"
      );
    }
    descriptors.set(attachmentId, descriptor);
  }
  return [...descriptors.values()].sort((left, right) =>
    bytewiseCompare(left.attachment_id, right.attachment_id)
  );
}

function assertProviderContentMatches(
  provider: EmailProvider,
  source: ProviderDeliveredContent
): void {
  const valid =
    (provider === "gmail" &&
      source.sourceKind === "gmail_mime_part" &&
      typeof source.contentCharset === "string" &&
      /^[a-z0-9._:-]{1,64}$/.test(source.contentCharset) &&
      source.selectionRevision ===
        PROVIDER_DELIVERY_SELECTION_REVISIONS.gmail) ||
    (provider === "microsoft365" &&
      source.sourceKind === "microsoft_graph_body" &&
      source.contentCharset === null &&
      source.selectionRevision ===
        PROVIDER_DELIVERY_SELECTION_REVISIONS.microsoft365);
  if (!valid) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_PROVIDER_CONTENT_CONFLICT"
    );
  }
  if (
    !(source.deliveredAt instanceof Date) ||
    !Number.isFinite(source.deliveredAt.getTime())
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_DELIVERED_AT_INVALID"
    );
  }
}

function authoritativeDeliveredAt(input: {
  provider: EmailProvider;
  direction: ProviderDeliveryDirection;
  source: ProviderDeliveredContent;
}): Date {
  const selected =
    input.provider === "microsoft365"
      ? input.direction === "outbound"
        ? input.source.providerSentAt
        : input.source.providerReceivedAt
      : input.source.deliveredAt;
  if (!(selected instanceof Date) || !Number.isFinite(selected.getTime())) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_DELIVERED_AT_INVALID"
    );
  }
  return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactSingleRow(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && value.length === 1 && isRecord(value[0])
    ? value[0]
    : null;
}

function optionalSingleRow(value: unknown): {
  valid: boolean;
  row: Record<string, unknown> | null;
} {
  if (value === null || (Array.isArray(value) && value.length === 0)) {
    return { valid: true, row: null };
  }
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    return { valid: true, row: value[0] };
  }
  return { valid: false, row: null };
}

async function captureEnvelope(
  supabase: DeliverySourceSupabase,
  input: {
    companyId: string;
    connectionId: string;
    provider: EmailProvider;
    providerMessageId: string;
    providerThreadId: string;
    direction: ProviderDeliveryDirection;
    deliveredAt: Date;
    subject: string;
    senderIdentity: string;
    recipientIdentities: string[];
    ccRecipientIdentities: string[];
    content: Pick<
      ProviderDeliveredContent,
      | "mediaType"
      | "value"
      | "contentCharset"
      | "sourceKind"
      | "selectionRevision"
      | "providerPartId"
      | "providerBodyAttachmentId"
    >;
    outboundIntentKind:
      "email_send_intent" | "approved_action_email_intent" | null;
    outboundIntentId: string | null;
    attachmentDescriptors: CanonicalProviderAttachmentDescriptor[];
  }
): Promise<ProviderDeliverySourceReceipt> {
  assertContentBound(input.content.value);
  let normalizedSubject: string | null;
  let normalizedPlainText: string;
  let normalizationStatus: "normalized" | "rejected";
  try {
    const normalized = normalizeCorrespondence({
      evidenceId: `provider_delivery_source:${input.connectionId}:${input.providerMessageId}`,
      companyId: input.companyId,
      sourceDomain: "email",
      sourceType: "provider_message",
      sourceId: `${input.connectionId}:${input.providerMessageId}`,
      occurredAt: input.deliveredAt.toISOString(),
      subject: input.subject,
      content: {
        mediaType: input.content.mediaType,
        value: input.content.value,
      },
      attachments: [],
    });
    normalizedSubject = normalized.subject;
    normalizedPlainText = normalized.normalizedPlainText;
    normalizationStatus = "normalized";
  } catch {
    normalizedSubject = CORRESPONDENCE_NORMALIZATION_REJECTED_SUBJECT;
    normalizedPlainText = CORRESPONDENCE_NORMALIZATION_REJECTED_TEXT;
    normalizationStatus = "rejected";
  }
  const response = await supabase.rpc(
    "capture_agent_provider_delivery_source_as_system",
    {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_provider: input.provider,
      p_provider_message_id: requiredTrimmedId(
        input.providerMessageId,
        "PROVIDER_MESSAGE_ID"
      ),
      p_provider_thread_id: requiredTrimmedId(
        input.providerThreadId,
        "PROVIDER_THREAD_ID"
      ),
      p_direction: input.direction,
      p_delivered_at: input.deliveredAt.toISOString(),
      p_subject: input.subject,
      p_normalized_subject: normalizedSubject,
      p_normalized_plain_text: normalizedPlainText,
      p_normalization_revision: CORRESPONDENCE_NORMALIZATION_REVISION,
      p_normalization_status: normalizationStatus,
      p_sender_identity: canonicalIdentity(
        input.senderIdentity,
        "SENDER_IDENTITY"
      ),
      p_recipient_identities: canonicalIdentities(
        input.recipientIdentities,
        "RECIPIENT_IDENTITIES"
      ),
      p_cc_recipient_identities: canonicalIdentities(
        input.ccRecipientIdentities,
        "CC_RECIPIENT_IDENTITIES"
      ),
      p_content_media_type: input.content.mediaType,
      p_content_value: input.content.value,
      p_content_charset: input.content.contentCharset,
      p_content_source_kind: input.content.sourceKind,
      p_content_selection_revision: input.content.selectionRevision,
      p_provider_part_id: input.content.providerPartId,
      p_provider_body_attachment_id: input.content.providerBodyAttachmentId,
      p_outbound_intent_kind: input.outboundIntentKind,
      p_outbound_intent_id: input.outboundIntentId,
      p_attachment_enumeration_complete: true,
      p_attachment_descriptors: input.attachmentDescriptors,
    }
  );
  const { data, error } = response;
  if (error) {
    throw new CronDatabaseOperationError(
      `PROVIDER_DELIVERY_SOURCE_CAPTURE_FAILED: ${error.message ?? "unknown error"}`,
      { cause: supabaseDatabaseOperationCause(response) }
    );
  }
  const row = exactSingleRow(data);
  const sourceId = typeof row?.source_id === "string" ? row.source_id : "";
  const sourceSha256 =
    typeof row?.source_sha256 === "string" ? row.source_sha256 : "";
  if (
    !UUID.test(sourceId) ||
    !SHA256.test(sourceSha256) ||
    typeof row?.inserted !== "boolean"
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_CAPTURE_RECEIPT_INVALID"
    );
  }
  return { sourceId, sourceSha256, inserted: row.inserted };
}

async function preflightProviderDeliverySource(input: {
  supabase: DeliverySourceSupabase;
  companyId: string;
  connectionId: string;
  provider: EmailProvider;
  providerMessageId: string;
  providerThreadId: string;
  direction: ProviderDeliveryDirection;
}): Promise<ProviderDeliverySourceReceipt | null> {
  const providerMessageId = requiredTrimmedId(
    input.providerMessageId,
    "PROVIDER_MESSAGE_ID"
  );
  const providerThreadId = requiredTrimmedId(
    input.providerThreadId,
    "PROVIDER_THREAD_ID"
  );
  const response = await input.supabase.rpc(
    "preflight_agent_provider_delivery_source_as_system",
    {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_provider: input.provider,
      p_provider_message_id: providerMessageId,
      p_provider_thread_id: providerThreadId,
      p_direction: input.direction,
    }
  );
  const { data, error } = response;
  if (error) {
    throw new CronDatabaseOperationError(
      `PROVIDER_DELIVERY_SOURCE_PREFLIGHT_FAILED: ${error.message ?? "unknown error"}`,
      { cause: supabaseDatabaseOperationCause(response) }
    );
  }
  const receipt = optionalSingleRow(data);
  if (!receipt.valid) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_PREFLIGHT_RECEIPT_INVALID"
    );
  }
  const row = receipt.row;
  if (!row) return null;

  const sourceId = typeof row.source_id === "string" ? row.source_id : "";
  const sourceSha256 =
    typeof row.source_sha256 === "string" ? row.source_sha256 : "";
  if (
    !UUID.test(sourceId) ||
    !SHA256.test(sourceSha256) ||
    row.company_id !== input.companyId ||
    row.connection_id !== input.connectionId ||
    row.provider_message_id !== providerMessageId ||
    row.provider !== input.provider ||
    row.provider_thread_id !== providerThreadId ||
    row.direction !== input.direction
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_PREFLIGHT_CONFLICT"
    );
  }
  return { sourceId, sourceSha256, inserted: false };
}

/** Capture one exact provider message only after all attachments enumerate. */
export async function captureProviderDeliveredEmailSource(input: {
  supabase: DeliverySourceSupabase;
  connection: EmailConnection;
  provider: ProviderAttachmentEnumerator;
  email: NormalizedEmail;
  direction: ProviderDeliveryDirection;
}): Promise<ProviderDeliverySourceReceipt> {
  const { connection, email, provider } = input;
  if (
    connection.provider !== provider.providerType ||
    !email.providerDeliverySource
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_PROVIDER_CONFLICT"
    );
  }
  const source = email.providerDeliverySource;
  assertProviderContentMatches(connection.provider, source);
  const deliveredAt = authoritativeDeliveredAt({
    provider: connection.provider,
    direction: input.direction,
    source,
  });
  if (
    source.subject !== email.subject ||
    (connection.provider !== "microsoft365" &&
      deliveredAt.getTime() !== email.date.getTime())
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_NORMALIZED_EMAIL_CONFLICT"
    );
  }

  const existing = await preflightProviderDeliverySource({
    supabase: input.supabase,
    companyId: connection.companyId,
    connectionId: connection.id,
    provider: connection.provider,
    providerMessageId: email.id,
    providerThreadId: email.threadId,
    direction: input.direction,
  });
  if (existing) return existing;
  assertContentBound(source.value);

  const attachments = await provider.getAttachmentsFromMessage(email.id, {
    fromEmail: email.from,
    date: deliveredAt,
  });
  const attachmentDescriptors = canonicalAttachmentDescriptors({
    attachments,
    messageId: email.id,
    deliveredAt,
    senderIdentity: source.senderIdentity,
  });
  return captureEnvelope(input.supabase, {
    companyId: connection.companyId,
    connectionId: connection.id,
    provider: connection.provider,
    providerMessageId: email.id,
    providerThreadId: email.threadId,
    direction: input.direction,
    deliveredAt,
    subject: source.subject,
    senderIdentity: source.senderIdentity,
    recipientIdentities: source.recipientIdentities,
    ccRecipientIdentities: source.ccRecipientIdentities,
    content: source,
    outboundIntentKind: null,
    outboundIntentId: null,
    attachmentDescriptors,
  });
}

const ACCEPTED_OUTBOUND_STATUSES = new Set([
  "provider_accepted",
  "reconciling",
  "reconciliation_failed",
  "reconciled",
]);

/**
 * Capture an OPS-originated delivery only after provider acceptance. The
 * immutable source is the rendered provider payload, never the authored draft.
 */
export async function captureAcceptedOutboundProviderDeliverySource(input: {
  supabase: DeliverySourceSupabase;
  connection: EmailConnection;
  intent: AcceptedOutboundProviderDeliveryIntent;
}): Promise<ProviderDeliverySourceReceipt> {
  const { connection, intent } = input;
  if (
    !ACCEPTED_OUTBOUND_STATUSES.has(intent.status) ||
    intent.companyId !== connection.companyId ||
    intent.connectionId !== connection.id ||
    !intent.providerMessageId ||
    !intent.providerThreadId ||
    !intent.providerAcceptedAt ||
    !intent.renderedBodyHash ||
    !UUID.test(intent.outboundIntentId)
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_OUTBOUND_NOT_ACCEPTED"
    );
  }
  const deliveredAt = new Date(intent.providerAcceptedAt);
  if (!Number.isFinite(deliveredAt.getTime())) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_DELIVERED_AT_INVALID"
    );
  }
  assertContentBound(intent.renderedBody);
  const actualRenderedHash = createHash("sha256")
    .update(intent.renderedBody)
    .digest("hex");
  if (actualRenderedHash !== intent.renderedBodyHash) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_RENDERED_BODY_HASH_CONFLICT"
    );
  }

  return captureEnvelope(input.supabase, {
    companyId: intent.companyId,
    connectionId: intent.connectionId,
    provider: connection.provider,
    providerMessageId: intent.providerMessageId,
    providerThreadId: intent.providerThreadId,
    direction: "outbound",
    deliveredAt,
    subject: intent.subject,
    senderIdentity: intent.senderIdentity,
    recipientIdentities: intent.recipientIdentities,
    ccRecipientIdentities: intent.ccRecipientIdentities,
    content: {
      mediaType: intent.contentType === "html" ? "text/html" : "text/plain",
      value: intent.renderedBody,
      contentCharset: null,
      sourceKind: "ops_rendered_outbound",
      selectionRevision: PROVIDER_DELIVERY_SELECTION_REVISIONS.acceptedOutbound,
      providerPartId: null,
      providerBodyAttachmentId: null,
    },
    outboundIntentKind: intent.outboundIntentKind,
    outboundIntentId: intent.outboundIntentId,
    attachmentDescriptors: [],
  });
}

function requiredRowText(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_READ_RECEIPT_INVALID"
    );
  }
  return value;
}

/** Service-only loader used by durable-turn ingestion. */
export async function readProviderDeliverySource(input: {
  supabase: DeliverySourceSupabase;
  companyId: string;
  connectionId: string;
  providerMessageId: string;
  sourceActivityId: string;
}): Promise<ProviderDeliverySource | null> {
  const response = await input.supabase.rpc(
    "read_agent_provider_delivery_source_as_system",
    {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_provider_message_id: input.providerMessageId,
      p_source_activity_id: input.sourceActivityId,
    }
  );
  const { data, error } = response;
  if (error) {
    throw new CronDatabaseOperationError(
      `PROVIDER_DELIVERY_SOURCE_READ_FAILED: ${error.message ?? "unknown error"}`,
      { cause: supabaseDatabaseOperationCause(response) }
    );
  }
  const receipt = optionalSingleRow(data);
  if (!receipt.valid) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_READ_RECEIPT_INVALID"
    );
  }
  const row = receipt.row;
  if (!row) return null;
  const recipientIdentities = row.recipient_identities;
  const ccRecipientIdentities = row.cc_recipient_identities;
  const attachmentEvidenceIds = row.attachment_evidence_ids;
  if (
    !canonicalReadArray(recipientIdentities, EMAIL_IDENTITY) ||
    !canonicalReadArray(ccRecipientIdentities, EMAIL_IDENTITY) ||
    !canonicalReadArray(
      attachmentEvidenceIds,
      /^email_attachment:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    ) ||
    row.attachment_enumeration_complete !== true
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_READ_RECEIPT_INVALID"
    );
  }
  const source: ProviderDeliverySource = {
    sourceId: requiredRowText(row, "source_id"),
    companyId: requiredRowText(row, "company_id"),
    connectionId: requiredRowText(row, "connection_id"),
    provider: requiredRowText(row, "provider") as EmailProvider,
    providerMessageId: requiredRowText(row, "provider_message_id"),
    providerThreadId: requiredRowText(row, "provider_thread_id"),
    direction: requiredRowText(row, "direction") as ProviderDeliveryDirection,
    deliveredAt: requiredRowText(row, "delivered_at"),
    subject: requiredRowText(row, "subject"),
    senderIdentity: requiredRowText(row, "sender_identity"),
    recipientIdentities: recipientIdentities as string[],
    ccRecipientIdentities: ccRecipientIdentities as string[],
    contentMediaType: requiredRowText(
      row,
      "content_media_type"
    ) as ProviderDeliverySource["contentMediaType"],
    contentValue: requiredRowText(row, "content_value"),
    contentCharset:
      typeof row.content_charset === "string" ? row.content_charset : null,
    contentSourceKind: requiredRowText(
      row,
      "content_source_kind"
    ) as ProviderDeliverySource["contentSourceKind"],
    contentSelectionRevision: requiredRowText(
      row,
      "content_selection_revision"
    ),
    providerPartId:
      typeof row.provider_part_id === "string" ? row.provider_part_id : null,
    providerBodyAttachmentId:
      typeof row.provider_body_attachment_id === "string"
        ? row.provider_body_attachment_id
        : null,
    attachmentEnumerationComplete: true,
    attachmentEvidenceIds: attachmentEvidenceIds as string[],
    sourceSha256: requiredRowText(row, "source_sha256"),
    capturedAt: requiredRowText(row, "captured_at"),
  };
  if (
    !UUID.test(source.sourceId) ||
    !SHA256.test(source.sourceSha256) ||
    !["gmail", "microsoft365"].includes(source.provider) ||
    !["inbound", "outbound"].includes(source.direction) ||
    !["text/plain", "text/html"].includes(source.contentMediaType)
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_READ_RECEIPT_INVALID"
    );
  }
  if (
    source.companyId !== input.companyId ||
    source.connectionId !== input.connectionId ||
    source.providerMessageId !== input.providerMessageId ||
    Buffer.byteLength(source.contentValue, "utf8") >
      MAX_EXACT_CORRESPONDENCE_CONTENT_BYTES ||
    !Number.isFinite(new Date(source.deliveredAt).getTime()) ||
    !Number.isFinite(new Date(source.capturedAt).getTime()) ||
    !providerContentCombinationIsValid(source)
  ) {
    throw new ProviderDeliverySourceError(
      "PROVIDER_DELIVERY_SOURCE_READ_RECEIPT_INVALID"
    );
  }
  return source;
}

function canonicalReadArray(
  value: unknown,
  pattern: RegExp
): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_IDENTITY_COUNT) return false;
  let previous: string | null = null;
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !pattern.test(item) ||
      (previous !== null && bytewiseCompare(item, previous) <= 0)
    ) {
      return false;
    }
    previous = item;
  }
  return true;
}

function providerContentCombinationIsValid(
  source: ProviderDeliverySource
): boolean {
  if (source.contentSourceKind === "ops_rendered_outbound") {
    return (
      source.direction === "outbound" &&
      source.contentCharset === null &&
      source.contentSelectionRevision ===
        PROVIDER_DELIVERY_SELECTION_REVISIONS.acceptedOutbound
    );
  }
  return (
    (source.provider === "gmail" &&
      source.contentSourceKind === "gmail_mime_part" &&
      typeof source.contentCharset === "string" &&
      /^[a-z0-9._:-]{1,64}$/.test(source.contentCharset) &&
      source.contentSelectionRevision ===
        PROVIDER_DELIVERY_SELECTION_REVISIONS.gmail) ||
    (source.provider === "microsoft365" &&
      source.contentSourceKind === "microsoft_graph_body" &&
      source.contentCharset === null &&
      source.contentSelectionRevision ===
        PROVIDER_DELIVERY_SELECTION_REVISIONS.microsoft365)
  );
}
