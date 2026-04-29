/**
 * GET /api/admin/email/monitor/domains
 *
 * Returns the top N bounce-receiver domains in the window. Used by the
 * "Top bounce domains" horizontal-bar widget.
 *
 * Query params:
 *   - minutesBack: 5..1440 (default 60)
 *   - limit: 1..50 (default 10)
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
  const limitRaw = Number(sp.get("limit") ?? 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
    : 10;

  const db = getServiceRoleClient();
  const { data, error } = await db.rpc("email_top_bounce_domains", {
    p_minutes_back: minutesBack,
    p_limit: limit,
  });
  if (error) {
    console.error("[monitor/domains] RPC error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ domains: data ?? [] });
});
