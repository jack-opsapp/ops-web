/**
 * OPS Web - Gmail Block Domain
 *
 * POST /api/integrations/gmail/block-domain
 * Adds a domain to the connection's excludeDomains list and marks all
 * activities from that domain as read.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import {
  buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";
import { checkPermissionById } from "@/lib/supabase/check-permission";

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const domain = body.domain as string | undefined;
    const connectionId = body.connectionId as string | undefined;
    const companyId = body.companyId as string | undefined;

    if (!domain || !connectionId || !companyId) {
      return NextResponse.json(
        { error: "domain, connectionId, and companyId are required" },
        { status: 400 }
      );
    }

    const access = await resolveEmailConnectionOperationAccess({
      request,
      claimedCompanyId: companyId,
      connectionId,
      requireUsable: true,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }
    if (access.connections[0]?.provider !== "gmail") {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    if (!(await checkPermissionById(access.actor.userId, "inbox.categorize"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const listAccess = await resolveEmailInboxListAccess({
      actor: access.actor,
      supabase,
    });
    if (!listAccess.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const authorizationFilter =
      buildEmailThreadListAuthorizationFilter(listAccess);

    // Step 1: Read current sync_filters and append domain to excludeDomains
    const { data: connection, error: readError } = await supabase
      .from("email_connections")
      .select("id, company_id, provider, sync_filters")
      .eq("id", connectionId)
      .eq("company_id", access.actor.companyId)
      .eq("provider", "gmail")
      .single();

    if (readError) throw readError;

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    const syncFilters =
      (connection.sync_filters as Record<string, unknown>) ?? {};
    const excludeDomains = Array.isArray(syncFilters.excludeDomains)
      ? (syncFilters.excludeDomains as string[])
      : [];

    if (!excludeDomains.includes(domain)) {
      excludeDomains.push(domain);
    }

    const updatedFilters = { ...syncFilters, excludeDomains };

    const { error: updateError } = await supabase
      .from("email_connections")
      .update({ sync_filters: updatedFilters })
      .eq("id", connectionId)
      .eq("company_id", access.actor.companyId)
      .eq("provider", "gmail");

    if (updateError) throw updateError;

    // Step 2: Mark only activity rows the actor can currently see.
    if (
      !authorizationFilter.empty &&
      (!authorizationFilter.connectionIds ||
        authorizationFilter.connectionIds.includes(connectionId))
    ) {
      let activitiesQuery = supabase
        .from("activities")
        .update({ is_read: true })
        .eq("company_id", access.actor.companyId)
        .eq("email_connection_id", connectionId)
        .like("from_email", `%@${domain}`);
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
      const { error: activitiesError } = await activitiesQuery;
      if (activitiesError) throw activitiesError;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[gmail-block-domain]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
