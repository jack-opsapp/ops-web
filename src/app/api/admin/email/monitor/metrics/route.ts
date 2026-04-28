/**
 * GET /api/admin/email/monitor/metrics
 *
 * Admin-gated read of `email_event_metrics(p_minutes_back, p_bucket)`.
 * Used by the Event Monitor dashboard at /admin/email?tab=event-monitor.
 *
 * Query params:
 *   - minutesBack: 5..1440 (default 60)
 *   - bucket: 1m | 5m | 15m | (omit for no bucketing)
 */
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const sp = req.nextUrl.searchParams;
  const minutesBackRaw = Number(sp.get("minutesBack") ?? 60);
  const minutesBack = Number.isFinite(minutesBackRaw)
    ? Math.min(Math.max(Math.trunc(minutesBackRaw), 5), 1440)
    : 60;

  const bucketParam = sp.get("bucket");
  const bucket =
    bucketParam === "1m" || bucketParam === "5m" || bucketParam === "15m"
      ? bucketParam
      : null;

  const db = getServiceRoleClient();
  const { data, error } = await db.rpc("email_event_metrics", {
    p_minutes_back: minutesBack,
    p_bucket: bucket,
  });
  if (error) {
    console.error("[monitor/metrics] RPC error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ metrics: data });
});
