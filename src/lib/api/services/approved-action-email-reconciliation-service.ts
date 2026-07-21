import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailConnection } from "@/lib/types/email-connection";
import { EmailOutboundLearningService } from "./email-outbound-learning-service";
import type { EmailProviderInterface } from "./email-provider";
import { applyEmailProviderLabelWriteback } from "./email-provider-label-writeback";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";
import { EmailThreadService } from "./email-thread-service";
import { NotificationService } from "./notification-service";
import { OpportunityLifecycleService } from "./opportunity-lifecycle-service";
import type { ApprovedActionEmailIntent } from "./approved-action-email-delivery-service";

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

  const { data: inserted, error } = await supabase
    .from("activities")
    .insert(row)
    .select("id")
    .single();
  if (!error && inserted?.id) return String(inserted.id);

  if ((error as { code?: string } | null)?.code !== "23505") {
    throw new Error(
      `APPROVED_ACTION_EMAIL_ACTIVITY_PERSISTENCE_FAILED: ${error?.message ?? "missing row"}`
    );
  }

  const { data: candidates, error: lookupError } = await supabase
    .from("activities")
    .select(
      "id, company_id, email_connection_id, email_message_id, email_thread_id, opportunity_id, client_id, invoice_id, project_id, created_by, type, direction"
    )
    .eq("company_id", intent.companyId)
    .eq("email_connection_id", intent.connectionId)
    .eq("email_message_id", providerMessageId)
    .limit(2);
  if (lookupError || candidates?.length !== 1) {
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
  const { error: attributionError } = await supabase
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
  if (attributionError) {
    throw new Error(
      `APPROVED_ACTION_EMAIL_ACTIVITY_ATTRIBUTION_FAILED: ${attributionError.message}`
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

  const { error: linkError } = await supabase
    .from("opportunity_email_threads")
    .upsert(
      {
        opportunity_id: intent.opportunityId,
        thread_id: providerThreadId,
        connection_id: intent.connectionId,
      },
      { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
    );
  if (linkError) {
    throw new Error(
      `APPROVED_ACTION_EMAIL_THREAD_LINK_FAILED: ${linkError.message}`
    );
  }
  const { data: canonicalLink, error: canonicalLinkError } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("connection_id", intent.connectionId)
    .eq("thread_id", providerThreadId)
    .maybeSingle();
  if (
    canonicalLinkError ||
    canonicalLink?.opportunity_id !== intent.opportunityId
  ) {
    throw new Error("APPROVED_ACTION_EMAIL_THREAD_LEAD_CONFLICT");
  }

  const correspondence =
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
      knownPlatformSenders: connection.syncFilters?.knownPlatformSenders ?? [],
    });
  if (
    !correspondence.created &&
    correspondence.reason !== "duplicate_provider_message_id"
  ) {
    throw new Error(
      `APPROVED_ACTION_EMAIL_CORRESPONDENCE_FAILED: ${correspondence.reason}`
    );
  }

  const { error: projectionError } = await supabase.rpc(
    "apply_opportunity_correspondence_event",
    {
      p_company_id: intent.companyId,
      p_opportunity_id: intent.opportunityId,
      p_connection_id: intent.connectionId,
      p_provider_message_id: providerMessageId,
    }
  );
  if (projectionError) {
    throw new Error(
      `APPROVED_ACTION_EMAIL_PROJECTION_FAILED: ${projectionError.message}`
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
    const { error } = await supabase
      .from("invoices")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", intent.invoiceId)
      .eq("company_id", intent.companyId)
      .eq("status", "draft");
    if (error) {
      throw new Error(
        `APPROVED_ACTION_EMAIL_INVOICE_STATE_FAILED: ${error.message}`
      );
    }
  }

  if (intent.actionType === "send_payment_reminder" && intent.invoiceId) {
    const { error } = await supabase
      .from("invoices")
      .update({ status: "past_due" })
      .eq("id", intent.invoiceId)
      .eq("company_id", intent.companyId)
      .in("status", ["sent", "awaiting_payment"]);
    if (error) {
      throw new Error(
        `APPROVED_ACTION_EMAIL_REMINDER_STATE_FAILED: ${error.message}`
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

  const { data: task, error: taskError } = await supabase
    .from("project_tasks")
    .update(update)
    .eq("id", taskId)
    .eq("company_id", intent.companyId)
    .eq("project_id", intent.projectId)
    .select("calendar_event_id")
    .single();
  if (taskError || !task) {
    throw new Error(
      `APPROVED_ACTION_EMAIL_RESCHEDULE_TASK_FAILED: ${taskError?.message ?? "missing task"}`
    );
  }
  const calendarEventId = optionalString(task.calendar_event_id);
  if (calendarEventId) {
    const { error: calendarError } = await supabase
      .from("calendar_events")
      .update(update)
      .eq("id", calendarEventId)
      .eq("company_id", intent.companyId);
    if (calendarError) {
      throw new Error(
        `APPROVED_ACTION_EMAIL_RESCHEDULE_CALENDAR_FAILED: ${calendarError.message}`
      );
    }
  }

  const { ScheduleOptimizationService } =
    await import("./schedule-optimization-service");
  await ScheduleOptimizationService.handleRescheduleCascade(
    intent.companyId,
    intent.actorUserId,
    taskId,
    "reschedule_request"
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

  const activityId = await persistCanonicalActivity({
    supabase,
    intent,
    providerMessageId,
    providerThreadId,
    sentAt,
  });
  await reconcileOpportunity({
    supabase,
    intent,
    activityId,
    providerMessageId,
    providerThreadId,
    sentAt,
    connection,
  });

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
    clientId: intent.clientId,
  });
  if (
    threadRow.latestDirection === "outbound" &&
    threadRow.labels.includes("AWAITING_REPLY")
  ) {
    await EmailThreadService.dismissAwaitingReply(
      threadRow.id,
      intent.companyId
    );
  }

  await applyPostSendFollowOn({ supabase, intent, sentAt });

  if (intent.draftHistoryId) {
    const { error: draftError } = await supabase
      .from("ai_draft_history")
      .update({
        final_version: intent.authoredBody,
        status: "sent",
        sent_at: sentAt,
      })
      .eq("id", intent.draftHistoryId)
      .eq("company_id", intent.companyId)
      .eq("user_id", intent.actorUserId);
    if (draftError) {
      throw new Error(
        `APPROVED_ACTION_EMAIL_DRAFT_OUTCOME_FAILED: ${draftError.message}`
      );
    }
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
      draftDeliveryChannel: "ops_send",
      opportunityId: intent.opportunityId,
      profileType: intent.profileTypeSnapshot,
      // Autonomous jobs persist the sent outcome but the outbound worker sets
      // applyLearning=false for this authority, so they cannot train or
      // graduate the actor's personal profile.
      learningAuthority: intent.learningAuthority,
    });
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
  try {
    await notifyActor(intent);
  } catch {
    // Notification delivery is non-authoritative. The durable action result and
    // sent activity remain the source of truth.
  }

  return { activityId };
}
