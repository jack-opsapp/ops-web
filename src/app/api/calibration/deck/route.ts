import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { CalibrationService } from "@/lib/api/services/calibration-service";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const allowed = await checkPermissionById(auth.id, "email.configure_ai");
  if (!allowed) {
    return NextResponse.json(
      { error: "Forbidden: email.configure_ai required" },
      { status: 403 }
    );
  }

  try {
    const state = await CalibrationService.getDeckState(auth.companyId);
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to fetch deck state",
      },
      { status: 500 }
    );
  }
}
