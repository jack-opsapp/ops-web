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
import { useCreateNotification } from "./use-notifications";
import { useDictionary } from "@/i18n/client";
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

export interface ApplyResult {
  applied: {
    customers: number;
    estimates: number;
    invoices: number;
    payments: number;
    lineItems: number;
  };
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
  });
}

// ─── Apply approved decisions, then fire the notification-rail event ──────────

export function useApplyImport() {
  const queryClient = useQueryClient();
  const notify = useCreateNotification();
  const { t } = useDictionary("accounting");

  return useMutation({
    mutationFn: async ({
      runId,
      decisions,
    }: {
      runId: string;
      decisions: ApplyDecision[];
    }): Promise<ApplyResult> => {
      const res = await authedFetch(
        "/api/integrations/quickbooks/import/apply",
        {
          method: "POST",
          body: JSON.stringify({ runId, decisions }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Apply failed");
      }
      return res.json();
    },
    onSuccess: (data, { runId }) => {
      const a = data.applied;
      const total =
        a.customers + a.estimates + a.invoices + a.payments + a.lineItems;

      // Notification-rail event (read-only import landed). No QB-specific
      // NotificationType exists in the DB enum, so use the generic 'system'
      // type; the web Books/A-R surface is the click-through target.
      notify({
        type: "system",
        title: t("qbo.notify.title"),
        body: t("qbo.notify.body", { count: total }),
        actionUrl: "/accounting?tab=dashboard",
        actionLabel: t("qbo.notify.action"),
        persistent: false,
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.importReview(runId),
      });
      // Imported $ now lives in clients/invoices/payments — refresh the dash.
      queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
    },
  });
}
