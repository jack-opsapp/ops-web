/**
 * OPS Web - Billing Hooks
 *
 * TanStack Query hooks for Stripe payment methods and invoices.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/auth-store";
import { CompanyService } from "../api/services/company-service";

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

/**
 * Promote a payment method to the company's Stripe default. Required for
 * billing lockout recovery: /api/stripe/subscribe falls back to the customer
 * default when no explicit paymentMethodId is supplied, so a card added via
 * SetupIntent stays useless until it's set as default. Called automatically
 * from AddCardForm when the customer has no default yet, and on demand from
 * the explicit "Set as default" action on existing cards.
 */
export function useSetDefaultPaymentMethod() {
  const { company } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentMethodId: string) => {
      if (!company?.id) throw new Error("No active company");
      const res = await fetch("/api/stripe/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          paymentMethodId,
          action: "set_default",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to set default payment method");
      }
      return res.json() as Promise<{
        success: true;
        defaultPaymentMethodId: string;
      }>;
    },
    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: billingKeys.paymentMethods(company.id),
        });
      }
    },
  });
}

export function useRemovePaymentMethod() {
  const { company } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const res = await fetch("/api/stripe/payment-methods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove payment method");
      }
      return res.json();
    },
    onSuccess: () => {
      if (company) {
        queryClient.invalidateQueries({
          queryKey: billingKeys.paymentMethods(company.id),
        });
      }
    },
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
