/**
 * OPS Web - Accounting Sync Cron
 *
 * GET /api/cron/accounting-sync
 * Vercel cron-compatible endpoint that syncs all enabled accounting connections.
 * Protected by CRON_SECRET header check (fail-closed).
 * Calls sync functions directly instead of HTTP loopback.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runSyncForConnection } from "@/lib/api/services/sync-orchestrator";

export async function GET(request: NextRequest) {
  // Verify cron secret — fail-closed: reject if secret is missing or doesn't match
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();

  // Find all enabled connections
  const { data: connections, error } = await supabase
    .from("accounting_connections")
    .select("id, company_id, provider, last_sync_at")
    .eq("is_connected", true)
    .eq("sync_enabled", true);

  if (error) {
    console.error("Cron: Failed to fetch connections:", error.message);
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 });
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({ message: "No active connections to sync", synced: 0 });
  }

  const results: Array<{ companyId: string; provider: string; status: string }> = [];

  for (const conn of connections) {
    try {
      const syncResult = await runSyncForConnection(
        supabase,
        conn.company_id,
        conn.provider,
        conn.id,
        conn.last_sync_at
      );
      results.push({
        companyId: conn.company_id,
        provider: conn.provider,
        status: syncResult.success ? "success" : "error",
      });
    } catch (err) {
      console.error(`Cron sync error for ${conn.company_id}/${conn.provider}:`, err);
      results.push({
        companyId: conn.company_id,
        provider: conn.provider,
        status: "error",
      });
    }
  }

  return NextResponse.json({
    message: `Sync cron complete`,
    synced: results.filter((r) => r.status === "success").length,
    total: results.length,
    results,
  });
}
