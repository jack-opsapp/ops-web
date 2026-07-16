/**
 * POST /api/integrations/email/auto-send/cancel
 *
 * Cancel a pending auto-send email.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AutoSendService } from "@/lib/api/services/auto-send-service";

export const maxDuration = 15;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const id = typeof body?.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json(
        { error: "Auto-send ID required" },
        { status: 400 }
      );
    }
    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    const { actor } = actorResolution;

    const cancelled = await AutoSendService.cancelAutoSend(
      id,
      actor.companyId,
      { actorUserId: actor.userId }
    );

    if (!cancelled) {
      return NextResponse.json(
        { error: "Auto-send not found or already processed" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auto-send-cancel]", err);
    return NextResponse.json(
      { error: "Failed to cancel auto-send" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
