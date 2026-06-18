"use client";

/**
 * Runs the read-only QuickBooks catalog pull via
 * POST /api/catalog/setup/import/quickbooks (spec §8, §11).
 *
 * The route reads the Firebase idToken from the body (mirrors the commit hook),
 * pulls QB Items server-side, maps them to SELL cards, dedupes them against the
 * live catalog, and returns classified cards (proposed/merge) + the show-diff
 * map. The caller dispatches the cards onto the canvas; the shared commit then
 * stamps external_source/external_id so the next pull re-syncs, never duplicates.
 *
 * A missing/inactive connection (or a stale refresh token) resolves to a
 * `connected: false` result (NOT an error) so the pane can offer connect/reconnect
 * honestly. Transport / server failures throw `QbPullError`.
 */

import { useMutation } from "@tanstack/react-query";
import type { StagingCard, SellFields } from "../catalog-setup/staging-card";

export interface QbPullSummary {
  /** Raw QB Items returned by the pull. */
  pulled: number;
  /** SELL cards staged onto the canvas (Category folders dropped). */
  staged: number;
  /** Of the staged cards, how many matched a live catalog row (merge cards). */
  matched: number;
  /** Cards that cannot commit until fixed (e.g. a missing name). */
  blockers: number;
  /** Cards mapped via a safe default the owner should review. */
  needsReview: number;
}

export interface QbPullConnected {
  connected: true;
  cards: StagingCard[];
  existingRows: Record<string, SellFields>;
  summary: QbPullSummary;
}

export interface QbPullDisconnected {
  connected: false;
  /** A stale refresh token → reconnect required (vs simply never connected). */
  reconnect: boolean;
}

export type QbPullResult = QbPullConnected | QbPullDisconnected;

export class QbPullError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "QbPullError";
    this.status = status;
  }
}

interface RawResponse {
  ok: boolean;
  error?: string;
  connected?: boolean;
  reconnect?: boolean;
  cards?: StagingCard[];
  existingRows?: Record<string, SellFields>;
  summary?: QbPullSummary;
}

export function useQuickBooksCatalogPull() {
  return useMutation<QbPullResult, QbPullError, void>({
    mutationFn: async () => {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/catalog/setup/import/quickbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json().catch(() => null)) as RawResponse | null;

      if (!res.ok || !json || json.ok !== true) {
        throw new QbPullError(json?.error ?? "QuickBooks pull failed", res.status);
      }

      if (json.connected === false) {
        return { connected: false, reconnect: json.reconnect === true };
      }
      return {
        connected: true,
        cards: json.cards ?? [],
        existingRows: json.existingRows ?? {},
        summary:
          json.summary ?? { pulled: 0, staged: 0, matched: 0, blockers: 0, needsReview: 0 },
      };
    },
  });
}
