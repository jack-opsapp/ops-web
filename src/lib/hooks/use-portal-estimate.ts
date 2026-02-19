/**
 * OPS Web - Portal Estimate Hooks
 *
 * TanStack Query hooks for viewing and responding to estimates
 * from the client portal. Uses session cookies for authentication.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { portalKeys, portalFetch } from "./use-portal-data";
import type { Estimate, LineItem } from "../types/pipeline";

// ─── Response Types ───────────────────────────────────────────────────────────

interface PortalEstimateDetail extends Estimate {
  lineItems: LineItem[];
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single estimate with its line items for the portal.
 * Enabled only when `id` is truthy.
 */
export function usePortalEstimate(id: string | undefined) {
  return useQuery<PortalEstimateDetail>({
    queryKey: portalKeys.estimate(id ?? ""),
    queryFn: () =>
      portalFetch<PortalEstimateDetail>(`/api/portal/estimates/${id}`),
    enabled: !!id,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Approve an estimate on behalf of the client.
 * Invalidates the estimate detail and the portal data (status/count changes).
 */
export function useApproveEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      portalFetch<void>(`/api/portal/estimates/${id}/approve`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: portalKeys.estimate(id) });
      queryClient.invalidateQueries({ queryKey: portalKeys.data() });
    },
  });
}

/**
 * Decline an estimate on behalf of the client, with an optional reason.
 * Invalidates the estimate detail and the portal data (status/count changes).
 */
export function useDeclineEstimate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      portalFetch<void>(`/api/portal/estimates/${id}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: portalKeys.estimate(id) });
      queryClient.invalidateQueries({ queryKey: portalKeys.data() });
    },
  });
}
