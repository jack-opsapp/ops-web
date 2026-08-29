/**
 * POST /api/notifications/push-companion
 *
 * Companion pushes for rail rows iOS has ALREADY written server-side through a
 * narrow SECURITY DEFINER RPC. The caller names a notification type and the
 * recipients whose rows it just caused; the server finds those durable rows and
 * pushes each row's own copy. No caller-supplied copy, no caller-supplied
 * targeting beyond "which of my company's rows to look at".
 *
 * This replaces `/api/notifications/send`, which stays permanently retired as a
 * 404 — it accepted arbitrary recipients and arbitrary copy.
 *
 * Worst-case abuse by an authenticated same-company actor: re-pushing an
 * existing rail row that is at most 15 minutes old, to that row's own
 * recipient, with that row's own copy. Idempotent per row.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  parsePushCompanionRequest,
  sendPushCompanions,
} from "@/lib/notifications/push-companion";
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

    const parsed = parsePushCompanionRequest(await req.json());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.reason }, { status: 400 });
    }

    const result = await sendPushCompanions({
      db: getServiceRoleClient(),
      actor: actorResolution.actor,
      request: parsed.value,
    });

    return NextResponse.json({
      success: true,
      matched: result.matched,
      pushed: result.pushed,
      suppressed: result.suppressed,
    });
  } catch (error) {
    console.error("[push-companion] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
