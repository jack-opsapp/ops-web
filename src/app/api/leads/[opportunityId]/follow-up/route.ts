import { NextRequest, NextResponse } from "next/server";

import {
  LeadFollowUpError,
  sendLeadFollowUp,
} from "@/lib/api/services/lead-follow-up-send-service";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ opportunityId: string }> }
) {
  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      const actorResolution = await resolveEmailRouteActor(request);
      if (!actorResolution.ok) return actorResolution.response;

      const { opportunityId } = await context.params;
      const payload = (await request.json().catch(() => null)) as {
        idempotencyKey?: unknown;
      } | null;
      const idempotencyKey =
        typeof payload?.idempotencyKey === "string"
          ? payload.idempotencyKey.trim()
          : "";
      if (!UUID_RE.test(idempotencyKey)) {
        return NextResponse.json(
          { error: "LEAD_FOLLOW_UP_IDEMPOTENCY_KEY_INVALID" },
          { status: 400 }
        );
      }
      if (!UUID_RE.test(opportunityId?.trim() ?? "")) {
        return NextResponse.json(
          { error: "LEAD_FOLLOW_UP_OPPORTUNITY_INVALID" },
          { status: 400 }
        );
      }

      const result = await sendLeadFollowUp({
        actor: actorResolution.actor,
        opportunityId,
        idempotencyKey,
      });
      return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
      if (error instanceof LeadFollowUpError) {
        return NextResponse.json(
          { error: error.code, ...error.details },
          { status: error.status }
        );
      }
      console.error("[lead-follow-up]", error);
      return NextResponse.json(
        { error: "LEAD_FOLLOW_UP_REQUEST_FAILED" },
        { status: 500 }
      );
    }
  });
}
