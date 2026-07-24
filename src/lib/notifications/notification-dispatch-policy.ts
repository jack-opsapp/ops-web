export type NotificationDispatchRequest =
  | {
      eventType: "project_status_change";
      projectId: string;
      projectStatusEventId: string;
    }
  | { eventType: "expense_submitted"; expenseId: string }
  | { eventType: "expense_approved" | "expense_paid"; batchId: string }
  | { eventType: "mention"; noteId: string }
  | { eventType: "mention_edit"; mentionEventId: string };

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
    default:
      return { ok: false, reason: "Unsupported notification event" };
  }
}
