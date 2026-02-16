/**
 * OPS Web - Calendar Hooks
 *
 * TanStack Query hooks for calendar event data.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  CalendarService,
  type FetchCalendarEventsOptions,
} from "../api/services";
import type { CalendarEvent } from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch calendar events for the current company.
 */
export function useCalendarEvents(
  options?: FetchCalendarEventsOptions,
  queryOptions?: Partial<UseQueryOptions<{ events: CalendarEvent[]; remaining: number; count: number }>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.calendar.list(companyId, options as Record<string, unknown>),
    queryFn: () => CalendarService.fetchCalendarEvents(companyId, options),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch calendar events for a specific date range.
 * Commonly used for calendar view rendering.
 */
export function useCalendarEventsForRange(
  startDate: Date | null,
  endDate: Date | null,
  options?: Omit<
    FetchCalendarEventsOptions,
    "startDateFrom" | "startDateTo"
  >,
  queryOptions?: Partial<UseQueryOptions<CalendarEvent[]>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const startStr = startDate?.toISOString() ?? "";
  const endStr = endDate?.toISOString() ?? "";

  return useQuery({
    queryKey: queryKeys.calendar.dateRange(companyId, startStr, endStr),
    queryFn: () =>
      CalendarService.fetchEventsForDateRange(
        companyId,
        startDate!,
        endDate!,
        options
      ),
    enabled: !!companyId && !!startDate && !!endDate,
    ...queryOptions,
  });
}

/**
 * Fetch a single calendar event by ID.
 */
export function useCalendarEvent(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<CalendarEvent | null>>
) {
  return useQuery({
    queryKey: queryKeys.calendar.detail(id ?? ""),
    queryFn: () => CalendarService.fetchCalendarEvent(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new calendar event.
 */
export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: Partial<CalendarEvent> & {
        projectId: string;
        companyId: string;
        title: string;
      }
    ) => CalendarService.createCalendarEvent(data),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.lists(),
      });
    },
  });
}

/**
 * Update a calendar event with optimistic update.
 */
export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CalendarEvent>;
    }) => CalendarService.updateCalendarEvent(id, data),

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.calendar.detail(id),
      });

      const previousEvent = queryClient.getQueryData<CalendarEvent | null>(
        queryKeys.calendar.detail(id)
      );

      if (previousEvent) {
        queryClient.setQueryData(queryKeys.calendar.detail(id), {
          ...previousEvent,
          ...data,
        });
      }

      return { previousEvent };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousEvent) {
        queryClient.setQueryData(
          queryKeys.calendar.detail(id),
          context.previousEvent
        );
      }
    },

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.lists(),
      });
    },
  });
}

/**
 * Soft delete a calendar event.
 */
export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => CalendarService.deleteCalendarEvent(id),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.all,
      });
      // Tasks may reference this event
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
    },
  });
}
