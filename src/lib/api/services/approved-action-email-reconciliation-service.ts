import type { SupabaseClient } from "@supabase/supabase-js";

import { persistCapturedProviderDeliveryTurn } from "@/lib/agent-control-plane/memory/persist-captured-provider-delivery-turn";
import type { EmailConnection } from "@/lib/types/email-connection";
import {
  CronDatabaseOperationError,
  supabaseDatabaseOperationCause,
} from "./cron-workload-control-service";
import { EmailOutboundLearningService } from "./email-outbound-learning-service";
import type { EmailProviderInterface } from "./email-provider";
import { applyEmailProviderLabelWriteback } from "./email-provider-label-writeback";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";
import { EmailThreadService } from "./email-thread-service";
import { NotificationService } from "./notification-service";
import { OpportunityLifecycleService } from "./opportunity-lifecycle-service";
import type { ApprovedActionEmailIntent } from "./approved-action-email-delivery-service";
import { captureAcceptedOutboundProviderDeliverySource } from "./provider-delivery-source-service";

function required(value: string | null, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compatibleNullableIdentity(
  value: unknown,
  expected: string | null
): boolean {
  return value === null || value === expected;
}

function databaseOperationError(
  message: string,
  cause: unknown
): CronDatabaseOperationError {
  return cause instanceof CronDatabaseOperationError
    ? cause
    : new CronDatabaseOperationError(message, { cause });
}

async function runDatabaseBoundary<T>(
  message: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw databaseOperationError(message, error);
  }
}

async function captureAcceptedDeliverySource(input: {
  supabase: SupabaseClient;
  intent: ApprovedActionEmailIntent;
  connection: EmailConnection;
}): Promise<void> {
  const { supabase, intent, connection } = input;

  await captureAcceptedOutboundProviderDeliverySource({
    supabase,
    connection,
    intent: {
      outboundIntentKind: "approved_action_email_intent",
      outboundIntentId: intent.id,
      status: intent.status,
      companyId: intent.companyId,
      connectionId: intent.connectionId,
      providerMessageId: intent.providerMessageId,
      providerThreadId: intent.acceptedProviderThreadId,
      providerAcceptedAt: intent.providerAcceptedAt,
      senderIdentity: intent.clientFromAddressSnapshot,
      recipientIdentities: intent.toEmails,
      ccRecipientIdentities: intent.ccEmails,
      subject: intent.subject,
      renderedBody: intent.renderedBody,
      renderedBodyHash: intent.renderedBodyHash,
      contentType: intent.contentType,
    },
  });
}

