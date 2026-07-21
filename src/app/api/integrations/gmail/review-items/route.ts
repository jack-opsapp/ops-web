/**
 * OPS Web - Gmail Review Items
 *
 * GET /api/integrations/gmail/review-items?companyId=...
 * Returns activities that need review (unmatched or low-confidence matches).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import {
  buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";

export async function GET(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    const actorResolution = await resolveEmailRouteActor(request, {
      claimedCompanyId: companyId,
    });
    if (!actorResolution.ok) return actorResolution.response;
    const listAccess = await resolveEmailInboxListAccess({
      actor: actorResolution.actor,
      supabase,
    });
    if (!listAccess.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const authorizationFilter =
      buildEmailThreadListAuthorizationFilter(listAccess);
    if (authorizationFilter.empty) {
      return NextResponse.json({ ok: true, items: [] });
    }

    const { data: gmailConnections, error: gmailConnectionsError } =
      await supabase
        .from("email_connections")
        .select("id")
        .eq("company_id", actorResolution.actor.companyId)
        .eq("provider", "gmail");
    if (gmailConnectionsError) throw gmailConnectionsError;
    const gmailConnectionIds = (gmailConnections ?? []).map((connection) =>
      String(connection.id)
    );
    const allowedConnectionIds = authorizationFilter.connectionIds
      ? authorizationFilter.connectionIds.filter((connectionId) =>
          gmailConnectionIds.includes(connectionId)
        )
      : gmailConnectionIds;
    if (allowedConnectionIds.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }

    // The review queue surfaces inbound emails the auto-classification pipeline
    // couldn't confidently place (unmatched) or matched only weakly
    // (needs_review). Bound it to a rolling window: before this, the queue
    // accreted every such email ever received, so the pipeline badge read a
    // permanent "99+" of months-old noise no operator would ever triage — a
    // count that could never reach zero. A recent window keeps the queue an
    // honest, actionable reflection of the operator's current reality; the hard
    // cap guards against a pathological backlog (e.g. right after a large
    // historical import).
    const REVIEW_WINDOW_DAYS = 30;
    const REVIEW_MAX_ITEMS = 200;
    const windowStart = new Date(
      Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // Step 1: Fetch recent activities needing review
    let activitiesQuery = supabase
      .from("activities")
      .select(
        "id, subject, content, from_email, match_confidence, suggested_client_id, client_id, email_thread_id, email_connection_id, opportunity_id, created_at"
      )
      .eq("type", "email")
      .eq("company_id", actorResolution.actor.companyId)
      .in("email_connection_id", allowedConnectionIds)
      .eq("is_read", false)
      .gte("created_at", windowStart)
      .or("match_needs_review.eq.true,match_confidence.eq.unmatched")
      .order("created_at", { ascending: false });
    if (authorizationFilter.unlinkedOnly) {
      activitiesQuery = activitiesQuery.is("opportunity_id", null);
    }
    if (authorizationFilter.or) {
      activitiesQuery = activitiesQuery.or(
        authorizationFilter.or.replaceAll(
          "connection_id",
          "email_connection_id"
        )
      );
    }
    const { data: activities, error } =
      await activitiesQuery.limit(REVIEW_MAX_ITEMS);

    if (error) throw error;

    if (!activities || activities.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }

    // Step 2: Collect unique client IDs (suggested + assigned)
    const clientIds = new Set<string>();
    for (const a of activities) {
      if (a.suggested_client_id) clientIds.add(a.suggested_client_id as string);
      if (a.client_id) clientIds.add(a.client_id as string);
    }

    // Step 3: Fetch client names in a second query
    const clientMap: Record<string, string> = {};
    if (clientIds.size > 0) {
      const { data: clients, error: clientError } = await supabase
        .from("clients")
        .select("id, name")
        .eq("company_id", actorResolution.actor.companyId)
        .in("id", Array.from(clientIds));

      if (clientError) throw clientError;

      for (const c of clients ?? []) {
        clientMap[c.id as string] = c.name as string;
      }
    }

    // Step 4: Map activities with client names
    const items = activities.map((a) => ({
      id: a.id,
      subject: a.subject,
      content: a.content,
      fromEmail: a.from_email,
      matchConfidence: a.match_confidence,
      suggestedClientId: a.suggested_client_id,
      suggestedClientName: a.suggested_client_id
        ? (clientMap[a.suggested_client_id as string] ?? null)
        : null,
      clientId: a.client_id,
      clientName: a.client_id
        ? (clientMap[a.client_id as string] ?? null)
        : null,
      emailThreadId: a.email_thread_id,
      createdAt: a.created_at,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[gmail-review-items]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
