import "server-only";

import type { ScheduleConfirmationPersistenceGuard } from "@/lib/types/approval-queue";

const CURRENT_GUARDS = new WeakSet<object>();

export function mintScheduleConfirmationPersistenceGuard(input: {
  eventId: string;
  leaseToken: string;
  taskId: string;
  scheduleVersion: number;
  confirmedAt: string;
  confirmedBy: string | null;
  confirmationOrigin: "manual" | "automatic_grace" | "full_auto";
}): ScheduleConfirmationPersistenceGuard {
  const guard = Object.freeze({ ...input });
  CURRENT_GUARDS.add(guard);
  return guard;
}

export function isCurrentScheduleConfirmationPersistenceGuard(
  guard: ScheduleConfirmationPersistenceGuard
): boolean {
  return CURRENT_GUARDS.has(guard);
}

export function isCurrentScheduleConfirmationDispatchLease(
  guard: ScheduleConfirmationPersistenceGuard,
  eventId: string,
  leaseToken: string
): boolean {
  return (
    CURRENT_GUARDS.has(guard) &&
    guard.eventId === eventId &&
    guard.leaseToken === leaseToken
  );
}
