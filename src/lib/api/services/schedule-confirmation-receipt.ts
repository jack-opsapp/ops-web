import "server-only";

export type ScheduleConfirmationReceipt = Readonly<{
  task_id: string;
  newly_confirmed: boolean;
  confirmation_origin: "manual" | "automatic_grace";
  schedule_confirmed_at: string;
  schedule_confirmed_by: string | null;
  confirmed_schedule_version: number;
  schedule_version: number;
}>;

const RECEIPT_KEYS = [
  "confirmation_origin",
  "confirmed_schedule_version",
  "newly_confirmed",
  "schedule_confirmed_at",
  "schedule_confirmed_by",
  "schedule_version",
  "task_id",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isExactReceiptRecord(
  input: unknown
): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).sort().join("\0") === [...RECEIPT_KEYS].sort().join("\0")
  );
}

export function parseScheduleConfirmationReceipt(
  input: unknown,
  expected: Readonly<{
    taskId: string;
    scheduleVersion: number;
    confirmationKind: "manual" | "automatic";
    actorUserId: string;
  }>
): ScheduleConfirmationReceipt {
  if (
    !UUID_PATTERN.test(expected.taskId) ||
    !UUID_PATTERN.test(expected.actorUserId) ||
    !Number.isSafeInteger(expected.scheduleVersion) ||
    expected.scheduleVersion < 0 ||
    !isExactReceiptRecord(input) ||
    input.task_id !== expected.taskId ||
    typeof input.newly_confirmed !== "boolean" ||
    input.confirmation_origin !==
      (expected.confirmationKind === "manual" ? "manual" : "automatic_grace") ||
    typeof input.schedule_confirmed_at !== "string" ||
    !RFC3339_UTC_PATTERN.test(input.schedule_confirmed_at) ||
    !Number.isFinite(Date.parse(input.schedule_confirmed_at)) ||
    input.confirmed_schedule_version !== expected.scheduleVersion ||
    input.schedule_version !== expected.scheduleVersion ||
    (input.schedule_confirmed_by !== null &&
      (typeof input.schedule_confirmed_by !== "string" ||
        !UUID_PATTERN.test(input.schedule_confirmed_by))) ||
    (input.newly_confirmed &&
      expected.confirmationKind === "manual" &&
      input.schedule_confirmed_by !== expected.actorUserId) ||
    (input.newly_confirmed &&
      expected.confirmationKind === "automatic" &&
      input.schedule_confirmed_by !== null)
  ) {
    throw new Error("Invalid schedule confirmation receipt");
  }
  return input as ScheduleConfirmationReceipt;
}
