"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
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
      if (!res.ok) throw new Error("Failed to fetch deck state");
      return res.json();
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
