/**
 * OPS Web - Task Materials Service
 *
 * CRUD for task_materials + population logic from product BOM / line item overrides.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  TaskMaterial,
  CreateTaskMaterial,
} from "@/lib/types/product-materials";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): TaskMaterial {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    inventoryItemId: row.inventory_item_id as string,
    quantity: Number(row.quantity ?? 0),
    source: (row.source as "stock" | "order") ?? "stock",
  };
}

function mapToDb(data: CreateTaskMaterial): Record<string, unknown> {
  return {
    task_id: data.taskId,
    inventory_item_id: data.inventoryItemId,
    quantity: data.quantity,
    source: data.source ?? "stock",
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const TaskMaterialsService = {
  /** Fetch all materials for a task */
  async fetchByTask(taskId: string): Promise<TaskMaterial[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_materials")
      .select("*")
      .eq("task_id", taskId);

    if (error) throw new Error(`Failed to fetch task materials: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /** Set all materials for a task (delete + re-insert) */
  async setMaterials(taskId: string, materials: CreateTaskMaterial[]): Promise<void> {
    const supabase = requireSupabase();

    const { error: deleteError } = await supabase
      .from("task_materials")
      .delete()
      .eq("task_id", taskId);

    if (deleteError) throw new Error(`Failed to clear task materials: ${deleteError.message}`);

    if (materials.length > 0) {
      const rows = materials.map(mapToDb);
      const { error: insertError } = await supabase
        .from("task_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to set task materials: ${insertError.message}`);
    }
  },

  /**
   * Populate task_materials from a source line item.
   * Resolution order:
   * 1. line_item_materials overrides (if any exist for the line item)
   * 2. product_materials BOM (calculated: line_item.quantity * quantity_per_unit)
   * 3. Nothing (no BOM, no overrides)
   */
  async populateFromLineItem(
    taskId: string,
    lineItemId: string
  ): Promise<TaskMaterial[]> {
    const supabase = requireSupabase();

    // 1. Check for line_item_materials overrides
    const { data: overrides, error: overrideError } = await supabase
      .from("line_item_materials")
      .select("*")
      .eq("line_item_id", lineItemId);

    if (overrideError) throw new Error(`Failed to fetch line item materials: ${overrideError.message}`);

    if (overrides && overrides.length > 0) {
      const rows = overrides.map((o) => ({
        task_id: taskId,
        inventory_item_id: o.inventory_item_id as string,
        quantity: Number(o.quantity),
        source: (o.source as string) ?? "stock",
      }));

      const { error: insertError } = await supabase
        .from("task_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to populate task materials from overrides: ${insertError.message}`);
      return rows.map((r) => ({
        id: "",
        taskId: r.task_id,
        inventoryItemId: r.inventory_item_id,
        quantity: r.quantity,
        source: r.source as "stock" | "order",
      }));
    }

    // 2. Fall back to product BOM
    const { data: lineItem, error: liError } = await supabase
      .from("line_items")
      .select("product_id, quantity")
      .eq("id", lineItemId)
      .single();

    if (liError || !lineItem?.product_id) return [];

    const { data: bom, error: bomError } = await supabase
      .from("product_materials")
      .select("*")
      .eq("product_id", lineItem.product_id as string);

    if (bomError) throw new Error(`Failed to fetch product BOM: ${bomError.message}`);
    if (!bom || bom.length === 0) return [];

    const lineQty = Number(lineItem.quantity);
    const rows = bom.map((b) => ({
      task_id: taskId,
      inventory_item_id: b.inventory_item_id as string,
      quantity: lineQty * Number(b.quantity_per_unit),
      source: "stock",
    }));

    const { error: insertError } = await supabase
      .from("task_materials")
      .insert(rows);

    if (insertError) throw new Error(`Failed to populate task materials from BOM: ${insertError.message}`);

    return rows.map((r) => ({
      id: "",
      taskId: r.task_id,
      inventoryItemId: r.inventory_item_id,
      quantity: r.quantity,
      source: r.source as "stock" | "order",
    }));
  },
};
