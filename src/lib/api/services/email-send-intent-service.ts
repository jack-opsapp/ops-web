import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailSendIntentStatus =
  | "prepared"
  | "sending"
  | "provider_accepted"
  | "reconciling"
  | "reconciliation_failed"
  | "reconciled"
  | "provider_rejected"
  | "delivery_unknown";

export type EmailSendInitiator =
  | "operator"
  | "phase_c_auto_send"
  | "lifecycle_auto_send";

export type EmailSendLearningAuthority =
  | "operator_authored"
  | "operator_approved"
  | "autonomous";

export interface PrepareEmailSendIntentInput {
  idempotencyKey: string;
  companyId: string;
  actorUserId: string;
  initiatedBy: EmailSendInitiator;
  connectionId: string;
  opportunityId: string;
  sourceEmailThreadId?: string | null;
  replyProviderThreadId?: string | null;
  inReplyTo?: string | null;
  senderSwitched?: boolean;
  toEmails: string[];
  ccEmails?: string[];
  subject: string;
  authoredBody: string;
  renderedBody: string;
  contentType: "text" | "html";
  draftHistoryId?: string | null;
  followUpDraftId?: string | null;
  learningAuthority: EmailSendLearningAuthority;
  signatureId?: string | null;
  signatureContentHash?: string | null;
  renderedBodyHash: string;
  pendingAutoSendId?: string | null;
  pendingAutoSendLeaseToken?: string | null;
}

