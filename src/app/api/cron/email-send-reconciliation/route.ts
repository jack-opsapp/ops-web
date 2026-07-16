import { NextRequest, NextResponse } from "next/server";

import { runEmailSendReconciliationRecovery } from "@/lib/api/services/email-send-reconciliation-recovery-service";
import { runWithSupabase } from "@/lib/supabase/helpers";
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

  const supabase = getServiceRoleClient();

  try {
    const result = await runWithSupabase(supabase, () =>
      runEmailSendReconciliationRecovery(supabase, {
        limit: 25,
        failureCooldownSeconds: 60,
        leaseSeconds: 300,
      })
    );
    const ok = result.failed === 0;
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503 });
  } catch (error) {
    const failure =
      error instanceof Error
        ? error.message
        : "Unknown email send reconciliation error";
    console.error("[cron/email-send-reconciliation]", failure);
    return NextResponse.json({ ok: false, error: failure }, { status: 500 });
  }
}
