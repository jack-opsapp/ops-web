/**
 * OPS Web - Recurrence Service (Phase 3)
 *
 * CRUD for task_recurrences and task_recurrence_exceptions.
 * Materialization is owned by /api/cron/recurrence-generate; this service
 * is the read/write boundary for the UI.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type {
  TaskRecurrence,
  TaskRecurrenceException,
  TaskRecurrenceExceptionAction,
} from "../../types/models";

function mapRecurrenceFromDb(row: Record<string, unknown>): TaskRecurrence {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    projectId: (row.project_id as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    taskTypeId: (row.task_type_id as string) ?? null,
    title: row.title as string,
    teamMemberIds: (row.team_member_ids as string[]) ?? [],
    rrule: row.rrule as string,
    startAnchor: row.start_anchor as string,
    endAnchor: (row.end_anchor as string) ?? null,
    allDay: (row.all_day as boolean) ?? true,
    startTime: (row.start_time as string) ?? null,
    endTime: (row.end_time as string) ?? null,
    duration: (row.duration as number) ?? 1,
    notes: (row.notes as string) ?? null,
    nextGenerationAt: parseDate(row.next_generation_at),
    createdBy: (row.created_by as string) ?? null,
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapExceptionFromDb(row: Record<string, unknown>): TaskRecurrenceException {
  return {
    id: row.id as string,
    recurrenceId: row.recurrence_id as string,
    originalDate: row.original_date as string,
    action: row.action as TaskRecurrenceExceptionAction,
    newDate: (row.new_date as string) ?? null,
    newStartTime: (row.new_start_time as string) ?? null,
    newEndTime: (row.new_end_time as string) ?? null,
    newTeamMemberIds: (row.new_team_member_ids as string[]) ?? null,
    notes: (row.notes as string) ?? null,
    createdAt: parseDate(row.created_at),
  };
}

export type CreateRecurrenceInput = Omit<
  TaskRecurrence,
  "id" | "createdAt" | "updatedAt" | "deletedAt" | "nextGenerationAt"
>;

export type UpsertRecurrenceExceptionInput = Omit<
  TaskRecurrenceException,
  "id" | "createdAt"
>;

export const RecurrenceService = {
  // ── Templates ───────────────────────────────────────────────────────────

  async listForCompany(companyId: string): Promise<TaskRecurrence[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_recurrences")
      .select("*")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list recurrences: ${error.message}`);
    return (data ?? []).map(mapRecurrenceFromDb);
  },

  async getById(id: string): Promise<TaskRecurrence | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_recurrences")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch recurrence: ${error.message}`);
    return data ? mapRecurrenceFromDb(data) : null;
  },

  async create(input: CreateRecurrenceInput): Promise<TaskRecurrence> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_recurrences")
      .insert({
        company_id: input.companyId,
        project_id: input.projectId,
        client_id: input.clientId,
        task_type_id: input.taskTypeId,
        title: input.title,
        team_member_ids: input.teamMemberIds,
        rrule: input.rrule,
        start_anchor: input.startAnchor,
        end_anchor: input.endAnchor,
        all_day: input.allDay,
        start_time: input.startTime,
        end_time: input.endTime,
        duration: input.duration,
        notes: input.notes,
        created_by: input.createdBy,
        next_generation_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(`Failed to create recurrence: ${error.message}`);
    return mapRecurrenceFromDb(data);
  },

  async update(id: string, patch: Partial<TaskRecurrence>): Promise<TaskRecurrence> {
    const supabase = requireSupabase();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.teamMemberIds !== undefined) row.team_member_ids = patch.teamMemberIds;
    if (patch.rrule !== undefined) row.rrule = patch.rrule;
    if (patch.startAnchor !== undefined) row.start_anchor = patch.startAnchor;
    if (patch.endAnchor !== undefined) row.end_anchor = patch.endAnchor;
    if (patch.allDay !== undefined) row.all_day = patch.allDay;
    if (patch.startTime !== undefined) row.start_time = patch.startTime;
    if (patch.endTime !== undefined) row.end_time = patch.endTime;
    if (patch.duration !== undefined) row.duration = patch.duration;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.projectId !== undefined) row.project_id = patch.projectId;
    if (patch.clientId !== undefined) row.client_id = patch.clientId;
    if (patch.taskTypeId !== undefined) row.task_type_id = patch.taskTypeId;

    // Mutating any rule-affecting field forces re-generation from now.
    if (
      patch.rrule !== undefined ||
      patch.startAnchor !== undefined ||
      patch.endAnchor !== undefined ||
      patch.startTime !== undefined ||
      patch.endTime !== undefined ||
      patch.allDay !== undefined ||
      patch.duration !== undefined ||
      patch.teamMemberIds !== undefined ||
      patch.taskTypeId !== undefined
    ) {
      row.next_generation_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("task_recurrences")
      .update(row)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(`Failed to update recurrence: ${error.message}`);
    return mapRecurrenceFromDb(data);
  },

  /**
   * Soft-delete a recurrence template AND every un-started future occurrence
   * it generated. Past, in-progress, and completed occurrences are preserved
   * as historical records. See spec §4 (Risks and rollback).
   */
  async softDelete(id: string): Promise<void> {
    const supabase = requireSupabase();
    const now = new Date().toISOString();

    const { error: tplError } = await supabase
      .from("task_recurrences")
      .update({ deleted_at: now })
      .eq("id", id);
    if (tplError) throw new Error(`Failed to soft-delete recurrence: ${tplError.message}`);

    // Soft-delete generated tasks that are still active and start in the future.
    const { error: taskError } = await supabase
      .from("project_tasks")
      .update({ deleted_at: now })
      .eq("recurrence_id", id)
      .eq("status", "active")
      .gt("start_date", now)
      .is("deleted_at", null);
    if (taskError) {
      throw new Error(
        `Failed to soft-delete future generated tasks: ${taskError.message}`
      );
    }
  },

  // ── Exceptions ──────────────────────────────────────────────────────────

  async listExceptions(recurrenceId: string): Promise<TaskRecurrenceException[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_recurrence_exceptions")
      .select("*")
      .eq("recurrence_id", recurrenceId)
      .order("original_date", { ascending: true });
    if (error) throw new Error(`Failed to list exceptions: ${error.message}`);
    return (data ?? []).map(mapExceptionFromDb);
  },

  async upsertException(
    input: UpsertRecurrenceExceptionInput
  ): Promise<TaskRecurrenceException> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_recurrence_exceptions")
      .upsert(
        {
          recurrence_id: input.recurrenceId,
          original_date: input.originalDate,
          action: input.action,
          new_date: input.newDate,
          new_start_time: input.newStartTime,
          new_end_time: input.newEndTime,
          new_team_member_ids: input.newTeamMemberIds,
          notes: input.notes,
        },
        { onConflict: "recurrence_id,original_date" }
      )
      .select("*")
      .single();
    if (error) throw new Error(`Failed to upsert exception: ${error.message}`);
    return mapExceptionFromDb(data);
  },

  /**
   * Fetch the exception (if any) for a specific occurrence date.
   */
  async getExceptionForDate(
    recurrenceId: string,
    originalDate: string
  ): Promise<TaskRecurrenceException | null> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_recurrence_exceptions")
      .select("*")
      .eq("recurrence_id", recurrenceId)
      .eq("original_date", originalDate)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch exception: ${error.message}`);
    return data ? mapExceptionFromDb(data) : null;
  },
};

export default RecurrenceService;
