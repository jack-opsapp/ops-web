/**
 * POST /api/cron/gmail-sync
 * Vercel cron: runs every 15 min, syncs connections that are due.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { GmailService } from "@/lib/api/services";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const { data: connections, error } = await supabase
      .from("gmail_connections")
      .select("id, company_id, email, sync_interval_minutes, last_synced_at")
      .eq("sync_enabled", true);

    if (error) throw error;

    const now = Date.now();
    const results: Array<{
      connectionId: string;
      email: string;
      activitiesCreated: number;
      matched: number;
      error?: string;
    }> = [];

    for (const conn of connections ?? []) {
      const intervalMs = ((conn.sync_interval_minutes as number) ?? 60) * 60 * 1000;
      const lastSynced = conn.last_synced_at
        ? new Date(conn.last_synced_at as string).getTime()
        : 0;

      if (now - lastSynced < intervalMs) continue;

      try {
        const result = await GmailService.syncInbox(conn.id as string);
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          activitiesCreated: result.activitiesCreated,
          matched: result.matched,
        });
      } catch (err) {
        results.push({
          connectionId: conn.id as string,
          email: conn.email as string,
          activitiesCreated: 0,
          matched: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      synced: results.length,
      results,
    });
  } catch (err) {
    console.error("[gmail-cron-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
