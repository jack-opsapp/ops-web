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
  ReassignTaskActionData,
  ArchiveProjectActionData,
} from "@/lib/types/approval-queue";
import { ProjectStatus, TaskStatus } from "@/lib/types/models";

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
    createdAt: parseDate(row.created_at) ?? new Date(),
    updatedAt: parseDate(row.updated_at) ?? new Date(),
  };
}

// ─── Expiry Defaults ──────────────────────────────────────────────────────────

const EXPIRY_DAYS: Record<string, number> = {
  create_project: 7,
  create_task: 7,
  create_invoice: 3,
  send_email: 1,
  send_status_email: 3,
  reassign_task: 7,
  archive_project: 14,
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
  const supabase = requireSupabase();
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

  // Record in ai_draft_history for learning (best effort)
  try {
    await supabase.from("ai_draft_history").insert({
      company_id: action.companyId,
      user_id: action.userId,
      connection_id: data.connection_id,
      draft_text: data.draft_text,
      final_text: data.draft_text,
      profile_type: "client_active_project",
      status: "sent",
      edit_distance: 0,
    });
  } catch {
    // Non-critical — don't block on this
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
