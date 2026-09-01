import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CrewNotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import type { NotificationRouteActor } from "@/lib/notifications/server-notification-service";

export interface ResolvedCrewNotificationPush {
  companyId: string;
  recipientUserIds: string[];
  preferenceKey:
    "task_completed" | "task_assigned" | "schedule_changes" | "project_updates";
  title: string;
  body: string;
  pushData: Record<string, string>;
}

export type CrewNotificationResolution =
  | { ok: true; notified: number; events: ResolvedCrewNotificationPush[] }
  | { ok: false; status: 403 | 404 | 409; reason: string };

interface TaskRow {
  id: string;
  company_id: string;
  project_id: string;
  custom_title: string | null;
  task_type_id: string | null;
  deleted_at: string | null;
}

interface ProjectRow {
  id: string;
  company_id: string;
  title: string;
  deleted_at: string | null;
  team_member_ids?: string[] | null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string")
        ),
      ]
    : [];
}

async function rpc(
  actorDb: SupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const response = await actorDb.rpc(name, args);
  if (response.error) {
    throw new Error(
      `Crew notification proof failed: ${response.error.message}`
    );
  }
  return response.data;
}

async function loadTaskContext(
  db: SupabaseClient,
  actor: NotificationRouteActor,
  taskId: string
): Promise<{ task: TaskRow; taskTitle: string; project: ProjectRow } | null> {
  const taskResponse = await db
    .from("project_tasks")
    .select(
      "id, company_id, project_id, custom_title, task_type_id, deleted_at"
    )
    .eq("id", taskId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (taskResponse.error) {
    throw new Error(
      `Crew notification task read failed: ${taskResponse.error.message}`
    );
  }
  if (!taskResponse.data || taskResponse.data.deleted_at) return null;
  const task = taskResponse.data as TaskRow;
  const [projectResponse, typeResponse] = await Promise.all([
    db
      .from("projects")
      .select("id, company_id, title, deleted_at")
      .eq("id", task.project_id)
      .eq("company_id", actor.companyId)
      .maybeSingle(),
    task.task_type_id
      ? db
          .from("task_types")
          .select("display")
          .eq("id", task.task_type_id)
          .eq("company_id", actor.companyId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (projectResponse.error || typeResponse.error) {
    throw new Error(
      `Crew notification context read failed: ${projectResponse.error?.message ?? typeResponse.error?.message}`
    );
  }
  if (!projectResponse.data || projectResponse.data.deleted_at) return null;
  const project = projectResponse.data as ProjectRow;
  const taskTitle =
    task.custom_title?.trim() ||
    (typeof typeResponse.data?.display === "string"
      ? typeResponse.data.display.trim()
      : "") ||
    "Task";
  return { task, taskTitle, project };
}

function taskPush(input: {
  actor: NotificationRouteActor;
  recipientUserIds: string[];
  context: { task: TaskRow; taskTitle: string; project: ProjectRow };
  kind: "completed" | "rescheduled" | "assigned";
}): ResolvedCrewNotificationPush {
  const { actor, context, recipientUserIds, kind } = input;
  if (kind === "completed") {
    return {
      companyId: actor.companyId,
      recipientUserIds,
      preferenceKey: "task_completed",
      title: "Task Completed",
      body: `${actor.name} completed “${context.taskTitle}” on ${context.project.title}`,
      pushData: {
        type: "taskCompletion",
        taskId: context.task.id,
        projectId: context.project.id,
        screen: "taskDetails",
      },
    };
  }
  if (kind === "assigned") {
    return {
      companyId: actor.companyId,
      recipientUserIds,
      preferenceKey: "task_assigned",
      title: "New Task Assignment",
      body: `You’ve been assigned to “${context.taskTitle}” on ${context.project.title}`,
      pushData: {
        type: "taskAssignment",
        taskId: context.task.id,
        projectId: context.project.id,
        screen: "taskDetails",
      },
    };
  }
  return {
    companyId: actor.companyId,
    recipientUserIds,
    preferenceKey: "schedule_changes",
    title: "Schedule Update",
    body: `“${context.taskTitle}” on ${context.project.title} has been rescheduled`,
    pushData: {
      type: "scheduleChange",
      taskId: context.task.id,
      projectId: context.project.id,
      screen: "taskDetails",
    },
  };
}

export async function resolveCrewNotificationEvent(params: {
  db: SupabaseClient;
  actorDb: SupabaseClient;
  actor: NotificationRouteActor;
  request: CrewNotificationDispatchRequest;
}): Promise<CrewNotificationResolution> {
  const { db, actorDb, actor, request } = params;

  if (
    request.eventType === "project_completed" ||
    request.eventType === "project_assigned"
  ) {
    const projectResponse = await db
      .from("projects")
      .select("id, company_id, title, deleted_at, team_member_ids")
      .eq("id", request.projectId)
      .eq("company_id", actor.companyId)
      .maybeSingle();
    if (projectResponse.error) {
      throw new Error(
        `Crew project read failed: ${projectResponse.error.message}`
      );
    }
    if (!projectResponse.data || projectResponse.data.deleted_at) {
      return { ok: false, status: 404, reason: "Project not found" };
    }
    const project = projectResponse.data as ProjectRow;
    const recipientUserIds = stringArray(
      await rpc(
        actorDb,
        request.eventType === "project_completed"
          ? "notify_project_completed"
          : "notify_project_assigned",
        {
          p_project_id: request.projectId,
          ...(request.eventType === "project_assigned"
            ? { p_user_ids: stringArray(project.team_member_ids) }
            : {}),
        }
      )
    );
    if (recipientUserIds.length === 0) {
      return { ok: true, notified: 0, events: [] };
    }
    const assigned = request.eventType === "project_assigned";
    return {
      ok: true,
      notified: recipientUserIds.length,
      events: [
        {
          companyId: actor.companyId,
          recipientUserIds,
          preferenceKey: assigned ? "task_assigned" : "project_updates",
          title: assigned ? "New Project Assignment" : "Project Completed",
          body: assigned
            ? `You’ve been assigned to “${project.title}”`
            : `“${project.title}” has been marked as completed`,
          pushData: {
            type: assigned ? "projectAssignment" : "projectCompletion",
            projectId: request.projectId,
            screen: "projectDetails",
          },
        },
      ],
    };
  }

  if (request.eventType === "dependency_ready") {
    const data = await rpc(actorDb, "notify_dependency_ready", {
      p_completed_task_id: request.completedTaskId,
    });
    const rows = Array.isArray(data)
      ? data.filter(
          (value): value is Record<string, unknown> =>
            Boolean(value) && typeof value === "object" && !Array.isArray(value)
        )
      : [];
    if (rows.length === 0) return { ok: true, notified: 0, events: [] };
    const completed = await loadTaskContext(db, actor, request.completedTaskId);
    if (!completed) {
      return { ok: false, status: 404, reason: "Completed task not found" };
    }
    const events: ResolvedCrewNotificationPush[] = [];
    for (const row of rows) {
      const taskId = typeof row.task_id === "string" ? row.task_id : "";
      const recipientUserIds = stringArray(row.user_ids);
      if (!taskId || recipientUserIds.length === 0) continue;
      const dependent = await loadTaskContext(db, actor, taskId);
      if (!dependent) continue;
      events.push({
        companyId: actor.companyId,
        recipientUserIds,
        preferenceKey: "task_completed",
        title: "Ready to start",
        body: `${dependent.taskTitle} on ${dependent.project.title} — ${completed.taskTitle} is complete`,
        pushData: {
          type: "dependencyCompleted",
          completedTaskId: request.completedTaskId,
          taskId,
          projectId: dependent.project.id,
          screen: "taskDetails",
        },
      });
    }
    return {
      ok: true,
      notified: events.reduce(
        (total, event) => total + event.recipientUserIds.length,
        0
      ),
      events,
    };
  }

  if (request.eventType === "schedule_run_summary") {
    const data = await rpc(actorDb, "notify_schedule_run_summary", {
      p_task_ids: request.taskIds,
    });
    const events: ResolvedCrewNotificationPush[] = Array.isArray(data)
      ? data.flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return [];
          const row = value as Record<string, unknown>;
          const userId = typeof row.user_id === "string" ? row.user_id : "";
          const movedCount = Number(row.moved_count);
          if (!userId || !Number.isSafeInteger(movedCount) || movedCount < 1)
            return [];
          return [
            {
              companyId: actor.companyId,
              recipientUserIds: [userId],
              preferenceKey: "schedule_changes" as const,
              title: "Schedule updated",
              body: `${movedCount} ${movedCount === 1 ? "task was" : "tasks were"} moved`,
              pushData: {
                type: "scheduleBatchUpdate",
                screen: "calendar",
              },
            },
          ];
        })
      : [];
    return { ok: true, notified: events.length, events };
  }

  if (!("taskId" in request)) {
    return { ok: false, status: 409, reason: "Unsupported crew event proof" };
  }

  const rpcName =
    request.eventType === "task_completed"
      ? "notify_task_completed"
      : request.eventType === "task_assigned"
        ? "notify_task_assigned"
        : "notify_task_rescheduled";
  const recipientUserIds = stringArray(
    await rpc(actorDb, rpcName, {
      p_task_id: request.taskId,
      ...(request.eventType === "task_assigned" ? { p_user_ids: null } : {}),
    })
  );
  if (recipientUserIds.length === 0) {
    return { ok: true, notified: 0, events: [] };
  }
  const context = await loadTaskContext(db, actor, request.taskId);
  if (!context) return { ok: false, status: 404, reason: "Task not found" };
  return {
    ok: true,
    notified: recipientUserIds.length,
    events: [
      taskPush({
        actor,
        recipientUserIds,
        context,
        kind:
          request.eventType === "task_completed"
            ? "completed"
            : request.eventType === "task_assigned"
              ? "assigned"
              : "rescheduled",
      }),
    ],
  };
}
