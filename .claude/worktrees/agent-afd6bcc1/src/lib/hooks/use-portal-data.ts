/**
 * OPS Web - Portal Data Hook
 *
 * TanStack Query hook for fetching the aggregated portal dashboard data.
 * Uses session cookies (NOT useAuthStore) for authentication.
 */

import { useQuery } from "@tanstack/react-query";
import type { PortalClientData } from "../types/portal";

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const portalKeys = {
  all: ["portal"] as const,
  data: () => [...portalKeys.all, "data"] as const,
  estimate: (id: string) => [...portalKeys.all, "estimate", id] as const,
  estimateQuestions: (id: string) =>
    [...portalKeys.all, "estimate-questions", id] as const,
  invoice: (id: string) => [...portalKeys.all, "invoice", id] as const,
  project: (id: string) => [...portalKeys.all, "project", id] as const,
  messages: (filters?: Record<string, unknown>) =>
    [...portalKeys.all, "messages", filters] as const,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Shared fetch wrapper for portal API routes.
 * Includes credentials so the session cookie is sent automatically.
 * Throws on non-2xx responses with the server-provided error message.
 */
export async function portalFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as Record<string, string>).error ??
        `Portal request failed: ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the aggregated portal data: client info, company info, branding,
 * projects, estimates, invoices, and unread message count.
 */
export function usePortalData() {
  return useQuery<PortalClientData>({
    queryKey: portalKeys.data(),
    queryFn: () => portalFetch<PortalClientData>("/api/portal/data"),
  });
}
