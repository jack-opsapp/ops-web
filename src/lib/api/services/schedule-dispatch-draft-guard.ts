import "server-only";

export type ScheduleDispatchDraftGuard = Readonly<{
  eventId: string;
  leaseToken: string;
  companyId: string;
  actorUserId: string;
  connectionId: string;
  recipientEmail: string;
}>;

const CURRENT_GUARDS = new WeakSet<object>();

export function mintScheduleDispatchDraftGuard(
  input: ScheduleDispatchDraftGuard
): ScheduleDispatchDraftGuard {
  const guard = Object.freeze({ ...input });
  CURRENT_GUARDS.add(guard);
  return guard;
}

export function isCurrentScheduleDispatchDraftGuard(
  guard: ScheduleDispatchDraftGuard | undefined
): guard is ScheduleDispatchDraftGuard {
  return guard !== undefined && CURRENT_GUARDS.has(guard);
}
