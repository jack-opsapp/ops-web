export type NotificationDispatchRequest =
  | {
      eventType: "project_status_change";
      projectId: string;
      projectStatusEventId: string;
    }
  | { eventType: "expense_submitted"; expenseId: string }
  | { eventType: "expense_approved" | "expense_paid"; batchId: string }
  | { eventType: "mention"; noteId: string }
  | { eventType: "mention_edit"; mentionEventId: string }
  | CrewNotificationDispatchRequest;

export type CrewNotificationDispatchRequest =
  | {
      eventType: "task_completed" | "task_rescheduled" | "task_assigned";
      taskId: string;
    }
  | {
      eventType: "project_completed" | "project_assigned";
      projectId: string;
    }
  | { eventType: "dependency_ready"; completedTaskId: string }
  | { eventType: "schedule_run_summary"; taskIds: string[] };

export function isCrewNotificationDispatchRequest(
  request: NotificationDispatchRequest
): request is CrewNotificationDispatchRequest {
  return [
    "task_completed",
    "task_rescheduled",
    "task_assigned",
    "project_completed",
    "project_assigned",
    "dependency_ready",
    "schedule_run_summary",
  ].includes(request.eventType);
}

export type NotificationDispatchParseResult =
  | { ok: true; value: NotificationDispatchRequest }
  | { ok: false; reason: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_BODY_KEYS = new Set([
  "companyId",
  "recipientIds",
  "title",
  "body",
  "actionUrl",
  "actionLabel",
  "persistent",
  "pushData",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

export function parseNotificationDispatchRequest(
  input: unknown
): NotificationDispatchParseResult {
  if (!isRecord(input)) return { ok: false, reason: "Invalid request" };
  if (Object.keys(input).some((key) => FORBIDDEN_BODY_KEYS.has(key))) {
    return {
      ok: false,
      reason: "Body-trusted notification fields are forbidden",
    };
  }

  const eventType = input.eventType;
  switch (eventType) {
    case "project_status_change":
      if (
        !hasOnlyKeys(input, [
          "eventType",
          "projectId",
          "projectStatusEventId",
        ]) ||
        !isUuid(input.projectId) ||
        !isUuid(input.projectStatusEventId)
      ) {
        return { ok: false, reason: "Invalid project status proof" };
      }
      return {
        ok: true,
        value: {
          eventType,
          projectId: input.projectId,
          projectStatusEventId: input.projectStatusEventId,
        },
      };
    case "expense_submitted":
      if (
        !hasOnlyKeys(input, ["eventType", "expenseId"]) ||
        !isUuid(input.expenseId)
      ) {
        return { ok: false, reason: "Invalid expense proof" };
      }
      return { ok: true, value: { eventType, expenseId: input.expenseId } };
    case "expense_approved":
    case "expense_paid":
      if (
        !hasOnlyKeys(input, ["eventType", "batchId"]) ||
        !isUuid(input.batchId)
      ) {
        return { ok: false, reason: "Invalid expense batch proof" };
      }
      return { ok: true, value: { eventType, batchId: input.batchId } };
    case "mention":
      if (
        !hasOnlyKeys(input, ["eventType", "noteId"]) ||
        !isUuid(input.noteId)
      ) {
        return { ok: false, reason: "Invalid mention proof" };
      }
      return { ok: true, value: { eventType, noteId: input.noteId } };
    case "mention_edit":
      if (
        !hasOnlyKeys(input, ["eventType", "mentionEventId"]) ||
        !isUuid(input.mentionEventId)
      ) {
        return { ok: false, reason: "Invalid mention edit proof" };
      }
      return {
        ok: true,
        value: { eventType, mentionEventId: input.mentionEventId },
      };
    case "task_completed":
    case "task_rescheduled":
    case "task_assigned":
      if (
        !hasOnlyKeys(input, ["eventType", "taskId"]) ||
        !isUuid(input.taskId)
      ) {
        return { ok: false, reason: "Invalid task notification proof" };
      }
      return { ok: true, value: { eventType, taskId: input.taskId } };
    case "project_completed":
    case "project_assigned":
      if (
        !hasOnlyKeys(input, ["eventType", "projectId"]) ||
        !isUuid(input.projectId)
      ) {
        return { ok: false, reason: "Invalid project notification proof" };
      }
      return { ok: true, value: { eventType, projectId: input.projectId } };
    case "dependency_ready":
      if (
        !hasOnlyKeys(input, ["eventType", "completedTaskId"]) ||
        !isUuid(input.completedTaskId)
      ) {
        return { ok: false, reason: "Invalid dependency notification proof" };
      }
      return {
        ok: true,
        value: { eventType, completedTaskId: input.completedTaskId },
      };
    case "schedule_run_summary": {
      const taskIds = input.taskIds;
      if (
        !hasOnlyKeys(input, ["eventType", "taskIds"]) ||
        !Array.isArray(taskIds) ||
        taskIds.length < 1 ||
        taskIds.length > 500 ||
        !taskIds.every(isUuid) ||
        new Set(taskIds).size !== taskIds.length
      ) {
        return { ok: false, reason: "Invalid schedule notification proof" };
      }
      return { ok: true, value: { eventType, taskIds } };
    }
    default:
      return { ok: false, reason: "Unsupported notification event" };
  }
}
