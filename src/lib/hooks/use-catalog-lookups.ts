/**
 * OPS Web - Catalog Lookups Hook
 *
 * Lightweight read-only fetcher for `catalog_categories` and `catalog_units`
 * scoped to the active company. Used by the products form to resolve a
 * user-typed `category` / `unit` string into its FK id when an exact match
 * exists in the catalog (case-insensitive, trimmed). When no match, the
 * caller leaves the FK NULL and writes only the legacy free-text column.
 *
 * This is a stopgap for the P0 FK-write parity with iOS. Replace with real
 * pickers (Menu/Combobox over both tables) in P0-2.
 */

import { useQuery } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { useAuthStore } from "@/lib/store/auth-store";

export interface CatalogCategoryLookup {
  id: string;
  name: string;
}

export interface CatalogUnitLookup {
  id: string;
  display: string;
  abbreviation: string | null;
}

async function fetchCatalogCategories(
  companyId: string
): Promise<CatalogCategoryLookup[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("catalog_categories")
    .select("id, name")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch catalog categories: ${error.message}`);
  }
  return (data ?? []) as CatalogCategoryLookup[];
}

async function fetchCatalogUnits(
  companyId: string
): Promise<CatalogUnitLookup[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("catalog_units")
    .select("id, display, abbreviation")
    .eq("company_id", companyId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch catalog units: ${error.message}`);
  }
  return (data ?? []) as CatalogUnitLookup[];
}

export function useCatalogLookups() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const categoriesQuery = useQuery({
    queryKey: ["catalog-categories", companyId],
    queryFn: () => fetchCatalogCategories(companyId),
    enabled: !!companyId,
  });

  const unitsQuery = useQuery({
    queryKey: ["catalog-units", companyId],
    queryFn: () => fetchCatalogUnits(companyId),
    enabled: !!companyId,
  });

  return {
    categories: categoriesQuery.data ?? [],
    units: unitsQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || unitsQuery.isLoading,
  };
}

/**
 * Resolve a user-typed category string to a `catalog_categories.id`.
 * Returns null if no exact match (case-insensitive, trimmed) is found —
 * callers should leave the FK NULL in that case and continue to write
 * the legacy free-text `category` column.
 */
export function resolveCategoryId(
  raw: string | null | undefined,
  categories: ReadonlyArray<CatalogCategoryLookup>
): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return null;
  const match = categories.find(
    (c) => c.name.trim().toLowerCase() === trimmed
  );
  return match?.id ?? null;
}

/**
 * Resolve a user-typed unit string to a `catalog_units.id`. Matches against
 * `display` first, then falls back to `abbreviation`. Returns null if no
 * exact match (case-insensitive, trimmed) — same NULL-FK fallback policy
 * as `resolveCategoryId`.
 */
export function resolveUnitId(
  raw: string | null | undefined,
  units: ReadonlyArray<CatalogUnitLookup>
): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return null;
  const byDisplay = units.find(
    (u) => u.display.trim().toLowerCase() === trimmed
  );
  if (byDisplay) return byDisplay.id;
  const byAbbrev = units.find(
    (u) => (u.abbreviation ?? "").trim().toLowerCase() === trimmed
  );
  return byAbbrev?.id ?? null;
}
