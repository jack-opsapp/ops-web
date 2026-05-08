/**
 * OPS Web - Catalog Category Service (Supabase)
 *
 * Minimal write-side wrapper around `catalog_categories`. The picker layer
 * still reads through `useCatalogLookups` for the cached list; this service
 * is the path the inline-create dialog uses to insert a new row and feed it
 * back to the picker.
 *
 * Mirrors the iOS `CreateCatalogCategoryDTO` field set so the two platforms
 * stay row-shape-compatible.
 */

import { requireSupabase } from "@/lib/supabase/helpers";

export interface CatalogCategory {
  id: string;
  companyId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  colorHex: string | null;
  defaultWarningThreshold: number | null;
  defaultCriticalThreshold: number | null;
}

export interface CreateCatalogCategoryInput {
  companyId: string;
  name: string;
  parentId?: string | null;
  /**
   * Optional explicit sort order. When omitted the service picks
   * `max(sort_order) + 1` for the company so the new row appends to the
   * end of the picker list.
   */
  sortOrder?: number;
  colorHex?: string | null;
  defaultWarningThreshold?: number | null;
  defaultCriticalThreshold?: number | null;
}

function mapFromDb(row: Record<string, unknown>): CatalogCategory {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    parentId: (row.parent_id as string | null) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
    colorHex: (row.color_hex as string | null) ?? null,
    defaultWarningThreshold:
      (row.default_warning_threshold as number | null) ?? null,
    defaultCriticalThreshold:
      (row.default_critical_threshold as number | null) ?? null,
  };
}

/**
 * Compute the next `sort_order` for the given company. Reads the current
 * max from non-deleted rows and returns `max + 1`, or `1` if the company
 * has no categories yet.
 */
async function nextSortOrder(companyId: string): Promise<number> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("catalog_categories")
    .select("sort_order")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to compute next category sort_order: ${error.message}`
    );
  }
  const max = (data?.[0]?.sort_order as number | undefined) ?? 0;
  return max + 1;
}

export const CatalogCategoryService = {
  /**
   * Create a new catalog category. When `sortOrder` is not supplied, the
   * service places the row at the end of the company's list.
   */
  async create(input: CreateCatalogCategoryInput): Promise<CatalogCategory> {
    const supabase = requireSupabase();
    const sortOrder =
      input.sortOrder ?? (await nextSortOrder(input.companyId));

    const row = {
      company_id: input.companyId,
      name: input.name.trim(),
      parent_id: input.parentId ?? null,
      sort_order: sortOrder,
      color_hex: input.colorHex ?? null,
      default_warning_threshold: input.defaultWarningThreshold ?? null,
      default_critical_threshold: input.defaultCriticalThreshold ?? null,
    };

    const { data, error } = await supabase
      .from("catalog_categories")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create catalog category: ${error.message}`);
    }
    return mapFromDb(data as Record<string, unknown>);
  },
};

export default CatalogCategoryService;
