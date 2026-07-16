import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import type { NotificationRouteActor } from "@/lib/notifications/server-notification-service";
import {
  checkPermissionById,
  resolvePermissionScopeById,
} from "@/lib/supabase/check-permission";

export interface ResolvedNotificationEvent {
  eventType: NotificationDispatchRequest["eventType"];
  companyId: string;
  recipientUserIds: string[];
  preferenceKey: string;
  type: string;
  title: string;
  body: string;
  persistent: boolean;
  actionUrl: string;
  actionLabel: string;
  projectId?: string;
  noteId?: string;
  deepLinkType: string;
  dedupeKey: string;
  pushData: Record<string, string>;
}

export type NotificationEventResolution =
  | { ok: true; event: ResolvedNotificationEvent }
  | { ok: false; status: 403 | 404 | 409; reason: string };

interface ProjectRow {
  id: string;
  company_id: string;
  title: string;
  status: string;
  team_member_ids: string[] | null;
  opportunity_ref: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

interface TaskRow {
  id: string;
  company_id: string;
  project_id: string;
  custom_title: string | null;
  status: string;
  team_member_ids: string[] | null;
  updated_at: string | null;
}

const EVENT_FRESHNESS_MS = 15 * 60 * 1000;

function values(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isFresh(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && timestamp >= Date.now() - EVENT_FRESHNESS_MS
  );
}

function intersect(left: string[], right: string[]): string[] {
  const allowed = new Set(right);
  return [...new Set(left)].filter((id) => allowed.has(id));
}

async function loadProject(
  db: SupabaseClient,
  actor: NotificationRouteActor,
  projectId: string
): Promise<ProjectRow | null> {
  const { data, error } = await db
    .from("projects")
    .select(
      "id, company_id, title, status, team_member_ids, opportunity_ref, updated_at, deleted_at"
    )
    .eq("id", projectId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProjectRow;
}

async function canActOnProject(params: {
  db: SupabaseClient;
  actor: NotificationRouteActor;
  project: ProjectRow;
  permission: "projects.edit" | "projects.assign_team";
}): Promise<boolean> {
  const scope = await resolvePermissionScopeById(
    params.actor.userId,
    params.permission
  );
  if (scope === "all") return true;
  if (scope !== "assigned") return false;

  if (values(params.project.team_member_ids).includes(params.actor.userId)) {
    return true;
  }
  const { data, error } = await params.db
    .from("project_tasks")
    .select("id")
    .eq("project_id", params.project.id)
    .contains("team_member_ids", [params.actor.userId])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return !error && !!data;
}

async function loadRecentProjectEvent(params: {
  db: SupabaseClient;
  actor: NotificationRouteActor;
  projectId: string;
  eventKind: "status_change" | "project_archived";
}): Promise<Record<string, unknown> | null> {
  const cutoff = new Date(Date.now() - EVENT_FRESHNESS_MS).toISOString();
  const { data, error } = await params.db
    .from("project_notes")
    .select("id, content_metadata, created_at")
    .eq("project_id", params.projectId)
    .eq("company_id", params.actor.companyId)
    .eq("author_id", params.actor.userId)
    .eq("event_kind", params.eventKind)
    .is("deleted_at", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error || !data ? null : (data as Record<string, unknown>);
}

async function loadTask(
  db: SupabaseClient,
  actor: NotificationRouteActor,
  taskId: string
): Promise<{ task: TaskRow; project: ProjectRow } | null> {
  const { data, error } = await db
    .from("project_tasks")
    .select(
      "id, company_id, project_id, custom_title, status, team_member_ids, updated_at"
    )
    .eq("id", taskId)
    .eq("company_id", actor.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const task = data as TaskRow;
  const project = await loadProject(db, actor, task.project_id);
  if (!project || project.deleted_at) return null;
  return { task, project };
}

function projectActionUrl(projectId: string): string {
  return `/dashboard?openProject=${encodeURIComponent(projectId)}&mode=view`;
}

export async function resolveNotificationEvent(params: {
  db: SupabaseClient;
  actor: NotificationRouteActor;
  request: NotificationDispatchRequest;
}): Promise<NotificationEventResolution> {
  const { db, actor, request } = params;

  if (
    request.eventType === "project_assigned" ||
    request.eventType === "project_status_change" ||
    request.eventType === "project_archived" ||
    request.eventType === "lead_converted"
  ) {
    const project = await loadProject(db, actor, request.projectId);
    if (!project || project.deleted_at) {
      return { ok: false, status: 404, reason: "Project event not found" };
    }

    if (request.eventType === "project_assigned") {
      const allowed = await canActOnProject({
        db,
        actor,
        project,
        permission: "projects.assign_team",
      });
      if (!allowed) return { ok: false, status: 403, reason: "Forbidden" };
      if (!isFresh(project.updated_at)) {
        return { ok: false, status: 409, reason: "Stale assignment event" };
      }
      const recipients = intersect(
        request.candidateRecipientIds,
        values(project.team_member_ids)
      );
      return {
        ok: true,
        event: {
          eventType: request.eventType,
          companyId: actor.companyId,
          recipientUserIds: recipients,
          preferenceKey: "project_updates",
          type: "project_assigned",
          title: "Added to Project",
          body: `${actor.name} added you to ${project.title}.`,
          persistent: false,
          actionUrl: projectActionUrl(project.id),
          actionLabel: "View Project",
          projectId: project.id,
          deepLinkType: "project",
          dedupeKey: `project-assigned:${project.id}:${project.updated_at}`,
          pushData: {
            type: "projectAssignment",
            projectId: project.id,
            screen: "projectDetails",
          },
        },
      };
    }

    if (request.eventType === "project_status_change") {
      const allowed = await canActOnProject({
        db,
        actor,
        project,
        permission: "projects.edit",
      });
      const proof = allowed
        ? await loadRecentProjectEvent({
            db,
            actor,
            projectId: project.id,
            eventKind: "status_change",
          })
        : null;
      if (!allowed) return { ok: false, status: 403, reason: "Forbidden" };
      if (!proof)
        return { ok: false, status: 409, reason: "Missing status event" };
      const metadata =
        proof.content_metadata && typeof proof.content_metadata === "object"
          ? (proof.content_metadata as Record<string, unknown>)
          : {};
      const from =
        typeof metadata.from === "string" ? metadata.from : "Previous";
      const to = typeof metadata.to === "string" ? metadata.to : project.status;
      if (project.status !== to) {
        return {
          ok: false,
          status: 409,
          reason: "Status event no longer current",
        };
      }
      return {
        ok: true,
        event: {
          eventType: request.eventType,
          companyId: actor.companyId,
          recipientUserIds: values(project.team_member_ids),
          preferenceKey: "project_updates",
          type: "project_status_change",
          title: `Status changed: ${from} → ${to}`,
          body: `${actor.name} moved ${project.title} from ${from} to ${to}.`,
          persistent: false,
          actionUrl: projectActionUrl(project.id),
          actionLabel: "View Project",
          projectId: project.id,
          deepLinkType: "project",
          dedupeKey: `project-status:${String(proof.id)}`,
          pushData: {
            type: "projectStatusChange",
            projectId: project.id,
            screen: "projectDetails",
          },
        },
      };
    }

    if (request.eventType === "project_archived") {
      const allowed = await canActOnProject({
        db,
        actor,
        project,
        permission: "projects.edit",
      });
      const proof = allowed
        ? await loadRecentProjectEvent({
            db,
            actor,
            projectId: project.id,
            eventKind: "project_archived",
          })
        : null;
      if (!allowed) return { ok: false, status: 403, reason: "Forbidden" };
      if (project.status.toLowerCase() !== "archived" || !proof) {
        return { ok: false, status: 409, reason: "Missing archive event" };
      }
      return {
        ok: true,
        event: {
          eventType: request.eventType,
          companyId: actor.companyId,
          recipientUserIds: values(project.team_member_ids),
          preferenceKey: "project_updates",
          type: "project_archived",
          title: `${project.title} archived`,
          body: `${actor.name} archived ${project.title}.`,
          persistent: false,
          actionUrl: projectActionUrl(project.id),
          actionLabel: "View Project",
          projectId: project.id,
          deepLinkType: "project",
          dedupeKey: `project-archived:${String(proof.id)}`,
          pushData: {
            type: "projectArchived",
            projectId: project.id,
            screen: "projectDetails",
          },
        },
      };
    }

    const opportunityId = project.opportunity_ref;
    if (!opportunityId) {
      return {
        ok: false,
        status: 409,
        reason: "Missing conversion relationship",
      };
    }
    const [{ data: opportunity }, { data: conversionEvent }, authorization] =
      await Promise.all([
        db
          .from("opportunities")
          .select("id, title, assigned_to, stage, project_ref")
          .eq("id", opportunityId)
          .eq("company_id", actor.companyId)
          .is("deleted_at", null)
          .maybeSingle(),
        db
          .from("opportunity_conversion_events")
          .select("id, actor_user_id")
          .eq("opportunity_id", opportunityId)
          .eq("project_id", project.id)
          .eq("company_id", actor.companyId)
          .eq("event_type", "converted_to_project")
          .maybeSingle(),
        db.rpc("authorize_opportunity_action_as_system", {
          p_actor_user_id: actor.userId,
          p_opportunity_id: opportunityId,
          p_action: "convert",
        }),
      ]);
    if (!opportunity || !conversionEvent) {
      return { ok: false, status: 409, reason: "Missing conversion event" };
    }
    if (
      authorization.error ||
      authorization.data !== true ||
      conversionEvent.actor_user_id !== actor.userId ||
      opportunity.project_ref !== project.id ||
      String(opportunity.stage).toLowerCase() !== "won"
    ) {
      return { ok: false, status: 403, reason: "Forbidden" };
    }
    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: actor.companyId,
        recipientUserIds: opportunity.assigned_to
          ? [String(opportunity.assigned_to)]
          : [],
        preferenceKey: "project_updates",
        type: "lead_converted",
        title: "Deal converted to project",
        body: `${actor.name} converted ${String(opportunity.title)} to a project.`,
        persistent: false,
        actionUrl: projectActionUrl(project.id),
        actionLabel: "View Project",
        projectId: project.id,
        deepLinkType: "project",
        dedupeKey: `lead-converted:${String(conversionEvent.id)}`,
        pushData: {
          type: "leadConverted",
          projectId: project.id,
          screen: "projectDetails",
        },
      },
    };
  }

  if (
    request.eventType === "task_assigned" ||
    request.eventType === "task_completed" ||
    request.eventType === "schedule_change"
  ) {
    const loaded = await loadTask(db, actor, request.taskId);
    if (!loaded)
      return { ok: false, status: 404, reason: "Task event not found" };
    const { task, project } = loaded;
    const allowed = await canActOnProject({
      db,
      actor,
      project,
      permission: "projects.edit",
    });
    if (!allowed) return { ok: false, status: 403, reason: "Forbidden" };
    if (!isFresh(task.updated_at)) {
      return { ok: false, status: 409, reason: "Stale task event" };
    }
    const taskTitle = task.custom_title?.trim() || "Task";
    const taskMembers = values(task.team_member_ids);

    if (request.eventType === "task_assigned") {
      return {
        ok: true,
        event: {
          eventType: request.eventType,
          companyId: actor.companyId,
          recipientUserIds: intersect(
            request.candidateRecipientIds,
            taskMembers
          ),
          preferenceKey: "task_assigned",
          type: "task_assigned",
          title: "New Task Assignment",
          body: `${actor.name} assigned you ${taskTitle} on ${project.title}.`,
          persistent: false,
          actionUrl: projectActionUrl(project.id),
          actionLabel: "View Task",
          projectId: project.id,
          deepLinkType: "task",
          dedupeKey: `task-assigned:${task.id}:${task.updated_at}`,
          pushData: {
            type: "taskAssignment",
            taskId: task.id,
            projectId: project.id,
            screen: "taskDetails",
          },
        },
      };
    }

    if (request.eventType === "task_completed") {
      if (task.status.toLowerCase() !== "completed") {
        return { ok: false, status: 409, reason: "Task is not completed" };
      }
      return {
        ok: true,
        event: {
          eventType: request.eventType,
          companyId: actor.companyId,
          recipientUserIds: taskMembers,
          preferenceKey: "task_completed",
          type: "task_completed",
          title: "Task Completed",
          body: `${actor.name} completed ${taskTitle} on ${project.title}.`,
          persistent: false,
          actionUrl: projectActionUrl(project.id),
          actionLabel: "View Project",
          projectId: project.id,
          deepLinkType: "task",
          dedupeKey: `task-completed:${task.id}:${task.updated_at}`,
          pushData: {
            type: "taskCompletion",
            taskId: task.id,
            projectId: project.id,
            screen: "projectDetails",
          },
        },
      };
    }

    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: actor.companyId,
        recipientUserIds: taskMembers,
        preferenceKey: "schedule_changes",
        type: "schedule_change",
        title: "Schedule Update",
        body: `${actor.name} rescheduled ${taskTitle} on ${project.title}.`,
        persistent: false,
        actionUrl: projectActionUrl(project.id),
        actionLabel: "View Task",
        projectId: project.id,
        deepLinkType: "task",
        dedupeKey: `schedule-change:${task.id}:${task.updated_at}`,
        pushData: {
          type: "scheduleChange",
          taskId: task.id,
          projectId: project.id,
          screen: "taskDetails",
        },
      },
    };
  }

