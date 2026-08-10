import type { EmailProvider } from "@/lib/types/email-connection";

export const PROVIDER_DELIVERY_SELECTION_REVISIONS = {
  gmail: "gmail.mime.text-plain-first.charset-decoded.v2",
  microsoft365: "microsoft.graph.body.v1",
  acceptedOutbound: "ops.accepted-send.rendered-body.v1",
} as const;

export type ProviderDeliveryMediaType = "text/plain" | "text/html";

export type ProviderDeliveryContentSourceKind =
  | "gmail_mime_part"
  | "microsoft_graph_body"
  | "ops_rendered_outbound";

/**
 * Exact content and delivery headers selected from one provider message.
 * Display-clean bodies are deliberately absent: this record is provenance,
 * not a UI projection.
 */
export interface ProviderDeliveredContent {
  mediaType: ProviderDeliveryMediaType;
  value: string;
  sourceKind: ProviderDeliveryContentSourceKind;
  selectionRevision: string;
  providerPartId: string | null;
  providerBodyAttachmentId: string | null;
  contentCharset: string | null;
  senderIdentity: string;
  recipientIdentities: string[];
  ccRecipientIdentities: string[];
  subject: string;
  deliveredAt: Date;
  /** Exact Graph timestamps retained until authoritative sync direction exists. */
  providerSentAt?: Date | null;
  providerReceivedAt?: Date | null;
}

export type ProviderDeliveryDirection = "inbound" | "outbound";

export interface ProviderDeliverySource {
  sourceId: string;
  companyId: string;
  connectionId: string;
  provider: EmailProvider;
  providerMessageId: string;
  providerThreadId: string;
  direction: ProviderDeliveryDirection;
  deliveredAt: string;
  subject: string;
  senderIdentity: string;
  recipientIdentities: string[];
  ccRecipientIdentities: string[];
  contentMediaType: ProviderDeliveryMediaType;
  contentValue: string;
  contentCharset: string | null;
  contentSourceKind: ProviderDeliveryContentSourceKind;
  contentSelectionRevision: string;
  providerPartId: string | null;
  providerBodyAttachmentId: string | null;
  attachmentEnumerationComplete: true;
  attachmentEvidenceIds: string[];
  sourceSha256: string;
  capturedAt: string;
}

export interface ProviderDeliverySourceReceipt {
  sourceId: string;
  sourceSha256: string;
  inserted: boolean;
}
