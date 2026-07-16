import { NextRequest, NextResponse } from "next/server";

import { getPhaseCWeekSummary } from "@/lib/api/services/phase-c-week-summary-service";
import { resolveEmailInboxListAccess } from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function GET(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;

  const supabase = getServiceRoleClient();
  const access = await resolveEmailInboxListAccess({
    actor: actorResolution.actor,
    supabase,
  });
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const summary = await getPhaseCWeekSummary({
      actor: actorResolution.actor,
      access,
      supabase,
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[phase-c-week-summary]", error);
    return NextResponse.json(
      { error: "Failed to load Phase C summary" },
      { status: 500 }
    );
  }
}
