/**
 * GET /api/admin/email/monitor/stream
 *
 * Returns the most recent N rows from `email_events`, optionally filtered
 * by event types. Used by the live event stream panel in the Event Monitor.
 *
 * Query params:
 *   - limit: 1..200 (default 50)
 *   - events: comma-separated list of event types (e.g. "bounce,spamreport")
 */
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
    : 50;

  const eventTypes = sp
    .get("events")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const db = getServiceRoleClient();
  let q = db
    .from("email_events")
    .select("id, email, event, timestamp, sg_message_id, reason")
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (eventTypes && eventTypes.length > 0) q = q.in("event", eventTypes);

  const { data, error } = await q;
  if (error) {
    console.error("[monitor/stream] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data ?? [] });
});
