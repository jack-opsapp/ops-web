import "server-only";

import type { TaskAutomationPersistenceGuard } from "@/lib/types/approval-queue";

export type ScheduleUnconfirmationPersistenceGuard = Readonly<
  TaskAutomationPersistenceGuard & {
    companyId: string;
    actorUserId: string;
    previousConfirmedAt: string;
    unconfirmationOrigin: "explicit_admin" | "schedule_edit";
  }
>;

const CURRENT_GUARDS = new WeakSet<object>();

export function mintScheduleUnconfirmationPersistenceGuard(input: {
  eventId: string;
  leaseToken: string;
  taskId: string;
  scheduleVersion: number;
  companyId: string;
  actorUserId: string;
  previousConfirmedAt: string;
  unconfirmationOrigin: "explicit_admin" | "schedule_edit";
}): ScheduleUnconfirmationPersistenceGuard {
  const guard = Object.freeze({ ...input });
  CURRENT_GUARDS.add(guard);
  return guard;
}

export function isCurrentScheduleUnconfirmationPersistenceGuard(
  guard: TaskAutomationPersistenceGuard
): guard is ScheduleUnconfirmationPersistenceGuard {
  return CURRENT_GUARDS.has(guard);
}
