import { NextRequest, NextResponse } from "next/server";

import { LeadAssignmentDeliveryService } from "@/lib/api/services/lead-assignment-delivery-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result = await LeadAssignmentDeliveryService.processBatch(
      getServiceRoleClient(),
      { limit: 50, leaseSeconds: 360 }
    );
    const ok =
      result.errors.length === 0 &&
      result.requeued === 0 &&
      result.terminalFailed === 0;

    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Lead assignment delivery worker failed";
    console.error("[cron/lead-assignment-deliveries]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
