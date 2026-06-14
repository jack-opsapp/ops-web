"use client";

/**
 * Flip a company's inventory mode via the set_company_inventory_mode RPC. Used by
 * the catalog-setup wizard's inventory-off prompt: when the owner chooses "track
 * inventory", this turns tracking on so the STOCK module appears and the stock
 * cards commit as tracked variants. Invalidates the inventory-mode read so the
 * wizard's state-aware UI updates immediately.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "../supabase/helpers";
import { useAuthStore } from "../store/auth-store";

export type InventoryModeValue = "tracked" | "off";

export function useSetInventoryMode() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useMutation<void, Error, InventoryModeValue>({
    mutationFn: async (mode) => {
      const supabase = requireSupabase();
      const { error } = await supabase.rpc("set_company_inventory_mode", {
        p_company_id: companyId,
        p_inventory_mode: mode,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["companyInventorySettings", companyId, "mode"],
      });
    },
  });
}
