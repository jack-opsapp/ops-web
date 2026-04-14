/**
 * GET/PUT /api/settings/lifecycle
 * Manages lifecycle automation settings for a company.
 * Stored in companies.lifecycle_settings JSONB column.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

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
  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(authUser.uid, undefined, "id, company_id, role");
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("companies")
    .select("lifecycle_settings")
    .eq("id", companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    config: data?.lifecycle_settings ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { companyId, config } = body;

  if (!companyId || !config) {
    return NextResponse.json(
      { error: "companyId and config required" },
      { status: 400 }
    );
  }

  // Verify user belongs to this company and has admin/owner role
  const supabase = getServiceRoleClient();
  const user = await findUserByAuth(authUser.uid, undefined, "id, company_id, role");
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userRole = (user.role as string) ?? "";
  if (!["admin", "owner"].includes(userRole)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Validate config shape
  const validConfig = {
    status_update_frequency_days: Math.max(
      0,
      Number(config.status_update_frequency_days) || 7
    ),
    overdue_threshold_days: Math.max(
      0,
      Number(config.overdue_threshold_days) || 1
    ),
    archive_after_days: Math.max(
      0,
      Number(config.archive_after_days) || 30
    ),
    stage_task_overrides:
      typeof config.stage_task_overrides === "object" &&
      config.stage_task_overrides !== null
        ? Object.fromEntries(
            Object.entries(
              config.stage_task_overrides as Record<string, unknown>
            )
              .filter(
                ([, v]) =>
                  Array.isArray(v) &&
                  v.every((item: unknown) => typeof item === "string")
              )
              .map(([k, v]) => [
                k,
                (v as string[]).filter((s) => s.trim().length > 0),
              ])
          )
        : {},
  };

  const { error } = await supabase
    .from("companies")
    .update({ lifecycle_settings: validConfig })
    .eq("id", companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
