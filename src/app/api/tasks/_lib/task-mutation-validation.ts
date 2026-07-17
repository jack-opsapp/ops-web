import type { SupabaseClient } from "@supabase/supabase-js";

import { TaskStatus, type ProjectTask } from "@/lib/types/models";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TASK_STATUSES = new Set<string>(Object.values(TaskStatus));

export class TaskMutationValidationError extends Error {}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TaskMutationValidationError(`Invalid ${label}`);
  }
  return value;
}

export function optionalUuid(
  value: unknown,
  label: string
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireUuid(value, label);
}

export function taskStatus(value: unknown): TaskStatus {
  if (typeof value !== "string" || !TASK_STATUSES.has(value)) {
    throw new TaskMutationValidationError("Invalid task status");
  }
  return value as TaskStatus;
}

export function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TaskMutationValidationError("Invalid task team");
  }
  const ids = value.map((id) => requireUuid(id, "task team member"));
  if (new Set(ids).size !== ids.length) {
    throw new TaskMutationValidationError("Invalid task team");
  }
  return ids;
}

type RelationshipInput = {
  db: SupabaseClient;
  companyId: string;
  projectId: string;
  taskTypeId?: string;
  recurrenceId?: string | null;
  teamMemberIds?: string[];
};

/**
 * Foreign keys alone do not enforce OPS tenant or lifecycle boundaries. Check
 * every mutable relationship explicitly before the task write.
 */
export async function validateTaskRelationships({
  db,
  companyId,
  projectId,
  taskTypeId,
  recurrenceId,
  teamMemberIds,
}: RelationshipInput): Promise<void> {
  if (taskTypeId) {
    const { data, error } = await db
      .from("task_types")
      .select("id")
      .eq("id", taskTypeId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) {
      throw new TaskMutationValidationError("Invalid task type");
    }
  }

  if (recurrenceId) {
    const { data, error } = await db
      .from("task_recurrences")
      .select("id")
      .eq("id", recurrenceId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) {
      throw new TaskMutationValidationError("Invalid task recurrence");
    }
  }

  if (teamMemberIds && teamMemberIds.length > 0) {
    const { data, error } = await db
      .from("users")
      .select("id")
      .in("id", teamMemberIds)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("deleted_at", null);
    const found = new Set(
      (data ?? []).map((row: { id: string }) => row.id).filter(Boolean)
    );
    if (
      error ||
      found.size !== teamMemberIds.length ||
      teamMemberIds.some((id) => !found.has(id))
    ) {
      throw new TaskMutationValidationError("Invalid task team");
    }
  }
}

export type TaskScheduleSnapshot = {
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  duration: number;
  teamMemberIds: string[];
};

export function scheduleSnapshot(
  row: Record<string, unknown>
): TaskScheduleSnapshot {
  return {
    startDate: typeof row.start_date === "string" ? row.start_date : null,
    endDate: typeof row.end_date === "string" ? row.end_date : null,
    startTime: typeof row.start_time === "string" ? row.start_time : null,
    endTime: typeof row.end_time === "string" ? row.end_time : null,
    allDay: row.all_day !== false,
    duration:
      typeof row.duration === "number" && Number.isFinite(row.duration)
        ? row.duration
        : 1,
    teamMemberIds: Array.isArray(row.team_member_ids)
      ? row.team_member_ids.filter(
          (value): value is string => typeof value === "string"
        )
      : [],
  };
}

export function validateRecurrenceOrigin(
  recurrenceId: ProjectTask["recurrenceId"],
  recurrenceOriginDate: ProjectTask["recurrenceOriginDate"] | undefined
): void {
  if (recurrenceOriginDate != null && !recurrenceId) {
    throw new TaskMutationValidationError(
      "A recurrence date requires a task recurrence"
    );
  }
}
