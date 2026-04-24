import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { CalibrationService } from "@/lib/api/services/calibration-service";
import type {
  ActivityFilters,
  RecentEventType,
} from "@/lib/types/calibration";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const allowed = await checkPermissionById(auth.id, "email.configure_ai");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const typesParam = sp.get("types");
  const filters: ActivityFilters = {
    types:
      typesParam === "all" || !typesParam
        ? "all"
        : (typesParam.split(",") as RecentEventType[]),
    timeRange: (sp.get("timeRange") ?? "day") as ActivityFilters["timeRange"],
  };
  const cursor = sp.get("cursor") ?? undefined;
  const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10), 200);

  const { events, nextCursor } = await CalibrationService.getActivityLog(
    auth.companyId,
    filters,
    cursor,
    limit
  );
  return NextResponse.json({ events, nextCursor });
}
