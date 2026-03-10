/**
 * OPS Web - Gmail Historical Import Hook
 *
 * Starts a historical import job, polls for progress, and shows
 * Action Prompts with status updates.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail, CheckCircle, AlertCircle } from "lucide-react";
import { useActionPromptStore } from "@/stores/action-prompt-store";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROMPT_ID = "gmail-import-progress";
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
  const showPrompt = useActionPromptStore((s) => s.showPrompt);
  const removePrompt = useActionPromptStore((s) => s.removePrompt);

  // ── Start import mutation ──────────────────────────────────────────────

  const startImport = useMutation({
    mutationFn: async (params: StartImportParams) => {
      const response = await fetch("/api/integrations/gmail/historical-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to start import");
      }
      return response.json() as Promise<{ jobId: string }>;
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setStatus({ status: "running" });

      // Show running prompt
      showPrompt({
        id: PROMPT_ID,
        icon: Mail,
        title: "Importing emails...",
        description: "Scanning your inbox for leads. This may take a minute.",
        ctaLabel: "Dismiss",
        ctaAction: () => removePrompt(PROMPT_ID),
        persistent: true,
        dismissable: true,
        variant: "accent",
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
        const response = await fetch(
          `/api/integrations/gmail/import-status?jobId=${encodeURIComponent(jobId!)}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as ImportStatusResponse;
        setStatus(data);

        if (data.status === "completed") {
          stopPolling();
          removePrompt(PROMPT_ID);

          const hasReview = (data.needsReview ?? 0) > 0;
          const cCreated = data.clientsCreated ?? 0;
          const lCreated = data.leadsCreated ?? 0;

          // Build a description that highlights what was created
          let desc: string;
          if (cCreated > 0 || lCreated > 0) {
            const parts: string[] = [];
            if (cCreated > 0) parts.push(`${cCreated} client${cCreated !== 1 ? "s" : ""}`);
            if (lCreated > 0) parts.push(`${lCreated} lead${lCreated !== 1 ? "s" : ""}`);
            desc = `Created ${parts.join(" & ")} from ${data.processedEmails ?? 0} emails.`;
            if (hasReview) desc += ` ${data.needsReview} need review.`;
          } else {
            desc = hasReview
              ? `Found ${data.matchedLeads ?? 0} leads. ${data.needsReview} need review.`
              : `Found ${data.matchedLeads ?? 0} leads from ${data.processedEmails ?? 0} emails.`;
          }

          showPrompt({
            id: PROMPT_ID,
            icon: CheckCircle,
            title: "Import complete",
            description: desc,
            ctaLabel: lCreated > 0 ? "View Pipeline" : hasReview ? "Review Matches" : "Done",
            ctaAction: () => {
              removePrompt(PROMPT_ID);
              if (lCreated > 0) {
                window.location.href = "/pipeline";
              } else if (hasReview) {
                window.location.href = "/pipeline?review=true";
              }
            },
            persistent: true,
            dismissable: true,
            variant: "accent",
          });
        } else if (data.status === "failed") {
          stopPolling();
          removePrompt(PROMPT_ID);

          showPrompt({
            id: PROMPT_ID,
            icon: AlertCircle,
            title: "Import failed",
            description: data.error ?? "Something went wrong during import.",
            ctaLabel: "Dismiss",
            ctaAction: () => removePrompt(PROMPT_ID),
            persistent: true,
            dismissable: true,
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
  }, [jobId, stopPolling, showPrompt, removePrompt]);

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    startImport,
    status,
    isImporting: startImport.isPending || status?.status === "running",
  };
}
