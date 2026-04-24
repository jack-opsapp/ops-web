"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useAuthStore } from "@/lib/store/auth-store";
import type { FirstRunState } from "@/lib/types/calibration";

/**
 * First-run detection + dismiss mutation. GETs the composite state from
 * /api/calibration/first-run; POST { action: "dismiss" } persists
 * users.preferences.calibrationFirstRunDismissed.
 */
export function useCalibrationFirstRun() {
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? "";
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["calibration", "first-run", companyId, userId],
    queryFn: async (): Promise<FirstRunState> => {
      const res = await authedFetch("/api/calibration/first-run");
      if (!res.ok) throw new Error("Failed to fetch first-run state");
      return res.json();
    },
    enabled: !!companyId && !!userId,
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const res = await authedFetch("/api/calibration/first-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!res.ok) throw new Error("Failed to dismiss");
      return res.json();
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["calibration", "first-run"] }),
  });

  return { ...query, dismiss: dismiss.mutate };
}
