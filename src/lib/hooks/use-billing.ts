/**
 * OPS Web - Billing Hooks
 *
 * TanStack Query hooks for Stripe payment methods and invoices.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth-store";
import { CompanyService } from "../api/services";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export interface StripeInvoice {
  id: string;
  number: string | null;
  date: string | null;
  amount: number;
  status: string | null;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const billingKeys = {
  paymentMethods: (companyId: string) => ["billing", "payment-methods", companyId] as const,
  invoices: (companyId: string) => ["billing", "invoices", companyId] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export function usePaymentMethods() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: billingKeys.paymentMethods(companyId),
    queryFn: async (): Promise<PaymentMethod[]> => {
      const res = await fetch(`/api/stripe/payment-methods?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed to fetch payment methods");
      const data = await res.json();
      return data.methods;
    },
    enabled: !!companyId,
  });
}

export function useStripeInvoices() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: billingKeys.invoices(companyId),
    queryFn: async (): Promise<StripeInvoice[]> => {
      const res = await fetch(`/api/stripe/invoices?companyId=${companyId}`);
      if (!res.ok) throw new Error("Failed to fetch invoices");
      const data = await res.json();
      return data.invoices;
    },
    enabled: !!companyId,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useCreateSetupIntent() {
  const { company } = useAuthStore();

  return useMutation({
    mutationFn: () => CompanyService.createSetupIntent(company!.id),
  });
}

export function useRefreshPaymentMethods() {
  const { company } = useAuthStore();
  const queryClient = useQueryClient();

  return () => {
    if (company) {
      queryClient.invalidateQueries({
        queryKey: billingKeys.paymentMethods(company.id),
      });
    }
  };
}
