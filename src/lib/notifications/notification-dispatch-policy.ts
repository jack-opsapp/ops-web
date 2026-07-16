export type NotificationDispatchRequest =
  | {
      eventType: "project_assigned";
      projectId: string;
      candidateRecipientIds: string[];
    }
  | {
      eventType:
        | "project_status_change"
        | "project_archived"
        | "lead_converted";
      projectId: string;
    }
  | {
      eventType: "task_assigned";
      taskId: string;
      candidateRecipientIds: string[];
    }
  | {
      eventType: "task_completed" | "schedule_change";
      taskId: string;
    }
  | { eventType: "expense_submitted"; expenseId: string }
  | { eventType: "expense_approved" | "expense_paid"; batchId: string }
  | { eventType: "mention"; noteId: string };

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

function parseCandidates(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return null;
  }
  if (!value.every(isUuid)) return null;
  return [...new Set(value)];
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
    case "project_assigned": {
      if (
        !hasOnlyKeys(input, [
          "eventType",
          "projectId",
          "candidateRecipientIds",
        ]) ||
        !isUuid(input.projectId)
      ) {
        return { ok: false, reason: "Invalid project assignment proof" };
      }
      const candidateRecipientIds = parseCandidates(
        input.candidateRecipientIds
      );
      if (!candidateRecipientIds) {
        return { ok: false, reason: "Invalid project assignment recipients" };
      }
      return {
        ok: true,
        value: { eventType, projectId: input.projectId, candidateRecipientIds },
      };
    }
    case "project_status_change":
    case "project_archived":
    case "lead_converted":
      if (
        !hasOnlyKeys(input, ["eventType", "projectId"]) ||
        !isUuid(input.projectId)
      ) {
        return { ok: false, reason: "Invalid project event proof" };
      }
      return { ok: true, value: { eventType, projectId: input.projectId } };
    case "task_assigned": {
      if (
        !hasOnlyKeys(input, ["eventType", "taskId", "candidateRecipientIds"]) ||
        !isUuid(input.taskId)
      ) {
        return { ok: false, reason: "Invalid task assignment proof" };
      }
      const candidateRecipientIds = parseCandidates(
        input.candidateRecipientIds
      );
      if (!candidateRecipientIds) {
        return { ok: false, reason: "Invalid task assignment recipients" };
      }
      return {
        ok: true,
        value: { eventType, taskId: input.taskId, candidateRecipientIds },
      };
    }
    case "task_completed":
    case "schedule_change":
      if (
        !hasOnlyKeys(input, ["eventType", "taskId"]) ||
        !isUuid(input.taskId)
      ) {
        return { ok: false, reason: "Invalid task event proof" };
      }
      return { ok: true, value: { eventType, taskId: input.taskId } };
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
    default:
      return { ok: false, reason: "Unsupported notification event" };
  }
}
