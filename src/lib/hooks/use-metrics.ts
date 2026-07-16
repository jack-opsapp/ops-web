/**
 * OPS Web - Metrics Hooks
 *
 * TanStack Query hooks for tab-level aggregated metrics.
 * Each hook fetches metrics for a specific tab's MetricsHeader.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { MetricsService } from "../api/services/metrics-service";
import { effectivePipelineScope } from "../permissions/lead-access-policy";
import { useAuthStore } from "../store/auth-store";
import { usePermissionStore } from "../store/permissions-store";

function useCompanyId() {
  const { company } = useAuthStore();
  return company?.id ?? "";
}

export function useInvoiceMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("invoices", companyId),
    queryFn: () => MetricsService.fetchInvoiceMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProjectMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("projects", companyId),
    queryFn: () => MetricsService.fetchProjectMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePipelineMetrics() {
  const queryClient = useQueryClient();
  const companyId = useAuthStore((state) => state.company?.id ?? "");
  const actorUserId = useAuthStore((state) => state.currentUser?.id ?? "");
  const permissionState = usePermissionStore();
  const viewScope = effectivePipelineScope(permissionState, "pipeline.view");
  const pipelineMetricsKey = queryKeys.metrics.pipeline(
    companyId,
    actorUserId,
    viewScope
  );

  useEffect(() => {
    queryClient.removeQueries({
      queryKey: [...queryKeys.metrics.all, "pipeline"],
      type: "inactive",
    });
    return () => {
      queryClient.removeQueries({
        queryKey: pipelineMetricsKey,
        exact: true,
      });
    };
    // The primitive access fingerprint intentionally controls cache lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorUserId, companyId, queryClient, viewScope]);

  return useQuery({
    queryKey: pipelineMetricsKey,
    queryFn: () => MetricsService.fetchPipelineMetrics(companyId),
    enabled: Boolean(companyId && actorUserId && viewScope),
    placeholderData: undefined,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEstimateMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("estimates", companyId),
    queryFn: () => MetricsService.fetchEstimateMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAccountingMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("accounting", companyId),
    queryFn: () => MetricsService.fetchAccountingMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInventoryMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("inventory", companyId),
    queryFn: () => MetricsService.fetchInventoryMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClientMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("clients", companyId),
    queryFn: () => MetricsService.fetchClientMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTeamMetrics(maxSeats: number) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [...queryKeys.metrics.tab("team", companyId), maxSeats],
    queryFn: () => MetricsService.fetchTeamMetrics(companyId, maxSeats),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useProductMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("products", companyId),
    queryFn: () => MetricsService.fetchProductMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useJobBoardMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("job-board", companyId),
    queryFn: () => MetricsService.fetchJobBoardMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useScheduleMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("calendar", companyId),
    queryFn: () => MetricsService.fetchCalendarMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMapMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("map", companyId),
    queryFn: () => MetricsService.fetchMapMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInboxMetrics() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: queryKeys.metrics.tab("inbox", companyId),
    queryFn: () => MetricsService.fetchInboxMetrics(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}
