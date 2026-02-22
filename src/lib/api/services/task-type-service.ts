/**
 * OPS Web - TaskType Service (Supabase)
 *
 * Complete CRUD operations for TaskTypes stored in Supabase `task_types_v2` table.
 * Supabase-backed task type CRUD operations.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { TaskType } from "../../types/models";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): TaskType {
  return {
    id: row.id as string,
    display: row.display as string,
    color: row.color as string,
    icon: (row.icon as string) ?? null,
    isDefault: (row.is_default as boolean) ?? false,
    companyId: row.company_id as string,
    displayOrder: (row.display_order as number) ?? 0,
    defaultTeamMemberIds: (row.default_team_member_ids as string[]) ?? [],
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapToDb(data: Partial<TaskType>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.display !== undefined) row.display = data.display;
  if (data.color !== undefined) row.color = data.color;
  if (data.icon !== undefined) row.icon = data.icon;
  if (data.isDefault !== undefined) row.is_default = data.isDefault;
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.displayOrder !== undefined) row.display_order = data.displayOrder;
  if (data.defaultTeamMemberIds !== undefined)
    row.default_team_member_ids = data.defaultTeamMemberIds;
  return row;
}

// ─── TaskType Service ─────────────────────────────────────────────────────────

export const TaskTypeService = {
  /**
   * Fetch all task types for a company.
   */
  async fetchTaskTypes(companyId: string): Promise<TaskType[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_types_v2")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("display_order");

    if (error) throw new Error(`Failed to fetch task types: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /**
   * Fetch a single task type by ID.
   */
  async fetchTaskType(id: string): Promise<TaskType> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_types_v2")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch task type: ${error.message}`);
    return mapFromDb(data);
  },

  /**
   * Create a new task type.
   */
  async createTaskType(
    data: Partial<TaskType> & { display: string; color: string }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: created, error } = await supabase
      .from("task_types_v2")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create task type: ${error.message}`);
    return created.id as string;
  },

  /**
   * Update an existing task type.
   */
  async updateTaskType(id: string, data: Partial<TaskType>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { error } = await supabase
      .from("task_types_v2")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update task type: ${error.message}`);
  },

  /**
   * Soft delete a task type.
   */
  async deleteTaskType(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("task_types_v2")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete task type: ${error.message}`);
  },

  /**
   * Create default task types for a new company.
   * Returns array of created IDs.
   */
  async createDefaultTaskTypes(companyId: string): Promise<string[]> {
    const supabase = requireSupabase();

    const rows = [
      { company_id: companyId, display: "Quote", color: "#B5A381", is_default: true, display_order: 0 },
      { company_id: companyId, display: "Installation", color: "#8195B5", is_default: true, display_order: 1 },
      { company_id: companyId, display: "Repair", color: "#B58289", is_default: true, display_order: 2 },
      { company_id: companyId, display: "Inspection", color: "#9DB582", is_default: true, display_order: 3 },
      { company_id: companyId, display: "Consultation", color: "#A182B5", is_default: true, display_order: 4 },
      { company_id: companyId, display: "Follow-up", color: "#C4A868", is_default: true, display_order: 5 },
    ];

    const { data, error } = await supabase
      .from("task_types_v2")
      .insert(rows)
      .select("id");

    if (error) throw new Error(`Failed to create default task types: ${error.message}`);
    return (data ?? []).map((r) => r.id as string);
  },
};

export default TaskTypeService;
