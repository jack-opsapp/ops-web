/**
 * POST /api/notifications/dispatch
 *
 * Accepts only a persisted event proof. The canonical OPS actor/company,
 * authorized relationship, recipients, copy, persistence, navigation, and
 * push payload are all resolved server-side.
 */

import { NextRequest, NextResponse } from "next/server";

import { sendOneSignalPush } from "@/lib/integrations/onesignal";
import { parseNotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import { resolveNotificationEvent } from "@/lib/notifications/notification-event-resolver";
import {
  createTrustedNotifications,
  resolveNotificationPreferences,
  resolveNotificationRouteActor,
} from "@/lib/notifications/server-notification-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const actorResolution = await resolveNotificationRouteActor(req);
    if (!actorResolution.ok) {
      return NextResponse.json(
        {
          error: actorResolution.status === 401 ? "Unauthorized" : "Forbidden",
        },
        { status: actorResolution.status }
      );
    }

    const parsed = parseNotificationDispatchRequest(await req.json());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.reason }, { status: 400 });
    }

    const db = getServiceRoleClient();
    const resolved = await resolveNotificationEvent({
      db,
      actor: actorResolution.actor,
      request: parsed.value,
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.reason },
        { status: resolved.status }
      );
    }

    const event = resolved.event;
    const preferences = await resolveNotificationPreferences({
      companyId: event.companyId,
      recipientUserIds: event.recipientUserIds,
      excludeUserId: actorResolution.actor.userId,
      preferenceKey: event.preferenceKey,
      db,
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
      db
    );
    if (rail.errors > 0) {
      return NextResponse.json(
        { error: "Notification persistence failed" },
        { status: 500 }
      );
    }

    const createdRecipients = new Set(rail.createdRecipientIds);
    const pushRecipientIds = preferences.pushRecipientIds.filter((userId) =>
      createdRecipients.has(userId)
    );
    let pushed = 0;
    if (pushRecipientIds.length > 0) {
      const result = await sendOneSignalPush({
        recipientUserIds: pushRecipientIds,
        title: event.title,
        body: event.body,
        data: event.pushData,
      });
      pushed = result.ok ? result.recipients : 0;
    }

    return NextResponse.json({
      success: true,
      notified: rail.createdRecipientIds.length,
      pushed,
      emailed: 0,
    });
  } catch (error) {
    console.error("[notification-dispatch] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
