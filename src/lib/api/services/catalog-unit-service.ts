/**
 * OPS Web - Catalog Unit Service (Supabase)
 *
 * Minimal write-side wrapper around `catalog_units`. Mirrors the iOS
 * `CreateCatalogUnitDTO` field set. Used by the inline-create unit dialog
 * to insert a new row and hand it back to the unit picker.
 *
 * The `dimension` value must match the Postgres check constraint on
 * `catalog_units.dimension`: count / length / area / volume / mass / time.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

export const CATALOG_UNIT_DIMENSIONS = [
  "count",
  "length",
  "area",
  "volume",
  "mass",
  "time",
] as const;

export type CatalogUnitDimension = (typeof CATALOG_UNIT_DIMENSIONS)[number];

export interface CatalogUnit {
  id: string;
  companyId: string;
  display: string;
  abbreviation: string | null;
  dimension: CatalogUnitDimension;
  isDefault: boolean;
  sortOrder: number;
}

export interface CreateCatalogUnitInput {
  companyId: string;
  display: string;
  dimension: CatalogUnitDimension;
  abbreviation?: string | null;
  isDefault?: boolean;
  /**
   * Optional explicit sort order. When omitted the service picks
   * `max(sort_order) + 1` for the company.
   */
  sortOrder?: number;
}

function mapFromDb(row: Record<string, unknown>): CatalogUnit {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    display: row.display as string,
    abbreviation: (row.abbreviation as string | null) ?? null,
    dimension: row.dimension as CatalogUnitDimension,
    isDefault: (row.is_default as boolean) ?? false,
    sortOrder: (row.sort_order as number) ?? 0,
  };
}

/**
 * Compute the next `sort_order` for the given company. Reads the current
 * max from non-deleted rows and returns `max + 1`, or `1` if the company
 * has no units yet.
 */
async function nextSortOrder(companyId: string): Promise<number> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("catalog_units")
    .select("sort_order")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to compute next unit sort_order: ${error.message}`
    );
  }
  const max = (data?.[0]?.sort_order as number | undefined) ?? 0;
  return max + 1;
}

export const CatalogUnitService = {
  /**
   * Create a new catalog unit. When `sortOrder` is not supplied, the
   * service places the row at the end of the company's list.
   */
  async create(input: CreateCatalogUnitInput): Promise<CatalogUnit> {
    const supabase = requireSupabase();
    const sortOrder =
      input.sortOrder ?? (await nextSortOrder(input.companyId));

    const row = {
      company_id: input.companyId,
      display: input.display.trim(),
      abbreviation: input.abbreviation?.trim() || null,
      dimension: input.dimension,
      is_default: input.isDefault ?? false,
      sort_order: sortOrder,
    };

    const { data, error } = await supabase
      .from("catalog_units")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create catalog unit: ${error.message}`);
    }
    return mapFromDb(data as Record<string, unknown>);
  },
};

export default CatalogUnitService;
