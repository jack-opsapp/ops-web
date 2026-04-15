/**
 * OPS Web - Line Item Materials Service
 *
 * CRUD for line_item_materials — per-estimate line item overrides to the
 * product BOM. Rows only exist when a user has explicitly overridden the
 * default recipe on a specific estimate line item.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  LineItemMaterial,
  CreateLineItemMaterial,
} from "@/lib/types/product-materials";

function mapFromDb(row: Record<string, unknown>): LineItemMaterial {
  return {
    id: row.id as string,
    lineItemId: row.line_item_id as string,
    inventoryItemId: row.inventory_item_id as string,
    quantity: Number(row.quantity ?? 0),
    source: (row.source as "stock" | "order") ?? "stock",
  };
}

function mapToDb(data: CreateLineItemMaterial): Record<string, unknown> {
  return {
    line_item_id: data.lineItemId,
    inventory_item_id: data.inventoryItemId,
    quantity: data.quantity,
    source: data.source ?? "stock",
  };
}

export const LineItemMaterialsService = {
  async fetchByLineItem(lineItemId: string): Promise<LineItemMaterial[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("line_item_materials")
      .select("*")
      .eq("line_item_id", lineItemId);

    if (error) throw new Error(`Failed to fetch line item materials: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async setOverrides(
    lineItemId: string,
    materials: CreateLineItemMaterial[]
  ): Promise<void> {
    const supabase = requireSupabase();

    const { error: deleteError } = await supabase
      .from("line_item_materials")
      .delete()
      .eq("line_item_id", lineItemId);

    if (deleteError) throw new Error(`Failed to clear line item materials: ${deleteError.message}`);

    if (materials.length > 0) {
      const rows = materials.map(mapToDb);
      const { error: insertError } = await supabase
        .from("line_item_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to set line item materials: ${insertError.message}`);
    }
  },
};
