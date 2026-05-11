/**
 * OPS Web - Product Pricing Modifiers Service
 *
 * CRUD for `product_pricing_modifiers`. RLS enforces company isolation
 * via the parent product (verified live 2026-05-08).
 *
 * No soft-delete — confirm on the route layer.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProductPricingModifier,
  CreateProductPricingModifier,
  UpdateProductPricingModifier,
} from "@/lib/types/product-options";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ProductPricingModifier {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    optionId: row.option_id as string,
    triggerValueId: (row.trigger_value_id as string) ?? null,
    triggerIntMin:
      row.trigger_int_min != null ? Number(row.trigger_int_min) : null,
    triggerIntMax:
      row.trigger_int_max != null ? Number(row.trigger_int_max) : null,
    modifierKind: row.modifier_kind as ProductPricingModifier["modifierKind"],
    amount: Number(row.amount ?? 0),
  };
}

function mapToDb(
  data: Partial<CreateProductPricingModifier>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.productId !== undefined) row.product_id = data.productId;
  if (data.optionId !== undefined) row.option_id = data.optionId;
  if (data.triggerValueId !== undefined)
    row.trigger_value_id = data.triggerValueId;
  if (data.triggerIntMin !== undefined)
    row.trigger_int_min = data.triggerIntMin;
  if (data.triggerIntMax !== undefined)
    row.trigger_int_max = data.triggerIntMax;
  if (data.modifierKind !== undefined) row.modifier_kind = data.modifierKind;
  if (data.amount !== undefined) row.amount = data.amount;
  return row;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const ProductPricingModifiersService = {
  async fetchByProduct(
    productId: string
  ): Promise<ProductPricingModifier[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_pricing_modifiers")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: true });

    if (error)
      throw new Error(`Failed to fetch pricing modifiers: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async createModifier(
    data: CreateProductPricingModifier
  ): Promise<ProductPricingModifier> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: created, error } = await supabase
      .from("product_pricing_modifiers")
      .insert(row)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to create pricing modifier: ${error.message}`);
    return mapFromDb(created);
  },

  async updateModifier(
    id: string,
    data: UpdateProductPricingModifier
  ): Promise<ProductPricingModifier> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: updated, error } = await supabase
      .from("product_pricing_modifiers")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error)
      throw new Error(`Failed to update pricing modifier: ${error.message}`);
    return mapFromDb(updated);
  },

  async deleteModifier(id: string): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("product_pricing_modifiers")
      .delete()
      .eq("id", id);

    if (error)
      throw new Error(`Failed to delete pricing modifier: ${error.message}`);
  },
};
