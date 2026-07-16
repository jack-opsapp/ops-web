/**
 * Client notification event dispatch.
 *
 * Requests contain only persisted event proof IDs. The server derives the
 * canonical actor/company, authorized recipient relationship, copy,
 * navigation, persistence, and push payload.
 */

import type { NotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";

async function dispatch(request: NotificationDispatchRequest): Promise<void> {
  try {
    const response = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error(
        `[notification-dispatch] ${request.eventType} failed:`,
        error
      );
    }
  } catch (error) {
    console.error(`[notification-dispatch] ${request.eventType} error:`, error);
  }
}

export function dispatchProjectAssignment(params: {
  projectId: string;
  projectTitle: string;
  newMemberIds: string[];
  companyId: string;
}): void {
  if (params.newMemberIds.length === 0) return;
  void dispatch({
    eventType: "project_assigned",
    projectId: params.projectId,
    candidateRecipientIds: params.newMemberIds,
  });
}

export function dispatchProjectArchived(params: {
  projectId: string;
  projectTitle: string;
  archivedByName: string;
  recipientUserIds: string[];
  companyId: string;
}): void {
  void dispatch({ eventType: "project_archived", projectId: params.projectId });
}

export function dispatchProjectStatusChange(params: {
  projectId: string;
  projectTitle: string;
  fromStatus: string;
  toStatus: string;
  changedByName: string;
  recipientUserIds: string[];
  companyId: string;
}): void {
  void dispatch({
    eventType: "project_status_change",
    projectId: params.projectId,
  });
}

export function dispatchLeadConverted(params: {
  projectId: string;
  dealName: string;
  convertedByName: string;
  recipientUserIds: string[];
  companyId: string;
}): void {
  void dispatch({ eventType: "lead_converted", projectId: params.projectId });
}

export function dispatchTaskAssignment(params: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
  newMemberIds: string[];
  companyId: string;
}): void {
  if (params.newMemberIds.length === 0) return;
  void dispatch({
    eventType: "task_assigned",
    taskId: params.taskId,
    candidateRecipientIds: params.newMemberIds,
  });
}

export function dispatchTaskCompleted(params: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
  completedByName: string;
  teamMemberIds: string[];
  companyId: string;
}): void {
  void dispatch({ eventType: "task_completed", taskId: params.taskId });
}

export function dispatchScheduleChange(params: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectTitle: string;
  teamMemberIds: string[];
  companyId: string;
}): void {
  void dispatch({ eventType: "schedule_change", taskId: params.taskId });
}

export function dispatchMentionPush(params: { noteId: string }): void {
  void dispatch({ eventType: "mention", noteId: params.noteId });
}

export function dispatchExpenseSubmitted(params: {
  expenseId: string;
  expenseDescription: string;
  submittedByName: string;
  approverIds: string[];
  companyId: string;
  projectId?: string;
  actionUrl?: string;
}): void {
  void dispatch({
    eventType: "expense_submitted",
    expenseId: params.expenseId,
  });
}

export function dispatchExpenseApproved(params: {
  batchId: string;
  expenseDescription?: string;
  submitterId?: string;
  companyId?: string;
  actionUrl?: string;
}): void {
  void dispatch({ eventType: "expense_approved", batchId: params.batchId });
}

export function dispatchExpensePaid(params: {
  batchId: string;
  batchLabel?: string;
  submitterId?: string;
  companyId?: string;
  actionUrl?: string;
}): void {
  void dispatch({ eventType: "expense_paid", batchId: params.batchId });
}
