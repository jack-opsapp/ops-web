import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { CalibrationService } from "@/lib/api/services/calibration-service";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const allowed = await checkPermissionById(auth.id, "email.configure_ai");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") ?? "5", 10),
    20
  );

  const events = await CalibrationService.getRecentEvents(auth.companyId, limit);
  return NextResponse.json({ events });
}
