/**
 * OPS Web - Gmail Ignore Activity
 *
 * POST /api/integrations/gmail/ignore
 * Dismisses an activity by marking it as read.
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
        "inbox.archive"
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
    const { data: activity, error: readError } = await supabase
      .from("activities")
      .select(
        "company_id, email_connection_id, email_thread_id, opportunity_id, match_confidence"
      )
      .eq("id", activityId)
      .eq("company_id", actorResolution.actor.companyId)
      .single();
    if (readError || !activity) {
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
    if (connectionError || !connection || (connection.provider !== "gmail" && activity.match_confidence !== "work_intent_review")) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }
    // Message-scoped forwards deliberately have no shared email_threads row.
    // Authorize the exact mailbox before acknowledging a durable work review.
    if (activity.match_confidence === "work_intent_review" && !activity.opportunity_id) {
      const { data: allowed, error: accessError } = await supabase.rpc("authorize_email_inbox_action_as_system", {
        p_actor_user_id: actorResolution.actor.userId, p_connection_id: activity.email_connection_id,
        p_opportunity_id: null, p_action: "view",
      });
      if (accessError || allowed !== true) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
      const { data: acknowledged, error: acknowledgeError } = await supabase.from("activities")
        .update({ is_read: true, match_needs_review: false })
        .eq("id", activityId).eq("company_id", actorResolution.actor.companyId)
        .eq("email_connection_id", activity.email_connection_id)
        .eq("match_confidence", "work_intent_review").is("opportunity_id", null)
        .select("id").maybeSingle();
      if (acknowledgeError) throw acknowledgeError;
      if (!acknowledged) return NextResponse.json({ error: "Activity changed. Refresh and try again." }, { status: 409 });
      return NextResponse.json({ ok: true });
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

    const { error } = await supabase
      .from("activities")
      .update({ is_read: true })
      .eq("id", activityId)
      .eq("company_id", actorResolution.actor.companyId)
      .eq("email_connection_id", activity.email_connection_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail-ignore]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
