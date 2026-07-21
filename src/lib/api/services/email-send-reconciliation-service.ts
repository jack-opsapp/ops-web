import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailConnection } from "@/lib/types/email-connection";
import { EmailOutboundLearningService } from "./email-outbound-learning-service";
import type { EmailProviderInterface } from "./email-provider";
import { applyEmailProviderLabelWriteback } from "./email-provider-label-writeback";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";
import type { EmailSendIntent } from "./email-send-intent-service";
import { EmailThreadService } from "./email-thread-service";
import { OpportunityLifecycleService } from "./opportunity-lifecycle-service";

export interface EmailSendReconciliationResult {
  activityId: string;
  labels: string[];
  latestDirection: string;
  opportunityId: string;
  providerMessageId: string;
  providerThreadId: string;
  sentAt: string;
}

interface ReconcileEmailSendInput {
  supabase: SupabaseClient;
  intent: EmailSendIntent;
  connection: EmailConnection;
  provider: Pick<EmailProviderInterface, "applyLabel">;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}

function required(value: string | null, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value;
}

/**
 * Idempotently materialize one provider-accepted intent into OPS. Every write
 * is anchored to the immutable provider connection/message identity and the
 * lead/actor captured before delivery.
 */
export async function reconcileEmailSend(
  input: ReconcileEmailSendInput
): Promise<EmailSendReconciliationResult> {
  const { supabase, intent, connection, provider } = input;
  const providerMessageId = required(
    intent.providerMessageId,
    "EMAIL_SEND_PROVIDER_MESSAGE_ID_MISSING"
  );
  const providerThreadId = required(
    intent.acceptedProviderThreadId,
    "EMAIL_SEND_PROVIDER_THREAD_ID_MISSING"
  );
  const sentAt = required(
    intent.providerAcceptedAt,
    "EMAIL_SEND_PROVIDER_ACCEPTED_AT_MISSING"
  );

  if (
    connection.id !== intent.connectionId ||
    connection.companyId !== intent.companyId
  ) {
    throw new Error("EMAIL_SEND_RECONCILIATION_CONNECTION_CONFLICT");
  }

  const { error: threadClaimError } = await supabase
    .from("opportunity_email_threads")
    .upsert(
      {
        opportunity_id: intent.opportunityId,
        thread_id: providerThreadId,
        connection_id: intent.connectionId,
      },
      { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
    );
  if (threadClaimError) {
    throw new Error(
      `Sent email thread claim failed: ${threadClaimError.message ?? "unknown error"}`
    );
  }

  const { data: canonicalThreadLink, error: canonicalThreadLinkError } =
    await supabase
      .from("opportunity_email_threads")
      .select("opportunity_id")
      .eq("thread_id", providerThreadId)
      .eq("connection_id", intent.connectionId)
      .limit(1)
      .maybeSingle();
  if (canonicalThreadLinkError) {
    throw new Error(
      `Sent email canonical thread lookup failed: ${canonicalThreadLinkError.message ?? "unknown error"}`
    );
  }
  if (canonicalThreadLink?.opportunity_id !== intent.opportunityId) {
    throw new Error("EMAIL_SEND_THREAD_OWNERSHIP_CONFLICT");
  }

  const { data: insertedActivity, error: activityError } = await supabase
    .from("activities")
    .insert({
      company_id: intent.companyId,
      type: "email",
      subject: intent.subject,
      content: intent.authoredBody.substring(0, 500),
      body_text: intent.authoredBody,
      email_connection_id: intent.connectionId,
      email_message_id: providerMessageId,
      email_thread_id: providerThreadId,
      opportunity_id: intent.opportunityId,
      direction: "outbound",
      from_email: intent.clientFromAddressSnapshot,
      to_emails: intent.toEmails,
      cc_emails: intent.ccEmails,
      has_attachments: false,
      attachment_count: 0,
      is_read: true,
      created_by: intent.actorUserId,
      created_at: sentAt,
      draft_history_id: intent.draftHistoryId,
    })
    .select("id")
    .single();

  let canonicalActivity = insertedActivity as Record<string, unknown> | null;
  if ((activityError as { code?: string } | null)?.code === "23505") {
    const { data: racedActivities, error: racedActivityError } = await supabase
      .from("activities")
      .select(
        "id, company_id, email_connection_id, email_message_id, email_thread_id, opportunity_id, type, direction"
      )
      .eq("company_id", intent.companyId)
      .eq("email_connection_id", intent.connectionId)
      .eq("email_message_id", providerMessageId)
      .limit(2);
    if (racedActivityError) {
      throw new Error(
        `Sent email canonical activity lookup failed: ${racedActivityError.message ?? "unknown error"}`
      );
    }
    const candidates = (racedActivities ?? []) as Array<
      Record<string, unknown>
    >;
    if (candidates.length !== 1) {
      throw new Error(
        "Sent email activity conflict did not resolve to exactly one same-mailbox activity"
      );
    }
    const candidate = candidates[0];
    const candidateIsCanonical =
      typeof candidate.id === "string" &&
      candidate.company_id === intent.companyId &&
      candidate.email_connection_id === intent.connectionId &&
      candidate.email_message_id === providerMessageId &&
      candidate.email_thread_id === providerThreadId &&
      (candidate.opportunity_id === null ||
        candidate.opportunity_id === intent.opportunityId) &&
      candidate.type === "email" &&
      candidate.direction === "outbound";
    if (!candidateIsCanonical) {
      throw new Error(
        "Sent email activity conflict resolved to an invalid canonical activity"
      );
    }

    const { error: attributionError } = await supabase
      .from("activities")
      .update({
        opportunity_id: intent.opportunityId,
        created_by: intent.actorUserId,
        draft_history_id: intent.draftHistoryId,
      })
      .eq("id", candidate.id)
      .eq("company_id", intent.companyId)
      .eq("email_connection_id", intent.connectionId)
      .eq("email_message_id", providerMessageId);
    if (attributionError) {
      throw new Error(
        `Sent email actor attribution failed: ${attributionError.message ?? "unknown error"}`
      );
    }
    canonicalActivity = candidate;
  } else if (activityError || !canonicalActivity) {
    throw new Error(
      `Sent email activity persistence failed: ${activityError?.message ?? "insert returned no row"}`
    );
  }

  const activityId = required(
    canonicalActivity?.id as string | null,
    "EMAIL_SEND_ACTIVITY_ID_MISSING"
  );
  const correspondenceResult =
    await OpportunityLifecycleService.recordCorrespondenceEvent({
      supabase,
      companyId: intent.companyId,
      opportunityId: intent.opportunityId,
      activityId,
      connectionId: intent.connectionId,
      providerThreadId,
      providerMessageId,
      requireProviderMessageId: true,
      direction: "outbound",
      occurredAt: new Date(sentAt),
      source: "email_send",
      applyOpportunityProjection: true,
      fromEmail: intent.clientFromAddressSnapshot,
      fromName: intent.actorNameSnapshot,
      toEmails: intent.toEmails,
      ccEmails: intent.ccEmails,
      subject: intent.subject,
      bodyText: intent.authoredBody,
      connectionEmail: connection.email,
      companyDomains: connection.syncFilters?.companyDomains ?? [],
      userEmailAddresses: connection.syncFilters?.userEmailAddresses ?? [],
      knownPlatformSenders: connection.syncFilters?.knownPlatformSenders ?? [],
    });
  if (
    !correspondenceResult.created &&
    correspondenceResult.reason !== "duplicate_provider_message_id"
  ) {
    throw new Error(
      `Sent email correspondence persistence failed: ${correspondenceResult.reason}`
    );
  }

  const { data: projectionRows, error: projectionError } = await supabase.rpc(
    "apply_opportunity_correspondence_event",
    {
      p_company_id: intent.companyId,
      p_opportunity_id: intent.opportunityId,
      p_connection_id: intent.connectionId,
      p_provider_message_id: providerMessageId,
    }
  );
  if (projectionError || !projectionRows) {
    throw new Error(
      `Sent email correspondence projection failed: ${projectionError?.message ?? "RPC returned no rows"}`
    );
  }

  const { threadRow } = await EmailThreadService.upsertFromEmail({
    companyId: intent.companyId,
    connectionId: intent.connectionId,
    providerThreadId,
    email: {
      id: providerMessageId,
      threadId: providerThreadId,
      from: intent.clientFromAddressSnapshot,
      fromName: intent.actorNameSnapshot,
      to: intent.toEmails,
      cc: intent.ccEmails,
      subject: intent.subject,
      snippet: intent.authoredBody,
      bodyText: intent.authoredBody,
      date: new Date(sentAt),
      labelIds: [],
      isRead: true,
      hasAttachments: false,
      sizeEstimate: intent.authoredBody.length,
    },
    direction: "outbound",
    opportunityId: intent.opportunityId,
  });
  const outboundIsLatest = threadRow.latestDirection === "outbound";
  const labels =
    outboundIsLatest && threadRow.labels.includes("AWAITING_REPLY")
      ? await EmailThreadService.dismissAwaitingReply(
          threadRow.id,
          intent.companyId
        )
      : threadRow.labels;

  if (connection.opsLabelId) {
    await applyEmailProviderLabelWriteback({
      supabase,
      connectionId: connection.id,
      providerThreadId,
      providerLabelId: connection.opsLabelId,
      provider,
      context: "email-send-label-writeback",
      busyError: "EMAIL_SEND_LABEL_MAILBOX_BUSY",
      logPrefix: "[email-send]",
      providerLockCheckpoint: input.providerLockCheckpoint,
    });
  }

  // Queue persistence is part of provider reconciliation, not a best-effort
  // side effect. If it fails, the durable send intent remains retryable and
  // the provider is never called again. That preserves draft-edit feedback and
  // actor-specific voice learning without turning a queue outage into a false
  // "fully reconciled" send.
  await new EmailOutboundLearningService(supabase).enqueueIfEnabled({
    companyId: intent.companyId,
    connectionId: intent.connectionId,
    providerMessageId,
    providerThreadId,
    userId: intent.actorUserId,
    fromEmail: intent.clientFromAddressSnapshot,
    toEmails: intent.toEmails,
    subject: intent.subject,
    bodyText: intent.authoredBody,
    occurredAt: new Date(sentAt),
    draftHistoryId: intent.draftHistoryId,
    followUpDraftId: intent.followUpDraftId,
    draftDeliveryChannel: intent.draftHistoryId ? "ops_send" : null,
    opportunityId: intent.opportunityId,
    profileType: intent.profileTypeSnapshot,
    learningAuthority: intent.learningAuthority,
  });

  return {
    activityId,
    labels,
    latestDirection: threadRow.latestDirection ?? "outbound",
    opportunityId: intent.opportunityId,
    providerMessageId,
    providerThreadId,
    sentAt,
  };
}
