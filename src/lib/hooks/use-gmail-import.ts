/**
 * OPS Web - Gmail Historical Import Hook
 *
 * Starts a historical import job, polls for progress, and creates
 * notifications in the rail with status updates.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authedFetch } from "@/lib/utils/authed-fetch";

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportStatusResponse {
  status: "running" | "completed" | "failed";
  totalEmails?: number;
  processedEmails?: number;
  matchedLeads?: number;
  needsReview?: number;
  clientsCreated?: number;
  leadsCreated?: number;
  error?: string;
}

export interface ApprovedContact {
  fromEmail: string;
  name: string;
  createLead: boolean;
  /** If true, this is a company group — name is the company name */
  isCompanyGroup?: boolean;
  /** Sub-contacts to create under the company client */
  subContacts?: Array<{ fromEmail: string; name: string }>;
}

interface StartImportParams {
  companyId: string;
  connectionId: string;
  importAfter: string; // YYYY-MM-DD
  approvedContacts?: ApprovedContact[];
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useGmailImport() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatusResponse | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Start import mutation ──────────────────────────────────────────────

  const startImport = useMutation({
    mutationFn: async (params: StartImportParams) => {
      const response = await authedFetch(
        "/api/integrations/gmail/historical-import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Failed to start import"
        );
      }
      return response.json() as Promise<{ jobId: string }>;
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setStatus({ status: "running" });
    },
  });

  // ── Poll for status ────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    async function poll() {
      try {
        const response = await authedFetch(
          `/api/integrations/gmail/import-status?jobId=${encodeURIComponent(jobId!)}`
        );
        if (!response.ok) return;
        const data = (await response.json()) as ImportStatusResponse;
        setStatus(data);

        if (data.status === "completed") {
          stopPolling();
        } else if (data.status === "failed") {
          stopPolling();
        }
      } catch {
        // Silently retry on network errors
      }
    }

    // Immediate first poll, then interval
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => stopPolling();
  }, [jobId, stopPolling]);

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    startImport,
    status,
    isImporting: startImport.isPending || status?.status === "running",
  };
}

// ─── Import History ─────────────────────────────────────────────────────────

export interface ImportHistoryJob {
  id: string;
  status: "running" | "completed" | "failed";
  totalEmails: number;
  processed: number;
  matched: number;
  needsReview: number;
  clientsCreated: number;
  leadsCreated: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useImportHistory(companyId: string | undefined) {
  return useQuery({
    queryKey: ["gmail-import-history", companyId],
    queryFn: async (): Promise<ImportHistoryJob[]> => {
      if (!companyId) return [];
      const resp = await authedFetch(
        `/api/integrations/gmail/import-history?companyId=${encodeURIComponent(companyId)}&limit=3`
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.jobs ?? [];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}
