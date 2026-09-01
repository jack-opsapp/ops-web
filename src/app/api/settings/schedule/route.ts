/**
 * GET/PUT /api/settings/schedule
 * Manages schedule optimization settings for a company.
 * Stored in companies.schedule_settings JSONB column.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { DEFAULT_SCHEDULE_SETTINGS } from "@/lib/types/approval-queue";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function authorizeCompanySettings(req: NextRequest, companyId: string) {
  const authUser = await verifyAdminAuth(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id"
  );
  if (!user || user.company_id !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = await checkPermissionById(
    user.id as string,
    "settings.company"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const authorizationError = await authorizeCompanySettings(req, companyId);
  if (authorizationError) return authorizationError;

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("companies")
    .select("schedule_settings")
    .eq("id", companyId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    config: data?.schedule_settings ?? DEFAULT_SCHEDULE_SETTINGS,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const companyId = isRecord(body) ? body.companyId : null;
  const config = isRecord(body) ? body.config : null;

  if (typeof companyId !== "string" || !isRecord(config)) {
    return NextResponse.json(
      { error: "companyId and config required" },
      { status: 400 }
    );
  }

  const authorizationError = await authorizeCompanySettings(req, companyId);
  if (authorizationError) return authorizationError;

  const validConfig = {
    enabled:
      typeof config.enabled === "boolean"
        ? config.enabled
        : DEFAULT_SCHEDULE_SETTINGS.enabled,
    optimization_window_days: Math.max(
      1,
      Math.min(
        7,
        Number(config.optimization_window_days) ||
          DEFAULT_SCHEDULE_SETTINGS.optimization_window_days
      )
    ),
    travel_optimization:
      typeof config.travel_optimization === "boolean"
        ? config.travel_optimization
        : DEFAULT_SCHEDULE_SETTINGS.travel_optimization,
    conflict_detection:
      typeof config.conflict_detection === "boolean"
        ? config.conflict_detection
        : DEFAULT_SCHEDULE_SETTINGS.conflict_detection,
    weather_awareness:
      typeof config.weather_awareness === "boolean"
        ? config.weather_awareness
        : DEFAULT_SCHEDULE_SETTINGS.weather_awareness,
    climate_zone: ["northern", "southern", "auto"].includes(
      String(config.climate_zone)
    )
      ? config.climate_zone
      : DEFAULT_SCHEDULE_SETTINGS.climate_zone,
    cascade_detection:
      typeof config.cascade_detection === "boolean"
        ? config.cascade_detection
        : DEFAULT_SCHEDULE_SETTINGS.cascade_detection,
    outdoor_task_type_ids: Array.isArray(config.outdoor_task_type_ids)
      ? config.outdoor_task_type_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0
        )
      : DEFAULT_SCHEDULE_SETTINGS.outdoor_task_type_ids,
  };

  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("companies")
    .update({ schedule_settings: validConfig })
    .eq("id", companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
