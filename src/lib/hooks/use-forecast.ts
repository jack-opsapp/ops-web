/**
 * OPS Web - Forecast Hooks
 *
 * TanStack Query hooks for forward-looking financial projections.
 * Wraps ForecastService methods with caching and auto-refresh.
 */

import { useQuery } from "@tanstack/react-query";
import { ForecastService } from "@/lib/api/services/forecast-service";
import { useAuthStore } from "../store/auth-store";

// ── Query key factory ──

const forecastKeys = {
  all: ["forecast"] as const,
  weightedPipeline: (companyId: string) =>
    [...forecastKeys.all, "weighted-pipeline", companyId] as const,
  cashFlow: (companyId: string, days: number) =>
    [...forecastKeys.all, "cash-flow", companyId, days] as const,
  revenueProjection: (companyId: string) =>
    [...forecastKeys.all, "revenue-projection", companyId] as const,
};

// ── Hooks ──

/**
 * Weighted pipeline value: SUM(estimated_value × win_probability / 100)
 * for all open opportunities, grouped by stage.
 */
export function useWeightedPipelineValue() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: forecastKeys.weightedPipeline(companyId),
    queryFn: () => ForecastService.fetchWeightedPipelineValue(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Cash flow forecast for the next N days.
 * Inflow from unpaid invoices, outflow from expense run-rate.
 */
export function useCashFlowForecast(days: number = 30) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: forecastKeys.cashFlow(companyId, days),
    queryFn: () => ForecastService.fetchCashFlowForecast(companyId, days),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Revenue projection for 30/60/90 day windows.
 * Combines pipeline opportunity value with outstanding invoice balances.
 */
export function useRevenueProjection() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: forecastKeys.revenueProjection(companyId),
    queryFn: () => ForecastService.fetchRevenueProjection(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
}
