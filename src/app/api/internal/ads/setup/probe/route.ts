/**
 * POST /api/internal/ads/setup/probe
 *
 * Run the engine readiness probe against Google (validateOnly throughout,
 * nothing written there) and store it on ads_sync_status `engine-readiness`.
 * The daily ads-sync cron calls the same logic; this route is the operator's
 * on-demand refresh. CRON_SECRET bearer, like the cron routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { computeReadiness } from "@/lib/ads/readiness";
import { loadReadinessCounts, refreshReadinessProbe } from "@/lib/ads/readiness-probe";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } }
  );
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const db = getAdminSupabase();
    const probe = await refreshReadinessProbe(db);
    const counts = await loadReadinessCounts(db);
    const readiness = computeReadiness({
      probe,
      conversionActionCount: counts.conversionActions,
      clickIdCompanies30d: counts.clickIdCompanies30d,
      eventStates: counts.eventStates,
    });
    return NextResponse.json({ probe, counts, ...readiness }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ads-setup] probe failed:", message);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
