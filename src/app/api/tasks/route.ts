import { after, NextRequest, NextResponse } from "next/server";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  serializeTaskPatch,
  type CreateTaskWithEventData,
} from "@/lib/api/services/task-service";
import { TaskMutationAutomationOutboxService } from "@/lib/api/services/task-mutation-automation-outbox-service";
import type { ProjectTask } from "@/lib/types/models";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  memberIds,
  optionalUuid,
  requireUuid,
  taskStatus,
  TaskMutationValidationError,
  validateRecurrenceOrigin,
} from "./_lib/task-mutation-validation";

const CREATE_TASK_FIELDS = [
  "id",
  "projectId",
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

function sameMemberSet(left: string[], right: string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function reviveTask(
  value: Record<string, unknown>,
  companyId: string
): CreateTaskWithEventData["task"] {
  const id = requireUuid(value.id, "task id");
  const projectId = requireUuid(value.projectId, "task project");
  const taskTypeId = requireUuid(value.taskTypeId, "task type");
  const task: Record<string, unknown> = {};
  for (const field of CREATE_TASK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      task[field] = value[field];
    }
  }
  task.id = id;
  task.projectId = projectId;
  task.companyId = companyId;
  task.taskTypeId = taskTypeId;
  if (value.status !== undefined) task.status = taskStatus(value.status);
  if (value.teamMemberIds !== undefined) {
    task.teamMemberIds = memberIds(value.teamMemberIds);
  }
  if (value.recurrenceId !== undefined) {
    task.recurrenceId = optionalUuid(value.recurrenceId, "task recurrence");
  }
  const startDate = dateValue(value.startDate);
  const endDate = dateValue(value.endDate);
  if (startDate !== undefined) task.startDate = startDate;
  if (endDate !== undefined) task.endDate = endDate;
  validateRecurrenceOrigin(
    task.recurrenceId as ProjectTask["recurrenceId"],
    task.recurrenceOriginDate as ProjectTask["recurrenceOriginDate"]
  );
  return task as CreateTaskWithEventData["task"];
}

function reviveCreateBody(value: unknown, companyId: string) {
  if (!value || typeof value !== "object") throw new Error("Invalid request");
  const body = value as { task?: unknown; schedule?: unknown };
  if (!body.task || typeof body.task !== "object") {
    throw new Error("Invalid task");
  }

  const task = reviveTask(body.task as Record<string, unknown>, companyId);
  if (body.schedule === undefined) return { task };
  if (!body.schedule || typeof body.schedule !== "object") {
    throw new Error("Invalid task schedule");
  }
  const schedule = body.schedule as Record<string, unknown>;
  const startDate = dateValue(schedule.startDate);
  if (!(startDate instanceof Date) || typeof schedule.title !== "string") {
    throw new Error("Invalid task schedule");
  }
  const endDate = dateValue(schedule.endDate);
  const scheduleTeamMemberIds =
    schedule.teamMemberIds === undefined
      ? undefined
      : memberIds(schedule.teamMemberIds);
  if (
    task.teamMemberIds !== undefined &&
    scheduleTeamMemberIds !== undefined &&
    !sameMemberSet(task.teamMemberIds, scheduleTeamMemberIds)
  ) {
    throw new TaskMutationValidationError("Task and schedule teams must match");
  }

  return {
    task,
    schedule: {
      ...(schedule as unknown as CreateTaskWithEventData["schedule"]),
      title: schedule.title,
      startDate,
      ...(endDate instanceof Date ? { endDate } : {}),
      ...(scheduleTeamMemberIds
        ? { teamMemberIds: scheduleTeamMemberIds }
        : {}),
    },
  } satisfies CreateTaskWithEventData;
}

export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  let input: CreateTaskWithEventData;
  try {
    input = reviveCreateBody(await request.json(), auth.companyId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }

  const actorDb = getAccessTokenClient(token);
  const needsSchedulingFollowUp = !!(
    input.schedule?.startDate || input.task.startDate
  );
  const serviceDb = needsSchedulingFollowUp ? getServiceRoleClient() : null;
  try {
    const taskData: Partial<ProjectTask> = { ...input.task };
    if (input.schedule) {
      taskData.startDate = input.schedule.startDate;
      taskData.endDate = input.schedule.endDate ?? null;
      taskData.duration = input.schedule.duration ?? 1;
      if (input.schedule.teamMemberIds?.length) {
        taskData.teamMemberIds = input.schedule.teamMemberIds;
      }
      if (input.schedule.color) taskData.taskColor = input.schedule.color;
    }
    const payload = serializeTaskPatch(taskData);
    delete payload.id;
    delete payload.company_id;
    delete payload.project_id;
    delete payload.task_type_id;
    const { data, error } = await actorDb.rpc("create_task_with_event", {
      p_task_id: input.task.id!,
      p_project_id: input.task.projectId,
      p_task_type_id: input.task.taskTypeId,
      p_payload: payload,
    });
    if (error) {
      const status =
        error.code === "22023"
          ? 400
          : error.code === "23505" || error.code === "55000"
            ? 409
            : 403;
      return NextResponse.json(
        {
          error:
            status === 400
              ? "Invalid task"
              : error.code === "55000"
                ? "Reopen the project before adding active tasks"
                : status === 409
                  ? "Task already exists"
                  : "Forbidden",
        },
        { status }
      );
    }
    const rpcResult = data as Record<string, unknown> | null;
    if (
      !rpcResult ||
      typeof rpcResult.task_id !== "string" ||
      typeof rpcResult.created !== "boolean"
    ) {
      throw new Error("Task creation returned an invalid result");
    }
    const result = {
      taskId: rpcResult.task_id,
      created: rpcResult.created,
    };

    if (serviceDb) {
      try {
        after(async () => {
          try {
            await TaskMutationAutomationOutboxService.processBatch(serviceDb, {
              limit: 10,
              leaseSeconds: 180,
            });
          } catch (error) {
            console.error("[task-create] Eager outbox drain failed", error);
          }
        });
      } catch (error) {
        console.error("[task-create] Scheduling registration failed", error);
      }
    }

    return NextResponse.json(result, {
      status: result.created === false ? 200 : 201,
    });
  } catch (error) {
    console.error("[task-create] Mutation failed", error);
    return NextResponse.json(
      { error: "Unable to create task" },
      { status: 403 }
    );
  }
}
