/**
 * OPS Web - Portal Invoice Hooks
 *
 * TanStack Query hooks for viewing invoices and initiating Stripe payments
 * from the client portal. Uses session cookies for authentication.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { portalKeys, portalFetch } from "./use-portal-data";
import type { Invoice, LineItem, Payment } from "../types/pipeline";

// ─── Response Types ───────────────────────────────────────────────────────────

interface PortalInvoiceDetail extends Invoice {
  lineItems: LineItem[];
  payments: Payment[];
}

interface PaymentIntentResponse {
  clientSecret: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single invoice with its line items and payments for the portal.
 * Enabled only when `id` is truthy.
 */
export function usePortalInvoice(id: string | undefined) {
  return useQuery<PortalInvoiceDetail>({
    queryKey: portalKeys.invoice(id ?? ""),
    queryFn: () =>
      portalFetch<PortalInvoiceDetail>(`/api/portal/invoices/${id}`),
    enabled: !!id,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a Stripe PaymentIntent for an invoice.
 * Returns the clientSecret needed by Stripe Elements to confirm payment.
 * Does NOT invalidate queries on success — the invoice status updates
 * when the Stripe webhook confirms payment, not at intent creation time.
 */
export function useCreatePaymentIntent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invoiceId: string) =>
      portalFetch<PaymentIntentResponse>(
        `/api/portal/invoices/${invoiceId}/pay`,
        { method: "POST" }
      ),
    onSuccess: (_data, invoiceId) => {
      // Invalidate invoice detail in case the server sets a "processing" state
      queryClient.invalidateQueries({
        queryKey: portalKeys.invoice(invoiceId),
      });
    },
  });
}
