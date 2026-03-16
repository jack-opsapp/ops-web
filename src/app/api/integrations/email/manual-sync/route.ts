/**
 * POST /api/integrations/email/manual-sync
 * Manual sync endpoint — triggered by user button or webhook push.
 * Supports single connectionId or all active connections for a companyId.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { SyncEngine } from "@/lib/api/services/sync-engine";

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { connectionId, companyId, source } = body;

    if (!connectionId && !companyId) {
      return NextResponse.json(
        { error: "connectionId or companyId required" },
        { status: 400 }
      );
    }

    let connectionIds: string[] = [];

    if (connectionId) {
      connectionIds = [connectionId];
    } else {
      const { data: connections } = await supabase
        .from("email_connections")
        .select("id")
        .eq("company_id", companyId)
        .eq("sync_enabled", true)
        .eq("status", "active");

      connectionIds = (connections || []).map((c) => c.id as string);
    }

    const results = [];
    for (const id of connectionIds) {
      const result = await SyncEngine.runSync(id);
      results.push({ connectionId: id, ...result });
    }

    return NextResponse.json({
      ok: true,
      source: source || "manual",
      connectionsProcessed: results.length,
      results,
    });
  } catch (err) {
    console.error("[email-manual-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
