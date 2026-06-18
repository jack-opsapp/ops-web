"use client";

/**
 * Reads the company's live PRODUCT rows for the file-upload dedupe (spec §11).
 * A re-import must MERGE its rows into the catalog (show-diff), never double-
 * create — so before staging uploaded cards the wizard matches them against
 * these rows on `lower(trim(sku))` (and name when SKU is absent).
 *
 * Selects exactly the columns the matcher + show-diff canvas need. `external_*`
 * exist on prod (additive dedupe-identity migration) but lag the generated
 * `database.types.ts`, so the result is cast through `unknown` to the explicit
 * `ExistingProductRow` shape.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "../supabase/helpers";
import { useAuthStore } from "../store/auth-store";
import type { ExistingProductRow } from "@/lib/catalog-setup/existing-rows";

const EXISTING_PRODUCT_COLUMNS =
  "id, sku, name, base_price, unit_cost, is_taxable, kind, description, category_id, is_active, show_in_storefront, pricing_unit, external_source, external_id";

export function useCatalogSetupExistingRows() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: ["catalog-setup", "existing-products", companyId],
    queryFn: async (): Promise<ExistingProductRow[]> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("products")
        .select(EXISTING_PRODUCT_COLUMNS)
        .eq("company_id", companyId)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as unknown as ExistingProductRow[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}
