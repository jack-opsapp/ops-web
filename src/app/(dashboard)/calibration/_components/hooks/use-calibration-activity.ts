"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import type {
  ActivityFilters,
  RecentEvent,
} from "@/lib/types/calibration";

/**
 * ACTIVITY drill-in log. Not virtualized in first cut — the 30-day
 * default window on a single-customer corpus returns well under 1k rows,
 * and the existing pages list pattern uses plain overflow. Swap to
 * TanStack Virtual if a customer's log exceeds ~2k visible entries.
 */
export function useCalibrationActivity(
  filters: ActivityFilters,
  cursor?: string,
  limit = 50
) {
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";

  const typesParam =
    filters.types === "all" ? "all" : filters.types.join(",");

  return useQuery({
    queryKey: [
      "calibration",
      "activity",
      companyId,
      typesParam,
      filters.timeRange,
      cursor ?? null,
      limit,
    ],
    queryFn: async () => {
      const sp = new URLSearchParams({
        types: typesParam,
        timeRange: filters.timeRange,
        limit: String(limit),
      });
      if (cursor) sp.set("cursor", cursor);
      const res = await authedFetch(`/api/calibration/activity?${sp}`);
      if (!res.ok) throw new Error("Failed to fetch activity log");
      return res.json() as Promise<{
        events: RecentEvent[];
        nextCursor: string | null;
      }>;
    },
    enabled: !!companyId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
