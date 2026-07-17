/**
 * POST /api/notifications/dispatch
 *
 * Accepts only a persisted event proof. The canonical OPS actor/company,
 * authorized relationship, recipients, copy, persistence, navigation, and
 * push payload are all resolved server-side.
 */

import { NextRequest, NextResponse } from "next/server";

import { dispatchNotificationEvent } from "@/lib/notifications/dispatch-notification-event";
import { parseNotificationDispatchRequest } from "@/lib/notifications/notification-dispatch-policy";
import { resolveNotificationRouteActor } from "@/lib/notifications/server-notification-service";
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
    const result = await dispatchNotificationEvent({
      db,
      actor: actorResolution.actor,
      request: parsed.value,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason },
        { status: result.status }
      );
    }
    return NextResponse.json({
      success: true,
      notified: result.notified,
      pushed: result.pushed,
      emailed: result.emailed,
    });
  } catch (error) {
    console.error("[notification-dispatch] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
