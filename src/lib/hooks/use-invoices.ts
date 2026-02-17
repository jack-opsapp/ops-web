/**
 * OPS Web - Invoice Hooks
 *
 * TanStack Query hooks for invoices and payments with optimistic updates.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { InvoiceService, type FetchInvoicesOptions } from "../api/services";
import type { CreateInvoice, CreateLineItem, CreatePayment } from "../types/pipeline";
import { useAuthStore } from "../store/auth-store";

export function useInvoices(options?: FetchInvoicesOptions) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.invoices.list(companyId, options as Record<string, unknown>),
    queryFn: () => InvoiceService.fetchAllInvoices(companyId, options),
    enabled: !!companyId,
  });
}

export function useProjectInvoices(projectId: string | undefined) {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.invoices.projectInvoices(projectId ?? ""),
    queryFn: () => InvoiceService.fetchProjectInvoices(projectId!, companyId),
    enabled: !!projectId && !!companyId,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id ?? ""),
    queryFn: () => InvoiceService.fetchInvoice(id!),
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      data,
      lineItems,
    }: {
      data: Partial<CreateInvoice> & { companyId: string; clientId: string };
      lineItems: Partial<CreateLineItem>[];
    }) => InvoiceService.createInvoice(data, lineItems),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.lists() });
    },
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
      lineItems,
    }: {
      id: string;
      data: Partial<CreateInvoice>;
      lineItems?: Partial<CreateLineItem>[];
    }) => InvoiceService.updateInvoice(id, data, lineItems),
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.lists() });
    },
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => InvoiceService.deleteInvoice(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

export function useSendInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => InvoiceService.sendInvoice(id),
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.lists() });
    },
  });
}

export function useVoidInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => InvoiceService.voidInvoice(id),
    onSettled: (_data, _error, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.lists() });
    },
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePayment) =>
      InvoiceService.recordPayment(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.invoices.detail(variables.invoiceId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.lists() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.payments.invoicePayments(variables.invoiceId),
      });
    },
  });
}

export function useVoidPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      paymentId,
      invoiceId,
      userId,
    }: {
      paymentId: string;
      invoiceId: string;
      userId: string;
    }) => InvoiceService.voidPayment(paymentId, userId),
    onSuccess: (_data, { invoiceId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.invoices.detail(invoiceId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.lists() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.payments.invoicePayments(invoiceId),
      });
    },
  });
}
