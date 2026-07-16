import { NextRequest, NextResponse } from "next/server";

import { resolveNotificationRouteActor } from "@/lib/notifications/server-notification-service";
import { syncSetupPromptNotifications } from "@/lib/notifications/setup-prompt-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const actorResolution = await resolveNotificationRouteActor(request);
  if (!actorResolution.ok) {
    return NextResponse.json(
      {
        error: actorResolution.status === 401 ? "Unauthorized" : "Forbidden",
      },
      { status: actorResolution.status }
    );
  }

  const body = await request.text();
  if (body.trim() !== "") {
    return NextResponse.json(
      { error: "Request body is not allowed" },
      { status: 400 }
    );
  }

  try {
    const result = await syncSetupPromptNotifications({
      actor: actorResolution.actor,
      db: getServiceRoleClient(),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[setup-prompts] Failed to sync prompts:", error);
    return NextResponse.json(
      { error: "Failed to sync setup prompts" },
      { status: 500 }
    );
  }
}
