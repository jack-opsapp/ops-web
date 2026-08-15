/**
 * OPS Web - Site Visit Hooks
 *
 * TanStack Query hooks for site visit CRUD and lifecycle transitions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  SiteVisitService,
  type BookSiteVisitInput,
  type BookedVisitWithLead,
  type FetchSiteVisitsOptions,
  type RescheduleSiteVisitInput,
} from "../api/services/site-visit-service";
import type { CreateSiteVisit, SiteVisit, UpdateSiteVisit } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";

export function useSiteVisits(options: FetchSiteVisitsOptions = {}) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.siteVisits.list(companyId, options as Record<string, unknown>),
    queryFn: () => SiteVisitService.fetchSiteVisits(companyId, options),
    enabled: !!companyId,
  });
}

export function useSiteVisit(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.siteVisits.detail(id ?? ""),
    queryFn: () => SiteVisitService.fetchSiteVisit(id!),
    enabled: !!id,
  });
}

export function useCreateSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSiteVisit) => SiteVisitService.createSiteVisit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.lists() });
    },
  });
}

export function useUpdateSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSiteVisit }) =>
      SiteVisitService.updateSiteVisit(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.detail(id) });
    },
  });
}

export function useStartSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => SiteVisitService.startSiteVisit(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.detail(id) });
    },
  });
}

export function useCompleteSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: {
        notes?: string;
        measurements?: string;
        photos?: string[];
        internalNotes?: string;
      };
    }) => SiteVisitService.completeSiteVisit(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.detail(id) });
      // Invalidate opportunity activities since a new one was created
      queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
    },
  });
}

export function useCancelSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => SiteVisitService.cancelSiteVisit(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.detail(id) });
    },
  });
}

// ─── Booking (RPC write path) ───────────────────────────────────────────────
//
// Booking side effects are server-owned: the RPC writes the visit, logs the
// timeline activity, nudges new_lead → qualifying, and enqueues calendar
// sync. Client-side we only refresh the caches those effects touched —
// siteVisits (open booking + booked ranges), opportunities (stage + assigned
// context timeline), and the schedule calendar tree.

function invalidateBookingCaches(
  queryClient: ReturnType<typeof useQueryClient>
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.siteVisits.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.opportunities.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all });
}

/**
 * Booked appointments in a date window — the schedule calendar's third
 * source. Scope-aware like the user-events hook: without an `all` view
 * scope the read narrows to visits the current user is going on.
 */
export function useBookedVisits(
  rangeStart: Date | null,
  rangeEnd: Date | null
) {
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";

  const calendarScope = usePermissionStore(
    (s) => s.permissions.get("calendar.view")
  );
  const tasksScope = usePermissionStore((s) => s.permissions.get("tasks.view"));
  const hasAllScope = calendarScope === "all" || tasksScope === "all";
  const scopedUserId = !hasAllScope ? currentUser?.id : undefined;

  const startIso = rangeStart?.toISOString() ?? "";
  const endIso = rangeEnd?.toISOString() ?? "";

  return useQuery<BookedVisitWithLead[]>({
    queryKey: [
      ...queryKeys.siteVisits.bookedRange(companyId, startIso, endIso),
      scopedUserId ?? "",
    ],
    queryFn: () =>
      SiteVisitService.getBookedVisitsInRange(
        companyId,
        rangeStart!,
        rangeEnd!,
        scopedUserId ? { assigneeId: scopedUserId } : {}
      ),
    enabled: !!companyId && !!rangeStart && !!rangeEnd,
    // Keep the previous range visible during background refetches on scroll.
    placeholderData: (previousData) => previousData,
  });
}

/**
 * The lead's open booking (one-open-booking rule: at most one `scheduled`
 * booked visit per lead). Null when the slot is free.
 */
export function useOpenBooking(opportunityId: string | undefined) {
  return useQuery<SiteVisit | null>({
    queryKey: queryKeys.siteVisits.openBooking(opportunityId ?? ""),
    queryFn: () => SiteVisitService.fetchOpenBooking(opportunityId!),
    enabled: !!opportunityId,
  });
}

export function useBookSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BookSiteVisitInput) =>
      SiteVisitService.bookSiteVisit(input),
    onSuccess: () => invalidateBookingCaches(queryClient),
  });
}

export function useRescheduleSiteVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RescheduleSiteVisitInput) =>
      SiteVisitService.rescheduleSiteVisit(input),
    onSuccess: () => invalidateBookingCaches(queryClient),
  });
}

export function useCancelSiteVisitBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteVisitId: string) =>
      SiteVisitService.cancelSiteVisitBooking(siteVisitId),
    onSuccess: () => invalidateBookingCaches(queryClient),
  });
}
