"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { CalibrationRequestError } from "./calibration-request-error";
import type { DeckState } from "@/lib/types/calibration";

/**
 * Calibration deck state — polled every 30s with 20s staleness window.
 * Realtime updates are merged separately via use-calibration-recent.
 */
export function useCalibrationDeck() {
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: ["calibration", "deck", companyId],
    queryFn: async (): Promise<DeckState> => {
      const res = await authedFetch("/api/calibration/deck");
      if (!res.ok) {
        throw new CalibrationRequestError(
          res.status,
          "Failed to fetch deck state"
        );
      }
      return res.json();
    },
    enabled: !!companyId,
    // Poll only while the deck is healthy. A failed read plus a fixed 30s
    // interval is a storm, not a recovery: in production it produced 63 deck
    // requests in about two minutes. Recovery is the operator's RETRY.
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 30_000,
    staleTime: 20_000,
  });
}