async function persistCanonicalActivity(input: {
  supabase: SupabaseClient;
  intent: ApprovedActionEmailIntent;
  providerMessageId: string;
  providerThreadId: string;
  sentAt: string;
}): Promise<string> {
  const { supabase, intent, providerMessageId, providerThreadId, sentAt } =
    input;
  const row = {
    company_id: intent.companyId,
    type: "email",
    subject: intent.subject,
    content: intent.authoredBody.substring(0, 500),
    body_text: intent.authoredBody,
    email_connection_id: intent.connectionId,
    email_message_id: providerMessageId,
    email_thread_id: providerThreadId,
    opportunity_id: intent.opportunityId,
    client_id: intent.clientId,
    invoice_id: intent.invoiceId,
    project_id: intent.projectId,
    direction: "outbound",
    from_email: intent.clientFromAddressSnapshot,
    to_emails: intent.toEmails,
    cc_emails: intent.ccEmails,
    has_attachments: false,
    attachment_count: 0,
    is_read: true,
    sent_by_agent: true,
    created_by: intent.actorUserId,
    created_at: sentAt,
    draft_history_id: intent.draftHistoryId,
  };

  const insertResponse = await supabase
    .from("activities")
    .insert(row)
    .select("id")
    .single();
  const { data: inserted, error } = insertResponse;
  if (!error && inserted?.id) return String(inserted.id);

  if ((error as { code?: string } | null)?.code !== "23505") {
    if (error) {
      throw databaseOperationError(
        `APPROVED_ACTION_EMAIL_ACTIVITY_PERSISTENCE_FAILED: ${error.message ?? "unknown error"}`,
        supabaseDatabaseOperationCause(insertResponse)
      );
    }
    throw new Error("APPROVED_ACTION_EMAIL_ACTIVITY_PERSISTENCE_FAILED");
  }

  const lookupResponse = await supabase
    .from("activities")
    .select(
      "id, company_id, email_connection_id, email_message_id, email_thread_id, opportunity_id, client_id, invoice_id, project_id, created_by, type, direction"
    )
    .eq("company_id", intent.companyId)
    .eq("email_connection_id", intent.connectionId)
    .eq("email_message_id", providerMessageId)
    .limit(2);
  const { data: candidates, error: lookupError } = lookupResponse;
  if (lookupError) {
    throw databaseOperationError(
      `APPROVED_ACTION_EMAIL_ACTIVITY_LOOKUP_FAILED: ${lookupError.message ?? "unknown error"}`,
      supabaseDatabaseOperationCause(lookupResponse)
    );
  }
  if (candidates?.length !== 1) {
    throw new Error("APPROVED_ACTION_EMAIL_ACTIVITY_IDENTITY_CONFLICT");
  }
  const candidate = candidates[0] as Record<string, unknown>;
  if (
    candidate.company_id !== intent.companyId ||
    candidate.email_connection_id !== intent.connectionId ||
    candidate.email_message_id !== providerMessageId ||
    candidate.email_thread_id !== providerThreadId ||
    !compatibleNullableIdentity(
      candidate.opportunity_id,
      intent.opportunityId
    ) ||
    !compatibleNullableIdentity(candidate.client_id, intent.clientId) ||
    !compatibleNullableIdentity(candidate.invoice_id, intent.invoiceId) ||
    !compatibleNullableIdentity(candidate.project_id, intent.projectId) ||
    !compatibleNullableIdentity(candidate.created_by, intent.actorUserId) ||
    candidate.type !== "email" ||
    candidate.direction !== "outbound"
  ) {
    throw new Error("APPROVED_ACTION_EMAIL_ACTIVITY_IDENTITY_CONFLICT");
  }

  const activityId = required(
    optionalString(candidate.id),
    "APPROVED_ACTION_EMAIL_ACTIVITY_ID_MISSING"
  );
  const attributionResponse = await supabase
    .from("activities")
    .update({
      opportunity_id: intent.opportunityId,
      client_id: intent.clientId,
      invoice_id: intent.invoiceId,
      project_id: intent.projectId,
      created_by: intent.actorUserId,
      sent_by_agent: true,
      draft_history_id: intent.draftHistoryId,
    })
    .eq("id", activityId)
    .eq("company_id", intent.companyId)
    .eq("email_connection_id", intent.connectionId)
    .eq("email_message_id", providerMessageId);
  const { error: attributionError } = attributionResponse;
  if (attributionError) {
    throw databaseOperationError(
      `APPROVED_ACTION_EMAIL_ACTIVITY_ATTRIBUTION_FAILED: ${attributionError.message ?? "unknown error"}`,
      supabaseDatabaseOperationCause(attributionResponse)
    );
  }
  return activityId;
}

