import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isErrorResponse } from "../../agent/_lib/auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { CalibrationService } from "@/lib/api/services/calibration-service";
import { resolveEmailInboxListAccess } from "@/lib/email/email-opportunity-access";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

async function canReadCalibration(auth: { id: string; companyId: string }) {
  const access = await resolveEmailInboxListAccess({
    actor: { userId: auth.id, companyId: auth.companyId },
    supabase: getServiceRoleClient(),
  });
  return access.allowed;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const allowed = await checkPermissionById(auth.id, "email.configure_ai");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const access = { allowed: await canReadCalibration(auth) };
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = await CalibrationService.getFirstRunState(
    auth.companyId,
    auth.id
  );
  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;

  const allowed = await checkPermissionById(auth.id, "email.configure_ai");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const access = { allowed: await canReadCalibration(auth) };
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "dismiss") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  await CalibrationService.dismissFirstRun(auth.id);
  return NextResponse.json({ dismissed: true });
}
