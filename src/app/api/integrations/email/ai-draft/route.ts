/**
 * POST /api/integrations/email/ai-draft
 *
 * Generate an AI draft email using writing profile + thread context.
 * NOT gated by phase_c — any user with email connected can use this.
 * Memory context is used when available (phase_c) but not required.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const {
      companyId,
      userId,
      connectionId,
      opportunityId,
      threadId,
      userInstruction,
      subject,
      configuredSubject,
    } = body;

    if (!companyId || !userId || !connectionId) {
      return NextResponse.json(
        { error: "companyId, userId, and connectionId are required" },
        { status: 400 }
      );
    }
    const actorResolution = await resolveEmailRouteActor(request, {
      claimedCompanyId: companyId,
      claimedUserId: userId,
    });
    if (!actorResolution.ok) return actorResolution.response;
    const { actor } = actorResolution;

    let internalThreadId: string | null = null;
    if (threadId) {
      const { data: ownedThread, error: threadError } = await supabase
        .from("email_threads")
        .select("id")
        .eq("company_id", actor.companyId)
        .eq("connection_id", connectionId)
        .eq("provider_thread_id", threadId)
        .maybeSingle();
      if (threadError) {
        throw new Error(
          `Failed to validate email thread: ${threadError.message}`
        );
      }
      if (!ownedThread?.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      internalThreadId = ownedThread.id as string;
    }

    const access = await resolveEmailOpportunityAccess({
      actor,
      operation: "send",
      ...(internalThreadId ? { threadId: internalThreadId } : {}),
      connectionId,
      ...(threadId ? { providerThreadId: threadId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await AIDraftService.generateDraft({
      // From this point forward the authorization projection is the only
      // identity source. Request-body ids above were compatibility assertions
      // for the resolver and must never steer prompt retrieval.
      companyId: access.actor.companyId,
      userId: access.actor.userId,
      connectionId: access.connectionId,
      opportunityId: access.opportunityId ?? undefined,
      threadId: access.providerThreadId ?? undefined,
      emailAccess: access,
      userInstruction,
      subject,
      configuredSubject,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-draft]", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to generate draft",
      },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
