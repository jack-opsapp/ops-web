/**
 * OPS Web - Site Visit Hooks
 *
 * TanStack Query hooks for site visit CRUD and lifecycle transitions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  SiteVisitService,
  type FetchSiteVisitsOptions,
} from "../api/services/site-visit-service";
import type { CreateSiteVisit, UpdateSiteVisit } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

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
