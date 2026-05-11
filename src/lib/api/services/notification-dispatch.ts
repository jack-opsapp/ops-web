/**
 * OPS Web - Client-side Notification Dispatch
 *
 * Typed helper functions for dispatching multi-channel notifications
 * via the /api/notifications/dispatch route. Helpers return a
 * `DispatchResult` so callers that care (e.g. @mentions on notes) can
 * surface failure to the operator; callers that don't can ignore the
 * returned promise and keep the fire-and-forget behavior.
 */

export interface DispatchResult {
  ok: boolean;
  /** Number of recipients targeted (0 when nothing to do). */
  attempted: number;
  /** Human-readable reason populated when `ok === false`. */
  error?: string;
  /** HTTP status when the route was reached; absent for network errors. */
  status?: number;
}

// ─── Types (mirrors the dispatch route's DispatchBody) ───────────────────────

type NotificationEventType =
  | "project_assigned"
  | "project_status_change"
  | "project_archived"
  | "task_assigned"
  | "task_completed"
  | "schedule_change"
  | "expense_submitted"
  | "expense_approved"
  | "mention";

interface DispatchParams {
  eventType: NotificationEventType;
  recipientIds: string[];
  companyId: string;
  title: string;
  body: string;
  projectId?: string;
  noteId?: string;
  actionUrl?: string;
  actionLabel?: string;
  persistent?: boolean;
  pushData?: Record<string, string>;
}

// ─── Core Dispatcher ─────────────────────────────────────────────────────────

/**
 * Notification dispatch. Never throws — returns a structured result that
 * callers can inspect to surface failure to the operator. Callers that
 * don't care can ignore the returned promise and rely on the logged
 * error. The server route handles auth via cookies, self-notification
 * filtering, and notification preference checks.
 */
async function dispatch(params: DispatchParams): Promise<DispatchResult> {
  if (!params.recipientIds.length) {
    return { ok: true, attempted: 0 };
  }

  try {
    const res = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const reason =
        (err && typeof err === "object" && "error" in err
          ? String((err as { error: unknown }).error)
          : `HTTP ${res.status}`);
      console.error(
        `[notification-dispatch] ${params.eventType} failed:`,
        { status: res.status, error: err, recipients: params.recipientIds.length },
      );
      return {
        ok: false,
        attempted: params.recipientIds.length,
        error: reason,
        status: res.status,
      };
    }

    return { ok: true, attempted: params.recipientIds.length, status: res.status };
  } catch (err) {
    console.error(
      `[notification-dispatch] ${params.eventType} error:`,
      { error: err, recipients: params.recipientIds.length },
    );
    return {
      ok: false,
      attempted: params.recipientIds.length,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ─── Project Notifications ───────────────────────────────────────────────────

/**
 * Notify users they've been added to a project.
 * Called after useCreateProject / useUpdateProject when teamMemberIds change.
 */
export function dispatchProjectAssignment(params: {
  projectId: string;
  projectTitle: string;
  newMemberIds: string[];
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "project_assigned",
    recipientIds: params.newMemberIds,
    companyId: params.companyId,
    title: "Added to Project",
    body: `You've been added to "${params.projectTitle}"`,
    projectId: params.projectId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Project",
    pushData: {
      type: "projectAssignment",
      projectId: params.projectId,
      screen: "projectDetails",
    },
  });
}

/**
 * Notify the project team that a project has been archived.
 * Goes through the dispatch route so push + in-app preferences both fire,
 * and the archiver is auto-filtered out of recipients server-side.
 */
export function dispatchProjectArchived(params: {
  projectId: string;
  projectTitle: string;
  archivedByName: string;
  recipientUserIds: string[];
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "project_archived",
    recipientIds: params.recipientUserIds,
    companyId: params.companyId,
    title: `${params.projectTitle} archived`,
    body: `${params.archivedByName} archived ${params.projectTitle}.`,
    projectId: params.projectId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Project",
    pushData: {
      type: "projectArchived",
      projectId: params.projectId,
      screen: "projectDetails",
    },
  });
}

/**
 * Notify the project team that a project's status has moved to a new stage.
 * Called from ProjectLifecycleService.onProjectStageChange after the
 * project_notes timeline event lands. The recipient list should already
 * exclude the user who triggered the change.
 */
export function dispatchProjectStatusChange(params: {
  projectId: string;
  projectTitle: string;
  fromStatus: string;
  toStatus: string;
  changedByName: string;
  recipientUserIds: string[];
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "project_status_change",
    recipientIds: params.recipientUserIds,
    companyId: params.companyId,
    title: `Status changed: ${params.fromStatus} → ${params.toStatus}`,
    body: `${params.changedByName} moved ${params.projectTitle} from ${params.fromStatus} to ${params.toStatus}.`,
    projectId: params.projectId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Project",
    pushData: {
      type: "projectStatusChange",
      projectId: params.projectId,
      screen: "projectDetails",
    },
  });
}

