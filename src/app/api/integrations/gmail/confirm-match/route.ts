/**
 * OPS Web - Gmail Confirm Match
 *
 * POST /api/integrations/gmail/confirm-match
 * Confirms a suggested client match: promotes suggested_client_id to client_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import { checkPermissionById } from "@/lib/supabase/check-permission";

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const actorResolution = await resolveEmailRouteActor(request);
    if (!actorResolution.ok) return actorResolution.response;
    if (
      !(await checkPermissionById(
        actorResolution.actor.userId,
        "inbox.categorize"
      ))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const activityId = body.activityId as string | undefined;

    if (!activityId) {
      return NextResponse.json(
        { error: "activityId is required" },
        { status: 400 }
      );
    }

    // Read the activity to get suggested_client_id
    const { data: activity, error: readError } = await supabase
      .from("activities")
      .select(
        "id, company_id, suggested_client_id, email_connection_id, email_thread_id, opportunity_id"
      )
      .eq("id", activityId)
      .eq("company_id", actorResolution.actor.companyId)
      .single();

    if (readError) throw readError;

    if (!activity) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }
    if (!activity.email_connection_id || !activity.email_thread_id) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }
    const { data: connection, error: connectionError } = await supabase
      .from("email_connections")
      .select("id, provider")
      .eq("id", activity.email_connection_id)
      .eq("company_id", actorResolution.actor.companyId)
      .maybeSingle();
    if (connectionError || !connection || connection.provider !== "gmail") {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }
    const { data: thread, error: threadError } = await supabase
      .from("email_threads")
      .select("id")
      .eq("company_id", actorResolution.actor.companyId)
      .eq("connection_id", activity.email_connection_id)
      .eq("provider_thread_id", activity.email_thread_id)
      .maybeSingle();
    if (threadError || !thread) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }
    const threadAccess = await resolveEmailOpportunityAccess({
      actor: actorResolution.actor,
      operation: "mutate",
      threadId: String(thread.id),
      connectionId: String(activity.email_connection_id),
      providerThreadId: String(activity.email_thread_id),
      supabase,
    });
    if (
      !threadAccess.allowed ||
      (threadAccess.opportunityId ?? null) !== (activity.opportunity_id ?? null)
    ) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }

    // Update: promote suggested_client_id to client_id
    const { error: updateError } = await supabase
      .from("activities")
      .update({
        match_needs_review: false,
        client_id: activity.suggested_client_id,
        is_read: true,
      })
      .eq("id", activityId)
      .eq("company_id", actorResolution.actor.companyId)
      .eq("email_connection_id", activity.email_connection_id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail-confirm-match]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
