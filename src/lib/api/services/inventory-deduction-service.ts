/**
 * OPS Web - Inventory Deduction Service
 *
 * Transactional deduction on task completion, reversal on task reopening,
 * and audit trail queries.
 *
 * IMPORTANT: deductForTask and reverseForTask must be called AFTER the task
 * status update succeeds. They are NOT idempotent — the inventory_deducted
 * guard on project_tasks prevents double-processing.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  InventoryDeduction,
  DeductionReason,
} from "@/lib/types/product-materials";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): InventoryDeduction {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    inventoryItemId: (row.inventory_item_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    taskId: (row.task_id as string) ?? null,
    lineItemId: (row.line_item_id as string) ?? null,
    quantityDeducted: Number(row.quantity_deducted ?? 0),
    previousQuantity: Number(row.previous_quantity ?? 0),
    newQuantity: Number(row.new_quantity ?? 0),
    reason: ((row.reason as DeductionReason) ?? "task_completion"),
    deductedBy: (row.deducted_by as string) ?? null,
    deductedAt: parseDate(row.deducted_at) ?? new Date(),
    notes: (row.notes as string) ?? null,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const InventoryDeductionService = {
  /**
   * Deduct inventory for a completed task.
   * Reads task_materials (source='stock' only), deducts from inventory_items,
   * writes audit rows to inventory_deductions, sets inventory_deducted=true.
   */
  async deductForTask(taskId: string, userId: string | null): Promise<void> {
    const supabase = requireSupabase();

    const { data: task, error: taskError } = await supabase
      .from("project_tasks")
      .select("id, company_id, project_id, source_line_item_id, inventory_deducted")
      .eq("id", taskId)
      .single();

    if (taskError || !task) return;
    if (task.inventory_deducted) return;

    const { data: materials, error: matError } = await supabase
      .from("task_materials")
      .select("inventory_item_id, quantity")
      .eq("task_id", taskId)
      .eq("source", "stock");

    if (matError) throw new Error(`Failed to fetch task materials: ${matError.message}`);
    if (!materials || materials.length === 0) {
      await supabase
        .from("project_tasks")
        .update({ inventory_deducted: true })
        .eq("id", taskId);
      return;
    }

    const companyId = task.company_id as string;
    const projectId = (task.project_id as string) ?? null;
    const rawLineItemId = (task.source_line_item_id as string) ?? null;
    const lineItemUuid = rawLineItemId && UUID_RE.test(rawLineItemId) ? rawLineItemId : null;

    for (const mat of materials) {
      const itemId = mat.inventory_item_id as string;
      const deductQty = Number(mat.quantity);

      const { data: item, error: itemError } = await supabase
        .from("inventory_items")
        .select("quantity, deleted_at, warning_threshold, name")
        .eq("id", itemId)
        .single();

      if (itemError || !item) continue;

      if (item.deleted_at) {
        await supabase.from("inventory_deductions").insert({
          company_id: companyId,
          inventory_item_id: itemId,
          project_id: projectId,
          task_id: taskId,
          line_item_id: lineItemUuid,
          quantity_deducted: 0,
          previous_quantity: Number(item.quantity),
          new_quantity: Number(item.quantity),
          reason: "skipped_archived",
          deducted_by: userId,
          notes: `Skipped: ${item.name} is archived`,
        });
        continue;
      }

      const currentQty = Number(item.quantity);
      const newQty = Math.max(0, currentQty - deductQty);

      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", itemId);

      if (updateError) throw new Error(`Failed to deduct inventory: ${updateError.message}`);

      await supabase.from("inventory_deductions").insert({
        company_id: companyId,
        inventory_item_id: itemId,
        project_id: projectId,
        task_id: taskId,
        line_item_id: lineItemUuid,
        quantity_deducted: deductQty,
        previous_quantity: currentQty,
        new_quantity: newQty,
        reason: "task_completion",
        deducted_by: userId,
      });

      const threshold = item.warning_threshold != null ? Number(item.warning_threshold) : null;
      if (threshold != null && newQty <= threshold) {
        await supabase
          .rpc("create_notification_if_new", {
            p_user_id: userId ?? companyId,
            p_company_id: companyId,
            p_type: "system",
            p_title: `Low stock: ${item.name}`,
            p_body: `${item.name} is low (${newQty} remaining, threshold: ${threshold})`,
            p_persistent: false,
          })
          .then(() => undefined, () => undefined);
      }
    }

    await supabase
      .from("project_tasks")
      .update({ inventory_deducted: true })
      .eq("id", taskId);
  },

  /**
   * Reverse inventory deductions for a task that was reopened.
   * Reads existing deduction records, adds quantities back,
   * writes reversal audit rows, sets inventory_deducted=false.
   */
  async reverseForTask(taskId: string, userId: string | null): Promise<void> {
    const supabase = requireSupabase();

    const { data: task, error: taskError } = await supabase
      .from("project_tasks")
      .select("id, company_id, inventory_deducted")
      .eq("id", taskId)
      .single();

    if (taskError || !task) return;
    if (!task.inventory_deducted) return;

    const { data: deductions, error: dedError } = await supabase
      .from("inventory_deductions")
      .select("*")
      .eq("task_id", taskId)
      .eq("reason", "task_completion");

    if (dedError) throw new Error(`Failed to fetch deductions for reversal: ${dedError.message}`);
    if (!deductions || deductions.length === 0) {
      await supabase
        .from("project_tasks")
        .update({ inventory_deducted: false })
        .eq("id", taskId);
      return;
    }

    for (const ded of deductions) {
      const itemId = ded.inventory_item_id as string;
      if (!itemId) continue;
      const restoreQty = Number(ded.quantity_deducted);

      const { data: item } = await supabase
        .from("inventory_items")
        .select("quantity")
        .eq("id", itemId)
        .single();

      if (!item) continue;

      const currentQty = Number(item.quantity);
      const newQty = currentQty + restoreQty;

      await supabase
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", itemId);

      await supabase.from("inventory_deductions").insert({
        company_id: ded.company_id as string,
        inventory_item_id: itemId,
        project_id: (ded.project_id as string) ?? null,
        task_id: taskId,
        line_item_id: (ded.line_item_id as string) ?? null,
        quantity_deducted: restoreQty,
        previous_quantity: currentQty,
        new_quantity: newQty,
        reason: "task_reopened",
        deducted_by: userId,
        notes: "Reversed: task reopened",
      });
    }

    await supabase
      .from("project_tasks")
      .update({ inventory_deducted: false })
      .eq("id", taskId);
  },

  /** Fetch deduction history for a project (reconciliation view) */
  async fetchByProject(projectId: string): Promise<InventoryDeduction[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("inventory_deductions")
      .select("*")
      .eq("project_id", projectId)
      .order("deducted_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch deductions: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /** Fetch deduction history for a task */
  async fetchByTask(taskId: string): Promise<InventoryDeduction[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("inventory_deductions")
      .select("*")
      .eq("task_id", taskId)
      .order("deducted_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch deductions: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },
};
