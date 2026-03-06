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

    // Step 1: Read current sync_filters and append domain to excludeDomains
    const { data: connection, error: readError } = await supabase
      .from("gmail_connections")
      .select("id, sync_filters")
      .eq("id", connectionId)
      .single();

    if (readError) throw readError;

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const syncFilters = (connection.sync_filters as Record<string, unknown>) ?? {};
    const excludeDomains = Array.isArray(syncFilters.excludeDomains)
      ? (syncFilters.excludeDomains as string[])
      : [];

    if (!excludeDomains.includes(domain)) {
      excludeDomains.push(domain);
    }

    const updatedFilters = { ...syncFilters, excludeDomains };

    const { error: updateError } = await supabase
      .from("gmail_connections")
      .update({ sync_filters: updatedFilters })
      .eq("id", connectionId);

    if (updateError) throw updateError;

    // Step 2: Mark all activities from this domain as read
    const { error: activitiesError } = await supabase
      .from("activities")
      .update({ is_read: true })
      .eq("company_id", companyId)
      .like("from_email", `%@${domain}`);

    if (activitiesError) throw activitiesError;

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
