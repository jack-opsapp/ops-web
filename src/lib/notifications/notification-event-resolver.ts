import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import { normalizeNotificationPreviewText } from "@/lib/notifications/notification-copy";
import {
  filterActiveCompanyRecipients,
  type NotificationRouteActor,
} from "@/lib/notifications/server-notification-service";
import { checkPermissionById } from "@/lib/supabase/check-permission";

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

interface ProjectStatusNotificationProof {
  eventId: string;
  companyId: string;
  projectId: string;
  actorUserId: string;
  oldStatus: string;
  newStatus: string;
  statusVersion: number;
  projectTitle: string;
  recipientUserIds: string[];
}

const EVENT_FRESHNESS_MS = 15 * 60 * 1000;
// OneSignal retains an idempotency UUID for 30 days. Stop retrying one day
// earlier so a late replay can never create a second provider message.
const MENTION_EDIT_FRESHNESS_MS = 29 * 24 * 60 * 60 * 1000;

function values(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isFresh(
  value: unknown,
  maximumAgeMs: number = EVENT_FRESHNESS_MS
): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= Date.now() - maximumAgeMs;
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
  if (error)
    throw new Error(`Failed to load notification project: ${error.message}`);
  if (!data) return null;
  return data as ProjectRow;
}

async function resolveProjectStatusProof(params: {
  db: SupabaseClient;
  actor: NotificationRouteActor;
  projectId: string;
  eventId: string;
}): Promise<ProjectStatusNotificationProof | null> {
  const { data, error } = await params.db.rpc(
    "resolve_project_status_notification_as_system",
    {
      p_actor_user_id: params.actor.userId,
      p_project_id: params.projectId,
      p_event_id: params.eventId,
    }
  );
  if (error) {
    throw new Error(`Failed to resolve project notification: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const proof = data as Record<string, unknown>;
  if (
    typeof proof.event_id !== "string" ||
    typeof proof.company_id !== "string" ||
    typeof proof.project_id !== "string" ||
    typeof proof.actor_user_id !== "string" ||
    typeof proof.old_status !== "string" ||
    typeof proof.new_status !== "string" ||
    typeof proof.status_version !== "number" ||
    !Number.isSafeInteger(proof.status_version) ||
    proof.status_version < 1 ||
    typeof proof.project_title !== "string" ||
    !Array.isArray(proof.recipient_user_ids)
  ) {
    throw new Error("Project notification proof was invalid");
  }
  return {
    eventId: proof.event_id,
    companyId: proof.company_id,
    projectId: proof.project_id,
    actorUserId: proof.actor_user_id,
    oldStatus: proof.old_status,
    newStatus: proof.new_status,
    statusVersion: proof.status_version,
    projectTitle: proof.project_title,
    recipientUserIds: values(proof.recipient_user_ids),
  };
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

  if (request.eventType === "project_status_change") {
    const proof = await resolveProjectStatusProof({
      db,
      actor,
      projectId: request.projectId,
      eventId: request.projectStatusEventId,
    });
    if (
      !proof ||
      proof.companyId !== actor.companyId ||
      proof.projectId !== request.projectId ||
      proof.eventId !== request.projectStatusEventId ||
      proof.actorUserId !== actor.userId
    ) {
      return {
        ok: false,
        status: 409,
        reason: "Missing current status event",
      };
    }
    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: proof.companyId,
        recipientUserIds: proof.recipientUserIds,
        preferenceKey: "project_updates",
        type: "project_status_change",
        title: `Status changed: ${proof.oldStatus} → ${proof.newStatus}`,
        body: `${actor.name} moved ${proof.projectTitle} from ${proof.oldStatus} to ${proof.newStatus}.`,
        persistent: false,
        actionUrl: projectActionUrl(proof.projectId),
        actionLabel: "View Project",
        projectId: proof.projectId,
        deepLinkType: "project",
        dedupeKey: `project-status-lifecycle:${proof.eventId}`,
        pushData: {
          type: "projectStatusChange",
          projectId: proof.projectId,
          screen: "projectDetails",
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
    const preview = normalizeNotificationPreviewText(
      String(note.content ?? "")
    );
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

  if (request.eventType === "mention_edit") {
    const { data: proof, error: proofError } = await db
      .from("project_note_mention_events")
      .select(
        "id, note_id, project_id, company_id, actor_user_id, recipient_user_ids, content_snapshot, actor_name_snapshot, project_title_snapshot, created_at"
      )
      .eq("id", request.mentionEventId)
      .eq("company_id", actor.companyId)
      .eq("actor_user_id", actor.userId)
      .maybeSingle();
    if (proofError) {
      throw new Error(
        `Failed to load mention edit proof: ${proofError.message}`
      );
    }
    if (
      !proof ||
      String(proof.id) !== request.mentionEventId ||
      String(proof.company_id) !== actor.companyId ||
      String(proof.actor_user_id) !== actor.userId
    ) {
      return {
        ok: false,
        status: 404,
        reason: "Mention edit event not found",
      };
    }
    if (!isFresh(proof.created_at, MENTION_EDIT_FRESHNESS_MS)) {
      return {
        ok: false,
        status: 409,
        reason: "Stale mention edit event",
      };
    }

    const noteId = String(proof.note_id ?? "");
    const projectId = String(proof.project_id ?? "");
    if (!noteId || !projectId) {
      throw new Error("Mention edit proof was invalid");
    }
    const { data: note, error: noteError } = await db
      .from("project_notes")
      .select(
        "id, project_id, company_id, author_id, mentioned_user_ids, deleted_at, event_kind"
      )
      .eq("id", noteId)
      .eq("project_id", projectId)
      .eq("company_id", actor.companyId)
      .eq("author_id", actor.userId)
      .is("deleted_at", null)
      .is("event_kind", null)
      .maybeSingle();
    if (noteError) {
      throw new Error(
        `Failed to revalidate mention edit note: ${noteError.message}`
      );
    }
    if (!note) {
      return {
        ok: false,
        status: 409,
        reason: "Mention edit note is no longer eligible",
      };
    }

    const contentSnapshot =
      typeof proof.content_snapshot === "string"
        ? proof.content_snapshot
        : null;
    const actorName =
      typeof proof.actor_name_snapshot === "string"
        ? proof.actor_name_snapshot.trim()
        : "";
    const projectTitle =
      typeof proof.project_title_snapshot === "string"
        ? proof.project_title_snapshot.trim()
        : "";
    if (contentSnapshot === null || !actorName || !projectTitle) {
      throw new Error("Mention edit proof was invalid");
    }

    const currentMentionIds = new Set(values(note.mentioned_user_ids));
    const stillMentionedEventRecipients = values(
      proof.recipient_user_ids
    ).filter((userId) => currentMentionIds.has(userId));
    const recipientUserIds = await filterActiveCompanyRecipients({
      companyId: actor.companyId,
      recipientUserIds: stillMentionedEventRecipients,
      excludeUserId: actor.userId,
      db,
    });

    const project = await loadProject(db, actor, projectId);
    if (!project || project.deleted_at) {
      return {
        ok: false,
        status: 404,
        reason: "Mention project not found",
      };
    }
    const preview = normalizeNotificationPreviewText(contentSnapshot);
    const body = preview
      ? `“${preview.slice(0, 80)}${preview.length > 80 ? "…" : ""}” on ${projectTitle}`
      : `You were mentioned in a note on ${projectTitle}.`;

    return {
      ok: true,
      event: {
        eventType: request.eventType,
        companyId: actor.companyId,
        recipientUserIds,
        preferenceKey: "team_mentions",
        type: "mention",
        title: `${actorName} mentioned you`,
        body,
        persistent: false,
        actionUrl: projectActionUrl(projectId),
        actionLabel: "View Note",
        projectId,
        noteId,
        deepLinkType: "project_note",
        dedupeKey: `mention-edit:${request.mentionEventId}`,
        pushData: {
          type: "projectNoteMention",
          projectId,
          noteId,
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