export interface EmailSendIntent {
  id: string;
  companyId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  actorUserId: string;
  initiatedBy: EmailSendInitiator;
  connectionId: string;
  opportunityId: string;
  assignmentVersion: number;
  assignmentEventId: string | null;
  sourceEmailThreadId: string | null;
  replyProviderThreadId: string | null;
  inReplyTo: string | null;
  senderSwitched: boolean;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  authoredBody: string;
  renderedBody: string;
  contentType: "text" | "html";
  draftHistoryId: string | null;
  followUpDraftId: string | null;
  followUpSourceEventId: string | null;
  followUpRecipientEmail: string | null;
  followUpOutcomeAppliedAt: string | null;
  followUpComebackAt: string | null;
  followUpNotificationId: string | null;
  learningAuthority: EmailSendLearningAuthority;
  actorNameSnapshot: string;
  actorEmailSnapshot: string;
  clientFromAddressSnapshot: string;
  signatureId: string | null;
  signatureContentHash: string | null;
  renderedBodyHash: string;
  pendingAutoSendId: string | null;
  pendingAutoSendLeaseToken: string | null;
  profileTypeSnapshot: string;
  status: EmailSendIntentStatus;
  providerMessageId: string | null;
  acceptedProviderThreadId: string | null;
  providerAcceptedAt: string | null;
  reconciliationAttempts: number;
  reconciliationLeaseToken: string | null;
  reconciliationLeaseExpiresAt: string | null;
  reconciledActivityId: string | null;
  reconciledAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MarkProviderAcceptedInput {
  intentId: string;
  providerMessageId: string;
  providerThreadId: string;
  acceptedAt: Date | string;
}

interface CompleteReconciliationInput {
  intentId: string;
  leaseToken: string;
  activityId: string;
}

interface FailReconciliationInput {
  intentId: string;
  leaseToken: string;
  error: string;
}

interface MarkProviderRejectedInput {
  intentId: string;
  error: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  const normalized = text(value).trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeAddresses(addresses: string[] | undefined): string[] {
  return (addresses ?? []).map((address) => address.trim().toLowerCase());
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function mapIntent(row: Record<string, unknown>): EmailSendIntent {
  return {
    id: text(row.id),
    companyId: text(row.company_id),
    idempotencyKey: text(row.idempotency_key),
    requestFingerprint: text(row.request_fingerprint),
    actorUserId: text(row.actor_user_id),
    initiatedBy: text(row.initiated_by) as EmailSendInitiator,
    connectionId: text(row.connection_id),
    opportunityId: text(row.opportunity_id),
    assignmentVersion: Number(row.assignment_version ?? 0),
    assignmentEventId: nullableText(row.assignment_event_id),
    sourceEmailThreadId: nullableText(row.source_email_thread_id),
    replyProviderThreadId: nullableText(row.reply_provider_thread_id),
    inReplyTo: nullableText(row.in_reply_to),
    senderSwitched: row.sender_switched === true,
    toEmails: stringArray(row.to_emails),
    ccEmails: stringArray(row.cc_emails),
    subject: text(row.subject),
    authoredBody: text(row.authored_body),
    renderedBody: text(row.rendered_body),
    contentType: text(row.content_type) === "html" ? "html" : "text",
    draftHistoryId: nullableText(row.draft_history_id),
    followUpDraftId: nullableText(row.follow_up_draft_id),
    followUpSourceEventId: nullableText(row.follow_up_source_event_id),
    followUpRecipientEmail: nullableText(row.follow_up_recipient_email),
    followUpOutcomeAppliedAt: nullableText(row.follow_up_outcome_applied_at),
    followUpComebackAt: nullableText(row.follow_up_comeback_at),
    followUpNotificationId: nullableText(row.follow_up_notification_id),
    learningAuthority: text(
      row.learning_authority
    ) as EmailSendLearningAuthority,
    actorNameSnapshot: text(row.actor_name_snapshot),
    actorEmailSnapshot: text(row.actor_email_snapshot),
    clientFromAddressSnapshot: text(row.client_from_address_snapshot),
    signatureId: nullableText(row.signature_id),
    signatureContentHash: nullableText(row.signature_content_hash),
    renderedBodyHash: text(row.rendered_body_hash),
    pendingAutoSendId: nullableText(row.pending_auto_send_id),
    pendingAutoSendLeaseToken: nullableText(row.pending_auto_send_lease_token),
    profileTypeSnapshot: text(row.profile_type_snapshot) || "general",
    status: text(row.status) as EmailSendIntentStatus,
    providerMessageId: nullableText(row.provider_message_id),
    acceptedProviderThreadId: nullableText(row.accepted_provider_thread_id),
    providerAcceptedAt: nullableText(row.provider_accepted_at),
    reconciliationAttempts: Number(row.reconciliation_attempts ?? 0),
    reconciliationLeaseToken: nullableText(row.reconciliation_lease_token),
    reconciliationLeaseExpiresAt: nullableText(
      row.reconciliation_lease_expires_at
    ),
    reconciledActivityId: nullableText(row.reconciled_activity_id),
    reconciledAt: nullableText(row.reconciled_at),
    lastError: nullableText(row.last_error),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function canonicalFingerprintPayload(input: PrepareEmailSendIntentInput) {
  return {
    actorUserId: input.actorUserId,
    initiatedBy: input.initiatedBy,
    connectionId: input.connectionId,
    opportunityId: input.opportunityId,
    sourceEmailThreadId: input.sourceEmailThreadId ?? null,
    replyProviderThreadId: input.replyProviderThreadId ?? null,
    inReplyTo: input.inReplyTo ?? null,
    senderSwitched: input.senderSwitched ?? false,
    toEmails: normalizeAddresses(input.toEmails),
    ccEmails: normalizeAddresses(input.ccEmails),
    subject: input.subject,
    authoredBody: input.authoredBody,
    renderedBody: input.renderedBody,
    contentType: input.contentType,
    draftHistoryId: input.draftHistoryId ?? null,
    followUpDraftId: input.followUpDraftId ?? null,
    learningAuthority: input.learningAuthority,
    signatureId: input.signatureId ?? null,
    signatureContentHash: input.signatureContentHash ?? null,
    renderedBodyHash: input.renderedBodyHash,
    pendingAutoSendId: input.pendingAutoSendId ?? null,
    pendingAutoSendLeaseToken: input.pendingAutoSendLeaseToken ?? null,
  };
}

export function buildEmailSendRequestFingerprint(
  input: PrepareEmailSendIntentInput
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalFingerprintPayload(input)))
    .digest("hex");
}

export class EmailSendIntentService {
  constructor(private readonly supabase: SupabaseClient) {}

  async findByIdempotencyKey(input: {
    companyId: string;
    idempotencyKey: string;
  }): Promise<EmailSendIntent | null> {
    const { data, error } = await this.supabase
      .from("email_send_intents")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("idempotency_key", input.idempotencyKey.trim())
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(
        error.message || "EMAIL_SEND_INTENT_IDEMPOTENCY_LOOKUP_FAILED"
      );
    }
    return data ? mapIntent(data as Record<string, unknown>) : null;
  }

  private async requiredRpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<EmailSendIntent> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) {
      throw new Error(error.message || `${name} failed`);
    }
    const row = firstRow(data);
    if (!row) throw new Error(`${name} returned no intent`);
    return mapIntent(row);
  }

