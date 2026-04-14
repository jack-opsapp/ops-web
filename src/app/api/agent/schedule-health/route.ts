/**
 * GET /api/agent/schedule-health
 * Returns today's schedule health metrics for the dashboard widget.
 * Admin/owner only.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { ScheduleOptimizationService } from "@/lib/api/services/schedule-optimization-service";

export async function GET(req: NextRequest) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json(
      { error: "companyId required" },
      { status: 400 }
    );
  }

  // Verify user belongs to this company and has admin/owner role
  const user = await findUserByAuth(authUser.uid, undefined, "id, company_id, role");
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const health = await ScheduleOptimizationService.getScheduleHealth(
      companyId,
      new Date()
    );
    return NextResponse.json(health);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[schedule-health]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
