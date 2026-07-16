/**
 * POST /api/integrations/email/draft-feedback
 *
 * Record abandonment of an AI-drafted email.
 *
 * Sent outcomes are deliberately owned by the confirmed-delivery learning
 * queue. Accepting a client-reported "sent" event here would allow an
 * unconfirmed preview/edit to train the writing profile.
 * The draft's live thread/lead/sender intersection is rechecked and all
 * attribution comes from the canonical OPS actor, never request identity.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailDraftAccess } from "@/lib/email/email-draft-access";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    const actor = actorResolution.actor;

    const body = await request.json();
    const { draftHistoryId, outcome } = body;

    if (
      typeof draftHistoryId !== "string" ||
      !draftHistoryId.trim() ||
      !outcome
    ) {
      return NextResponse.json(
        {
          error: "draftHistoryId and outcome are required",
        },
        { status: 400 }
      );
    }

    if (outcome !== "discarded") {
      return NextResponse.json(
        { error: "Only discarded draft feedback is accepted here" },
        { status: 400 }
      );
    }

    const access = await resolveEmailDraftAccess({
      actor,
      draftHistoryId,
      operation: "send",
      supabase,
    });
    if (
      !access.allowed ||
      !["drafted", "auto_drafted"].includes(access.draft.status)
    ) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    await AIDraftService.recordDraftOutcome(
      draftHistoryId,
      actor.companyId,
      actor.userId,
      "discarded"
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[draft-feedback]", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to record feedback",
      },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
