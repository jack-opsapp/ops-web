/**
 * GET /api/admin/email/monitor/anomalies
 *
 * Paginated read of `email_anomaly_log`. Used by the Anomaly History
 * panel and supports drill-down by kind.
 *
 * Query params:
 *   - limit: 1..200 (default 50)
 *   - offset: >= 0 (default 0)
 *   - kind: optional bounce_spike | spam_spike | delivery_drop | volume_drop
 */
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set([
  "bounce_spike",
  "spam_spike",
  "delivery_drop",
  "volume_drop",
]);

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
    : 50;
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const offset = Number.isFinite(offsetRaw)
    ? Math.max(Math.trunc(offsetRaw), 0)
    : 0;
  const kindParam = sp.get("kind");
  const kind = kindParam && VALID_KINDS.has(kindParam) ? kindParam : null;

  const db = getServiceRoleClient();
  let q = db
    .from("email_anomaly_log")
    .select("*", { count: "exact" })
    .order("detected_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (kind) q = q.eq("kind", kind);

  const { data, count, error } = await q;
  if (error) {
    console.error("[monitor/anomalies] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
});
