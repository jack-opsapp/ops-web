"use client";

/**
 * Commits the accepted staging-card set to the catalog via
 * POST /api/catalog/setup/commit (→ catalog_setup_save). On success it
 * invalidates the catalog queries so the supply strip + segment tables re-read
 * the now-live counts (the 0/0 first-run signal flips off) and the completion
 * flag refreshes.
 *
 * The route reads the Firebase idToken from the body (mirrors /api/setup/progress
 * — the onboarding analog). Throws CommitError on a non-ok response so the caller
 * can surface blockers precisely.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { useAuthStore } from "../store/auth-store";
import type { StagingCard } from "../catalog-setup/staging-card";

export interface CommitArgs {
  /** Stable wizard-session id → replay-safe idempotency key. */
  sessionId: string;
  cards: StagingCard[];
  mode?: "create" | "edit";
  externalSource?: string;
}

export interface CommitCounts {
  products: number;
  stock: number;
  /** task_types newly created by the TYPES commit (additive; trade is separate). */
  types?: number;
}

export interface CommitSuccess {
  ok: true;
  counts: CommitCounts;
  warnings?: string[];
}

export interface CommitBlocker {
  code?: string;
  message?: string;
}

export class CommitError extends Error {
  readonly blockers: CommitBlocker[];
  readonly status: number;
  constructor(message: string, blockers: CommitBlocker[], status: number) {
    super(message);
    this.name = "CommitError";
    this.blockers = blockers;
    this.status = status;
  }
}

export function useCommitCatalogSetup() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation<CommitSuccess, CommitError, CommitArgs>({
    mutationFn: async (args) => {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/catalog/setup/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...args }),
      });
      const json = (await res.json().catch(() => null)) as
        | (CommitSuccess & { error?: string; blockers?: CommitBlocker[] })
        | { ok: false; error?: string; blockers?: CommitBlocker[] }
        | null;

      if (!res.ok || !json || json.ok !== true) {
        throw new CommitError(
          json?.error ?? "Catalog commit failed",
          json?.blockers ?? [],
          res.status,
        );
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.companySettings.all, companyId, "catalogSetup"],
      });
    },
  });
}
