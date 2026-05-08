/**
 * OPS Web - Client-side Notification Dispatch
 *
 * Typed helper functions for dispatching multi-channel notifications
 * via the /api/notifications/dispatch route. Each function is fire-and-forget:
 * notification failures never break the calling mutation.
 */

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
 * Fire-and-forget notification dispatch. Never throws — logs errors to console.
 * The server route handles auth via cookies, self-notification filtering,
 * and notification preference checks.
 */
async function dispatch(params: DispatchParams): Promise<void> {
  if (!params.recipientIds.length) return;

  try {
    const res = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[notification-dispatch] ${params.eventType} failed:`, err);
    }
  } catch (err) {
    console.error(`[notification-dispatch] ${params.eventType} error:`, err);
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
}): void {
  dispatch({
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
