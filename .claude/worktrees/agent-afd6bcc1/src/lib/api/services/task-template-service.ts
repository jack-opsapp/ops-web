/**
 * OPS Web - Task Template Service
 *
 * CRUD operations for TaskTemplates using Supabase.
 * TaskTemplates define the sub-tasks automatically proposed when an estimate
 * is approved, based on LABOR line items and their linked TaskType.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  TaskTemplate,
  CreateTaskTemplate,
  UpdateTaskTemplate,
} from "@/lib/types/pipeline";
import type { Estimate } from "@/lib/types/pipeline";
import { EstimateService } from "./estimate-service";

// ─── Database ↔ TypeScript Mapping ────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): TaskTemplate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    taskTypeId: row.task_type_id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    estimatedHours: row.estimated_hours != null ? Number(row.estimated_hours) : null,
    displayOrder: Number(row.display_order ?? 0),
    defaultTeamMemberIds: (row.default_team_member_ids as string[]) ?? [],
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── ProposedTask — returned by getProposedTasks ───────────────────────────────

export interface ProposedTask {
  lineItemId: string;
  lineItemName: string;
  template: TaskTemplate;
  taskTypeId: string;
  defaultTeamMemberIds: string[];
  selected: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const TaskTemplateService = {
  async fetchTaskTemplates(
    companyId: string,
    taskTypeId?: string
  ): Promise<TaskTemplate[]> {
    const supabase = requireSupabase();

    let query = supabase
      .from("task_templates")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("display_order");

    if (taskTypeId) {
      query = query.eq("task_type_id", taskTypeId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch task templates: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  async fetchTaskTemplate(id: string): Promise<TaskTemplate> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("task_templates")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch task template: ${error.message}`);
    return mapFromDb(data);
  },

  async createTaskTemplate(data: CreateTaskTemplate): Promise<TaskTemplate> {
    const supabase = requireSupabase();

    const { data: created, error } = await supabase
      .from("task_templates")
      .insert({
        company_id: data.companyId,
        task_type_id: data.taskTypeId,
        title: data.title,
        description: data.description,
        estimated_hours: data.estimatedHours,
        display_order: data.displayOrder,
        default_team_member_ids: data.defaultTeamMemberIds,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create task template: ${error.message}`);
    return mapFromDb(created);
  },

  async updateTaskTemplate(id: string, data: UpdateTaskTemplate): Promise<TaskTemplate> {
    const supabase = requireSupabase();

    const row: Record<string, unknown> = {};
    if (data.title !== undefined) row.title = data.title;
    if (data.description !== undefined) row.description = data.description;
    if (data.estimatedHours !== undefined) row.estimated_hours = data.estimatedHours;
    if (data.displayOrder !== undefined) row.display_order = data.displayOrder;
    if (data.defaultTeamMemberIds !== undefined) row.default_team_member_ids = data.defaultTeamMemberIds;
    if (data.taskTypeId !== undefined) row.task_type_id = data.taskTypeId;

    const { data: updated, error } = await supabase
      .from("task_templates")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update task template: ${error.message}`);
    return mapFromDb(updated);
  },

  async deleteTaskTemplate(id: string): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("task_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to delete task template: ${error.message}`);
  },

  /**
   * Core task-generation logic: for each LABOR line item in an estimate,
   * load the task templates for that TaskType and build ProposedTask[] with
   * pre-filled crew assignments.
   */
  async getProposedTasks(
    estimateId: string,
    companyId: string
  ): Promise<ProposedTask[]> {
    // Load estimate with line items
    const estimate: Estimate = await EstimateService.fetchEstimate(estimateId);
    const lineItems = estimate.lineItems ?? [];

    // Only LABOR items get tasks
    const laborItems = lineItems.filter((li) => li.type === "LABOR" && li.taskTypeId);

    if (laborItems.length === 0) return [];

    // Load all templates for the company
    const allTemplates = await TaskTemplateService.fetchTaskTemplates(companyId);

    const proposed: ProposedTask[] = [];

    for (const item of laborItems) {
      const templates = allTemplates.filter(
        (t) => t.taskTypeId === item.taskTypeId
      );

      for (const template of templates) {
        proposed.push({
          lineItemId: item.id,
          lineItemName: item.name,
          template,
          taskTypeId: item.taskTypeId!,
          defaultTeamMemberIds: template.defaultTeamMemberIds,
          selected: true,
        });
      }
    }

    return proposed;
  },
};
