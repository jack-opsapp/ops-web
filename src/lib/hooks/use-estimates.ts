/**
 * OPS Web - Estimate Hooks
 *
 * TanStack Query hooks for estimates with optimistic updates.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { EstimateService, type FetchEstimatesOptions } from "../api/services";
import type { CreateEstimate, CreateLineItem } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

export function useEstimates(options?: FetchEstimatesOptions) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.estimates.list(companyId, options as Record<string, unknown>),
    queryFn: () => EstimateService.fetchEstimates(companyId, options),
    enabled: !!companyId,
  });
}

export function useProjectEstimates(projectId: string | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.estimates.projectEstimates(projectId ?? ""),
    queryFn: () => EstimateService.fetchProjectEstimates(projectId!, companyId),
    enabled: !!projectId && !!companyId,
  });
}

export function useEstimate(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.estimates.detail(id ?? ""),
    queryFn: () => EstimateService.fetchEstimate(id!),
    enabled: !!id,
  });
}

export function useCreateEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      data,
      lineItems,
    }: {
      data: Partial<CreateEstimate> & { companyId: string; clientId: string };
      lineItems: Partial<CreateLineItem>[];
    }) => EstimateService.createEstimate(data, lineItems),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.lists() });
    },
  });
}

export function useUpdateEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
      lineItems,
    }: {
      id: string;
      data: Partial<CreateEstimate>;
      lineItems?: Partial<CreateLineItem>[];
    }) => EstimateService.updateEstimate(id, data, lineItems),
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.lists() });
    },
  });
}

export function useDeleteEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => EstimateService.deleteEstimate(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
    },
  });
}

export function useSendEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => EstimateService.sendEstimate(id),
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.lists() });
    },
  });
}

export function useConvertEstimateToInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ estimateId, dueDate }: { estimateId: string; dueDate?: string }) =>
      EstimateService.convertToInvoice(estimateId, dueDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.estimates.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}
