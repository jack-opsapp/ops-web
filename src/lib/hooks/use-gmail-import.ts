/**
 * OPS Web - Gmail Historical Import Hook
 *
 * Starts a historical import job, polls for progress, and creates
 * notifications in the rail with status updates.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCreateNotification } from "./use-notifications";
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
  const notify = useCreateNotification();

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

      // Create a persistent notification for the running import
      notify({
        type: "pipeline_complete",
        title: "Importing emails...",
        body: "Scanning your inbox for leads. This may take a minute.",
        persistent: true,
        actionUrl: "/settings?tab=integrations",
        actionLabel: "View Progress",
      });
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

          const cCreated = data.clientsCreated ?? 0;
          const lCreated = data.leadsCreated ?? 0;
          const hasReview = (data.needsReview ?? 0) > 0;

          // Build a description that highlights what was created
          let desc: string;
          if (cCreated > 0 || lCreated > 0) {
            const parts: string[] = [];
            if (cCreated > 0)
              parts.push(`${cCreated} client${cCreated !== 1 ? "s" : ""}`);
            if (lCreated > 0)
              parts.push(`${lCreated} lead${lCreated !== 1 ? "s" : ""}`);
            desc = `Created ${parts.join(" & ")} from ${data.processedEmails ?? 0} emails.`;
            if (hasReview) desc += ` ${data.needsReview} need review.`;
          } else {
            desc = hasReview
              ? `Found ${data.matchedLeads ?? 0} leads. ${data.needsReview} need review.`
              : `Found ${data.matchedLeads ?? 0} leads from ${data.processedEmails ?? 0} emails.`;
          }

          notify({
            type: "pipeline_complete",
            title: "Import complete",
            body: desc,
            actionUrl:
              lCreated > 0
                ? "/pipeline"
                : hasReview
                  ? "/pipeline?review=true"
                  : "/settings?tab=integrations",
            actionLabel:
              lCreated > 0
                ? "View Pipeline"
                : hasReview
                  ? "Review Matches"
                  : "View",
          });
        } else if (data.status === "failed") {
          stopPolling();

          notify({
            type: "system",
            title: "Import failed",
            body: data.error ?? "Something went wrong during import.",
            actionUrl: "/settings?tab=integrations",
            actionLabel: "View",
          });
        }
      } catch {
        // Silently retry on network errors
      }
    }

    // Immediate first poll, then interval
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => stopPolling();
  }, [jobId, stopPolling, notify]);

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
