/**
 * OPS Web - Recurrence Hooks (Phase 3)
 *
 * TanStack Query hooks for task_recurrences and task_recurrence_exceptions.
 * The cron worker at /api/cron/recurrence-generate consumes these templates
 * and writes the generated project_tasks; UI mutations here invalidate the
 * calendar.scheduled key so the calendar refetches.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  RecurrenceService,
  type CreateRecurrenceInput,
  type UpsertRecurrenceExceptionInput,
} from "../api/services/recurrence-service";
import type {
  TaskRecurrence,
  TaskRecurrenceException,
} from "../types/models";
import { useAuthStore } from "../store/auth-store";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all active recurrence templates for the current company.
 */
export function useRecurrences(
  queryOptions?: Partial<UseQueryOptions<TaskRecurrence[]>>
) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.calendar.recurrences(companyId),
    queryFn: () => RecurrenceService.listForCompany(companyId),
    enabled: !!companyId,
    ...queryOptions,
  });
}

/**
 * Fetch a single recurrence template by ID.
 */
export function useRecurrence(
  id: string | undefined,
  queryOptions?: Partial<UseQueryOptions<TaskRecurrence | null>>
) {
  return useQuery({
    queryKey: queryKeys.calendar.recurrence(id ?? ""),
    queryFn: () => RecurrenceService.getById(id!),
    enabled: !!id,
    ...queryOptions,
  });
}

/**
 * List exceptions for a given recurrence.
 */
export function useRecurrenceExceptions(
  recurrenceId: string | undefined,
  queryOptions?: Partial<UseQueryOptions<TaskRecurrenceException[]>>
) {
  return useQuery({
    queryKey: queryKeys.calendar.recurrenceExceptions(recurrenceId ?? ""),
    queryFn: () => RecurrenceService.listExceptions(recurrenceId!),
    enabled: !!recurrenceId,
    ...queryOptions,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new recurrence template. After success, invalidate the company's
 * recurrence list and the calendar scheduled query so the cron-generated
 * tasks (when they appear) become visible.
 */
export function useCreateRecurrence() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation({
    mutationFn: (input: CreateRecurrenceInput) =>
      RecurrenceService.create(input),
    onSuccess: (recurrence) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrences(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrence(recurrence.id),
      });
      // Calendar must refetch to show generated tasks once cron lands.
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
    },
  });
}

/**
 * Update an existing recurrence template. The service sets
 * next_generation_at = NOW() on rule-affecting changes so the next cron
 * run regenerates everything from this point forward.
 */
export function useUpdateRecurrence() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<TaskRecurrence>;
    }) => RecurrenceService.update(id, patch),
    onSuccess: (recurrence) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrences(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrence(recurrence.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
    },
  });
}

/**
 * Soft-delete a recurrence and every un-started future occurrence.
 */
export function useSoftDeleteRecurrence() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation({
    mutationFn: (id: string) => RecurrenceService.softDelete(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrences(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrence(id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
    },
  });
}

/**
 * Upsert an exception (skip or reschedule) for a single occurrence.
 * Used by the edit-this scope of useRecurrenceEdit.
 */
export function useUpsertRecurrenceException() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpsertRecurrenceExceptionInput) =>
      RecurrenceService.upsertException(input),
    onSuccess: (exception) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.calendar.recurrenceExceptions(exception.recurrenceId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
    },
  });
}
