/**
 * OPS Web - Product Options Service
 *
 * CRUD for `product_options` and the nested `product_option_values` table.
 * RLS enforces company isolation via the parent product (verified live).
 *
 * No soft-delete — these tables hard-delete; the route layer must
 * confirm-on-delete per the perfection standard.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProductOption,
  CreateProductOption,
  UpdateProductOption,
  ProductOptionValue,
  CreateProductOptionValue,
  UpdateProductOptionValue,
} from "@/lib/types/product-options";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapOptionFromDb(row: Record<string, unknown>): ProductOption {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    name: row.name as string,
    kind: row.kind as ProductOption["kind"],
    affectsPrice: (row.affects_price as boolean) ?? false,
    affectsRecipe: (row.affects_recipe as boolean) ?? false,
    required: (row.required as boolean) ?? true,
    defaultValue: (row.default_value as string) ?? null,
    optionDefaultSource: (row.option_default_source as string) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapOptionToDb(
  data: Partial<CreateProductOption>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.productId !== undefined) row.product_id = data.productId;
  if (data.name !== undefined) row.name = data.name;
  if (data.kind !== undefined) row.kind = data.kind;
  if (data.affectsPrice !== undefined) row.affects_price = data.affectsPrice;
  if (data.affectsRecipe !== undefined) row.affects_recipe = data.affectsRecipe;
  if (data.required !== undefined) row.required = data.required;
  if (data.defaultValue !== undefined) row.default_value = data.defaultValue;
  if (data.optionDefaultSource !== undefined)
    row.option_default_source = data.optionDefaultSource;
  if (data.sortOrder !== undefined) row.sort_order = data.sortOrder;
  return row;
}

function mapValueFromDb(row: Record<string, unknown>): ProductOptionValue {
  return {
    id: row.id as string,
    optionId: row.option_id as string,
    value: row.value as string,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapValueToDb(
  data: Partial<CreateProductOptionValue>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.optionId !== undefined) row.option_id = data.optionId;
  if (data.value !== undefined) row.value = data.value;
  if (data.sortOrder !== undefined) row.sort_order = data.sortOrder;
  return row;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const ProductOptionsService = {
  /** Fetch all options for a product, sorted by sort_order then name. */
  async fetchOptions(productId: string): Promise<ProductOption[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_options")
      .select("*")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error)
      throw new Error(`Failed to fetch product options: ${error.message}`);
    return (data ?? []).map(mapOptionFromDb);
  },

  /** Fetch all option values for a list of option ids in one round trip. */
  async fetchValuesForOptions(
    optionIds: string[]
  ): Promise<ProductOptionValue[]> {
    if (optionIds.length === 0) return [];
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_option_values")
      .select("*")
      .in("option_id", optionIds)
      .order("sort_order", { ascending: true })
      .order("value", { ascending: true });

    if (error)
      throw new Error(`Failed to fetch option values: ${error.message}`);
    return (data ?? []).map(mapValueFromDb);
  },

  async createOption(data: CreateProductOption): Promise<ProductOption> {
    const supabase = requireSupabase();
    const row = mapOptionToDb(data);

    const { data: created, error } = await supabase
      .from("product_options")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create product option: ${error.message}`);
    return mapOptionFromDb(created);
  },

  async updateOption(
    id: string,
    data: UpdateProductOption
  ): Promise<ProductOption> {
    const supabase = requireSupabase();
    const row = mapOptionToDb(data);

    const { data: updated, error } = await supabase
      .from("product_options")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update product option: ${error.message}`);
    return mapOptionFromDb(updated);
  },

  /**
   * Reorder a batch of options. Caller passes the full set in display order;
   * we write each row's new sort_order in a single round trip via upsert.
   */
  async reorderOptions(
    productId: string,
    orderedIds: string[]
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    const supabase = requireSupabase();

    // Update each row individually — upsert would require the full row,
    // and we don't want to pay the round-trip to fetch them all first.
    // PostgREST batches these into a single HTTP/2 connection, so the
    // wall-clock cost is roughly one round trip + N parallel writes.
    const updates = orderedIds.map((id, index) =>
      supabase
        .from("product_options")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("product_id", productId)
    );

    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError)
      throw new Error(`Failed to reorder options: ${firstError.message}`);
  },

  async deleteOption(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("product_options")
      .delete()
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete product option: ${error.message}`);
  },

  // ─── Option Values ──────────────────────────────────────────────────────

  async createValue(
    data: CreateProductOptionValue
  ): Promise<ProductOptionValue> {
    const supabase = requireSupabase();
    const row = mapValueToDb(data);

    const { data: created, error } = await supabase
      .from("product_option_values")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create option value: ${error.message}`);
    return mapValueFromDb(created);
  },

  async updateValue(
    id: string,
    data: UpdateProductOptionValue
  ): Promise<ProductOptionValue> {
    const supabase = requireSupabase();
    const row = mapValueToDb(data);

    const { data: updated, error } = await supabase
      .from("product_option_values")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update option value: ${error.message}`);
    return mapValueFromDb(updated);
  },

  async reorderValues(
    optionId: string,
    orderedIds: string[]
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    const supabase = requireSupabase();

    const updates = orderedIds.map((id, index) =>
      supabase
        .from("product_option_values")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("option_id", optionId)
    );

    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError)
      throw new Error(`Failed to reorder values: ${firstError.message}`);
  },

  async deleteValue(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("product_option_values")
      .delete()
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete option value: ${error.message}`);
  },
};
