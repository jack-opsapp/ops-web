/**
 * OPS Web - Portal Project Hook
 *
 * TanStack Query hook for fetching a single project's detail
 * from the client portal. Uses session cookies for authentication.
 */

import { useQuery } from "@tanstack/react-query";
import { portalKeys, portalFetch } from "./use-portal-data";
import type { PortalProject } from "../types/portal";

// ─── Response Types ───────────────────────────────────────────────────────────

/**
 * Extended project detail returned by the portal project endpoint.
 * Includes the base PortalProject fields plus related estimates and invoices.
 */
interface PortalProjectDetail extends PortalProject {
  estimates: Array<{
    id: string;
    estimateNumber: string;
    title: string | null;
    status: string;
    total: number;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    subject: string | null;
    status: string;
    total: number;
    balanceDue: number;
  }>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a single project with its related estimates and invoices for the portal.
 * Enabled only when `id` is truthy.
 */
export function usePortalProject(id: string | undefined) {
  return useQuery<PortalProjectDetail>({
    queryKey: portalKeys.project(id ?? ""),
    queryFn: () =>
      portalFetch<PortalProjectDetail>(`/api/portal/projects/${id}`),
    enabled: !!id,
  });
}
