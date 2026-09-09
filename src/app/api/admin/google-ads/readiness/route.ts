/**
 * GET /api/admin/google-ads/readiness
 *
 * The seven engine readiness checks for the admin ledger: the stored probe
 * (refreshed daily by ads-sync, on demand by the internal probe route) paired
 * with live counts. Admin-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { computeReadiness } from "@/lib/ads/readiness";
import { loadReadinessCounts, loadReadinessProbe } from "@/lib/ads/readiness-probe";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const db = getAdminSupabase();
  const [probe, counts] = await Promise.all([loadReadinessProbe(db), loadReadinessCounts(db)]);
  const readiness = computeReadiness({
    probe,
    conversionActionCount: counts.conversionActions,
    clickIdCompanies30d: counts.clickIdCompanies30d,
    eventStates: counts.eventStates,
  });
  return NextResponse.json(
    { ...readiness, counts },
    { headers: { "cache-control": "no-store" } }
  );
});
