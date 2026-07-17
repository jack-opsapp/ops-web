import "server-only";

import { createHash } from "node:crypto";

import { requireSupabase } from "@/lib/supabase/helpers";

export type ApprovedTaskMutation = {
  actorUserId: string;
  taskId: string;
  projectId: string;
  taskTypeId: string;
  customTitle: string;
  taskNotes?: string | null;
  taskColor?: string | null;
  teamMemberIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  duration?: number | null;
};

export type ApprovedTaskPatch = {
  actorUserId: string;
  taskId: string;
  patch: Record<string, unknown>;
};

export function deterministicApprovalTaskId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export const TaskApprovalMutationService = {
  async createTask(
    input: ApprovedTaskMutation
  ): Promise<{ taskId: string; created: boolean }> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.rpc(
      "create_task_with_event_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_task_id: input.taskId,
        p_project_id: input.projectId,
        p_task_type_id: input.taskTypeId,
        p_custom_title: input.customTitle,
        p_task_notes: input.taskNotes ?? null,
        p_task_color: input.taskColor ?? null,
        p_team_member_ids: input.teamMemberIds ?? [],
        p_start_date: input.startDate ?? null,
        p_end_date: input.endDate ?? null,
        p_duration: input.duration ?? 1,
      }
    );
    if (error) {
      throw new Error(`Failed to create approved task: ${error.message}`);
    }
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as Record<string, unknown>).task_id !== "string" ||
      typeof (data as Record<string, unknown>).created !== "boolean"
    ) {
      throw new Error("Approved task creation returned an invalid result");
    }
    return {
      taskId: (data as Record<string, unknown>).task_id as string,
      created: (data as Record<string, unknown>).created as boolean,
    };
  },

  async updateTask(input: ApprovedTaskPatch): Promise<{
    changed: boolean;
    scheduleChanged: boolean;
    scheduleVersion: number;
  }> {
    const supabase = requireSupabase();
    const { data: current, error: currentError } = await supabase
      .from("project_tasks")
      .select("updated_at")
      .eq("id", input.taskId)
      .is("deleted_at", null)
      .maybeSingle();
    if (currentError || !current) {
      throw new Error("Approved task is no longer available");
    }

    const { data, error } = await supabase.rpc(
      "update_task_with_event_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_task_id: input.taskId,
        p_expected_updated_at: current.updated_at,
        p_patch: input.patch,
      }
    );
    if (error) {
      throw new Error(`Failed to update approved task: ${error.message}`);
    }
    const result = data as Record<string, unknown> | null;
    if (
      !result ||
      result.ok !== true ||
      result.conflict !== false ||
      typeof result.changed !== "boolean" ||
      typeof result.schedule_changed !== "boolean" ||
      typeof result.schedule_version !== "number"
    ) {
      if (result?.conflict === true) {
        throw new Error("Approved task changed before execution");
      }
      throw new Error("Approved task update returned an invalid result");
    }
    return {
      changed: result.changed,
      scheduleChanged: result.schedule_changed,
      scheduleVersion: result.schedule_version,
    };
  },
};