// ─── Task Notifications ──────────────────────────────────────────────────────

/**
 * Notify users they've been assigned to a task.
 * Called after useCreateTask / useUpdateTask when teamMemberIds change.
 */
export function dispatchTaskAssignment(params: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
  newMemberIds: string[];
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "task_assigned",
    recipientIds: params.newMemberIds,
    companyId: params.companyId,
    title: "New Task Assignment",
    body: `You've been assigned to "${params.taskTitle}" on ${params.projectTitle}`,
    projectId: params.projectId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Task",
    pushData: {
      type: "taskAssignment",
      taskId: params.taskId,
      projectId: params.projectId,
      screen: "taskDetails",
    },
  });
}

/**
 * Notify project team when a task is marked completed.
 */
export function dispatchTaskCompleted(params: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
  completedByName: string;
  teamMemberIds: string[];
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "task_completed",
    recipientIds: params.teamMemberIds,
    companyId: params.companyId,
    title: "Task Completed",
    body: `${params.completedByName} completed "${params.taskTitle}" on ${params.projectTitle}`,
    projectId: params.projectId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Project",
    pushData: {
      type: "taskCompletion",
      taskId: params.taskId,
      projectId: params.projectId,
      screen: "projectDetails",
    },
  });
}

/**
 * Notify task members when a task is rescheduled.
 */
export function dispatchScheduleChange(params: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
  teamMemberIds: string[];
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "schedule_change",
    recipientIds: params.teamMemberIds,
    companyId: params.companyId,
    title: "Schedule Update",
    body: `"${params.taskTitle}" on ${params.projectTitle} has been rescheduled`,
    projectId: params.projectId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Task",
    pushData: {
      type: "scheduleChange",
      taskId: params.taskId,
      projectId: params.projectId,
      screen: "taskDetails",
    },
  });
}

// ─── Mention Notifications ───────────────────────────────────────────────────

/**
 * Send push notifications for @mentions in project notes.
 * Called alongside NotificationService.createMentionNotifications() which
 * handles the in-app notification — this adds the push channel.
 */
export function dispatchMentionPush(params: {
  mentionedUserIds: string[];
  authorName: string;
  notePreview: string;
  projectId: string;
  projectTitle: string;
  noteId: string;
  companyId: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "mention",
    recipientIds: params.mentionedUserIds,
    companyId: params.companyId,
    title: `${params.authorName} mentioned you`,
    body: `"${params.notePreview.length > 80 ? params.notePreview.slice(0, 80) + "..." : params.notePreview}" on ${params.projectTitle}`,
    projectId: params.projectId,
    noteId: params.noteId,
    actionUrl: `/dashboard?openProject=${params.projectId}&mode=view`,
    actionLabel: "View Note",
    pushData: {
      type: "projectNoteMention",
      projectId: params.projectId,
      noteId: params.noteId,
      screen: "projectNotes",
    },
  });
}

// ─── Expense Notifications ───────────────────────────────────────────────────

/**
 * Notify approvers when an expense is submitted.
 */
export function dispatchExpenseSubmitted(params: {
  expenseDescription: string;
  submittedByName: string;
  approverIds: string[];
  companyId: string;
  projectId?: string;
  actionUrl?: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "expense_submitted",
    recipientIds: params.approverIds,
    companyId: params.companyId,
    title: "Expense Submitted",
    body: `${params.submittedByName} submitted an expense: ${params.expenseDescription}`,
    projectId: params.projectId,
    actionUrl: params.actionUrl ?? "/expenses",
    actionLabel: "Review",
    pushData: {
      type: "expenseSubmitted",
      screen: "expenses",
    },
  });
}

/**
 * Notify the submitter when their expense is approved.
 */
export function dispatchExpenseApproved(params: {
  expenseDescription: string;
  submitterId: string;
  companyId: string;
  actionUrl?: string;
}): Promise<DispatchResult> {
  return dispatch({
    eventType: "expense_approved",
    recipientIds: [params.submitterId],
    companyId: params.companyId,
    title: "Expense Approved",
    body: `Your expense "${params.expenseDescription}" has been approved`,
    actionUrl: params.actionUrl ?? "/expenses",
    actionLabel: "View",
    pushData: {
      type: "expenseApproved",
      screen: "expenses",
    },
  });
}
