"use client";

/**
 * Reads the company-scoped catalog-setup completion flag
 * (`company_settings.catalog_setup_completed_at`). NULL = never completed.
 *
 * The first-run takeover suppresses on EITHER signal: this flag set, OR the
 * catalog already holding data (products/stock > 0). The flag is what flips a
 * re-emptied catalog (everything deleted) from "fresh takeover" back to a quiet
 * launch entry (spec §6, §214) — so a one-time setup is never re-imposed.
 *
 * `company_settings.company_id` is TEXT — the uuid company id compares fine
 * against it (text equality); no cast needed.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { requireSupabase } from "../supabase/helpers";
import { useAuthStore } from "../store/auth-store";

export interface CatalogSetupStatus {
  completedAt: string | null;
}

export function useCatalogSetupStatus() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.companySettings.all, companyId, "catalogSetup"],
    queryFn: async (): Promise<CatalogSetupStatus> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("company_settings")
        .select("catalog_setup_completed_at")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      return {
        completedAt:
          (data?.catalog_setup_completed_at as string | null) ?? null,
      };
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}
