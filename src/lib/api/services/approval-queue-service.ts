/**
 * OPS Web — Approval Queue Service
 *
 * Central service for all agent-proposed actions. The agent proposes,
 * the user approves or rejects, and the service executes on approval.
 * Shared infrastructure for projects, tasks, invoices, and email.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import { ProjectService } from "./project-service";
import { TaskService } from "./task-service";
import { NotificationService } from "./notification-service";
import type {
  AgentAction,
  ProposeActionParams,
  QueueFilters,
  QueueStats,
  CreateProjectActionData,
  CreateTaskActionData,
  SendStatusEmailActionData,
  SendInvoiceEmailActionData,
  CreateInvoiceActionData,
  ReassignTaskActionData,
  ArchiveProjectActionData,
  SendPaymentReminderActionData,
  ClientHealthAlertActionData,
  FinancialInsightActionData,
  OptimizeScheduleActionData,
  RescheduleTasksActionData,
  SendAppointmentConfirmationActionData,
  SendDayBeforeReminderActionData,
  SendScheduleChangedActionData,
  SendSubcontractorCoordinationActionData,
  ProcessRescheduleRequestActionData,
} from "@/lib/types/approval-queue";
import { ProjectStatus, TaskStatus } from "@/lib/types/models";
import { InvoiceStatus, DiscountType } from "@/lib/types/pipeline";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): AgentAction {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    userId: row.user_id as string,
    actionType: row.action_type as AgentAction["actionType"],
    actionData: (row.action_data as Record<string, unknown>) ?? {},
    contextSummary: row.context_summary as string,
    contextSource: (row.context_source as AgentAction["contextSource"]) ?? null,
    sourceId: (row.source_id as string) ?? null,
    confidence: row.confidence as number,
    priority: row.priority as AgentAction["priority"],
    status: row.status as AgentAction["status"],
    reviewedBy: (row.reviewed_by as string) ?? null,
    reviewedAt: parseDate(row.reviewed_at),
    reviewNotes: (row.review_notes as string) ?? null,
    executedAt: parseDate(row.executed_at),
    executionResult: (row.execution_result as Record<string, unknown>) ?? null,
    error: (row.error as string) ?? null,
    expiresAt: parseDate(row.expires_at),
    autoExecuteAt: parseDate(row.auto_execute_at),
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

// ─── Expiry Defaults ──────────────────────────────────────────────────────────

const EXPIRY_DAYS: Record<string, number> = {
  create_project: 7,
  create_task: 7,
  create_invoice: 3,
  send_invoice_email: 3,
  send_email: 1,
  send_status_email: 3,
  send_payment_reminder: 3,
  reassign_task: 7,
  archive_project: 14,
  client_health_alert: 14,
  financial_insight: 14,
  optimize_schedule: 3,
  reschedule_tasks: 3,
  send_appointment_confirmation: 2,
  send_day_before_reminder: 1,
  send_appointment_reminder: 1,
  send_schedule_changed: 2,
  send_subcontractor_coordination: 5,
  process_reschedule_request: 2,
};

function defaultExpiry(actionType: string): Date {
  const days = EXPIRY_DAYS[actionType] ?? 7;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ─── Admin User Lookup ────────────────────────────────────────────────────────

async function getAdminUserIds(companyId: string): Promise<string[]> {
  const supabase = requireSupabase();

  // company.admin_ids is a comma-separated string of admin/owner user IDs
  const { data: company } = await supabase
    .from("companies")
    .select("admin_ids")
    .eq("id", companyId)
    .single();

  const rawAdminIds = (company?.admin_ids as string) ?? "";
  const adminIds = rawAdminIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (adminIds.length > 0) return adminIds;

  // Fallback: find users with admin/owner role
  const { data: admins } = await supabase
    .from("users")
    .select("id")
    .eq("company_id", companyId)
    .in("role", ["admin", "owner"])
    .limit(10);

  return (admins ?? []).map((u) => u.id as string);
}

// ─── Action Executors ─────────────────────────────────────────────────────────

async function executeAction(
  action: AgentAction
): Promise<Record<string, unknown>> {
  switch (action.actionType) {
    case "create_project":
      return executeCreateProject(action);
    case "create_task":
      return executeCreateTask(action);
    case "send_status_email":
      return executeSendStatusEmail(action);
    case "reassign_task":
      return executeReassignTask(action);
    case "archive_project":
      return executeArchiveProject(action);
    case "create_invoice":
      return executeCreateInvoice(action);
    case "send_invoice_email":
      return executeSendInvoiceEmail(action);
    case "send_payment_reminder":
      return executeSendPaymentReminder(action);
    case "client_health_alert":
      return executeClientHealthAlert(action);
    case "financial_insight":
      return executeFinancialInsight(action);
    case "optimize_schedule":
      return executeOptimizeSchedule(action);
    case "reschedule_tasks":
      return executeRescheduleTasks(action);
    case "send_appointment_confirmation":
      return executeSendAppointmentConfirmation(action);
    case "send_day_before_reminder":
    case "send_appointment_reminder":
      return executeSendDayBeforeReminder(action);
    case "send_schedule_changed":
      return executeSendScheduleChanged(action);
    case "send_subcontractor_coordination":
      return executeSendSubcontractorCoordination(action);
    case "process_reschedule_request":
      return executeProcessRescheduleRequest(action);
    default:
      throw new Error(`Unsupported action type: ${action.actionType}`);
  }
}

async function executeCreateProject(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as CreateProjectActionData;

  const projectId = await ProjectService.createProject({
    title: data.title,
    companyId: action.companyId,
    clientId: data.client_id ?? undefined,
    address: data.address ?? undefined,
    notes: data.scope ?? undefined,
    status: ProjectStatus.RFQ,
    opportunityId: data.source_opportunity_id ?? undefined,
  });

  // Create suggested tasks
  if (data.suggested_tasks?.length) {
    for (const task of data.suggested_tasks) {
      try {
        await TaskService.createTask({
          projectId,
          companyId: action.companyId,
          taskTypeId: task.task_type_id ?? "",
          customTitle: task.title,
          status: TaskStatus.Booked,
        });
      } catch (err) {
        console.error(`[approval-queue] Failed to create task "${task.title}":`, err);
      }
    }
  }

  // Link project back to opportunity if one exists
  if (data.source_opportunity_id) {
    await supabase
      .from("opportunities")
      .update({ project_id: projectId })
      .eq("id", data.source_opportunity_id);
  }

  // P2.4: Fire-and-forget — suggest individual tasks for the new project
  // Runs asynchronously so it doesn't block the approval flow
  import("./task-suggestion-service")
    .then(({ TaskSuggestionService }) =>
      TaskSuggestionService.suggestTasksForProject(action.companyId, projectId)
        .then((suggestions) => {
          if (suggestions.length > 0) {
            return TaskSuggestionService.proposeTaskCreation(
              action.companyId,
              action.userId,
              projectId,
              suggestions
            );
          }
        })
    )
    .catch((err) =>
      console.error("[approval-queue] Task suggestion after project creation error:", err)
    );

  return { projectId, tasksCreated: data.suggested_tasks?.length ?? 0 };
}

async function executeCreateTask(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data = action.actionData as unknown as CreateTaskActionData;

  // Build the task creation payload using TaskService patterns
  const taskData: Parameters<typeof TaskService.createTaskWithEvent>[0] = {
    task: {
      projectId: data.project_id,
      companyId: data.company_id,
      taskTypeId: data.task_type_id,
      customTitle: data.custom_title,
      taskNotes: data.task_notes ?? undefined,
      taskColor: data.task_color ?? undefined,
      teamMemberIds: data.suggested_team_member_id
        ? [data.suggested_team_member_id]
        : [],
      status: TaskStatus.Booked,
    },
  };

  // Add scheduling data if dates were suggested
  if (data.suggested_start_date) {
    taskData.schedule = {
      title: data.custom_title,
      startDate: new Date(data.suggested_start_date),
      endDate: data.suggested_end_date
        ? new Date(data.suggested_end_date)
        : undefined,
      duration: data.suggested_duration ?? 1,
      color: data.task_color ?? undefined,
      teamMemberIds: data.suggested_team_member_id
        ? [data.suggested_team_member_id]
        : undefined,
    };
  }

  const { taskId } = await TaskService.createTaskWithEvent(taskData);

  // S1.4: Fire-and-forget — check for schedule conflicts with existing tasks
  if (data.suggested_start_date) {
    import("./schedule-optimization-service")
      .then(({ ScheduleOptimizationService }) =>
        ScheduleOptimizationService.handleRescheduleCascade(
          action.companyId,
          action.userId,
          taskId,
          "task_created"
        )
      )
      .catch((err) =>
        console.error("[approval-queue] Cascade after task creation:", err)
      );

    // S2 Amendment: appointment confirmation only fires via
    // onTaskScheduleConfirmed() (explicit confirm button, auto-confirm cron,
    // or the full_auto immediate path). executeCreateTask no longer fires
    // confirmations directly — it would send duplicates as users shuffle
    // schedules. For full_auto level only, dispatch immediately.
    import("./client-scheduling-comms-service")
      .then(({ ClientSchedulingCommsService }) =>
        ClientSchedulingCommsService.onTaskCreatedMaybeFullAuto(
          action.companyId,
          action.userId,
          taskId
        )
      )
      .catch((err) =>
        console.error("[approval-queue] Full-auto dispatcher error:", err)
      );
  }

  return {
    taskId,
    projectId: data.project_id,
    teamMemberId: data.suggested_team_member_id,
    scheduled: !!data.suggested_start_date,
  };
}

// ─── Send Status Email Executor ──────────────────────────────────────────────

async function executeSendStatusEmail(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data = action.actionData as unknown as SendStatusEmailActionData;

  // Send via the internal email send endpoint (same pattern as auto-send)
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  const sendResponse = await fetch(`${appUrl}/api/integrations/email/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
    },
    body: JSON.stringify({
      connectionId: data.connection_id,
      companyId: action.companyId,
      userId: action.userId,
      to: [data.client_email],
      subject: data.subject,
      body: data.draft_text,
      contentType: "text",
    }),
  });

  if (!sendResponse.ok) {
    const errBody = await sendResponse.text();
    throw new Error(`Failed to send status email: ${errBody}`);
  }

  const result = await sendResponse.json();

  // Feed the final (possibly-edited) draft back into the writing profile
  // via recordDraftOutcome. This computes real edit distance against the
  // ai_draft_history row created at proposal time, detects change types,
  // and runs GPT analysis on significant edits.
  if (data.draft_history_id) {
    try {
      const { AIDraftService } = await import("./ai-draft-service");
      await AIDraftService.recordDraftOutcome(
        data.draft_history_id,
        action.companyId,
        action.userId,
        "sent",
        data.draft_text,
        "client_active_project"
      );
    } catch (err) {
      console.error("[approval-queue] status email draft outcome:", err);
    }
  }

  return {
    messageId: result.messageId ?? null,
    clientEmail: data.client_email,
    projectId: data.project_id,
  };
}

// ─── Reassign Task Executor ─────────────────────────────────────────────────

async function executeReassignTask(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as ReassignTaskActionData;

  // Update project_tasks.team_member_ids to the new assignee
  const { error: taskErr } = await supabase
    .from("project_tasks")
    .update({ team_member_ids: [data.suggested_team_member_id] })
    .eq("id", data.task_id)
    .eq("company_id", action.companyId);

  if (taskErr) {
    throw new Error(`Failed to reassign task: ${taskErr.message}`);
  }

  // Update calendar_event if the task has one
  const { data: task } = await supabase
    .from("project_tasks")
    .select("calendar_event_id")
    .eq("id", data.task_id)
    .single();

  const calendarEventId = task?.calendar_event_id as string | null;

  if (calendarEventId) {
    await supabase
      .from("calendar_events")
      .update({
        team_member_ids: [data.suggested_team_member_id],
        start_date: data.new_start_date,
        end_date: data.new_end_date,
      })
      .eq("id", calendarEventId);
  }

  // Notify the new assignee (best effort)
  try {
    await NotificationService.create({
      userId: data.suggested_team_member_id,
      companyId: action.companyId,
      type: "mention",
      title: "Task reassigned to you",
      body: `"${data.task_title}" on "${data.project_title}" has been reassigned to you.`,
      persistent: false,
      actionUrl: `/projects/${data.project_id}`,
      actionLabel: "View Project",
    });
  } catch {
    // Non-critical
  }

  // S1.4: Fire-and-forget — check for schedule cascade impacts
  import("./schedule-optimization-service")
    .then(({ ScheduleOptimizationService }) =>
      ScheduleOptimizationService.handleRescheduleCascade(
        action.companyId,
        action.userId,
        data.task_id,
        "reassignment"
      )
    )
    .catch((err) =>
      console.error("[approval-queue] Cascade after reassignment:", err)
    );

  // S2 Amendment: reassignment fires the configured reschedule_behavior
  // (notify, draft, or auto_send) for tasks that were already schedule-
  // confirmed. The old unconditional confirmation fire was removed — it
  // caused duplicate emails as users shuffled crews during planning.
  // Note: reassignment does NOT clear schedule_confirmed_at — only the
  // crew changed, not the date, so the confirmation is still valid.
  import("./client-scheduling-comms-service")
    .then(({ ClientSchedulingCommsService }) =>
      ClientSchedulingCommsService.onConfirmedTaskRescheduled(
        action.companyId,
        action.userId,
        data.task_id
      )
    )
    .catch((err) =>
      console.error(
        "[approval-queue] Reschedule behavior dispatcher error:",
        err
      )
    );

  return {
    taskId: data.task_id,
    projectId: data.project_id,
    newTeamMemberId: data.suggested_team_member_id,
    rescheduled: !!calendarEventId,
  };
}

// ─── Archive Project Executor ───────────────────────────────────────────────

async function executeArchiveProject(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as ArchiveProjectActionData;

  const { error } = await supabase
    .from("projects")
    .update({ status: "archived" })
    .eq("id", data.project_id)
    .eq("company_id", action.companyId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to archive project: ${error.message}`);
  }

  return {
    projectId: data.project_id,
    projectTitle: data.project_title,
    archivedAt: new Date().toISOString(),
  };
}

// ─── Create Invoice Executor ────────────────────────────────────────────────

async function executeCreateInvoice(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as CreateInvoiceActionData;

  // Dynamically import InvoiceService to avoid circular deps
  const { InvoiceService } = await import("./invoice-service");

  // Build CreateInvoice payload matching the exact service pattern
  const invoiceData = {
    companyId: action.companyId,
    clientId: data.client_id,
    estimateId: data.estimate_id ?? undefined,
    projectId: data.project_id ?? undefined,
    subtotal: data.subtotal,
    discountType: (data.discount_type as DiscountType) ?? undefined,
    discountValue: data.discount_value ?? undefined,
    discountAmount: data.discount_amount,
    taxRate: data.tax_rate ?? undefined,
    taxAmount: data.tax_amount,
    total: data.total,
    status: InvoiceStatus.Draft,
    issueDate: new Date(),
    dueDate: new Date(data.due_date),
    paymentTerms: data.payment_terms ?? undefined,
    clientMessage: data.notes ?? undefined,
    terms: data.terms ?? undefined,
    createdBy: action.userId,
  };

  // Build line items matching CreateLineItem shape
  const lineItems = data.line_items.map((item) => ({
    name: item.name,
    description: item.description ?? undefined,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unit_price,
    type: item.type,
    taskTypeId: item.task_type_id ?? undefined,
    isTaxable: item.is_taxable,
    sortOrder: item.sort_order,
    category: item.category ?? undefined,
    companyId: action.companyId,
  }));

  const invoice = await InvoiceService.createInvoice(invoiceData, lineItems);

  // If estimate_id is provided, update estimate status to "converted"
  if (data.estimate_id) {
    await supabase
      .from("estimates")
      .update({ status: "converted" })
      .eq("id", data.estimate_id)
      .eq("company_id", action.companyId);
  }

  // Fire-and-forget: generate cover email and propose send_invoice_email
  if (data.cover_email && data.cover_email.to && data.cover_email.connection_id) {
    const coverEmail = data.cover_email;

    import("./ai-draft-service")
      .then(async ({ AIDraftService }) => {
        const { getCompanyLocale, renderServerString } = await import(
          "@/i18n/server-render"
        );
        const locale = await getCompanyLocale(action.companyId);
        const bcp47 = locale === "es" ? "es-ES" : "en-US";

        const totalStr = new Intl.NumberFormat(bcp47, {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(data.total);
        const dueDateStr = new Date(data.due_date).toLocaleDateString(bcp47, {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        // Generate cover email using writing profile.
        // profileTypeOverride pins this to "client_active_project" so
        // recordDraftOutcome() at execution time learns into the correct
        // profile (invoice covers historically resolved to "general"
        // because no thread subject/opportunity stage was present).
        // The userInstruction stays English — it's consumed by GPT —
        // but we ask it to write the output in the company locale.
        const draftResult = await AIDraftService.generateDraft({
          companyId: action.companyId,
          userId: action.userId,
          connectionId: coverEmail.connection_id!,
          recipientEmail: coverEmail.to,
          recipientName: data.client_name,
          userInstruction: `Write a brief cover email for invoice #${invoice.invoiceNumber} totaling ${totalStr} for project "${data.project_title}". Payment terms: ${data.payment_terms ?? "NET-30"}. Due date: ${dueDateStr}. Keep it professional and concise. Write the email in ${locale === "es" ? "Spanish" : "English"}.`,
          profileTypeOverride: "client_active_project",
        });

        let draftText: string;
        let draftHistoryId: string | null;

        if (draftResult.available && draftResult.draft) {
          draftText = draftResult.draft;
          draftHistoryId = draftResult.draftHistoryId || null;
        } else {
          draftText = await renderServerString(
            locale,
            "server-emails",
            "invoiceCover.fallback",
            {
              clientName: data.client_name,
              invoiceNumber: invoice.invoiceNumber,
              amount: totalStr,
              projectTitle: data.project_title,
              dueDate: dueDateStr,
            }
          );

          const { data: fallbackHistory } = await supabase
            .from("ai_draft_history")
            .insert({
              company_id: action.companyId,
              user_id: action.userId,
              connection_id: coverEmail.connection_id!,
              original_draft: draftText,
              profile_type: "client_active_project",
              status: "drafted",
            })
            .select("id")
            .single();
          draftHistoryId = (fallbackHistory?.id as string) ?? null;
        }

        const localizedSubject =
          coverEmail.subject ||
          (await renderServerString(
            locale,
            "server-emails",
            "invoiceCover.subject",
            {
              invoiceNumber: invoice.invoiceNumber,
              projectTitle: data.project_title,
            }
          ));

        const emailActionData: SendInvoiceEmailActionData = {
          invoice_id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          invoice_total: data.total,
          to_email: coverEmail.to,
          client_name: data.client_name,
          project_title: data.project_title,
          subject: localizedSubject,
          draft_text: draftText,
          connection_id: coverEmail.connection_id!,
          attachments: [{ type: "invoice_pdf", invoice_id: invoice.id }],
          draft_history_id: draftHistoryId,
        };

        await ApprovalQueueService.proposeAction({
          companyId: action.companyId,
          userId: action.userId,
          actionType: "send_invoice_email",
          actionData: emailActionData as unknown as Record<string, unknown>,
          contextSummary: `Send invoice #${invoice.invoiceNumber} ($${data.total.toFixed(2)}) to ${data.client_name}`,
          contextSource: "invoice_created",
          sourceId: invoice.id,
          confidence: 0.8,
          priority: "normal",
        });
      })
      .catch((err) =>
        console.error("[approval-queue] Cover email generation error:", err)
      );
  }

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    clientId: data.client_id,
    projectId: data.project_id,
    total: data.total,
    lineItemCount: data.line_items.length,
  };
}

// ─── Send Invoice Email Executor ────────────────────────────────────────────

async function executeSendInvoiceEmail(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data = action.actionData as unknown as SendInvoiceEmailActionData;

  // Send via the internal email send endpoint (same pattern as status emails)
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  const sendResponse = await fetch(`${appUrl}/api/integrations/email/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
    },
    body: JSON.stringify({
      connectionId: data.connection_id,
      companyId: action.companyId,
      userId: action.userId,
      to: [data.to_email],
      subject: data.subject,
      body: data.draft_text,
      contentType: "text",
    }),
  });

  if (!sendResponse.ok) {
    const errBody = await sendResponse.text();
    throw new Error(`Failed to send invoice email: ${errBody}`);
  }

  const result = await sendResponse.json();

  // Update invoice status to "sent" if still in draft
  try {
    const { InvoiceService } = await import("./invoice-service");
    await InvoiceService.sendInvoice(data.invoice_id);
  } catch {
    // Non-critical — invoice may already be in a later status
  }

  // Feed the final (possibly-edited) cover email back into the writing
  // profile. recordDraftOutcome computes edit distance, runs GPT analysis,
  // and updates the profile via learnFromEdits.
  if (data.draft_history_id) {
    try {
      const { AIDraftService } = await import("./ai-draft-service");
      await AIDraftService.recordDraftOutcome(
        data.draft_history_id,
        action.companyId,
        action.userId,
        "sent",
        data.draft_text,
        "client_active_project"
      );
    } catch (err) {
      console.error("[approval-queue] invoice email draft outcome:", err);
    }
  }

  return {
    messageId: result.messageId ?? null,
    invoiceId: data.invoice_id,
    invoiceNumber: data.invoice_number,
    toEmail: data.to_email,
  };
}

// ─── Send Payment Reminder Executor ─────────────────────────────────────────

async function executeSendPaymentReminder(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as SendPaymentReminderActionData;

  // 1. Send the email via the internal email send endpoint
  if (!data.connection_id) {
    throw new Error("No email connection configured — cannot send payment reminder");
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  const sendResponse = await fetch(`${appUrl}/api/integrations/email/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
    },
    body: JSON.stringify({
      connectionId: data.connection_id,
      companyId: action.companyId,
      userId: action.userId,
      to: [data.client_email],
      subject: data.subject,
      body: data.draft_text,
      contentType: "text",
    }),
  });

  if (!sendResponse.ok) {
    const errBody = await sendResponse.text();
    throw new Error(`Failed to send payment reminder: ${errBody}`);
  }

  // 2. Update invoice status to 'past_due' if currently sent or awaiting_payment
  try {
    await supabase
      .from("invoices")
      .update({ status: "past_due" })
      .eq("id", data.invoice_id)
      .eq("company_id", action.companyId)
      .in("status", ["sent", "awaiting_payment"]);
  } catch {
    // Non-critical — invoice may already be past_due or partially_paid
  }

  // 3. Record in ai_draft_history via recordDraftOutcome for full learning loop
  //    (GPT diff analysis, learnFromEdits, content correction storage)
  try {
    const { AIDraftService } = await import("./ai-draft-service");
    const originalDraft = data.original_draft_text;
    const finalDraft = data.draft_text;

    // First insert the draft history record
    const { data: historyRow } = await supabase
      .from("ai_draft_history")
      .insert({
        company_id: action.companyId,
        user_id: action.userId,
        connection_id: data.connection_id || null,
        original_draft: originalDraft,
        profile_type: "client_followup",
        status: "drafted",
      })
      .select("id")
      .single();

    if (historyRow?.id) {
      // Use recordDraftOutcome for the full learning pipeline
      await AIDraftService.recordDraftOutcome(
        historyRow.id as string,
        action.companyId,
        action.userId,
        "sent",
        finalDraft,
        "client_followup"
      );
    }
  } catch {
    // Non-critical — don't block on draft history
  }

  // 4. Fire a notification to the user
  try {
    const { renderForCompany } = await import("@/i18n/server-render");
    const [title, body] = await Promise.all([
      renderForCompany(
        action.companyId,
        "server-emails",
        "paymentReminder.notification.title"
      ),
      renderForCompany(
        action.companyId,
        "server-emails",
        "paymentReminder.notification.body",
        {
          clientName: data.client_name,
          invoiceNumber: data.invoice_number,
        }
      ),
    ]);

    await NotificationService.create({
      userId: action.userId,
      companyId: action.companyId,
      type: "mention",
      title,
      body,
      persistent: false,
      actionUrl: `/pipeline?invoice=${data.invoice_id}`,
      actionLabel: "View Invoice",
    });
  } catch {
    // Non-critical
  }

  return {
    invoiceId: data.invoice_id,
    invoiceNumber: data.invoice_number,
    clientEmail: data.client_email,
    reminderLevel: data.reminder_level,
    reminderTone: data.reminder_tone,
  };
}

// ─── Client Health Alert Executor ───────────────────────────────────────────

async function executeClientHealthAlert(
  action: AgentAction
): Promise<Record<string, unknown>> {
  // This is a notification-only action — approval = acknowledgement
  return {
    acknowledged: true,
    clientId: (action.actionData as Record<string, unknown>).client_id,
    reviewedAt: new Date().toISOString(),
  };
}

async function executeFinancialInsight(
  action: AgentAction
): Promise<Record<string, unknown>> {
  // Notification-only action — approval = acknowledgement (user has seen the digest)
  const data = action.actionData as unknown as FinancialInsightActionData;

  // Optionally store key insights as agent memories for future draft context
  const supabase = requireSupabase();
  try {
    const alerts = data.alerts ?? [];
    if (alerts.length > 0) {
      const alertSummary = alerts
        .map((a) => `${a.type}: ${JSON.stringify(a.params)}`)
        .join("; ");

      await supabase.from("agent_memories").insert({
        company_id: action.companyId,
        memory_type: "fact",
        category: "financial_insight",
        content: `Financial digest acknowledged with alerts: ${alertSummary}`,
        confidence: 1.0,
        source: "financial_analysis",
      });
    }
  } catch {
    // Non-fatal — memory storage is supplementary
  }

  return {
    acknowledged: true,
    viewed_at: new Date().toISOString(),
    digest_type: data.digest_type,
  };
}

// ─── Optimize Schedule Executor ───────────────────────────────────────────

async function executeOptimizeSchedule(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as OptimizeScheduleActionData;

  if (data.optimization_type === "route_reorder") {
    const taskIds = data.suggested_order.map((item) => item.task_id);

    // Fetch existing tasks to capture original time slots in chronological order.
    // For timed schedules, reordering display_order alone is insufficient — we
    // must reflow start_time/end_time so the new sequence actually occupies the
    // day's existing time slots in the optimized order.
    const { data: existingTasks, error: fetchErr } = await supabase
      .from("project_tasks")
      .select("id, start_time, end_time, start_date, end_date")
      .eq("company_id", action.companyId)
      .in("id", taskIds);

    if (fetchErr) {
      throw new Error(`Failed to fetch tasks for route reorder: ${fetchErr.message}`);
    }

    // Build chronological slot list — sorted by start_time (nulls last)
    const taskMap = new Map<string, Record<string, unknown>>();
    for (const t of existingTasks ?? []) {
      taskMap.set(t.id as string, t as Record<string, unknown>);
    }

    const slotsChronological = (existingTasks ?? [])
      .slice()
      .sort((a, b) => {
        const at = (a.start_time as string | null) ?? "";
        const bt = (b.start_time as string | null) ?? "";
        if (!at && !bt) return 0;
        if (!at) return 1;
        if (!bt) return -1;
        return at.localeCompare(bt);
      })
      .map((t) => ({
        start_time: (t.start_time as string | null) ?? null,
        end_time: (t.end_time as string | null) ?? null,
        start_date: (t.start_date as string | null) ?? null,
        end_date: (t.end_date as string | null) ?? null,
      }));

    // Apply slots to tasks in the suggested order.
    // Slot[i] → suggested_order[i] — preserves chronological time boundaries
    // while re-sequencing which task occupies each slot.
    for (let i = 0; i < data.suggested_order.length; i++) {
      const item = data.suggested_order[i];
      const slot = slotsChronological[i];
      const updatePayload: Record<string, unknown> = {
        display_order: i + 1,
      };
      if (slot) {
        if (slot.start_time !== null) updatePayload.start_time = slot.start_time;
        if (slot.end_time !== null) updatePayload.end_time = slot.end_time;
        // Keep start_date/end_date stable if they already match — but in case
        // multi-day routes were re-ordered across days, reflow those too.
        if (slot.start_date !== null) updatePayload.start_date = slot.start_date;
        if (slot.end_date !== null) updatePayload.end_date = slot.end_date;
      }

      const { error: updateErr } = await supabase
        .from("project_tasks")
        .update(updatePayload)
        .eq("id", item.task_id)
        .eq("company_id", action.companyId);

      if (updateErr) {
        throw new Error(
          `Failed to update task ${item.task_id} in route reorder: ${updateErr.message}`
        );
      }
    }

    return {
      optimizationType: "route_reorder",
      teamMemberId: data.team_member_id,
      date: data.date,
      tasksReordered: data.suggested_order.length,
      distanceSaved: data.distance_saved_km,
    };
  }

  return { optimizationType: data.optimization_type };
}

// ─── Reschedule Tasks Executor ────────────────────────────────────────────

async function executeRescheduleTasks(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data = action.actionData as unknown as RescheduleTasksActionData;

  if (data.resolution_type === "conflict" && data.suggested_resolution) {
    const res = data.suggested_resolution;

    // Update the task's dates
    const updatePayload: Record<string, unknown> = {};
    if (res.new_start_date) updatePayload.start_date = res.new_start_date;
    if (res.new_end_date) updatePayload.end_date = res.new_end_date;
    if (res.new_team_member_id) {
      updatePayload.team_member_ids = [res.new_team_member_id];
    }

    if (Object.keys(updatePayload).length > 0) {
      await supabase
        .from("project_tasks")
        .update(updatePayload)
        .eq("id", res.task_id)
        .eq("company_id", action.companyId);
    }

    // Fire-and-forget: detect further cascade
    import("./schedule-optimization-service")
      .then(({ ScheduleOptimizationService }) =>
        ScheduleOptimizationService.handleRescheduleCascade(
          action.companyId,
          action.userId,
          res.task_id,
          "conflict_resolution"
        )
      )
      .catch((err) =>
        console.error("[approval-queue] Cascade after conflict resolution:", err)
      );

    return {
      resolutionType: "conflict",
      taskId: res.task_id,
      rescheduled: true,
    };
  }

  if (data.resolution_type === "assign" && data.task_id) {
    // Set team_member_ids on the unassigned task
    if (data.suggested_team_member_id) {
      await supabase
        .from("project_tasks")
        .update({ team_member_ids: [data.suggested_team_member_id] })
        .eq("id", data.task_id)
        .eq("company_id", action.companyId);

      // Notify the assigned member
      try {
        await NotificationService.create({
          userId: data.suggested_team_member_id,
          companyId: action.companyId,
          type: "mention",
          title: "Task assigned to you",
          body: `"${data.task_title}" has been assigned to you.`,
          persistent: false,
          actionUrl: "/calendar",
          actionLabel: "View Schedule",
        });
      } catch {
        // Non-critical
      }

      // Fire-and-forget cascade — assigning to a member who already has
      // tasks may create a new conflict we should surface.
      const assignedTaskId = data.task_id;
      import("./schedule-optimization-service")
        .then(({ ScheduleOptimizationService }) =>
          ScheduleOptimizationService.handleRescheduleCascade(
            action.companyId,
            action.userId,
            assignedTaskId,
            "assignment"
          )
        )
        .catch((err) =>
          console.error("[approval-queue] Cascade after assignment:", err)
        );
    }

    return {
      resolutionType: "assign",
      taskId: data.task_id,
      assignedTo: data.suggested_team_member_id,
    };
  }

  if (data.resolution_type === "cascade" && data.suggested_resolution) {
    const res = data.suggested_resolution;

    const updatePayload: Record<string, unknown> = {};
    if (res.new_start_date) updatePayload.start_date = res.new_start_date;
    if (res.new_end_date) updatePayload.end_date = res.new_end_date;
    if (res.new_team_member_id) {
      updatePayload.team_member_ids = [res.new_team_member_id];
    }

    if (Object.keys(updatePayload).length > 0) {
      await supabase
        .from("project_tasks")
        .update(updatePayload)
        .eq("id", res.task_id)
        .eq("company_id", action.companyId);
    }

    // Fire-and-forget: detect further cascades
    import("./schedule-optimization-service")
      .then(({ ScheduleOptimizationService }) =>
        ScheduleOptimizationService.handleRescheduleCascade(
          action.companyId,
          action.userId,
          res.task_id,
          "cascade_resolution"
        )
      )
      .catch((err) =>
        console.error("[approval-queue] Cascade after cascade resolution:", err)
      );

    return {
      resolutionType: "cascade",
      taskId: res.task_id,
      rescheduled: true,
    };
  }

  return { resolutionType: data.resolution_type };
}

// ─── Client Scheduling Comms Helpers ─────────────────────────────────────────

/**
 * Shared send path for appointment-confirmation / day-before-reminder /
 * subcontractor-coordination / reschedule-request-reply. Sends the email
 * via the internal send endpoint, records draft history via
 * AIDraftService.recordDraftOutcome for the full writing-profile learning
 * loop (edit distance, GPT diff analysis, content corrections), and logs
 * an activity on the thread/opportunity when available.
 */
