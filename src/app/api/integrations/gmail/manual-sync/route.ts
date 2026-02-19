/**
 * OPS Web - Gmail Manual Sync
 *
 * POST /api/integrations/gmail/manual-sync
 * Triggered by the user from the Settings UI to manually sync Gmail inbox.
 * Does NOT require cron secret — uses companyId from request body.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { GmailService } from "@/lib/api/services";

export async function POST(request: NextRequest) {
  // Set the service-role client so all requireSupabase() calls use it
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    // Load active connections for this company only
    const { data: connections, error } = await supabase
      .from("gmail_connections")
      .select("id, company_id, email")
      .eq("company_id", companyId)
      .eq("sync_enabled", true);

    if (error) throw error;

    const results: Array<{
      connectionId: string;
      email: string;
      activitiesCreated: number;
      error?: string;
    }> = [];

    for (const conn of connections ?? []) {
      try {
        const result = await GmailService.syncInbox(conn.id as string);
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          activitiesCreated: result.activitiesCreated,
        });
      } catch (err) {
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          activitiesCreated: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalActivities = results.reduce((s, r) => s + r.activitiesCreated, 0);

    return NextResponse.json({
      ok: true,
      connectionsProcessed: results.length,
      totalActivitiesCreated: totalActivities,
      results,
    });
  } catch (err) {
    console.error("[gmail-manual-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