  if (request.eventType === "mention") {
    const { data: note, error } = await db
      .from("project_notes")
      .select(
        "id, project_id, company_id, author_id, content, mentioned_user_ids, created_at"
      )
      .eq("id", request.noteId)
      .eq("company_id", actor.companyId)
      .eq("author_id", actor.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !note)
      return { ok: false, status: 404, reason: "Mention not found" };
    if (!isFresh(note.created_at)) {
      return { ok: false, status: 409, reason: "Stale mention event" };
    }
    const project = await loadProject(db, actor, String(note.project_id));
    if (!project || project.deleted_at) {
      return { ok: false, status: 404, reason: "Mention project not found" };
    }
    const preview = String(note.content ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const body = preview
      ? `“${preview.slice(0, 80)}${preview.length > 80 ? "…" : ""}” on ${project.title}`
      : `You were mentioned in a note on ${project.title}.`;
    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: actor.companyId,
        recipientUserIds: values(note.mentioned_user_ids),
        preferenceKey: "team_mentions",
        type: "mention",
        title: `${actor.name} mentioned you`,
        body,
        persistent: false,
        actionUrl: projectActionUrl(project.id),
        actionLabel: "View Note",
        projectId: project.id,
        noteId: String(note.id),
        deepLinkType: "project_note",
        dedupeKey: `mention:${String(note.id)}`,
        pushData: {
          type: "projectNoteMention",
          projectId: project.id,
          noteId: String(note.id),
          screen: "projectNotes",
        },
      },
    };
  }

  if (request.eventType === "expense_submitted") {
    const { data: expense, error } = await db
      .from("expenses")
      .select(
        "id, company_id, submitted_by, status, description, merchant_name, updated_at"
      )
      .eq("id", request.expenseId)
      .eq("company_id", actor.companyId)
      .eq("submitted_by", actor.userId)
      .is("deleted_at", null)
      .maybeSingle();
    const allowed = await checkPermissionById(
      actor.userId,
      "expenses.create",
      "own"
    );
    if (!allowed) return { ok: false, status: 403, reason: "Forbidden" };
    if (error || !expense)
      return { ok: false, status: 404, reason: "Expense not found" };
    if (
      !isFresh(expense.updated_at) ||
      !["submitted", "pending"].includes(String(expense.status))
    ) {
      return {
        ok: false,
        status: 409,
        reason: "Expense is not newly submitted",
      };
    }
    const { data: approvers, error: approverError } = await db.rpc(
      "users_with_permission",
      {
        p_company_id: actor.companyId,
        p_permission: "expenses.approve",
        p_required_scope: "all",
      }
    );
    if (approverError)
      return { ok: false, status: 409, reason: "Recipient lookup failed" };
    const description =
      String(
        expense.description ?? expense.merchant_name ?? "an expense"
      ).trim() || "an expense";
    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: actor.companyId,
        recipientUserIds: Array.isArray(approvers) ? approvers.map(String) : [],
        preferenceKey: "expense_submitted",
        type: "expense_submitted",
        title: "Expense Submitted",
        body: `${actor.name} submitted ${description}.`,
        persistent: false,
        actionUrl: "/expenses",
        actionLabel: "Review",
        deepLinkType: "expenses",
        dedupeKey: `expense-submitted:${String(expense.id)}:${String(expense.updated_at)}`,
        pushData: { type: "expenseSubmitted", screen: "expenses" },
      },
    };
  }

  if (
    request.eventType !== "expense_approved" &&
    request.eventType !== "expense_paid"
  ) {
    return { ok: false, status: 409, reason: "Unsupported notification event" };
  }

  const { data: batch, error: batchError } = await db
    .from("expense_batches")
    .select(
      "id, company_id, batch_number, status, submitted_by, reviewed_by, reviewed_at, paid_by, paid_at"
    )
    .eq("id", request.batchId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  const canApprove = await checkPermissionById(
    actor.userId,
    "expenses.approve",
    "all"
  );
  if (!canApprove) return { ok: false, status: 403, reason: "Forbidden" };
  if (batchError || !batch) {
    return { ok: false, status: 404, reason: "Expense batch not found" };
  }
  const approvedStatuses = ["approved", "partially_approved", "auto_approved"];

  if (request.eventType === "expense_approved") {
    if (
      batch.reviewed_by !== actor.userId ||
      !approvedStatuses.includes(String(batch.status)) ||
      !isFresh(batch.reviewed_at)
    ) {
      return { ok: false, status: 409, reason: "Batch is not newly approved" };
    }
    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: actor.companyId,
        recipientUserIds: batch.submitted_by
          ? [String(batch.submitted_by)]
          : [],
        preferenceKey: "expense_approved",
        type: "expense_approved",
        title: "Expense Approved",
        body: `Your expense batch ${String(batch.batch_number)} was approved.`,
        persistent: false,
        actionUrl: "/expenses",
        actionLabel: "View",
        deepLinkType: "expenses",
        dedupeKey: `expense-approved:${String(batch.id)}:${String(batch.reviewed_at)}`,
        pushData: { type: "expenseApproved", screen: "expenses" },
      },
    };
  }

  if (
    batch.paid_by !== actor.userId ||
    !approvedStatuses.includes(String(batch.status)) ||
    !isFresh(batch.paid_at)
  ) {
    return { ok: false, status: 409, reason: "Batch is not newly paid" };
  }
  return {
    ok: true,
    event: {
      eventType: request.eventType,
      companyId: actor.companyId,
      recipientUserIds: batch.submitted_by ? [String(batch.submitted_by)] : [],
      preferenceKey: "expense_approved",
      type: "expense_paid",
      title: "Expenses Paid Out",
      body: `Your expense batch ${String(batch.batch_number)} was paid out.`,
      persistent: false,
      actionUrl: "/expenses",
      actionLabel: "View",
      deepLinkType: "expenses",
      dedupeKey: `expense-paid:${String(batch.id)}:${String(batch.paid_at)}`,
      pushData: { type: "expensePaid", screen: "expenses" },
    },
  };
}
