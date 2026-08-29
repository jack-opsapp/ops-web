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
import { nameIdentityTokens } from "@/lib/api/services/email-matching-service-v2";
import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The sender's display name, but ONLY when the thread's latest sender is the
 * author of THIS activity. `activities` does not persist a display name, and
 * borrowing a different participant's name would attach the wrong identity.
 */
function senderDisplayNameForActivity(
  thread: { latest_sender_name?: unknown; latest_sender_email?: unknown },
  activity: { from_email?: unknown }
): string | null {
  const activityFrom =
    typeof activity.from_email === "string"
      ? activity.from_email.trim().toLowerCase()
      : "";
  const threadFrom =
    typeof thread.latest_sender_email === "string"
      ? thread.latest_sender_email.trim().toLowerCase()
      : "";
  if (!activityFrom || activityFrom !== threadFrom) return null;
  const name =
    typeof thread.latest_sender_name === "string"
      ? thread.latest_sender_name.trim()
      : "";
  return name && !name.includes("@") ? name : null;
}

/**
 * Close the loop the matcher opened (bug 3799225e).
 *
 * Elaine reached review only because her sub-contact record — "Bruce And
 * Elaine" on Mark Vanderwerf's client — had NO email, so the exact-match tier
 * could never see her. Confirming the match is the moment we learn her address;
 * writing it onto that existing sub-contact is what stops the next email from
 * repeating the whole cycle.
 *
 * Prefers UPDATING the name-matched email-less sub-contact over inserting a
 * duplicate. Best-effort by design: a confirmation must never fail because the
 * relationship could not be enriched.
 */
async function backfillConfirmedSubContactEmail(input: {
  supabase: SupabaseClient;
  companyId: string;
  clientId: string | null;
  senderEmail: string | null;
  senderName: string | null;
}): Promise<void> {
  const { supabase, companyId, clientId } = input;
  const senderEmail = (input.senderEmail ?? "").trim().toLowerCase();
  if (!clientId || !senderEmail || !senderEmail.includes("@")) return;

  try {
    const literalEmail = escapeIlikeLiteral(senderEmail);

    // Already the client's own address — nothing to record.
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .ilike("email", literalEmail)
      .maybeSingle();
    if (client) return;

    // Already recorded on a sub-contact — nothing to record.
    const { data: existing } = await supabase
      .from("sub_clients")
      .select("id")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .ilike("email", literalEmail)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    const senderTokens = new Set(nameIdentityTokens(input.senderName));

    if (senderTokens.size > 0) {
      const { data: emailless, error: emaillessError } = await supabase
        .from("sub_clients")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .is("email", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (emaillessError) throw emaillessError;

      const match = (
        (emailless ?? []) as Array<{ id: string; name: string | null }>
      ).find((subContact) =>
        nameIdentityTokens(subContact.name).some((token) =>
          senderTokens.has(token)
        )
      );

      if (match) {
        const { error: updateError } = await supabase
          .from("sub_clients")
          .update({ email: senderEmail, updated_at: new Date().toISOString() })
          .eq("id", match.id)
          .eq("company_id", companyId)
          .is("email", null);
        if (updateError) throw updateError;
        return;
      }
    }

    // No existing sub-contact to enrich. Insert one only when a REAL display
    // name is available — a name derived from an email local part is exactly
    // the junk identity the matcher is trying to avoid creating.
    if (!input.senderName) return;
    const { error: insertError } = await supabase.from("sub_clients").insert({
      company_id: companyId,
      client_id: clientId,
      name: input.senderName,
      email: senderEmail,
    });
    if (insertError) throw insertError;
  } catch (err) {
    console.error(
      "[gmail-confirm-match] sub-contact email backfill failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
  }
}

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
        "id, company_id, suggested_client_id, email_connection_id, email_thread_id, opportunity_id, from_email"
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
      .select("id, latest_sender_name, latest_sender_email")
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

    // The human just told us who this sender really is. Record that on the
    // relationship itself, so the NEXT email from them matches on Tier 1 and
    // never reaches review again.
    await backfillConfirmedSubContactEmail({
      supabase,
      companyId: actorResolution.actor.companyId,
      clientId:
        typeof activity.suggested_client_id === "string"
          ? activity.suggested_client_id
          : null,
      senderEmail:
        typeof activity.from_email === "string" ? activity.from_email : null,
      senderName: senderDisplayNameForActivity(thread, activity),
    });

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
