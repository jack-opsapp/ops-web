import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import { resolveCrewNotificationEvent } from "@/lib/notifications/crew-notification-event-resolver";
import type { CrewNotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import { resolveNotificationPreferences } from "@/lib/notifications/server-notification-service";
import type { NotificationRouteActor } from "@/lib/notifications/server-notification-service";
import type { NotificationEventDispatchResult } from "@/lib/notifications/dispatch-notification-event";

/**
 * The authenticated narrow RPC creates the canonical rail row first. This
 * layer only applies channel preferences and quiet hours to the companion
 * push; it never reconstructs or duplicates persistence.
 */
export async function dispatchCrewNotificationEvent(params: {
  db: SupabaseClient;
  actorDb: SupabaseClient;
  actor: NotificationRouteActor;
  request: CrewNotificationDispatchRequest;
}): Promise<NotificationEventDispatchResult> {
  const resolved = await resolveCrewNotificationEvent(params);
  if (!resolved.ok) return resolved;

  let pushed = 0;
  for (const event of resolved.events) {
    const preferences = await resolveNotificationPreferences({
      companyId: event.companyId,
      recipientUserIds: event.recipientUserIds,
      preferenceKey: event.preferenceKey,
      db: params.db,
    });
    if (preferences.pushRecipientIds.length === 0) continue;
    const push = await sendOneSignalPush({
      recipientUserIds: preferences.pushRecipientIds,
      title: event.title,
      body: event.body,
      data: event.pushData,
    });
    if (!push.ok) {
      return {
        ok: false,
        status: 500,
        reason: "Notification push failed",
      };
    }
    pushed += push.recipients;
  }

  return {
    ok: true,
    notified: resolved.notified,
    pushed,
    emailed: 0,
  };
}
