import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import type { NotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import { resolveNotificationEvent } from "@/lib/notifications/notification-event-resolver";
import {
  createTrustedNotifications,
  resolveNotificationPreferences,
  type NotificationRouteActor,
} from "@/lib/notifications/server-notification-service";

export type NotificationEventDispatchResult =
  | { ok: true; notified: number; pushed: number; emailed: 0 }
  | { ok: false; status: 403 | 404 | 409 | 500; reason: string };

/**
 * Canonical server execution seam shared by the authenticated HTTP route and
 * trusted server workflows. Authorization, recipient resolution, copy,
 * persistence, dedupe, preferences, and push all remain centralized.
 */
export async function dispatchNotificationEvent(params: {
  db: SupabaseClient;
  actor: NotificationRouteActor;
  request: NotificationDispatchRequest;
}): Promise<NotificationEventDispatchResult> {
  const resolved = await resolveNotificationEvent(params);
  if (!resolved.ok) return resolved;

  const event = resolved.event;
  const preferences = await resolveNotificationPreferences({
    companyId: event.companyId,
    recipientUserIds: event.recipientUserIds,
    excludeUserId: params.actor.userId,
    preferenceKey: event.preferenceKey,
    db: params.db,
  });

  const rail = await createTrustedNotifications(
    {
      companyId: event.companyId,
      recipientUserIds: preferences.inAppRecipientIds,
      type: event.type,
      title: event.title,
      body: event.body,
      persistent: event.persistent,
      actionUrl: event.actionUrl,
      actionLabel: event.actionLabel,
      projectId: event.projectId ?? null,
      deepLinkType: event.deepLinkType,
      dedupeKey: event.dedupeKey,
    },
    params.db
  );
  if (rail.errors > 0) {
    return {
      ok: false,
      status: 500,
      reason: "Notification persistence failed",
    };
  }

  const projectStatusEventId =
    params.request.eventType === "project_status_change"
      ? params.request.projectStatusEventId
      : null;
  const isProjectStatusChange = projectStatusEventId !== null;
  const createdRecipients = new Set(rail.createdRecipientIds);
  const pushRecipientIds = isProjectStatusChange
    ? preferences.pushRecipientIds
    : preferences.pushRecipientIds.filter((userId) =>
        createdRecipients.has(userId)
      );
  let pushed = 0;
  if (pushRecipientIds.length > 0) {
    const result = await sendOneSignalPush({
      recipientUserIds: pushRecipientIds,
      title: event.title,
      body: event.body,
      data: event.pushData,
      ...(isProjectStatusChange
        ? { idempotencyKey: projectStatusEventId }
        : {}),
    });
    if (isProjectStatusChange && !result.ok) {
      return {
        ok: false,
        status: 500,
        reason: "Notification push failed",
      };
    }
    pushed = result.ok ? result.recipients : 0;
  }

  return {
    ok: true,
    notified: rail.createdRecipientIds.length,
    pushed,
    emailed: 0,
  };
}
