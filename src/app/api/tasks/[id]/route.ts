import { after, NextRequest, NextResponse } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import { serializeTaskPatch } from "@/lib/api/services/task-service";
import { TaskMutationAutomationOutboxService } from "@/lib/api/services/task-mutation-automation-outbox-service";
import type { ProjectTask } from "@/lib/types/models";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  memberIds,
  optionalUuid,
  requireUuid,
  taskStatus,
} from "../_lib/task-mutation-validation";

const WRITABLE_FIELDS = [
  "status",
  "taskColor",
  "taskNotes",
  "taskTypeId",
  "customTitle",
  "teamMemberIds",
  "dependencyOverrides",
  "startDate",
  "endDate",
  "duration",
  "startTime",
  "endTime",
  "allDay",
  "recurrenceId",
  "recurrenceOriginDate",
  "displayOrder",
  "taskIndex",
] as const satisfies readonly (keyof ProjectTask)[];

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function dateValue(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid task date");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid task date");
  return parsed;
}

function revivePatch(value: unknown): Partial<ProjectTask> {
  if (!value || typeof value !== "object") throw new Error("Invalid task");
  const input = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      patch[field] = input[field];
    }
  }
  if (input.status !== undefined) patch.status = taskStatus(input.status);
  if (input.teamMemberIds !== undefined) {
    patch.teamMemberIds = memberIds(input.teamMemberIds);
  }
  if (input.taskTypeId !== undefined) {
    patch.taskTypeId = requireUuid(input.taskTypeId, "task type");
  }
  if (input.recurrenceId !== undefined) {
    patch.recurrenceId = optionalUuid(input.recurrenceId, "task recurrence");
  }
  patch.startDate = dateValue(input.startDate);
  patch.endDate = dateValue(input.endDate);
  if (patch.startDate === undefined) delete patch.startDate;
  if (patch.endDate === undefined) delete patch.endDate;
  if (Object.keys(patch).length === 0) throw new Error("No task changes");
  return patch as Partial<ProjectTask>;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  let patch: Partial<ProjectTask>;
  try {
    const body = (await request.json()) as { data?: unknown };
    patch = revivePatch(body.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }

  let taskId: string;
  try {
    taskId = requireUuid((await params).id, "task id");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid task id" },
      { status: 400 }
    );
  }

  const actorDb = getAccessTokenClient(token);
  const serviceDb = getServiceRoleClient();
  try {
    const { data: current, error: currentError } = await actorDb
      .from("project_tasks")
      .select("id, updated_at")
      .eq("id", taskId)
      .eq("company_id", auth.companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (currentError || !current) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: updated, error: updateError } = await actorDb.rpc(
      "update_task_with_event",
      {
        p_task_id: taskId,
        p_expected_updated_at: current.updated_at,
        p_patch: serializeTaskPatch(patch),
      }
    );
    if (updateError) {
      const status =
        updateError.code === "22023"
          ? 400
          : updateError.code === "55000"
            ? 409
            : 403;
      return NextResponse.json(
        {
          error:
            status === 400
              ? "Invalid task"
              : status === 409
                ? "Reopen the project before reactivating this task"
                : "Forbidden",
        },
        { status }
      );
    }
    const result = updated as Record<string, unknown> | null;
    if (result?.conflict === true) {
      return NextResponse.json(
        { error: "Task changed before this update completed" },
        { status: 409 }
      );
    }
    if (
      !result ||
      result.conflict !== false ||
      typeof result.changed !== "boolean"
    ) {
      throw new Error("Task update returned an invalid result");
    }

    if (result.schedule_changed === true) {
      try {
        after(async () => {
          try {
            await TaskMutationAutomationOutboxService.processBatch(serviceDb, {
              limit: 10,
              leaseSeconds: 180,
            });
          } catch (error) {
            console.error("[task-update] Eager outbox drain failed", error);
          }
        });
      } catch (error) {
        console.error("[task-update] Follow-up registration failed", error);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[task-update] Mutation failed", error);
    return NextResponse.json(
      { error: "Unable to update task" },
      { status: 403 }
    );
  }
}
