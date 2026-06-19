/**
 * OPS Web — Catalog Meta Service
 *
 * Read + manage operations for the catalog admin vocabulary: categories,
 * tags, units. Creates reuse the existing single-purpose services
 * (`CatalogCategoryService.create`, `CatalogUnitService.create`); this file
 * adds the list reads and the update/delete operations the kebab "// MANAGE"
 * modals need. All gated by `catalog.manage` at the UI layer (never roles).
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  CatalogCategoryNode,
  CatalogTag,
  CatalogUnit,
} from "@/lib/types/catalog";

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

export const CatalogMetaService = {
  // ── Categories ──────────────────────────────────────────────────────────
  async fetchCategories(companyId: string): Promise<CatalogCategoryNode[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("catalog_categories")
      .select(
        "id, company_id, name, parent_id, sort_order, color_hex, default_warning_threshold, default_critical_threshold",
      )
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order");
    if (error) throw new Error(`Failed to fetch categories: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      companyId: r.company_id as string,
      name: r.name as string,
      parentId: (r.parent_id as string) ?? null,
      sortOrder: (r.sort_order as number) ?? 0,
      colorHex: (r.color_hex as string) ?? null,
      defaultWarningThreshold: num(r.default_warning_threshold),
      defaultCriticalThreshold: num(r.default_critical_threshold),
    }));
  },

  async updateCategory(
    id: string,
    patch: {
      name?: string;
      defaultWarningThreshold?: number | null;
      defaultCriticalThreshold?: number | null;
    },
  ): Promise<void> {
    const supabase = requireSupabase();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.defaultWarningThreshold !== undefined)
      row.default_warning_threshold = patch.defaultWarningThreshold;
    if (patch.defaultCriticalThreshold !== undefined)
      row.default_critical_threshold = patch.defaultCriticalThreshold;
    const { error } = await supabase
      .from("catalog_categories")
      .update(row)
      .eq("id", id);
    if (error) throw new Error(`Failed to update category: ${error.message}`);
  },

  async deleteCategory(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("catalog_categories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Failed to delete category: ${error.message}`);
  },

  // ── Tags ────────────────────────────────────────────────────────────────
  async fetchTags(companyId: string): Promise<CatalogTag[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("catalog_tags")
      .select("id, company_id, name")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("name");
    if (error) throw new Error(`Failed to fetch tags: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      companyId: r.company_id as string,
      name: r.name as string,
    }));
  },

  async createTag(companyId: string, name: string): Promise<CatalogTag> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("catalog_tags")
      .insert({ company_id: companyId, name: name.trim() })
      .select("id, company_id, name")
      .single();
    if (error || !data) throw new Error(`Failed to create tag: ${error?.message}`);
    return {
      id: data.id as string,
      companyId: data.company_id as string,
      name: data.name as string,
    };
  },

  async renameTag(id: string, name: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("catalog_tags")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Failed to rename tag: ${error.message}`);
  },

  async deleteTag(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("catalog_tags")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Failed to delete tag: ${error.message}`);
  },

  // ── Units ───────────────────────────────────────────────────────────────
  async fetchUnits(companyId: string): Promise<CatalogUnit[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("catalog_units")
      .select("id, company_id, display, abbreviation, dimension, is_default, sort_order")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("sort_order");
    if (error) throw new Error(`Failed to fetch units: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      companyId: r.company_id as string,
      display: r.display as string,
      abbreviation: (r.abbreviation as string) ?? null,
      dimension: r.dimension as string,
      isDefault: (r.is_default as boolean) ?? false,
      sortOrder: (r.sort_order as number) ?? 0,
    }));
  },

  async deleteUnit(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("catalog_units")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Failed to delete unit: ${error.message}`);
  },
};

export default CatalogMetaService;
