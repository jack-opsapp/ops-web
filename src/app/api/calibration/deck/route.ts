import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { CalibrationService } from "@/lib/api/services/calibration-service";
import { resolveEmailInboxListAccess } from "@/lib/email/email-opportunity-access";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

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
    const supabase = getServiceRoleClient();
    const access = await resolveEmailInboxListAccess({
      actor: { userId: auth.id, companyId: auth.companyId },
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const state = await CalibrationService.getDeckState(
      auth.companyId,
      auth.id,
      access
    );
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