  private async nullableRpc(
    name: string,
    args: Record<string, unknown>
  ): Promise<EmailSendIntent | null> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) {
      throw new Error(error.message || `${name} failed`);
    }
    const row = firstRow(data);
    return row && nullableText(row.id) ? mapIntent(row) : null;
  }

  async prepare(input: PrepareEmailSendIntentInput): Promise<EmailSendIntent> {
    const toEmails = normalizeAddresses(input.toEmails);
    const ccEmails = normalizeAddresses(input.ccEmails);
    return this.requiredRpc("prepare_email_send_intent_guarded", {
      p_idempotency_key: input.idempotencyKey,
      p_request_fingerprint: buildEmailSendRequestFingerprint(input),
      p_company_id: input.companyId,
      p_actor_user_id: input.actorUserId,
      p_initiated_by: input.initiatedBy,
      p_connection_id: input.connectionId,
      p_opportunity_id: input.opportunityId,
      p_source_email_thread_id: input.sourceEmailThreadId ?? null,
      p_reply_provider_thread_id: input.replyProviderThreadId ?? null,
      p_in_reply_to: input.inReplyTo ?? null,
      p_sender_switched: input.senderSwitched ?? false,
      p_to_emails: toEmails,
      p_cc_emails: ccEmails,
      p_subject: input.subject,
      p_authored_body: input.authoredBody,
      p_rendered_body: input.renderedBody,
      p_content_type: input.contentType,
      p_draft_history_id: input.draftHistoryId ?? null,
      p_follow_up_draft_id: input.followUpDraftId ?? null,
      p_learning_authority: input.learningAuthority,
      p_signature_id: input.signatureId ?? null,
      p_signature_content_hash: input.signatureContentHash ?? null,
      p_rendered_body_hash: input.renderedBodyHash,
      p_pending_auto_send_id: input.pendingAutoSendId ?? null,
      p_pending_auto_send_lease_token: input.pendingAutoSendLeaseToken ?? null,
    });
  }

  claimProviderDelivery(intentId: string): Promise<EmailSendIntent | null> {
    return this.nullableRpc("claim_email_send_provider_delivery", {
      p_intent_id: intentId,
    });
  }

  markProviderAccepted(
    input: MarkProviderAcceptedInput
  ): Promise<EmailSendIntent> {
    return this.requiredRpc("mark_email_send_provider_accepted", {
      p_intent_id: input.intentId,
      p_provider_message_id: input.providerMessageId,
      p_provider_thread_id: input.providerThreadId,
      p_provider_accepted_at: iso(input.acceptedAt),
    });
  }

  /**
   * Provider acceptance is irreversible. Persist it once, retry that same
   * idempotent transition exactly once on a transient database failure, and
   * never acquire another provider-delivery claim here.
   */
  async persistProviderAcceptance(
    input: MarkProviderAcceptedInput
  ): Promise<EmailSendIntent> {
    try {
      return await this.markProviderAccepted(input);
    } catch {
      return this.markProviderAccepted(input);
    }
  }

  markProviderRejected(
    input: MarkProviderRejectedInput
  ): Promise<EmailSendIntent> {
    return this.requiredRpc("mark_email_send_provider_rejected", {
      p_intent_id: input.intentId,
      p_error: input.error,
    });
  }

  markDeliveryUnknown(
    intentId: string,
    error: string
  ): Promise<EmailSendIntent> {
    return this.requiredRpc("mark_email_send_delivery_unknown", {
      p_intent_id: intentId,
      p_error: error,
    });
  }

  claimReconciliation(intentId: string): Promise<EmailSendIntent | null> {
    return this.nullableRpc("claim_email_send_reconciliation", {
      p_intent_id: intentId,
    });
  }

  claimNextReconciliation(input: {
    failedBefore: Date | string;
    leaseSeconds: number;
  }): Promise<EmailSendIntent | null> {
    return this.nullableRpc("claim_next_email_send_reconciliation", {
      p_failed_before: iso(input.failedBefore),
      p_lease_seconds: input.leaseSeconds,
    });
  }

  completeReconciliation(
    input: CompleteReconciliationInput
  ): Promise<EmailSendIntent> {
    return this.requiredRpc("complete_email_send_reconciliation", {
      p_intent_id: input.intentId,
      p_lease_token: input.leaseToken,
      p_activity_id: input.activityId,
    });
  }

  failReconciliation(input: FailReconciliationInput): Promise<EmailSendIntent> {
    return this.requiredRpc("fail_email_send_reconciliation", {
      p_intent_id: input.intentId,
      p_lease_token: input.leaseToken,
      p_error: input.error,
    });
  }
}
