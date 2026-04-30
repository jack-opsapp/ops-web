/**
 * OPS Web - Calendar User Events Hook
 *
 * Fetches personal + time-off events for the current company that overlap a
 * given date range. Mirrors the iOS CalendarViewModel.loadUserEvents path.
 *
 * Scope-aware: users with `calendar.view: own` (or `tasks.view: assigned`)
 * only see their own events. `all`-scope users see every event in the
 * company.
 */

import { useQuery } from "@tanstack/react-query";
import { CalendarUserEventService } from "@/lib/api/services/calendar-user-event-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { CalendarUserEvent } from "@/lib/types/models";

export function useScheduledUserEvents(
  startDate: Date | null,
  endDate: Date | null
) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";

  const calendarScope = usePermissionStore(
    (s) => s.permissions.get("calendar.view")
  );
  const tasksScope = usePermissionStore((s) => s.permissions.get("tasks.view"));
  const hasAllScope = calendarScope === "all" || tasksScope === "all";
  const scopedUserId = !hasAllScope ? currentUser?.id : undefined;

  const startStr = startDate?.toISOString() ?? "";
  const endStr = endDate?.toISOString() ?? "";

  return useQuery<CalendarUserEvent[]>({
    queryKey: [
      "calendar",
      "user-events",
      companyId,
      startStr,
      endStr,
      scopedUserId ?? "",
    ],
    queryFn: () =>
      CalendarUserEventService.fetchForRange(
        companyId,
        startDate!,
        endDate!,
        scopedUserId ? { userId: scopedUserId } : {}
      ),
    enabled: !!companyId && !!startDate && !!endDate,
    // Keep previous range visible during background refetches on scroll.
    placeholderData: (previousData) => previousData,
  });
}
