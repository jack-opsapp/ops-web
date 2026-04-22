/**
 * OPS Admin — PMF MRR Trend API
 *
 * GET /api/admin/pmf/mrr-trend
 *
 * Returns the weekly MRR series powering the BASE SAAS · MRR TREND chart on
 * the PMF dashboard. Aggregation lives in the `pmf_mrr_weekly(weeks int)` RPC
 * (added in 20260422120000_pmf_mrr_weekly_rpc.sql) so the SQL stays close to
 * the data and weeks with no payments still surface as $0 rows.
 *
 * Behaviour:
 *   - 401 / 403 via the shared admin-auth helpers (withAdmin / requireAdmin)
 *   - 500 with the Postgres error message on RPC failure
 *   - 200 + { data: WeekPoint[] } on success, where
 *       WeekPoint = { week: string (ISO year-week, e.g. "2026-17"),
 *                     mrr_cents: number }
 *
 * Window is fixed at 18 weeks to match the chart spec (matches the frontend's
 * default range — extend by adding a `?weeks=` query param later if needed).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

async function handleGET(req: NextRequest) {
  await requireAdmin(req);
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc("pmf_mrr_weekly", { weeks: 18 });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export const GET = withAdmin(handleGET);
