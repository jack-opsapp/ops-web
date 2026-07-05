/**
 * OPS Web - QuickBooks Import Hooks (read-only sync, dry-run review + apply)
 *
 * TanStack Query hooks over the A1/A3 import routes:
 *   POST /api/integrations/quickbooks/import           → start run + pull + stage + match → { runId }
 *   GET  /api/integrations/quickbooks/import?runId=…    → QboImportReview
 *   POST /api/integrations/quickbooks/import/apply      → { applied: counts }
 *
 * No write ever reaches QuickBooks. apply writes only to OPS tables (handled server-side).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import type {
  MatchAction,
  QboImportReview,
} from "../types/qbo-import";

// ─── Apply payload ──────────────────────────────────────────────────────────

export interface ApplyDecision {
  customer_qb_id: string;
  action: MatchAction;
  client_id?: string;
}

/**
 * Apply is a background job: the route accepts the request (202), flips the run
 * to `applying`, and writes to OPS after responding. The UI observes progress
 * through the run's status (polled by useImportReview) and a persistent rail
 * notification — it does NOT block on the write completing.
 */
export interface ApplyAccepted {
  status: "applying";
  runId: string;
}

// ─── Auth'd fetch (Firebase JWT, matches AccountingService) ───────────────────

async function authedFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const idToken = await getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
  });
}

// ─── Start a run (pull → stage → compute matches) ─────────────────────────────

export function useStartImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      companyId,
    }: {
      companyId: string;
    }): Promise<{ runId: string }> => {
      const res = await authedFetch("/api/integrations/quickbooks/import", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "QuickBooks pull failed");
      }
      return res.json();
    },
    onSuccess: (_data, { companyId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.importRun(companyId),
      });
    },
  });
}

// ─── Fetch the staged review for a run ────────────────────────────────────────

export function useImportReview(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.accounting.importReview(runId ?? "none"),
    queryFn: async (): Promise<QboImportReview> => {
      const res = await authedFetch(
        `/api/integrations/quickbooks/import?runId=${runId}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to load import review");
      }
      return res.json();
    },
    enabled: !!runId,
    // While a background apply is running, poll the run so the tab reflects
    // completion (status → applied/error) without a manual refresh. Stops the
    // moment the run settles.
    refetchInterval: (query) =>
      query.state.data?.run.status === "applying" ? 2000 : false,
  });
}

// ─── Apply approved decisions ─────────────────────────────────────────────────

export function useApplyImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      runId,
      decisions,
    }: {
      runId: string;
      decisions: ApplyDecision[];
    }): Promise<ApplyAccepted> => {
      const res = await authedFetch(
        "/api/integrations/quickbooks/import/apply",
        {
          method: "POST",
          body: JSON.stringify({ runId, decisions }),
        }
      );
      // 202 Accepted: the write runs in the background. Anything else is a
      // synchronous rejection (bad decisions, auth, run not found).
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Apply failed");
      }
      return res.json();
    },
    onSuccess: (_data, { runId }) => {
      // The apply route owns the notification-rail event (a persistent
      // "applying" notification it resolves to "complete" server-side) — we do
      // NOT notify from the client. Invalidate the review so polling picks up
      // the run flipping to `applying` → `applied`.
      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.importReview(runId),
      });
      // Imported $ will land in clients/invoices/payments — refresh the dash
      // once the run settles (the review poll re-invalidates on completion).
      queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
    },
  });
}
