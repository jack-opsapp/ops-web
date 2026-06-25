"use client";

/**
 * useBaselineSeeded — has this company's baseline been seeded
 * (`initialize_company_defaults`: task_types + units both present)? The catalog
 * setup wizard builds on higher layers and must never re-seed those primitives,
 * so its prerequisite gate refuses to run until the baseline exists (spec §16
 * "Prerequisites"; predicate `baselineSeeded`).
 *
 * FAIL-OPEN: a blocked/failed count read must never wall a legitimate operator
 * out of setup, so on any query error we treat the baseline as present (the
 * wizard's commit path is merge-capable + idempotent regardless). The gate is
 * for the rare brand-new / mid-provisioning company, not a hard barrier.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "../supabase/helpers";
import { useAuthStore } from "../store/auth-store";
import { baselineSeeded } from "@/lib/catalog-setup/prerequisites";

export function useBaselineSeeded() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: ["catalog-setup", "baseline-seeded", companyId],
    queryFn: async (): Promise<boolean> => {
      const supabase = requireSupabase();
      const [types, units] = await Promise.all([
        supabase
          .from("task_types")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
        supabase
          .from("catalog_units")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId),
      ]);
      // Fail-open per read: a thrown/blocked count must not gate a real operator.
      const taskTypeCount = types.error ? 1 : types.count ?? 0;
      const unitCount = units.error ? 1 : units.count ?? 0;
      return baselineSeeded(taskTypeCount, unitCount);
    },
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
}
