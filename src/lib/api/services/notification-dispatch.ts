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
