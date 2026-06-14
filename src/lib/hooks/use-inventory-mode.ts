"use client";

/**
 * Reads `company_inventory_settings.inventory_mode` for the active company.
 * Drives whether the wizard's STOCK module renders (state-aware — the deck never
 * shows a step the operator will never touch; spec §6/§9, step-machine
 * buildStepPlan). Column default is `'off'`, and most companies have no settings
 * row yet → `tracked` defaults to false (STOCK omitted until inventory is on).
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "../supabase/helpers";
import { useAuthStore } from "../store/auth-store";

export interface InventoryMode {
  mode: string;
  tracked: boolean;
}

export function useInventoryMode() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: ["companyInventorySettings", companyId, "mode"],
    queryFn: async (): Promise<InventoryMode> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("company_inventory_settings")
        .select("inventory_mode")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      const mode = (data?.inventory_mode as string | null) ?? "off";
      return { mode, tracked: mode === "tracked" };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}
