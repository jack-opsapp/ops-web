/**
 * OPS Web - Product Materials Service
 *
 * CRUD for product bill-of-materials (BOM).
 * Maps product_materials table: product_id + inventory_item_id composite PK.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProductMaterial,
  CreateProductMaterial,
} from "@/lib/types/product-materials";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ProductMaterial {
  return {
    productId: row.product_id as string,
    inventoryItemId: row.inventory_item_id as string,
    quantityPerUnit: Number(row.quantity_per_unit ?? 0),
    notes: (row.notes as string) ?? null,
  };
}

function mapToDb(data: CreateProductMaterial): Record<string, unknown> {
  return {
    product_id: data.productId,
    inventory_item_id: data.inventoryItemId,
    quantity_per_unit: data.quantityPerUnit,
    notes: data.notes ?? null,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const ProductMaterialsService = {
  /** Fetch all BOM rows for a product */
  async fetchByProduct(productId: string): Promise<ProductMaterial[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_materials")
      .select("*")
      .eq("product_id", productId);

    if (error) throw new Error(`Failed to fetch product materials: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /** Set the full BOM for a product (delete + re-insert) */
  async setBom(productId: string, materials: CreateProductMaterial[]): Promise<void> {
    const supabase = requireSupabase();

    const { error: deleteError } = await supabase
      .from("product_materials")
      .delete()
      .eq("product_id", productId);

    if (deleteError) throw new Error(`Failed to clear product materials: ${deleteError.message}`);

    if (materials.length > 0) {
      const rows = materials.map(mapToDb);
      const { error: insertError } = await supabase
        .from("product_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to set product materials: ${insertError.message}`);
    }
  },

  /** Fetch BOM for multiple products (batch, for stock indicator) */
  async fetchByProducts(productIds: string[]): Promise<ProductMaterial[]> {
    if (productIds.length === 0) return [];
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_materials")
      .select("*")
      .in("product_id", productIds);

    if (error) throw new Error(`Failed to fetch product materials batch: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },
};