async function reconcileOpportunity(input: {
  supabase: SupabaseClient;
  intent: ApprovedActionEmailIntent;
  activityId: string;
  providerMessageId: string;
  providerThreadId: string;
  sentAt: string;
  connection: EmailConnection;
}): Promise<void> {
  const {
    supabase,
    intent,
    activityId,
    providerMessageId,
    providerThreadId,
    sentAt,
    connection,
  } = input;
  if (!intent.opportunityId) return;

  const linkResponse = await supabase
    .from("opportunity_email_threads")
    .upsert(
      {
        opportunity_id: intent.opportunityId,
        thread_id: providerThreadId,
        connection_id: intent.connectionId,
      },
      { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
    );
  const { error: linkError } = linkResponse;
  if (linkError) {
    throw databaseOperationError(
      `APPROVED_ACTION_EMAIL_THREAD_LINK_FAILED: ${linkError.message ?? "unknown error"}`,
      supabaseDatabaseOperationCause(linkResponse)
    );
  }
  const canonicalLinkResponse = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("connection_id", intent.connectionId)
    .eq("thread_id", providerThreadId)
    .maybeSingle();
  const { data: canonicalLink, error: canonicalLinkError } =
    canonicalLinkResponse;
  if (canonicalLinkError) {
    throw databaseOperationError(
      `APPROVED_ACTION_EMAIL_THREAD_LINK_LOOKUP_FAILED: ${canonicalLinkError.message ?? "unknown error"}`,
      supabaseDatabaseOperationCause(canonicalLinkResponse)
    );
  }
  if (canonicalLink?.opportunity_id !== intent.opportunityId) {
    throw new Error("APPROVED_ACTION_EMAIL_THREAD_LEAD_CONFLICT");
  }

  const correspondence = await runDatabaseBoundary(
    "APPROVED_ACTION_EMAIL_CORRESPONDENCE_FAILED",
    () =>
      OpportunityLifecycleService.recordCorrespondenceEvent({
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
        source: "approved_action_email_send",
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
        knownPlatformSenders:
          connection.syncFilters?.knownPlatformSenders ?? [],
      })
  );
  if (
    !correspondence.created &&
    correspondence.reason !== "duplicate_provider_message_id"
  ) {
    throw new Error(
      `APPROVED_ACTION_EMAIL_CORRESPONDENCE_FAILED: ${correspondence.reason}`
    );
  }
}

async function applyPostSendFollowOn(input: {
  supabase: SupabaseClient;
  intent: ApprovedActionEmailIntent;
  sentAt: string;
}): Promise<void> {
  const { supabase, intent, sentAt } = input;
  const data = intent.actionDataSnapshot;

  if (intent.actionType === "send_invoice_email" && intent.invoiceId) {
    const response = await supabase
      .from("invoices")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", intent.invoiceId)
      .eq("company_id", intent.companyId)
      .eq("status", "draft");
    const { error } = response;
    if (error) {
      throw databaseOperationError(
        `APPROVED_ACTION_EMAIL_INVOICE_STATE_FAILED: ${error.message ?? "unknown error"}`,
        supabaseDatabaseOperationCause(response)
      );
    }
  }

  if (intent.actionType === "send_payment_reminder" && intent.invoiceId) {
    const response = await supabase
      .from("invoices")
      .update({ status: "past_due" })
      .eq("id", intent.invoiceId)
      .eq("company_id", intent.companyId)
      .in("status", ["sent", "awaiting_payment"]);
    const { error } = response;
    if (error) {
      throw databaseOperationError(
        `APPROVED_ACTION_EMAIL_REMINDER_STATE_FAILED: ${error.message ?? "unknown error"}`,
        supabaseDatabaseOperationCause(response)
      );
    }
  }

  if (intent.actionType !== "process_reschedule_request") return;
  const taskId = optionalString(data.affected_task_id);
  if (!taskId || !intent.projectId) return;
  const alternatives = Array.isArray(data.suggested_alternatives)
    ? (data.suggested_alternatives as Array<Record<string, unknown>>)
    : [];
  const requestedIndex =
    typeof data.selected_alternative_index === "number"
      ? data.selected_alternative_index
      : 0;
  const selected = alternatives[requestedIndex] ?? alternatives[0];
  const selectedDate = optionalString(selected?.date);
  if (!selectedDate) return;

  const originalStart = optionalString(data.original_start_date);
  const originalEnd = optionalString(data.original_end_date);
  const spanMs =
    originalStart && originalEnd
      ? new Date(originalEnd).getTime() - new Date(originalStart).getTime()
      : 0;
  const newStart = new Date(selectedDate);
  if (Number.isNaN(newStart.getTime())) {
    throw new Error("APPROVED_ACTION_EMAIL_RESCHEDULE_DATE_INVALID");
  }
  const newEnd =
    spanMs > 0 ? new Date(newStart.getTime() + spanMs).toISOString() : null;
  const teamMemberId = optionalString(selected?.team_member_id);
  const update: Record<string, unknown> = {
    start_date: newStart.toISOString(),
  };
  if (newEnd) update.end_date = newEnd;
  if (teamMemberId) update.team_member_ids = [teamMemberId];

  const taskResponse = await supabase
    .from("project_tasks")
    .update(update)
    .eq("id", taskId)
    .eq("company_id", intent.companyId)
    .eq("project_id", intent.projectId)
    .select("calendar_event_id")
    .single();
  const { data: task, error: taskError } = taskResponse;
  if (taskError) {
    throw databaseOperationError(
      `APPROVED_ACTION_EMAIL_RESCHEDULE_TASK_FAILED: ${taskError.message ?? "unknown error"}`,
      supabaseDatabaseOperationCause(taskResponse)
    );
  }
  if (!task) {
    throw new Error("APPROVED_ACTION_EMAIL_RESCHEDULE_TASK_FAILED");
  }
  const calendarEventId = optionalString(task.calendar_event_id);
  if (calendarEventId) {
    const calendarResponse = await supabase
      .from("calendar_events")
      .update(update)
      .eq("id", calendarEventId)
      .eq("company_id", intent.companyId);
    const { error: calendarError } = calendarResponse;
    if (calendarError) {
      throw databaseOperationError(
        `APPROVED_ACTION_EMAIL_RESCHEDULE_CALENDAR_FAILED: ${calendarError.message ?? "unknown error"}`,
        supabaseDatabaseOperationCause(calendarResponse)
      );
    }
  }

  const { ScheduleOptimizationService } =
    await import("./schedule-optimization-service");
  await runDatabaseBoundary(
    "APPROVED_ACTION_EMAIL_RESCHEDULE_CASCADE_FAILED",
    () =>
      ScheduleOptimizationService.handleRescheduleCascade(
        intent.companyId,
        intent.actorUserId,
        taskId,
        "reschedule_request",
        { throwOnError: true }
      )
  );
}

async function notifyActor(intent: ApprovedActionEmailIntent): Promise<void> {
  const data = intent.actionDataSnapshot;
  const clientName = optionalString(data.client_name) ?? "the client";
  const projectTitle = optionalString(data.project_title) ?? "the project";
  const notification = (() => {
    switch (intent.actionType) {
      case "send_invoice_email":
        return {
          title: "Invoice email sent",
          body: `Invoice sent to ${clientName}.`,
        };
      case "send_payment_reminder":
        return {
          title: "Payment reminder sent",
          body: `Reminder sent to ${clientName}.`,
        };
      case "process_reschedule_request":
        return {
          title: "Reschedule handled",
          body: `Replied to ${clientName} and updated ${projectTitle}.`,
        };
      default:
        return {
          title: "Client email sent",
          body: `Message sent for ${projectTitle}.`,
        };
    }
  })();
  await NotificationService.create({
    userId: intent.actorUserId,
    companyId: intent.companyId,
    type: "mention",
    title: notification.title,
    body: notification.body,
    persistent: false,
    actionUrl: intent.projectId
      ? `/dashboard?openProject=${intent.projectId}&mode=view`
      : "/agent/queue",
    actionLabel: "View",
  });
}

/**
 * Materializes one provider-accepted approved action into OPS. Every write is
 * idempotent by the mailbox-scoped provider message identity. Autonomous
 * actions record their sent-draft outcome under autonomous authority, which
 * can never train or graduate a personal writing profile.
 */
export async function reconcileApprovedActionEmail(input: {
  supabase: SupabaseClient;
  intent: ApprovedActionEmailIntent;
  connection: EmailConnection;
  provider: Pick<EmailProviderInterface, "applyLabel">;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}): Promise<{ activityId: string }> {
  const { supabase, intent, connection, provider } = input;
  const checkpoint = input.providerLockCheckpoint ?? (async () => undefined);
  const providerMessageId = required(
    intent.providerMessageId,
    "APPROVED_ACTION_EMAIL_PROVIDER_MESSAGE_ID_MISSING"
  );
  const providerThreadId = required(
    intent.acceptedProviderThreadId,
    "APPROVED_ACTION_EMAIL_PROVIDER_THREAD_ID_MISSING"
  );
  const sentAt = required(
    intent.providerAcceptedAt,
    "APPROVED_ACTION_EMAIL_PROVIDER_ACCEPTED_AT_MISSING"
  );
  if (
    connection.id !== intent.connectionId ||
    connection.companyId !== intent.companyId
  ) {
    throw new Error("APPROVED_ACTION_EMAIL_CONNECTION_CONFLICT");
  }

  await checkpoint();
  await captureAcceptedDeliverySource({ supabase, intent, connection });
  await checkpoint();

  const activityId = await persistCanonicalActivity({
    supabase,
    intent,
    providerMessageId,
    providerThreadId,
    sentAt,
  });
  await checkpoint();
  await reconcileOpportunity({
    supabase,
    intent,
    activityId,
    providerMessageId,
    providerThreadId,
    sentAt,
    connection,
  });
  await checkpoint();
  if (intent.opportunityId || intent.projectId) {
    await persistCapturedProviderDeliveryTurn({
      supabase,
      companyId: intent.companyId,
      connectionId: intent.connectionId,
      providerMessageId,
      sourceActivityId: activityId,
    });
    await checkpoint();
  }

  const { threadRow } = await runDatabaseBoundary(
    "APPROVED_ACTION_EMAIL_THREAD_PERSISTENCE_FAILED",
    () =>
      EmailThreadService.upsertFromEmail({
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
        clientId: intent.clientId,
      })
  );
  await checkpoint();
  if (
    threadRow.latestDirection === "outbound" &&
    threadRow.labels.includes("AWAITING_REPLY")
  ) {
    await runDatabaseBoundary(
      "APPROVED_ACTION_EMAIL_AWAITING_REPLY_DISMISS_FAILED",
      () =>
        EmailThreadService.dismissAwaitingReply(threadRow.id, intent.companyId)
    );
    await checkpoint();
  }

  await applyPostSendFollowOn({ supabase, intent, sentAt });
  await checkpoint();

  if (intent.draftHistoryId) {
    const draftResponse = await supabase
      .from("ai_draft_history")
      .update({
        final_version: intent.authoredBody,
        status: "sent",
        sent_at: sentAt,
      })
      .eq("id", intent.draftHistoryId)
      .eq("company_id", intent.companyId)
      .eq("user_id", intent.actorUserId);
    const { error: draftError } = draftResponse;
    if (draftError) {
      throw databaseOperationError(
        `APPROVED_ACTION_EMAIL_DRAFT_OUTCOME_FAILED: ${draftError.message ?? "unknown error"}`,
        supabaseDatabaseOperationCause(draftResponse)
      );
    }
    await checkpoint();
    await runDatabaseBoundary(
      "APPROVED_ACTION_EMAIL_LEARNING_ENQUEUE_FAILED",
      () =>
        new EmailOutboundLearningService(supabase).enqueueIfEnabled({
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
          draftDeliveryChannel: "ops_send",
          opportunityId: intent.opportunityId,
          profileType: intent.profileTypeSnapshot,
          // Autonomous jobs persist the sent outcome but the outbound worker
          // sets applyLearning=false for this authority, so it cannot train or
          // graduate the actor's personal profile.
          learningAuthority: intent.learningAuthority,
        })
    );
    await checkpoint();
  }

  if (connection.opsLabelId) {
    await applyEmailProviderLabelWriteback({
      supabase,
      connectionId: connection.id,
      providerThreadId,
      providerLabelId: connection.opsLabelId,
      provider,
      context: "approved-action-email-label-writeback",
      busyError: "APPROVED_ACTION_EMAIL_LABEL_MAILBOX_BUSY",
      logPrefix: "[approved-action-email]",
      providerLockCheckpoint: input.providerLockCheckpoint,
    });
  }
  await checkpoint();
  try {
    await notifyActor(intent);
  } catch {
    // Notification delivery is non-authoritative. The durable action result and
    // sent activity remain the source of truth.
  }

  return { activityId };
}