async function sendClientCommsEmail(params: {
  companyId: string;
  userId: string;
  connectionId: string;
  toEmail: string;
  subject: string;
  finalDraft: string;
  originalDraft: string;
  profileType: string;
  threadId?: string | null;
  opportunityId?: string | null;
}): Promise<{ messageId: string | null }> {
  const supabase = requireSupabase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  if (!params.connectionId) {
    throw new Error("No email connection configured — cannot send");
  }

  const sendResponse = await fetch(`${appUrl}/api/integrations/email/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
    },
    body: JSON.stringify({
      connectionId: params.connectionId,
      companyId: params.companyId,
      userId: params.userId,
      to: [params.toEmail],
      subject: params.subject,
      body: params.finalDraft,
      contentType: "text",
    }),
  });

  if (!sendResponse.ok) {
    const errBody = await sendResponse.text();
    throw new Error(`Failed to send client comms email: ${errBody}`);
  }

  const result = await sendResponse.json();

  // Record in ai_draft_history + run the full learning pipeline.
  // Uses the correct column `original_draft` (NOT `draft_text`) and lets
  // recordDraftOutcome compute the real edit distance — no hardcoded zero.
  try {
    const { data: historyRow } = await supabase
      .from("ai_draft_history")
      .insert({
        company_id: params.companyId,
        user_id: params.userId,
        connection_id: params.connectionId,
        original_draft: params.originalDraft,
        profile_type: params.profileType,
        status: "drafted",
      })
      .select("id")
      .single();

    if (historyRow?.id) {
      const { AIDraftService } = await import("./ai-draft-service");
      await AIDraftService.recordDraftOutcome(
        historyRow.id as string,
        params.companyId,
        params.userId,
        "sent",
        params.finalDraft,
        params.profileType
      );
    }
  } catch (err) {
    console.error(
      "[approval-queue] recordDraftOutcome failed (non-fatal):",
      err
    );
  }

  // Log an activity row on the thread if we have one, so the outbound
  // message appears in the thread timeline alongside the inbound email.
  if (params.threadId || params.opportunityId) {
    try {
      await supabase.from("activities").insert({
        company_id: params.companyId,
        type: "email",
        subject: params.subject,
        content: params.finalDraft.slice(0, 300),
        body_text: params.finalDraft,
        email_thread_id: params.threadId ?? null,
        opportunity_id: params.opportunityId ?? null,
        direction: "outbound",
        from_email: null,
        to_emails: [params.toEmail],
        cc_emails: [],
        has_attachments: false,
        attachment_count: 0,
        match_confidence: "ai_agent",
        is_read: true,
      });
    } catch {
      // Non-critical
    }
  }

  return { messageId: (result.messageId as string) ?? null };
}

// ─── Send Appointment Confirmation Executor ──────────────────────────────────

async function executeSendAppointmentConfirmation(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data =
    action.actionData as unknown as SendAppointmentConfirmationActionData;

  const { messageId } = await sendClientCommsEmail({
    companyId: action.companyId,
    userId: action.userId,
    connectionId: data.connection_id,
    toEmail: data.client_email,
    subject: data.subject,
    finalDraft: data.draft_text,
    originalDraft: data.original_draft_text ?? data.draft_text,
    profileType: "client_active_project",
  });

  // Notify the user that the confirmation went out
  try {
    await NotificationService.create({
      userId: action.userId,
      companyId: action.companyId,
      type: "mention",
      title: "Appointment confirmation sent",
      body: `Confirmation sent to ${data.client_name} for ${data.project_title}`,
      persistent: false,
      actionUrl: `/projects/${data.project_id}`,
      actionLabel: "View Project",
    });
  } catch {
    // Non-critical
  }

  return {
    messageId,
    taskId: data.task_id,
    projectId: data.project_id,
    clientEmail: data.client_email,
  };
}

// ─── Send Day-Before Reminder Executor ───────────────────────────────────────

async function executeSendDayBeforeReminder(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data =
    action.actionData as unknown as SendDayBeforeReminderActionData;

  const { messageId } = await sendClientCommsEmail({
    companyId: action.companyId,
    userId: action.userId,
    connectionId: data.connection_id,
    toEmail: data.client_email,
    subject: data.subject,
    finalDraft: data.draft_text,
    originalDraft: data.original_draft_text ?? data.draft_text,
    profileType: "client_active_project",
  });

  try {
    await NotificationService.create({
      userId: action.userId,
      companyId: action.companyId,
      type: "mention",
      title: "Day-before reminder sent",
      body: `Reminder sent to ${data.client_name} for ${data.project_title}`,
      persistent: false,
      actionUrl: `/projects/${data.project_id}`,
      actionLabel: "View Project",
    });
  } catch {
    // Non-critical
  }

  return {
    messageId,
    taskId: data.task_id,
    projectId: data.project_id,
  };
}

// ─── Send Schedule Changed Executor (S2 Amendment) ──────────────────────────

async function executeSendScheduleChanged(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data =
    action.actionData as unknown as SendScheduleChangedActionData;

  const { messageId } = await sendClientCommsEmail({
    companyId: action.companyId,
    userId: action.userId,
    connectionId: data.connection_id,
    toEmail: data.client_email,
    subject: data.subject,
    finalDraft: data.draft_text,
    originalDraft: data.original_draft_text ?? data.draft_text,
    profileType: "client_active_project",
  });

  try {
    await NotificationService.create({
      userId: action.userId,
      companyId: action.companyId,
      type: "mention",
      title: "Schedule change notification sent",
      body: `Notified ${data.client_name} about the new date for ${data.project_title}`,
      persistent: false,
      actionUrl: `/projects/${data.project_id}`,
      actionLabel: "View Project",
    });
  } catch {
    // Non-critical
  }

  return {
    messageId,
    taskId: data.task_id,
    projectId: data.project_id,
  };
}

// ─── Send Subcontractor Coordination Executor ────────────────────────────────

async function executeSendSubcontractorCoordination(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const data =
    action.actionData as unknown as SendSubcontractorCoordinationActionData;

  const { messageId } = await sendClientCommsEmail({
    companyId: action.companyId,
    userId: action.userId,
    connectionId: data.connection_id,
    toEmail: data.subcontractor_email,
    subject: data.subject,
    finalDraft: data.draft_text,
    originalDraft: data.original_draft_text ?? data.draft_text,
    profileType: "subtrade_coordination",
  });

  try {
    await NotificationService.create({
      userId: action.userId,
      companyId: action.companyId,
      type: "mention",
      title: "Subcontractor coordination sent",
      body: `Coordination sent to ${data.subcontractor_name} for ${data.project_title}`,
      persistent: false,
      actionUrl: `/projects/${data.project_id}`,
      actionLabel: "View Project",
    });
  } catch {
    // Non-critical
  }

  return {
    messageId,
    projectId: data.project_id,
    subcontractorEmail: data.subcontractor_email,
  };
}

// ─── Process Reschedule Request Executor ─────────────────────────────────────

async function executeProcessRescheduleRequest(
  action: AgentAction
): Promise<Record<string, unknown>> {
  const supabase = requireSupabase();
  const data =
    action.actionData as unknown as ProcessRescheduleRequestActionData;

  // 1. Send the reply
  const { messageId } = await sendClientCommsEmail({
    companyId: action.companyId,
    userId: action.userId,
    connectionId: data.connection_id,
    toEmail: data.client_email,
    subject: data.subject,
    finalDraft: data.reply_draft_text,
    originalDraft: data.original_reply_draft_text ?? data.reply_draft_text,
    profileType: "client_active_project",
    threadId: data.thread_id,
    opportunityId: data.opportunity_id,
  });

  // 2. Resolve the confirmed new date — honor the user's edits.
  //    If the user selected an alternative via selected_alternative_index
  //    (potentially overridden via editedActionData in approveAction),
  //    use that. Otherwise fall back to index 0.
  const alternatives = data.suggested_alternatives ?? [];
  const selectedIndex =
    typeof data.selected_alternative_index === "number" &&
    data.selected_alternative_index >= 0 &&
    data.selected_alternative_index < alternatives.length
      ? data.selected_alternative_index
      : 0;
  const confirmed = alternatives[selectedIndex];

  let taskUpdated = false;
  if (confirmed && data.affected_task_id) {
    // Keep duration: compute new end_date by preserving the original span
    const originalStart = data.original_start_date
      ? new Date(data.original_start_date)
      : null;
    const originalEnd = data.original_end_date
      ? new Date(data.original_end_date)
      : null;
    const spanMs =
      originalStart && originalEnd
        ? originalEnd.getTime() - originalStart.getTime()
        : 0;

    const newStart = new Date(confirmed.date);
    const newEnd = spanMs > 0 ? new Date(newStart.getTime() + spanMs) : null;

    const updatePayload: Record<string, unknown> = {
      start_date: newStart.toISOString(),
    };
    if (newEnd) updatePayload.end_date = newEnd.toISOString();
    if (confirmed.team_member_id) {
      updatePayload.team_member_ids = [confirmed.team_member_id];
    }

    const { error: taskErr } = await supabase
      .from("project_tasks")
      .update(updatePayload)
      .eq("id", data.affected_task_id)
      .eq("company_id", action.companyId);

    if (taskErr) {
      console.error(
        "[approval-queue] reschedule task update failed:",
        taskErr.message
      );
    } else {
      taskUpdated = true;

      // Sync the calendar event if one exists
      const { data: taskRow } = await supabase
        .from("project_tasks")
        .select("calendar_event_id")
        .eq("id", data.affected_task_id)
        .maybeSingle();

      const calendarEventId = taskRow?.calendar_event_id as string | null;
      if (calendarEventId) {
        const cePayload: Record<string, unknown> = {
          start_date: newStart.toISOString(),
        };
        if (newEnd) cePayload.end_date = newEnd.toISOString();
        if (confirmed.team_member_id) {
          cePayload.team_member_ids = [confirmed.team_member_id];
        }
        await supabase
          .from("calendar_events")
          .update(cePayload)
          .eq("id", calendarEventId);
      }
    }
  }

  // 3. Fire-and-forget cascade detection
  if (taskUpdated && data.affected_task_id) {
    const affectedTaskId = data.affected_task_id;
    import("./schedule-optimization-service")
      .then(({ ScheduleOptimizationService }) =>
        ScheduleOptimizationService.handleRescheduleCascade(
          action.companyId,
          action.userId,
          affectedTaskId,
          "reschedule_request"
        )
      )
      .catch((err) =>
        console.error(
          "[approval-queue] Cascade after reschedule request:",
          err
        )
      );
  }

  // 4. Notify the user
  try {
    await NotificationService.create({
      userId: action.userId,
      companyId: action.companyId,
      type: "mention",
      title: "Reschedule handled",
      body: `Replied to ${data.client_name} and ${taskUpdated ? "updated the task" : "acknowledged the request"}`,
      persistent: false,
      actionUrl: `/projects/${data.project_id}`,
      actionLabel: "View Project",
    });
  } catch {
    // Non-critical
  }

  return {
    messageId,
    taskId: data.affected_task_id,
    projectId: data.project_id,
    taskUpdated,
    confirmedDate: confirmed?.date ?? null,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const ApprovalQueueService = {
  /**
   * Propose a new action for the queue.
   * Deduplicates by action_type + source_id (enforced at DB level).
   * Sends notifications to admin/owner users — not the triggering user.
   * Returns the action ID, or null if deduplicated.
   */
  async proposeAction(params: ProposeActionParams): Promise<string | null> {
    const supabase = requireSupabase();

    // Application-level dedup check (belt + suspenders with the DB unique index)
    if (params.sourceId) {
      const { data: existing } = await supabase
        .from("agent_actions")
        .select("id")
        .eq("company_id", params.companyId)
        .eq("action_type", params.actionType)
        .eq("source_id", params.sourceId)
        .eq("status", "pending")
        .limit(1);

      if (existing && existing.length > 0) {
        return null; // Already proposed
      }
    }

    const expiresAt = params.expiresAt ?? defaultExpiry(params.actionType);

    const { data, error } = await supabase
      .from("agent_actions")
      .insert({
        company_id: params.companyId,
        user_id: params.userId,
        action_type: params.actionType,
        action_data: params.actionData,
        context_summary: params.contextSummary,
        context_source: params.contextSource ?? null,
        source_id: params.sourceId ?? null,
        confidence: params.confidence ?? 0.5,
        priority: params.priority ?? "normal",
        status: "pending",
        expires_at: expiresAt.toISOString(),
        auto_execute_at: params.autoExecuteAt
          ? params.autoExecuteAt.toISOString()
          : null,
      })
      .select("id")
      .single();

    if (error) {
      // Unique constraint violation = dedup
      if (error.code === "23505") return null;
      throw new Error(`Failed to propose action: ${error.message}`);
    }

    const actionId = data!.id as string;

    // Notify admin/owner users — not the triggering user
    const adminIds = await getAdminUserIds(params.companyId);
    await Promise.allSettled(
      adminIds.map((adminId) =>
        NotificationService.create({
          userId: adminId,
          companyId: params.companyId,
          type: "agent_suggestion",
          title: "New agent suggestion",
          body: params.contextSummary,
          persistent: false,
          actionUrl: "/agent/queue",
          actionLabel: "Review",
        })
      )
    );

    return actionId;
  },

  /**
   * Fetch the queue for a company, optionally filtered.
   * Priority sorting at DB level via CASE expression.
   */
  async getQueue(
    companyId: string,
    filters: QueueFilters = {}
  ): Promise<AgentAction[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("agent_actions")
      .select("*")
      .eq("company_id", companyId);

    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.actionType) {
      query = query.eq("action_type", filters.actionType);
    }
    if (filters.priority) {
      query = query.eq("priority", filters.priority);
    }

    // DB-level sort: priority order then newest first.
    // Supabase PostgREST doesn't support CASE in order, so we use a
    // two-column sort: priority text (urgent < high < normal < low
    // alphabetically doesn't work), so we still sort in-app but AFTER
    // fetching ALL matching rows sorted by created_at desc.
    // To fix properly we'd need a DB function or numeric priority column.
    // For now: fetch sorted by created_at, then stable-sort by priority.
    query = query.order("created_at", { ascending: false });

    const { data, error } = await query.limit(200);

    if (error) throw new Error(`Failed to fetch queue: ${error.message}`);

    const priorityOrder: Record<string, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    const actions = (data ?? []).map(mapFromDb);
    actions.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return actions;
  },

  /**
   * Get pending actions count for a company.
   */
  async getPendingCount(companyId: string): Promise<number> {
    const supabase = requireSupabase();
    const { count, error } = await supabase
      .from("agent_actions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pending");

    if (error) return 0;
    return count ?? 0;
  },

  /**
   * Approve an action — atomic conditional update to prevent TOCTOU races.
   * Only transitions pending → approved. If the row was already handled
   * by another user, returns an error.
   */
  async approveAction(
    actionId: string,
    companyId: string,
    userId: string,
    editedActionData?: Record<string, unknown>
  ): Promise<AgentAction> {
    const supabase = requireSupabase();

    // If the reviewer edited the action data (e.g. changed team member or dates),
    // apply the edits to action_data before approving
    const updatePayload: Record<string, unknown> = {
      status: "approved",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    };
    if (editedActionData) {
      updatePayload.action_data = editedActionData;
    }

    // Atomic: only update if still pending AND belongs to this company
    const { data: approved, error: approveErr } = await supabase
      .from("agent_actions")
      .update(updatePayload)
      .eq("id", actionId)
      .eq("company_id", companyId)
      .eq("status", "pending")
      .select("*")
      .single();

    if (approveErr || !approved) {
      throw new Error("Action not found or already handled");
    }

    const action = mapFromDb(approved);

    // Execute
    try {
      const result = await executeAction(action);

      const { data: final } = await supabase
        .from("agent_actions")
        .update({
          status: "executed",
          executed_at: new Date().toISOString(),
          execution_result: result,
        })
        .eq("id", actionId)
        .eq("company_id", companyId)
        .select("*")
        .single();

      if (!final) throw new Error("Action not found after execution");
      return mapFromDb(final);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      await supabase
        .from("agent_actions")
        .update({
          status: "failed",
          error: message,
        })
        .eq("id", actionId)
        .eq("company_id", companyId);

      throw new Error(`Action execution failed: ${message}`);
    }
  },

  /**
   * Reject an action with optional notes — atomic conditional update.
   */
  async rejectAction(
    actionId: string,
    companyId: string,
    userId: string,
    notes?: string
  ): Promise<AgentAction> {
    const supabase = requireSupabase();

    const { data: updated, error } = await supabase
      .from("agent_actions")
      .update({
        status: "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes ?? null,
      })
      .eq("id", actionId)
      .eq("company_id", companyId)
      .eq("status", "pending")
      .select("*")
      .single();

    if (error || !updated) {
      throw new Error("Action not found or already handled");
    }

    return mapFromDb(updated);
  },

  /**
   * Bulk approve multiple actions.
   */
  async bulkApprove(
    actionIds: string[],
    companyId: string,
    userId: string
  ): Promise<{ approved: number; failed: number; errors: string[] }> {
    const result = { approved: 0, failed: 0, errors: [] as string[] };

    for (const actionId of actionIds) {
      try {
        await ApprovalQueueService.approveAction(actionId, companyId, userId);
        result.approved++;
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : "Unknown error";
        result.errors.push(`${actionId}: ${message}`);
      }
    }

    return result;
  },

  /**
   * Bulk reject multiple actions.
   */
  async bulkReject(
    actionIds: string[],
    companyId: string,
    userId: string,
    notes?: string
  ): Promise<{ rejected: number; failed: number; errors: string[] }> {
    const result = { rejected: 0, failed: 0, errors: [] as string[] };

    for (const actionId of actionIds) {
      try {
        await ApprovalQueueService.rejectAction(actionId, companyId, userId, notes);
        result.rejected++;
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : "Unknown error";
        result.errors.push(`${actionId}: ${message}`);
      }
    }

    return result;
  },

  /**
   * Cancel a pending action (user-initiated). Scoped to company.
   */
  async cancelAction(actionId: string, companyId: string): Promise<void> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("agent_actions")
      .update({ status: "cancelled" })
      .eq("id", actionId)
      .eq("company_id", companyId)
      .eq("status", "pending")
      .select("id");

    if (error) throw new Error(`Failed to cancel action: ${error.message}`);
    if (!data || data.length === 0) throw new Error("Action not found or already handled");
  },

  /**
   * Queue statistics for a company. All queries run in parallel.
   */
  async getStats(companyId: string): Promise<QueueStats> {
    const supabase = requireSupabase();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [pendingRes, approvedRes, rejectedRes, reviewedRes] =
      await Promise.all([
        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "pending"),

        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .in("status", ["approved", "executed"])
          .gte("reviewed_at", todayIso),

        supabase
          .from("agent_actions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "rejected")
          .gte("reviewed_at", todayIso),

        supabase
          .from("agent_actions")
          .select("created_at, reviewed_at")
          .eq("company_id", companyId)
          .not("reviewed_at", "is", null)
          .order("reviewed_at", { ascending: false })
          .limit(50),
      ]);

    let avgResponseTimeMinutes: number | null = null;
    const reviewed = reviewedRes.data;
    if (reviewed && reviewed.length > 0) {
      const totalMinutes = reviewed.reduce((sum, r) => {
        const created = new Date(r.created_at as string).getTime();
        const reviewedAt = new Date(r.reviewed_at as string).getTime();
        return sum + (reviewedAt - created) / 60000;
      }, 0);
      avgResponseTimeMinutes = Math.round(totalMinutes / reviewed.length);
    }

    return {
      pending: pendingRes.count ?? 0,
      approvedToday: approvedRes.count ?? 0,
      rejectedToday: rejectedRes.count ?? 0,
      avgResponseTimeMinutes,
    };
  },
};
